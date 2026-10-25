# Ingresos automáticos: tienda de producto digital

Primero, lo que no hace: ningún código genera dinero solo. Si alguien te vende eso (bots de trading, "clics pagados", criptos milagro), es humo o es una estafa.
Lo que sí funciona es **crear algo una vez y venderlo muchas veces sin intervenir**. Este código cobra con Stripe y entrega el archivo automáticamente, de día o de noche.

## Qué vender (lo más fácil)
Algo que ya sepas hacer, convertido en archivo descargable:
- Plantillas (Notion, Excel, CV, facturas para autónomos, planificadores)
- Guías en PDF muy concretas (p. ej. "Cómo darte de alta de autónomo en Asturias paso a paso")
- Packs de prompts, presets de fotos, scripts o código reutilizable

Regla: un problema concreto para un público concreto. Precio 9–29 €.

## Ponerlo en marcha (unos 30 min)
1. Crea una cuenta en https://stripe.com (acepta España, cobra con tarjeta, Bizum vía Stripe y Apple/Google Pay).
2. En Stripe, crea un Producto con su Precio y copia el `price_...`.
3. `cp .env.example .env` y rellénalo (empieza con claves `sk_test_`).
4. Pon tu archivo en `productos/producto.pdf` y edita `landing.html`.
5. `bun tienda.ts` y abre http://localhost:3000. Prueba con la tarjeta `4242 4242 4242 4242`.
6. `bun test` comprueba que los enlaces de descarga caducan.
7. Publícalo en un servidor barato (Railway, Fly.io o un VPS de ~5 €/mes) y cambia a claves `sk_live_`.

## Enlaces de descarga que caducan
Tras pagar, el comprador llega a `/gracias?session_id=...` y descarga el archivo. Ese enlace deja de funcionar:
- a las `HORAS_DESCARGA` horas (24 por defecto) desde que se creó el pago en Stripe, y
- tras `MAX_DESCARGAS` descargas (3 por defecto; pon `1` para un solo uso).

Las descargas se apuntan en `descargas.sqlite`. Si tu servidor borra el disco al reiniciar (p. ej. Railway sin volumen), monta un volumen y apunta `REGISTRO_DESCARGAS` ahí, o el contador se reinicia (el límite de horas sigue funcionando porque lo da Stripe).

## Lo que de verdad trae ventas: las visitas
El código es el 10 %. El 90 % es que la gente encuentre tu página:
- Vídeos cortos en TikTok/Instagram/YouTube Shorts resolviendo parte del problema gratis, con enlace a la página.
- Responder en Reddit, foros y grupos donde está tu público.
- Un artículo/blog por cada búsqueda en Google relacionada (tráfico que llega mientras duermes).

## Legal en España (importante)
- **Hacienda:** todo ingreso se declara en la renta (IRPF).
- **Autónomos:** si vendes de forma habitual tienes que darte de alta en el RETA. Hay **tarifa plana (~80 €/mes el primer año)**. Pregunta en la Agencia de Desarrollo Local del Ayuntamiento de Oviedo o en el CEEI Asturias: asesoran gratis a quien empieza.
- **IVA:** los productos digitales vendidos a particulares de la UE pagan el IVA del país del comprador (régimen OSS/ventanilla única). Activar Stripe Tax lo calcula solo.
- Stripe comunica a Hacienda los datos de vendedores (DAC7), así que no conviene "probar sin declarar".

Consúltalo con una gestoría antes de facturar en serio; suelen cobrar 40–60 €/mes.
