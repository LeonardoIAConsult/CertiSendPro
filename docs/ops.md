# Operación: barrido programado de acuses + alerta de Cloud Logging

Simplificación 2026-10-06 (decisión del Brain tras el NO-GO de la revisión externa, vuelta 32
sobre b93fbed: 3 vueltas seguidas parchando el reintento de acuses — la orden fue simplificar, no
agregar otra capa). Esta página documenta los comandos reales para dar de alta el job de Cloud
Scheduler que dispara el barrido completo de acuses pendientes y la alerta de Cloud Logging que
captura `ALERTA_ACUSE_ATRASADO`/`ALERTA_ACUSE_ABANDONADO`. **Ninguno de estos comandos se
ejecutó al escribir esta página** (guardarraíl: sin `gcloud` de escritura) — los ejecuta el Brain
o Leonardo cuando se decida activar el barrido programado.

Para el relay de correo (Apps Script, avisos a Leonardo/compradores) ver
[`docs/relay/README.md`](./relay/README.md) — es un tema separado.

## 0. Datos reales del proyecto

| Dato | Valor |
|---|---|
| Proyecto | `clever-spirit-436820-t7` |
| Región | `us-central1` |
| Servicio Cloud Run | `certisend-api` |
| URL del servicio | `https://certisend-api-522374745014.us-central1.run.app` |
| Audiencia OIDC | la MISMA URL del servicio: `https://certisend-api-522374745014.us-central1.run.app` |
| API `cloudscheduler.googleapis.com` | ya habilitada |
| SA del Scheduler | `certisend-scheduler@clever-spirit-436820-t7.iam.gserviceaccount.com` — ya existe y ya tiene `roles/run.invoker` sobre `certisend-api` |
| SA de la API | `certisend-api@clever-spirit-436820-t7.iam.gserviceaccount.com` — tiene `roles/firebaseauth.viewer` (ver nota abajo) |
| Secretos ya creados (Secret Manager) | `huella-lote-secret`, `avisos-relay-secret` — ya accesibles por la SA de la API |

**`roles/firebaseauth.viewer` (ya otorgado a `certisend-api@...` por el Brain):** `server.ts`
verifica el ID token de cada peticion con `getAuth().verifyIdToken(token, comprobarRevocado)`
(`comprobarRevocado=true` — ver el `match[1]` de la cabecera `Authorization`). Ese segundo
parametro exige que el SDK, ademas de validar la firma del token, consulte a Identity Toolkit si
el usuario fue deshabilitado o si sus tokens fueron revocados (`getUser` por debajo) — sin este
rol, esa consulta falla y CADA peticion autenticada (practicamente toda la API: `/api/lote/iniciar`,
`/api/send-email`, `/api/mercadopago/create-preference`, `/api/cuenta`...) responde 401 aunque el
token sea valido. No se ejecuta el otorgamiento desde esta pagina (mismo guardarraíl de siempre:
sin `gcloud` de escritura) — se documenta porque ya esta otorgado en el proyecto real; si se
recrea la SA desde cero, el comando (no ejecutado) seria:
```bash
gcloud projects add-iam-policy-binding clever-spirit-436820-t7 \
  --member="serviceAccount:certisend-api@clever-spirit-436820-t7.iam.gserviceaccount.com" \
  --role="roles/firebaseauth.viewer"
```

**B-1 (corrige vuelta 34 del REVISOR_EXTERNO): el servicio Cloud Run `certisend-api` corre HOY con
la cuenta de servicio de compute POR DEFECTO** (nunca se le asigno una dedicada) — la tabla de
arriba describe la SA que el deploy DEBE usar, no la que usa ahora. El deploy que active este
barrido debe, en el mismo paso, mover el servicio a `certisend-api@...` y dar de alta los dos
secretos que esa SA necesita (ya creados en Secret Manager, ver tabla arriba):

```bash
gcloud run services update certisend-api \
  --project=clever-spirit-436820-t7 \
  --region=us-central1 \
  --service-account="certisend-api@clever-spirit-436820-t7.iam.gserviceaccount.com" \
  --update-secrets="HUELLA_LOTE_SECRET=huella-lote-secret:latest,AVISOS_RELAY_SECRET=avisos-relay-secret:latest"
```

