# Relay de avisos de CertiSend Pro — despliegue

**Estado: NO desplegado.** Este documento es la guía para que Leonardo (o el Brain, con su OK) lo
active cuando decida encender los avisos por correo de la Tarea 5. El código del relay vive en
[`avisos-relay.gs`](./avisos-relay.gs) de este mismo directorio y **no se ha pegado en ningún
proyecto de Apps Script todavía**.

## Qué hace

Cloud Run (el backend de CertiSend, `server/avisos.ts`) manda correos firmados con HMAC-SHA256 a
este relay; el relay verifica la firma y los envía con `MailApp` desde la cuenta
`contacto@leonardoantolinez.com` (mismo patrón que el relay de licencias de Faro:
`Brain_Master_Business/TOOLS/faro-licencias-backend/`). Mientras el relay no exista, Cloud Run no
rompe nada: `enviarCorreo()` detecta que faltan `AVISOS_RELAY_URL`/`AVISOS_RELAY_SECRET`, hace
`console.warn` y devuelve `false` — la activación del Paquete sigue funcionando igual, solo que
nadie recibe el correo de confirmación ni el aviso de venta (por eso el texto de "pago en
revisión" de la app, corregido en M32, no promete un correo mientras esto no esté desplegado).

## Paso a paso

1. **Hoja/proyecto de Apps Script, en la cuenta `contacto@leonardoantolinez.com`.**
   - Puede ser un proyecto de Apps Script independiente (sin hoja asociada) — este relay no
     necesita guardar nada en una hoja, solo reenviar correos.
   - `script.google.com` → Nuevo proyecto → pegar el contenido completo de
     [`avisos-relay.gs`](./avisos-relay.gs).

2. **Generar el secreto compartido y guardarlo en los DOS lados.**
   - Generar un secreto aleatorio largo (ej. `openssl rand -hex 32` o el gestor de contraseñas de
     Leonardo). **Nunca** lo escribas en este repo, en `avisos-relay.gs`, en el chat, ni en
     ningún archivo versionado.
   - En Apps Script: *Configuración del proyecto* → *Propiedades del script* → agregar
     `AVISOS_RELAY_SECRET` = `<el secreto>`.
   - En Cloud Run: Secret Manager → crear el secreto `avisos-relay-secret` con el mismo valor, y
     montarlo como la variable de entorno `AVISOS_RELAY_SECRET` del servicio de CertiSend (mismo
     patrón que `MERCADO_PAGO_ACCESS_TOKEN`, que ya vive en Secret Manager para este servicio).

3. **Implementar como App Web.**
   - *Implementar* → *Nueva implementación* → tipo *Aplicación web*.
   - *Ejecutar como:* Yo (la cuenta `contacto@leonardoantolinez.com`).
   - *Quién tiene acceso:* Cualquier persona (el relay se protege con la firma HMAC, no con el
     control de acceso de Apps Script — igual que el relay de Faro).
   - Copiar la URL `/exec` que entrega el despliegue.

4. **Configurar `AVISOS_RELAY_URL` en Cloud Run.**
   - Variable de entorno `AVISOS_RELAY_URL` = la URL `/exec` del paso 3.

5. **Probar antes de depender de esto en producción.**
   - Desde el editor de Apps Script, correr `runTestHmac()` (sin desplegar nada): debe decir "OK:
     coincide con tests/avisos.test.ts" en el log. Si dice "DISTINTO", algo en el algoritmo de
     firma se desvió entre los dos lados — no seguir sin resolver esto.
   - Correr `runTestEnvio()` (ya con `AVISOS_RELAY_SECRET` configurado en Propiedades del
     script): debe llegar un correo de prueba a `contacto@leonardoantolinez.com`.
   - Desde Cloud Run (o local, apuntando `AVISOS_RELAY_URL`/`AVISOS_RELAY_SECRET` a los valores
     reales), forzar una llamada a `enviarCorreo` — por ejemplo, un pago de prueba de bajo monto
     (Tarea 13 del plan) — y confirmar que llegan los dos correos (comprador + Leonardo).
   - Probar también SIN el secreto correcto (una firma a mano con un secreto distinto): el relay
     debe responder `{ok:false, error:"firma_invalida"}` y **no** enviar nada.

6. **Monitoreo básico.**
   - *Apps Script* → *Ejecuciones* muestra cada llamada al relay (éxito/error), útil para
     diagnosticar sin tocar Cloud Run.
   - Las notificaciones de error del propio relay (`notifyLeo_`) llegan a
     `contacto@leonardoantolinez.com` — revisar esa bandeja si algo falla.

## Qué NO hace este relay

- No reemplaza la verificación del pago contra la API de Mercado Pago (eso ya lo hace
  `server/webhook.ts`, consultando `GET /v1/payments/{id}` con el token del servidor). El relay
  solo manda el correo que el backend YA decidió mandar.
- No decide idempotencia de "un correo por pago" — eso lo decide `server/cuentas.ts`
  (`correoYaEnviado`/`marcarCorreoEnviado`) antes de llamar al relay.
- No guarda copia de los correos enviados (el log de "Ejecuciones" de Apps Script tiene una
  retención limitada). Si se necesita un historial permanente, es trabajo aparte, fuera de esta
  tarea.

## Rollback

Si algo sale mal tras desplegar: quitar `AVISOS_RELAY_URL`/`AVISOS_RELAY_SECRET` de Cloud Run (o
apagar la implementación de Apps Script). `enviarCorreo()` vuelve a su comportamiento sin relay
(`console.warn` + `false`, sin romper la activación de pagos) de inmediato, sin redeploy del
backend.
