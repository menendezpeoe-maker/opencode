import { describe, expect, test } from "bun:test"
import { abrirRegistro, crearEntrega } from "./entrega"

const creada = 1_760_000_000 // segundos, como en Stripe

function tienda(o: { pagada?: boolean; max?: number; horas?: number; reloj?: { ms: number } } = {}) {
  const reloj = o.reloj ?? { ms: creada * 1000 + 60_000 }
  let llamadas = 0
  const entregar = crearEntrega({
    consultarSesion: async (id) => {
      llamadas++
      return { id, payment_status: o.pagada === false ? "unpaid" : "paid", created: creada }
    },
    producto: new File(["contenido"], "guia.pdf"),
    db: abrirRegistro(":memory:"),
    maxDescargas: o.max ?? 1,
    horas: o.horas ?? 24,
    ahora: () => reloj.ms,
  })
  const pedir = (id = "cs_test_123") => entregar(new Request(`http://x/gracias?session_id=${id}`))
  return { pedir, reloj, llamadas: () => llamadas }
}

describe("enlace de descarga", () => {
  test("entrega el archivo la primera vez", async () => {
    const res = await tienda().pedir()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("contenido")
    expect(res.headers.get("Content-Disposition")).toContain("guia.pdf")
  })

  test("rechaza un enlace reutilizado, sin volver a llamar a Stripe", async () => {
    const t = tienda({ max: 1 })
    expect((await t.pedir()).status).toBe(200)
    expect((await t.pedir()).status).toBe(410)
    expect(t.llamadas()).toBe(1)
  })

  test("permite hasta MAX_DESCARGAS y luego rechaza", async () => {
    const t = tienda({ max: 3 })
    for (let i = 0; i < 3; i++) expect((await t.pedir()).status).toBe(200)
    expect((await t.pedir()).status).toBe(410)
  })

  test("cada compra tiene su propio contador", async () => {
    const t = tienda({ max: 1 })
    expect((await t.pedir("cs_a")).status).toBe(200)
    expect((await t.pedir("cs_b")).status).toBe(200)
    expect((await t.pedir("cs_a")).status).toBe(410)
  })

  test("rechaza un enlace caducado aunque no se haya usado", async () => {
    const reloj = { ms: (creada + 24 * 3600 + 1) * 1000 }
    const res = await tienda({ reloj }).pedir()
    expect(res.status).toBe(410)
    expect(await res.text()).toContain("caducado")
  })

  test("un enlace caducado no gasta descargas", async () => {
    const reloj = { ms: (creada + 25 * 3600) * 1000 }
    const t = tienda({ reloj, max: 1 })
    expect((await t.pedir()).status).toBe(410)
    reloj.ms = creada * 1000 // imposible en la vida real; solo comprueba que no contó
    expect((await t.pedir()).status).toBe(200)
  })

  test("peticiones simultáneas no superan el límite", async () => {
    const t = tienda({ max: 1 })
    const res = await Promise.all([t.pedir(), t.pedir(), t.pedir()])
    expect(res.map((r) => r.status).sort()).toEqual([200, 410, 410])
  })

  test("rechaza pagos no completados e ids no válidos", async () => {
    expect((await tienda({ pagada: false }).pedir()).status).toBe(402)
    expect((await tienda().pedir("pi_123")).status).toBe(400)
  })
})