(no ejecutado por esta página — mismo guardarraíl que el resto de este documento: usar siempre la
variante `update` de este flag, NUNCA la variante `set`, que REEMPLAZA TODOS los secretos
existentes del servicio por solo los que se le pasen; la variante `update` agrega/actualiza sin
tocar los demás).

## 0bis. Orden de deploy (backend → Hosting) y rollback de los dos juntos

Este proyecto se despliega en DOS piezas separadas (Cloud Run `certisend-api` + Firebase Hosting
para `dist/`, ver `firebase.json`) que deben quedar coherentes entre si en dos sitios distintos:

1. **`PROVEEDOR_NOMBRE` (Cloud Run, servidor) debe ser IDENTICO, caracter por caracter, a
   `VITE_PROVEEDOR_NOMBRE` (variable de BUILD de Hosting, horneada en el bundle del cliente).**
   El cliente muestra el texto de autorización de datos (T11,
   `shared/textosCasillas.ts` `textoAutorizacionDatos`) interpolando `VITE_PROVEEDOR_NOMBRE`; el
   usuario acepta ESE texto. El servidor reconstruye el MISMO texto con su propio
   `PROVEEDOR_NOMBRE` y lo compara contra `nombreProveedorMostrado` que manda el cliente
   (`POST /api/autorizacion-datos`, "Medio 2, correccion vuelta 33") — si no coinciden, responde
   `409` y nadie puede autorizar datos ni, por tanto, usar la cuenta. Un desajuste entre los dos
   valores bloquea el login para TODOS los usuarios nuevos hasta corregirlo.
2. **Orden de deploy: backend primero, Hosting enseguida después.** El backend (Cloud Run) es
   retrocompatible por diseño con un Hosting mas viejo (rutas nuevas que el cliente viejo
   simplemente no llama); lo inverso no es cierto — un Hosting nuevo puede llamar una ruta o
   esperar un campo que el backend viejo todavia no tiene (p. ej. un `motivo` nuevo en un 403,
   o un campo nuevo de `/api/health`/`/api/precios`). Desplegar Hosting ANTES que el backend deja
   una ventana donde el cliente nuevo le habla a un servidor viejo que no entiende lo que pide.
   ```bash
   # 1) backend
   npm run build:server && gcloud run deploy certisend-api --source . --project=clever-spirit-436820-t7 --region=us-central1
   # 2) frontend, con las VITE_PROVEEDOR_* del build coincidiendo con el PROVEEDOR_NOMBRE ya fijado en (1)
   npm run build && firebase deploy --only hosting
   ```
   (no ejecutado por esta página — mismo guardarraíl de siempre).
3. **Rollback: los dos juntos, nunca uno solo.** Si hay que revertir, se revierte el backend a su
   revision anterior de Cloud Run Y el Hosting a su version anterior (`firebase hosting:clone` o
   `gcloud run services update-traffic` hacia la revision previa) EN EL MISMO movimiento — un
   rollback parcial (solo uno de los dos) reproduce el mismo riesgo del punto 2: un lado nuevo
   hablandole a un lado viejo con un contrato distinto.

## 1. Qué protege esto

`POST /api/tareas/barrido-acuses` (`server.ts`, lógica en `server/tareasFondo.ts` +
`server/schedulerAuth.ts`) es el **único** mecanismo de reintento del acuse de compra. El webhook
de Mercado Pago (`POST /api/mp/webhook`) manda el acuse de compra EN LÍNEA (`await` dentro de la
propia petición) al activar un pago; si falla, el acuse queda pendiente, sin ningún reintento
disparado por el propio webhook ni por `GET /api/cuenta` (esas dos vías existieron en versiones
anteriores y se retiraron en esta simplificación). Este endpoint recorre TODOS los
`pagosProcesados` pendientes de acuse (paginado, sin tope de antigüedad para la selección) y
reintenta el correo de confirmación de compra de cada uno elegible con el reclamo transaccional de
`server/cuentas.ts`.

Solo Cloud Scheduler, con un token de identidad OIDC firmado por Google para la cuenta de servicio
dedicada, puede llamarlo:

- Sin encabezado `Authorization: Bearer <token>` → `401` (y un log estructurado grepable
  `TAREA_BARRIDO_RECHAZADA`, `motivo:"sin_token"` — ver §4).
- Token válido pero de otra cuenta de servicio o con otra audiencia → `403` (mismo log,
  `motivo:"token_invalido"`).
