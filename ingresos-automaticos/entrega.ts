// Entrega del archivo comprado, con enlaces que caducan.
// El enlace /gracias?session_id=cs_... deja de valer cuando:
//  - han pasado HORAS_DESCARGA horas desde que se creó la sesión de pago en Stripe, o
//  - ya se ha descargado MAX_DESCARGAS veces.
// Así quien comparte el enlace no regala el producto.
import { Database } from "bun:sqlite"

type Sesion = { id: string; payment_status: string; created: number }

export type OpcionesEntrega = {
  consultarSesion: (id: string) => Promise<Sesion>
  producto: Blob & { name?: string }
  db: Database
  maxDescargas: number
  horas: number
  ahora?: () => number // milisegundos; se puede cambiar en los tests
}

export function abrirRegistro(ruta: string) {
  const db = new Database(ruta, { create: true })
  db.run("PRAGMA journal_mode = WAL")
  db.run(`CREATE TABLE IF NOT EXISTS descargas (
    session_id TEXT PRIMARY KEY,
    usos INTEGER NOT NULL DEFAULT 0,
    ultima INTEGER
  )`)
  return db
}

export function crearEntrega(o: OpcionesEntrega) {
  const ahora = o.ahora ?? Date.now
  const leer = o.db.query<{ usos: number }, [string]>("SELECT usos FROM descargas WHERE session_id = ?")
  // Suma un uso solo si quedan descargas; en una sola sentencia para que dos peticiones
  // a la vez no puedan pasar las dos con la última descarga.
  const gastar = o.db.query<{ usos: number }, [string, number, number]>(
    `INSERT INTO descargas (session_id, usos, ultima) VALUES (?1, 1, ?2)
     ON CONFLICT(session_id) DO UPDATE SET usos = usos + 1, ultima = ?2 WHERE usos < ?3
     RETURNING usos`,
  )
  const nombre = o.producto.name?.split("/").pop() ?? "producto"

  return async function entregar(req: Request) {
    const id = new URL(req.url).searchParams.get("session_id")
    if (!id?.startsWith("cs_")) return texto("Enlace no válido", 400)

    // Comprobación barata antes de llamar a Stripe.
    if ((leer.get(id)?.usos ?? 0) >= o.maxDescargas) return agotado()

    const sesion = await o.consultarSesion(id)
    if (sesion.id !== id) return texto("Enlace no válido", 400)
    if (sesion.payment_status !== "paid") return texto("Pago no completado", 402)
    if (ahora() > (sesion.created + o.horas * 3600) * 1000) {
      return texto("Este enlace de descarga ha caducado. Escríbenos con tu recibo de Stripe y te ayudamos.", 410)
    }

    if (!gastar.get(id, Math.floor(ahora() / 1000), o.maxDescargas)) return agotado()

    return new Response(o.producto, {
      headers: {
        "Content-Disposition": `attachment; filename="${nombre}"`,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    })
  }
}

function agotado() {
  return texto("Este enlace ya se ha usado todas las veces permitidas. Escríbenos con tu recibo de Stripe y te ayudamos.", 410)
}

function texto(mensaje: string, status: number) {
  return new Response(mensaje, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  })
}
