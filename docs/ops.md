# Operación: barrido programado de acuses + alerta de Cloud Logging

Correción NO-GO vuelta 30 (2026-10-05), requisitos G2/M2. Esta página documenta los comandos
`gcloud` para dar de alta el job de Cloud Scheduler que dispara el barrido completo de acuses
pendientes y la alerta de Cloud Logging que captura `ALERTA_ACUSE_ATRASADO`. **Ninguno de estos
comandos se ejecutó al escribir esta orden** (guardarraíl: sin `gcloud` de escritura, sin
secretos nuevos) — los ejecuta el Brain o Leonardo cuando se decida activar el barrido programado.

Para el relay de correo (Apps Script, avisos a Leonardo/compradores) ver
[`docs/relay/README.md`](./relay/README.md) — es un tema separado.

## 1. Qué protege esto

`POST /api/tareas/barrido-acuses` (`server.ts`, lógica en `server/tareasFondo.ts` +
`server/schedulerAuth.ts`) recorre TODOS los `pagosProcesados` pendientes de acuse (paginado, sin
tope de antigüedad) y reintenta el correo de confirmación de compra de cada uno elegible — a
diferencia del barrido parcial que ya dispara el propio webhook de Mercado Pago (ventana de 5
pagos recientes, máximo 1 vez por minuto), este es el barrido COMPLETO y es el único disparador
pensado para correr de forma regular sin depender de que lleguen pagos nuevos.

Solo Cloud Scheduler, con un token de identidad OIDC firmado por Google para una cuenta de
servicio específica, puede llamarlo:

- Sin encabezado `Authorization: Bearer <token>` → `401`.
- Token válido pero de otra cuenta de servicio o con otra audiencia → `403`.
- Token válido → ejecuta el barrido y responde `200` con `{ok:true, paginas, revisados,
  reintentados}`.

La verificación (`server/schedulerAuth.ts`) llama al endpoint público
`https://oauth2.googleapis.com/tokeninfo` (Google valida la firma de su lado) y comprueba que
`email`/`email_verified`/`aud` coincidan con `SCHEDULER_SA_EMAIL`/`SCHEDULER_AUDIENCE`. Ver el
comentario en ese archivo sobre por qué no se usa `google-auth-library` directamente (es una
dependencia transitiva, no declarada en `package.json`) — si se prefiere la verificación
criptográfica local en vez de llamar a Google en cada disparo, declarar esa librería como
dependencia directa es la vía recomendada, pero esta orden no lo hace sin que Leonardo lo decida.

## 2. Variables de entorno nuevas en Cloud Run

| Variable | Valor |
|---|---|
| `SCHEDULER_SA_EMAIL` | Email de la cuenta de servicio dedicada al Scheduler (crearla si no existe, ver §3). |
| `SCHEDULER_AUDIENCE` | La URL completa del servicio de Cloud Run + la ruta del endpoint, p. ej. `https://certisend-xxxxx-uc.a.run.app/api/tareas/barrido-acuses` (debe ser EXACTAMENTE la audiencia que se configura en el paso §4 del job). |

## 3. Crear la cuenta de servicio dedicada (una sola vez)

```bash
gcloud iam service-accounts create certisend-scheduler \
  --project=TU_PROYECTO \
  --display-name="CertiSend - Cloud Scheduler (barrido de acuses)"
```

Dar permiso para invocar el servicio de Cloud Run (nunca el rol de `admin`, solo `invoker`):

```bash
gcloud run services add-iam-policy-binding certisendpro \
  --project=TU_PROYECTO \
  --region=TU_REGION \
  --member="serviceAccount:certisend-scheduler@TU_PROYECTO.iam.gserviceaccount.com" \
  --role="roles/run.invoker"
```

`SCHEDULER_SA_EMAIL` = `certisend-scheduler@TU_PROYECTO.iam.gserviceaccount.com`.

## 4. Crear el job de Cloud Scheduler (cada 30 minutos, con OIDC)

```bash
gcloud scheduler jobs create http certisend-barrido-acuses \
  --project=TU_PROYECTO \
  --location=TU_REGION \
  --schedule="*/30 * * * *" \
  --uri="https://certisend-xxxxx-uc.a.run.app/api/tareas/barrido-acuses" \
  --http-method=POST \
  --oidc-service-account-email="certisend-scheduler@TU_PROYECTO.iam.gserviceaccount.com" \
  --oidc-token-audience="https://certisend-xxxxx-uc.a.run.app/api/tareas/barrido-acuses" \
  --attempt-deadline=30s \
  --max-retry-attempts=1
```

Notas:
- La URL de `--uri` y la de `--oidc-token-audience` deben coincidir con lo que Cloud Run sirve
  en producción (confirmar el dominio real de Cloud Run, no el de Firebase Hosting — el mismo
  cuidado que ya pide `PUBLIC_BASE_URL` en `server.ts`).