- Token válido → ejecuta el barrido y responde `200` con `{ok:true, paginas, revisados,
  reintentados}` (o `500` con un log estructurado `BARRIDO_ACUSES_FALLO` si el barrido mismo falla
  a mitad de camino — `server/tareasFondo.ts` lo envuelve en `try/catch`, nunca un rechazo sin
  manejar).

La verificación (`server/schedulerAuth.ts`) llama al endpoint público
`https://oauth2.googleapis.com/tokeninfo` (Google valida la firma de su lado) y comprueba que
`email`/`email_verified`/`aud` coincidan con `SCHEDULER_SA_EMAIL`/`SCHEDULER_AUDIENCE`. Ver el
comentario en ese archivo sobre por qué no se usa `google-auth-library` directamente (es una
dependencia transitiva, no declarada en `package.json`) — si se prefiere la verificación
criptográfica local en vez de llamar a Google en cada disparo, declarar esa librería como
dependencia directa es la vía recomendada, pero no se hace sin que Leonardo lo decida.

## 2. Variables de entorno en Cloud Run (servicio `certisend-api`)

| Variable | Valor |
|---|---|
| `SCHEDULER_SA_EMAIL` | `certisend-scheduler@clever-spirit-436820-t7.iam.gserviceaccount.com` |
| `SCHEDULER_AUDIENCE` | `https://certisend-api-522374745014.us-central1.run.app` (la MISMA URL del servicio, sin la ruta del endpoint — debe ser EXACTAMENTE lo que se pase en `--oidc-token-audience` en el paso 3) |

Los secretos `huella-lote-secret`/`avisos-relay-secret` ya existen en Secret Manager y ya son
accesibles por `certisend-api@clever-spirit-436820-t7.iam.gserviceaccount.com` — no hace falta
crear nada nuevo para el barrido; solo fijar las dos variables de arriba en la revisión de Cloud
Run (por ejemplo, con `gcloud run services update certisend-api --region us-central1
--update-env-vars SCHEDULER_SA_EMAIL=...,SCHEDULER_AUDIENCE=...`, no ejecutado por esta página).
**Usar siempre la variante `update` de este flag, NUNCA la variante `set`** (corrige G-1, vuelta 34
del REVISOR_EXTERNO): la variante `set` REEMPLAZA TODAS las variables de entorno existentes del
servicio (`NODE_ENV`, `APP_URL`, `ALLOWED_ORIGINS`...) por solo las que se le pasen — la variante
`update` agrega/actualiza sin borrar las demás.

## 3. Crear el job de Cloud Scheduler (cada 30 minutos, con OIDC)

La cuenta de servicio del Scheduler y el permiso `run.invoker` YA existen — este es el único paso
que falta dar de alta:

```bash
gcloud scheduler jobs create http certisend-barrido-acuses \
  --project=clever-spirit-436820-t7 \
  --location=us-central1 \
  --schedule="*/30 * * * *" \
  --uri="https://certisend-api-522374745014.us-central1.run.app/api/tareas/barrido-acuses" \
  --http-method=POST \
  --oidc-service-account-email="certisend-scheduler@clever-spirit-436820-t7.iam.gserviceaccount.com" \
  --oidc-token-audience="https://certisend-api-522374745014.us-central1.run.app" \
  --attempt-deadline=600s \
  --max-retry-attempts=1
```

Notas:
- `--uri` lleva la ruta del endpoint (`/api/tareas/barrido-acuses`); `--oidc-token-audience` NO —
  es la URL base del servicio, exactamente igual a `SCHEDULER_AUDIENCE` del paso 2 (así es como
  `server/schedulerAuth.ts` la compara contra el claim `aud` del token).
- `--max-retry-attempts=1`: un reintento basta — el endpoint es idempotente (el reclamo
  transaccional de `server/cuentas.ts` ya evita reintentar de más) y el siguiente disparo (30 min
  después) vuelve a cubrir cualquier pendiente.
- M-2 (corrige vuelta 36 del REVISOR_EXTERNO): `--attempt-deadline` sube de 30s a 600s — el
  barrido manda cada acuse EN SERIE (nunca en paralelo) y cada envío puede tardar hasta 20s
  (`TIMEOUT_MS_DEFECTO`, `server/avisos.ts`); con decenas de pagos pendientes, 30s se agotaba
  mucho antes de terminar una sola página. `barrerTodosLosPagosPendientes`
  (`server/tareasFondo.ts`) se acota a su vez a 540s de presupuesto total (menos que los 600s del
  job, con margen) — si se agota a mitad de un barrido, corta ahí y devuelve lo que alcanzó a
  procesar; el resto queda para la siguiente corrida (30 min después), nunca se pierde.

