// Tests de la tienda con Stripe simulado: no hace llamadas reales a api.stripe.com.
// Ejecutar desde ingresos-automaticos/: `bun test`
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

type StripeCall = { method: string; path: string; auth: string | null; form: URLSearchParams | null }
type StripeReply = { status?: number; body: unknown }

const calls: StripeCall[] = []
let reply: (call: StripeCall) => StripeReply = () => ({ status: 500, body: { error: { message: "sin respuesta" } } })

const realFetch = globalThis.fetch
const realServe = Bun.serve
let server: ReturnType<typeof Bun.serve>
let base: string
let dir: string
const contenido = "%PDF-1.4 contenido del producto de prueba"

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tienda-test-"))
  const archivo = path.join(dir, "mi-guia.pdf")
  await writeFile(archivo, contenido)

  Bun.env.STRIPE_SECRET_KEY = "sk_test_123"
  Bun.env.STRIPE_PRICE_ID = "price_abc"
  Bun.env.BASE_URL = "https://tienda.example"
  Bun.env.PRODUCTO = archivo

  // Stripe falso: intercepta solo las llamadas a api.stripe.com.
  spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.host !== "api.stripe.com") return realFetch(input, init)
    const headers = new Headers(init?.headers)
    const call: StripeCall = {
      method: init?.method ?? "GET",
      path: url.pathname.replace(/^\/v1/, ""),
      auth: headers.get("authorization"),
      form: init?.body ? new URLSearchParams(String(init.body)) : null,
    }
    calls.push(call)
    const r = reply(call)
    return Response.json(r.body, { status: r.status ?? 200 })
  }) as typeof fetch)

  // Arranca el servidor real en un puerto libre y guarda la referencia para pararlo.
  // El handler `error` imita lo que hace Bun en producción con una excepción (500),
  // porque bun test, sin él, trata la excepción como fallo del test.
  spyOn(Bun, "serve").mockImplementation(((opts: Parameters<typeof Bun.serve>[0]) => {
    const error = () => new Response("Error interno", { status: 500 })
    server = realServe({ error, ...opts, port: 0 } as Parameters<typeof Bun.serve>[0])
    return server
  }) as typeof Bun.serve)
  spyOn(console, "log").mockImplementation(() => {})

  await import("../tienda.ts")
  base = server.url.origin
})

afterEach(() => {
  calls.length = 0
})

afterAll(async () => {
  server?.stop(true)
  await rm(dir, { recursive: true, force: true })
})

describe("landing", () => {
  test("GET / sirve la página de venta", async () => {
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('action="/comprar"')
    expect(calls).toHaveLength(0)
  })
})

describe("crear pago (POST /comprar)", () => {
  test("crea una Checkout Session y redirige a Stripe", async () => {
    reply = () => ({ body: { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" } })
    const res = await fetch(`${base}/comprar`, { method: "POST", redirect: "manual" })

    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toBe("https://checkout.stripe.com/c/pay/cs_test_1")

    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call.method).toBe("POST")
    expect(call.path).toBe("/checkout/sessions")
    expect(call.auth).toBe("Bearer sk_test_123")
    expect(Object.fromEntries(call.form!)).toEqual({
      mode: "payment",
      "line_items[0][price]": "price_abc",
      "line_items[0][quantity]": "1",
      success_url: "https://tienda.example/gracias?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://tienda.example",
      "invoice_creation[enabled]": "true",
    })
  })

  test("si Stripe devuelve error, no redirige", async () => {
    reply = () => ({ status: 400, body: { error: { message: "No such price: 'price_abc'" } } })
    const res = await fetch(`${base}/comprar`, { method: "POST", redirect: "manual" })
    expect(res.status).toBe(500)
    expect(res.headers.get("location")).toBeNull()
  })

  test("GET /comprar no está permitido", async () => {
    const res = await fetch(`${base}/comprar`, { redirect: "manual" })
    expect(res.status).not.toBe(303)
    expect(calls).toHaveLength(0)
  })
})

describe("entrega de la descarga (GET /gracias)", () => {
  test("entrega el archivo si la sesión está pagada", async () => {
    reply = () => ({ body: { id: "cs_test_ok", payment_status: "paid" } })
    const res = await fetch(`${base}/gracias?session_id=cs_test_ok`)

    expect(res.status).toBe(200)
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="mi-guia.pdf"')
    expect(await res.text()).toBe(contenido)

    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe("GET")
    expect(calls[0].path).toBe("/checkout/sessions/cs_test_ok")
    expect(calls[0].auth).toBe("Bearer sk_test_123")
  })

  test.each(["unpaid", "no_payment_required"])("no entrega si payment_status es %s", async (estado) => {
    reply = () => ({ body: { id: "cs_test_x", payment_status: estado } })
    const res = await fetch(`${base}/gracias?session_id=cs_test_x`)
    expect(res.status).toBe(402)
    expect(await res.text()).not.toContain(contenido)
  })

  test("rechaza sin session_id y no llama a Stripe", async () => {
    const res = await fetch(`${base}/gracias`)
    expect(res.status).toBe(400)
    expect(calls).toHaveLength(0)
  })

  test("rechaza ids que no son de Checkout (cs_) y no llama a Stripe", async () => {
    for (const id of ["pi_123", "abc", "../../balance"]) {
      const res = await fetch(`${base}/gracias?session_id=${encodeURIComponent(id)}`)
      expect(res.status).toBe(400)
    }
    expect(calls).toHaveLength(0)
  })

  test("no entrega si Stripe no encuentra la sesión", async () => {
    reply = () => ({ status: 404, body: { error: { message: "No such checkout.session" } } })
    const res = await fetch(`${base}/gracias?session_id=cs_test_falsa`)
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain(contenido)
  })
})