- `SCHEDULER_AUDIENCE` en Cloud Run debe ser EXACTAMENTE el mismo valor que `--oidc-token-audience`.
- `--max-retry-attempts=1`: un reintento basta — el endpoint es idempotente (M2/M3 ya evitan
  reintentar de más) y el siguiente disparo (30 min después) vuelve a cubrir cualquier pendiente.

Verificar que el job quedó bien dado de alta:

```bash
gcloud scheduler jobs describe certisend-barrido-acuses --project=TU_PROYECTO --location=TU_REGION
```

Probar manualmente (sin esperar los 30 min):

```bash
gcloud scheduler jobs run certisend-barrido-acuses --project=TU_PROYECTO --location=TU_REGION
```

## 5. Alerta de Cloud Logging para `ALERTA_ACUSE_ATRASADO`

`server/notificaciones.ts` (`logAlertaAcuseAtrasado`) emite `console.error("ALERTA_ACUSE_ATRASADO",
{paymentId, uid, horas})` cuando el tope de intentos (M2, `MAX_INTENTOS_ACUSE=10`) se agota y el
acuse de compra sigue sin salir — esto llega a Cloud Logging como un log estructurado con
severidad `ERROR` desde Cloud Run. Crear una métrica basada en logs y una política de alerta sobre
ese marcador fijo (nunca cambiar el texto `ALERTA_ACUSE_ATRASADO` sin actualizar también este
filtro):

```bash
gcloud logging metrics create certisend_acuse_atrasado \
  --project=TU_PROYECTO \
  --description="Acuses de compra que agotaron los reintentos automáticos (M2)" \
  --log-filter='resource.type="cloud_run_revision"
resource.labels.service_name="certisendpro"
severity=ERROR
textPayload:"ALERTA_ACUSE_ATRASADO"'
```

Crear la política de alerta (notifica por correo; cambiar `NOTIFICATION_CHANNEL_ID` por el canal
real de Leonardo, creado antes en Cloud Monitoring → Alertas → Canales de notificación):

```bash
gcloud alpha monitoring policies create \
  --project=TU_PROYECTO \
  --display-name="CertiSend: acuse de compra atrasado (ALERTA_ACUSE_ATRASADO)" \
  --condition-display-name="Al menos 1 ocurrencia en 15 minutos" \
  --condition-filter='metric.type="logging.googleapis.com/user/certisend_acuse_atrasado" AND resource.type="cloud_run_revision"' \
  --condition-threshold-value=0 \
  --condition-threshold-comparison=COMPARISON_GT \
  --condition-threshold-duration=0s \
  --condition-aggregations='[{"alignmentPeriod":"900s","perSeriesAligner":"ALIGN_COUNT"}]' \
  --notification-channels="NOTIFICATION_CHANNEL_ID"
```

Nota: la sintaxis exacta de `gcloud alpha monitoring policies create` puede variar según la
versión del SDK instalado; si falla, crear la política equivalente desde la consola (Cloud
Monitoring → Alertas → Crear política → condición "Métrica de log" → la métrica
`certisend_acuse_atrasado` creada arriba → umbral "más de 0 en 15 minutos").

## 6. Huella HMAC de lotes (`HUELLA_LOTE_SECRET`)

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
  --project=TU_PROYECTO \
  --data-file=- \
  --replication-policy="automatic"

gcloud run services update certisendpro \
  --project=TU_PROYECTO \
  --region=TU_REGION \
  --update-secrets=HUELLA_LOTE_SECRET=huella-lote-secret:latest
```

Verificar que quedó encendido, sin revelar el valor:

```bash
curl -s https://TU_SERVICIO.run.app/api/health
# {"ok":true,"huella":true}
```

Rotar el secreto (crear una nueva versión, sin publicarla hasta estar listo):

```bash
echo -n "EL_VALOR_NUEVO" | gcloud secrets versions add huella-lote-secret --project=TU_PROYECTO --data-file=-
```

**Importante:** rotar este secreto invalida las huellas de cualquier lote YA creado y todavía no
confirmado por completo (el lote expira solo a las 2 horas, ver `server/cuentas.ts`) — rotar
coordinado con un momento de bajo tráfico, nunca a mitad de una campaña de envío masivo.

## 7. Qué NO hace este barrido

- No reemplaza el aviso de 20h a Leonardo (`server/notificaciones.ts`,
  `construirAvisoAcuse20hLeonardo`) — ese sigue siendo el canal principal mientras el pago esté
  dentro del tope de intentos. `ALERTA_ACUSE_ATRASADO` es el canal ADICIONAL para cuando el tope
  (M2, 10 intentos) ya se agotó y el caso necesita atención manual.
- No reintenta pagos `revertido` (G3) ni pagos en un estado terminal (`agotado`, aviso de bloqueo
  de proveedor ya enviado, aviso de 20h ya enviado — M3).
- No reactiva un Paquete ni toca el saldo/plan del usuario: el pago YA está activado: esto es
  solo el reintento del correo de confirmación.