Verificar que el job quedó bien dado de alta:

```bash
gcloud scheduler jobs describe certisend-barrido-acuses --project=clever-spirit-436820-t7 --location=us-central1
```

Probar manualmente (sin esperar los 30 min):

```bash
gcloud scheduler jobs run certisend-barrido-acuses --project=clever-spirit-436820-t7 --location=us-central1
```

## 4. Métrica basada en logs + alerta de Cloud Logging

`server/notificaciones.ts` (`emitirAlertaTiempoUnaVez`) emite, como canal fuerte (nunca depende
del relay de correo), un log estructurado con severidad `ERROR` ante dos condiciones, cada una
UNA sola vez por pago:

- `ALERTA_ACUSE_ATRASADO` — el acuse lleva ≥20h sin enviarse (el barrido sigue reintentando).
- `ALERTA_ACUSE_ABANDONADO` — el acuse lleva >48h sin enviarse (el barrido DEJA de reintentar;
  necesita atención manual).

`server/tareasFondo.ts` (`manejarBarridoAcusesTarea`) emite, con el mismo formato, un
`BARRIDO_ACUSES_FALLO` si el barrido mismo falla (p. ej. Firestore sin red a mitad de una página),
y un `TAREA_BARRIDO_RECHAZADA` (`motivo:"sin_token"`/`"token_invalido"`) ante un `401`/`403` — ver
§1. Este segundo marcador NO esta en el filtro de la metrica de abajo a proposito: un `401`/`403`
ocasional (bots escaneando el endpoint, sin el secreto nunca pueden pasar la verificacion) es
esperado y no amerita alertar; si `TAREA_BARRIDO_RECHAZADA` empieza a aparecer de forma
SOSTENIDA (el propio Cloud Scheduler dejo de poder autenticarse), eso lo atrapa la alerta de §4bis
(fallos del PROPIO job, no de la app).

El filtro de la métrica (§4) también incluye `ALERTA_REEMBOLSO_REQUERIDO` — `server/notificaciones.ts`
(`avisarPagoDobleRequiereReembolso`, Medio 4/Tarea 15) ya lo emite, con el mismo formato de log
estructurado (`severity:"ERROR"`, nunca uid), cuando un pago aprobado NO se activa por ya existir
un Paquete vigente de OTRO pago (pago doble con 2 preferencias); la devolución del dinero en sí
(Tarea 9) sigue siendo manual, ver el plan.

B-2 (corrige vuelta 36 del REVISOR_EXTERNO): el filtro también incluye `RUTA_TAREAS_NO_REGISTRADA`
— `server/tareasFondo.ts` (`verificarRutaTareasRegistrada`, §1) ya lo emite al arrancar, mismo
formato de log estructurado, si `registrarRutasTareas` dejara de registrar la ruta del barrido (p.
ej. un refactor que borre esa línea sin querer): sin esta alerta, el barrido completo deja de
existir y nadie se entera hasta que un acuse lleva días pendiente.

Crear la métrica basada en logs (nunca cambiar el texto de estos marcadores sin actualizar
también este filtro):

```bash
gcloud logging metrics create certisend_alertas_acuse \
  --project=clever-spirit-436820-t7 \
  --description="Acuses de compra atrasados/abandonados, fallos del barrido y reembolsos que requieren accion manual" \
  --log-filter='resource.type="cloud_run_revision"
resource.labels.service_name="certisend-api"
jsonPayload.message=~"ALERTA_ACUSE_(ATRASADO|ABANDONADO)|ALERTA_REEMBOLSO_REQUERIDO|BARRIDO_ACUSES_FALLO|RUTA_TAREAS_NO_REGISTRADA"'
```

Crear la política de alerta (notifica por correo a `contacto@leonardoantolinez.com` — crear antes
el canal de notificación en Cloud Monitoring → Alertas → Canales de notificación → Correo
electrónico, con esa dirección, y usar el id que devuelva en `NOTIFICATION_CHANNEL_ID`):

