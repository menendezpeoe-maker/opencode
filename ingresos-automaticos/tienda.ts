// Tienda de un producto digital: Stripe cobra y el servidor entrega la descarga.
// Funciona 24/7 sin intervención: tú solo creas el producto y traes visitas.
import { abrirRegistro, crearEntrega } from "./entrega"

const stripeKey = Bun.env.STRIPE_SECRET_KEY
const priceID = Bun.env.STRIPE_PRICE_ID
const baseURL = Bun.env.BASE_URL ?? "http://localhost:3000"
const producto = Bun.file(Bun.env.PRODUCTO ?? "./productos/producto.pdf")

if (!stripeKey || !priceID) throw new Error("Faltan STRIPE_SECRET_KEY o STRIPE_PRICE_ID en .env")

// Solo entrega el archivo si Stripe confirma que esa sesión está pagada,
// y el enlace caduca por tiempo y por número de descargas (ver entrega.ts).
const entregar = crearEntrega({
  consultarSesion: (id) => stripe(`/checkout/sessions/${encodeURIComponent(id)}`),
  producto,
  db: abrirRegistro(Bun.env.REGISTRO_DESCARGAS ?? "./descargas.sqlite"),
  maxDescargas: Number(Bun.env.MAX_DESCARGAS ?? 3),
  horas: Number(Bun.env.HORAS_DESCARGA ?? 24),
})

Bun.serve({
  port: Number(Bun.env.PORT ?? 3000),
  routes: {
    "/": () => new Response(Bun.file("./landing.html")),
    "/comprar": { POST: crearPago },
    "/gracias": { GET: entregar },
  },
})

console.log(`Tienda abierta en ${baseURL}`)

async function crearPago() {
  const res = await stripe("/checkout/sessions", {
    mode: "payment",
    "line_items[0][price]": priceID!,
    "line_items[0][quantity]": "1",
    success_url: `${baseURL}/gracias?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: baseURL,
    "invoice_creation[enabled]": "true", // Stripe envía factura al cliente
  })
  return Response.redirect(res.url, 303)
}

async function stripe(path: string, form?: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: form ? "POST" : "GET",
    headers: { Authorization: `Bearer ${stripeKey}` },
    body: form ? new URLSearchParams(form) : undefined,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error?.message ?? "Error de Stripe")
  return json
}