```bash
gcloud alpha monitoring policies create \
  --project=clever-spirit-436820-t7 \
  --display-name="CertiSend: acuse atrasado/abandonado o reembolso pendiente" \
  --condition-display-name="Al menos 1 ocurrencia en 15 minutos" \
  --condition-filter='metric.type="logging.googleapis.com/user/certisend_alertas_acuse" AND resource.type="cloud_run_revision"' \
  --aggregation='{"alignmentPeriod":"900s","perSeriesAligner":"ALIGN_COUNT"}' \
  --if='> 0' \
  --duration=0s \
  --notification-channels="NOTIFICATION_CHANNEL_ID"
```

M-1 (corrige vuelta 36 del REVISOR_EXTERNO): el comando de arriba usaba flags que `gcloud alpha
monitoring policies create` no tiene (`--condition-threshold-value`, `--condition-threshold-comparison`,
`--condition-threshold-duration`, `--condition-aggregations`) — nunca se habría podido ejecutar.
Los flags reales (confirmados con `gcloud alpha monitoring policies create --help`, solo lectura)
son `--aggregation` (un solo objeto JSON, no un arreglo), `--if` (`"> 0"`, no un valor+comparador
separados) y `--duration`.

Nota: la sintaxis exacta de `gcloud alpha monitoring policies create` puede variar según la
versión del SDK instalado; si falla, crear la política equivalente desde la consola (Cloud
Monitoring → Alertas → Crear política → condición "Métrica de log" → la métrica
`certisend_alertas_acuse` creada arriba → umbral "más de 0 en 15 minutos" → canal de notificación
el correo `contacto@leonardoantolinez.com`).

## 4bis. Segunda alerta: fallos del PROPIO job de Cloud Scheduler (M-1, corrige vuelta 34 del REVISOR_EXTERNO)

La alerta de §4 lee los logs que escribe LA APLICACIÓN (`resource.type="cloud_run_revision"`) —
nunca ve un fallo que ocurre ANTES de que la aplicación llegue a loguear nada: un `401`/`403`
sostenido por un token OIDC mal configurado, un timeout del `--attempt-deadline` (600s, §3), o
cualquier respuesta no-2xx que Cloud Scheduler reporte en SU PROPIO log de ejecución
(`resource.type="cloud_scheduler_job"`). Esta segunda alerta cubre esa capa, independiente de §4 —
si el job deja de poder disparar el barrido, esto avisa aunque la aplicación nunca llegue a
escribir ni un solo log.

Crear la métrica:

```bash
gcloud logging metrics create certisend_barrido_job_fallos \
  --project=clever-spirit-436820-t7 \
  --description="Fallos del propio job de Cloud Scheduler certisend-barrido-acuses (no llega a loguear la app)" \
  --log-filter='resource.type="cloud_scheduler_job" AND resource.labels.job_id="certisend-barrido-acuses" AND severity>=ERROR'
```

Crear la política de alerta (mismo canal de correo que §4):

```bash
gcloud alpha monitoring policies create \
  --project=clever-spirit-436820-t7 \
  --display-name="CertiSend: fallo del job de Cloud Scheduler certisend-barrido-acuses" \
  --condition-display-name="Al menos 1 ocurrencia en 15 minutos" \
  --condition-filter='metric.type="logging.googleapis.com/user/certisend_barrido_job_fallos" AND resource.type="cloud_scheduler_job"' \
  --aggregation='{"alignmentPeriod":"900s","perSeriesAligner":"ALIGN_COUNT"}' \
  --if='> 0' \
  --duration=0s \
  --notification-channels="NOTIFICATION_CHANNEL_ID"
```

Nota: misma salvedad de sintaxis que §4 — si `gcloud alpha monitoring policies create` falla,
crear la política equivalente desde la consola con el mismo filtro de log.

## 5. Huella HMAC de lotes (`HUELLA_LOTE_SECRET`)

Corrección GRAVE 2 (vuelta 31, 2026-10-06). `POST /api/lote/iniciar` firma, con esta clave, la
huella HMAC-SHA256 de cada par página-fila-correo que el usuario confirmó en la pantalla de
revisión (Tarea 15, requisito A.3); `POST /api/send-email` recalcula esa misma huella antes de
enviar y rechaza con `409` cualquier envío que no coincida con lo que de verdad se autorizó.

**Sin esta variable, el servidor NUNCA autoriza un lote** (falla cerrado: `503` en las dos rutas,
`GET /api/health` reporta `huella: false` sin revelar nada más) — nunca se vuelve a crear un lote
"sin huella" como pasaba antes de esta corrección.

Generar el secreto (una sola vez, nunca un valor corto ni memorable):

```bash
openssl rand -hex 32
```

Guardarlo en Secret Manager y conectarlo a Cloud Run (**ninguno de estos comandos se ejecutó al
escribir esta orden** — mismo guardarraíl que el resto de este documento):

```bash
echo -n "EL_VALOR_GENERADO_ARRIBA" | gcloud secrets create huella-lote-secret \
  --project=clever-spirit-436820-t7 \
  --data-file=- \
  --replication-policy="automatic"

gcloud run services update certisend-api \
  --project=clever-spirit-436820-t7 \
  --region=us-central1 \
  --update-secrets=HUELLA_LOTE_SECRET=huella-lote-secret:latest
```

B-3 (corrige vuelta 36 del REVISOR_EXTERNO): los tres comandos de esta sección decían
`--project=TU_PROYECTO`/`--region=TU_REGION` (placeholders genericos) y el segundo apuntaba al
servicio `certisendpro` — que no es el nombre real (`certisend-api`, ver §0). Se reemplazan por
los valores reales del proyecto, igual que el resto de esta página.

Verificar que quedó encendido, sin revelar el valor:

```bash
curl -s https://certisend-api-522374745014.us-central1.run.app/api/health
# {"ok":true,"huella":true,"proveedor":true,"relay":true,"listo":true}
```

Rotar el secreto (crear una nueva versión, sin publicarla hasta estar listo):

```bash
echo -n "EL_VALOR_NUEVO" | gcloud secrets versions add huella-lote-secret --project=clever-spirit-436820-t7 --data-file=-
```

**Importante:** rotar este secreto invalida las huellas de cualquier lote YA creado y todavía no
confirmado por completo (el lote expira solo a las 2 horas, ver `server/cuentas.ts`) — rotar
coordinado con un momento de bajo tráfico, nunca a mitad de una campaña de envío masivo.

## 6. Qué NO hace este barrido

- No reactiva un Paquete ni toca el saldo/plan del usuario: el pago YA está activado — esto es
  solo el reintento del correo de confirmación.
- No reintenta pagos `revertido` (un reembolso/contracargo ya confirmado: el comprador no tiene
  nada que confirmar).
- No tiene tope de INTENTOS ni espera creciente entre intentos (backoff exponencial) — cada
  disparo del Scheduler (cada 30 min) reintenta todo lo pendiente sin excepción; la única cosa que
  detiene el reintento de un pago es que su acuse ya salió, que esté revertido, o que ya pase de
  48h (momento en el que se abandona y se alerta, ver §1).
- No reemplaza la devolución manual del dinero (Tarea 9 del plan) ni la revisión del panel de
  Mercado Pago — solo automatiza el correo de confirmación de compra.


## Estado aplicado en producción (2026-10-06)

- Revisión `certisend-api-00003-x6l` con SA `certisend-api@` (datastore.user + firebaseauth.viewer + secretAccessor), secretos HUELLA_LOTE_SECRET y AVISOS_RELAY_SECRET, PROVEEDOR_*, AVISOS_RELAY_URL, SCHEDULER_*. `PAGOS_ACTIVOS` sin definir (pagos apagados). `/api/health` → `listo:true, relay:true`.
- Job `certisend-barrido-acuses` creado (America/Bogota, cada 30 min). Fue necesario dar al agente de servicio de Cloud Scheduler (`service-522374745014@gcp-sa-cloudscheduler.iam.gserviceaccount.com`) `roles/iam.serviceAccountTokenCreator` sobre `certisend-scheduler@`; sin eso el job no dispara (status -1, sin logs). `jobs run` manual → 200.
- Métricas `certisend_alertas_acuse` y `certisend_barrido_job_fallos`, canal de correo a contacto@ y dos políticas de alerta (`--combiner=OR` es obligatorio en `gcloud alpha monitoring policies create`).
- Hosting y reglas de Firestore desplegados; `Cache-Control: no-cache` en las rutas del SPA.
- Rollback conjunto: `gcloud run services update-traffic certisend-api --to-revisions=certisend-api-00002-lwz=100` + release anterior de Hosting.
