# Plan — Cobro real con planes en CertiSend Pro (v1)
**Fecha:** 2026-10-05 · **Autor:** Leonardo Antolinez · **Spec:** docs/specs/2026-10-05-cobro-real-con-planes.md
**Reglas de ejecución:** este plan se ejecuta bajo las 6 reglas SDD → `Brain_Master_Business/OUTPUTS/procesos/2026-09-02-superpowers-sdd-cosecha.md` (ledger de recuperación, fresh subagent por tarea, review 2-etapas, fix-loop con breaker 5 rondas, rulings-not-stalls, model selection). Quien implemente (plan-implementer o Claude) las lee ANTES de la Tarea 1. Ledger: `docs/plan/2026-10-05-cobro-real-con-planes.ledger.md`.

## 1. Objetivo
Que CertiSend cobre de verdad en pesos (TRM oficial) por tres planes —Gratis, Paquete de 150 envíos y Pro ilimitado con suscripción— y que la app respete en el servidor lo que cada usuario pagó, sin activar nada que Mercado Pago no haya confirmado.

## 2. Contexto del problema
Hoy no hay planes ni base de datos: todo es gratis y en memoria. El cobro nunca funcionó y, hasta el 5-oct, mostraba un "pago exitoso" falso; ahora los botones mandan a contacto y el cobro arreglado está apagado (`PAGOS_ACTIVOS`). La web promete beneficios que no existen. Hay 0 clientes de pago, así que es el momento de montar bien las reglas antes del primero.

## 3. Spec de referencia
`docs/specs/2026-10-05-cobro-real-con-planes.md` (aprobado v1). El plan DEBE cumplir:
- Gratis ≤ 15 certificados por lote · Paquete 150 envíos con éxito, 1 mes o hasta gastarlos, renovación mensual opcional, sobrantes no se acumulan · Pro ilimitado, suscripción mensual con monto ajustado a la TRM y aviso previo.
- Cobro en COP con TRM oficial; la web muestra USD + COP del día antes de pagar.
- El plan se activa **solo** con la confirmación de Mercado Pago verificada en el servidor; los límites se cuentan en el servidor.
- El usuario ve plan, saldo y vencimiento; puede cancelar y conserva lo pagado; Leonardo recibe aviso de venta, renovación, cancelación y pago fallido.
- Textos de planes alineados a lo real.
- **Fuera de v1:** DIAN, cupones, prueba gratis, equipos, USD/PayPal, reembolsos automáticos, escaneo prioritario, 24/7, panel de administración.

## 4. Lista de tareas a implementar

### Tarea 0 — Incorporar la revisión de Abogado_LAP
- **Qué:** leer el dictamen de Abogado_LAP sobre el spec (cambio mensual de monto, renovación automática, retracto, información de precio, términos de venta) y convertir sus requisitos en cambios del spec y en tareas de este plan (o en una orden para Legal_LAP si hace falta un documento nuevo, p. ej. términos de suscripción).
- **Dónde:** `docs/specs/…` (spec v2 si cambia), este plan, `Brain_Master_Business/ORDENES/` si se redacta un documento legal.
- **Depende de:** ninguna (corre en paralelo con 1-3; **bloquea la Tarea 13**).
- **Criterio de hecho:** cada hallazgo del dictamen tiene destino escrito (tarea, cambio de spec u orden a Legal_LAP); los de severidad alta están resueltos antes del lanzamiento.

#### Destino de cada hallazgo del dictamen (Tarea 0, resuelta 2026-10-05)
| Hallazgo | Destino |
|---|---|
| H1 términos, H10 prueba de aceptación, H7 retracto | Legal_LAP redacta `docs/legal/` + **Tarea 14** (páginas, casilla, registro de aceptación) |
| H11 privacidad, H9 identidad | Legal_LAP (`politica-de-privacidad.md`) + Tarea 11 (bloque de identidad, un solo correo) |
| H5 textos del Paquete, H4 precio principal en COP, H14/H15/H16 | Tarea 11 |
| H2 fórmula pactada, H3 cobrar lo avisado, H8 renovación del Paquete | Tareas 7 y 8 (monto calculado y guardado el día del aviso; aviso ≥ 5 días hábiles; tope 10 % con aceptación expresa) |
| H6 contracargos y cancelación en un paso | Tarea 9 |
| H10 confirmación al comprador | Tareas 5 y 6 |
| H13 reembolsos | Legal_LAP (términos) |
| H12 IVA/DIAN | Fuera del código: **contador antes de la primera venta** (bloquea Tarea 13) |
| Vía plena | Abogado colegiado revisa `docs/legal/` antes de Tarea 13 |

### Tarea 1 — Identidad del usuario en el servidor
- **Qué:** que el servidor sepa quién llama. El navegador manda el ID token de Firebase en cada `/api` sensible; el servidor lo verifica (firebase-admin con las credenciales por defecto de Cloud Run) y obtiene el `uid`. Sin token válido, las rutas de cobro y de envío responden 401.
- **Dónde:** `server.ts` (middleware), `src/firebaseAuth.ts` (obtener ID token), llamadas `fetch` de `src/App.tsx`.
- **Depende de:** ninguna.
- **Criterio de hecho:** con sesión iniciada, `/api/send-email` funciona igual que hoy; con un token falso o ausente responde 401 (curl). Dividir y analizar PDF siguen funcionando para el usuario logueado.

### Tarea 2 — Registro de cuentas y pagos (Firestore)
- **Qué:** guardar por usuario su plan, saldo de envíos, fecha de vencimiento, si renueva y el id de su suscripción; y un registro de pagos ya procesados (para no procesar dos veces). Solo el servidor escribe; reglas de Firestore que impiden que el navegador lea o escriba estos datos directamente.
- **Dónde:** `server.ts` (módulo de cuentas), `firestore.rules`, `firebase.json` (deploy de reglas).
- **Depende de:** Tarea 1.
- **Criterio de hecho:** un usuario nuevo queda como Gratis; intentar leer/escribir su documento desde el navegador con el SDK cliente es rechazado por las reglas (prueba con el emulador o la consola).

### Tarea 3 — Límites aplicados en el servidor al enviar
- **Qué:** antes de enviar un lote, el navegador pide permiso indicando cuántos certificados tiene; el servidor responde sí/no según el plan (Gratis ≤ 15; Paquete con saldo ≥ tamaño del lote y no vencido; Pro sin límite). Cada envío exitoso descuenta 1 del Paquete de forma atómica; los fallidos no descuentan. `/api/send-email` exige un lote autorizado.
- **Dónde:** `server.ts` (`/api/lote/iniciar`, `/api/send-email`), `src/App.tsx` (flujo de envío y mensajes).
- **Depende de:** Tareas 1 y 2.
- **Criterio de hecho:** usuario Gratis con lote de 16 → la app no envía y muestra opciones; con 15 → envía. Usuario Paquete con 40 de saldo y lote de 60 → aviso antes de empezar, 0 enviados. 10 envíos exitosos + 2 fallidos → el saldo baja exactamente 10. Llamar `/api/send-email` sin lote autorizado → rechazado.

### Tarea 4 — TRM robusta y precios en el servidor
- **Qué:** endurecer la TRM ya existente: timeout, descartar filas con más de 5 días de antigüedad, tope de salto respecto a la última válida, y una ruta pública que devuelva los precios del día en COP de cada plan. `planName` siempre como texto (Sentinel B3).
- **Dónde:** `server.ts` (`trmHoy`, `/api/precios`).
- **Depende de:** ninguna.
- **Criterio de hecho:** `/api/precios` devuelve TRM, fecha y COP de Paquete y Pro; con datos.gov.co simulado caído o con fila vieja, no ofrece precio (503 claro) en lugar de usar un dato malo.

### Tarea 5 — Canal de correo transaccional
- **Qué:** un único canal para que el servidor envíe correos: avisos a Leonardo (venta, renovación, cancelación, pago fallido) y avisos al cliente (monto del mes de Pro, cobro fallido, vencimiento). **Ruling previsto:** reutilizar el patrón ya probado de Apps Script `MailApp` en contacto@ (relé con secreto compartido en Secret Manager) en vez de un proveedor nuevo; si se elige otro, auditarlo antes (regla de instalación).
- **Dónde:** relé Apps Script (cuenta contacto@) + `server.ts` (función `enviarAviso`) + Secret Manager (`relay-secret`).
- **Depende de:** ninguna.
- **Criterio de hecho:** una llamada de prueba desde Cloud Run deja un correo en contacto@ y otro en una dirección de prueba; sin el secreto, el relé rechaza.

### Tarea 6 — Webhook propio de CertiSend
- **Qué:** ruta que recibe avisos de Mercado Pago, **verifica cada pago o suscripción consultando la API con el token del vendedor**, ignora todo lo que no tenga referencia de CertiSend (cuenta compartida con Faro), procesa cada pago una sola vez y actualiza la cuenta del usuario. Cada cobro de CertiSend lleva su propio `notification_url` hacia esta ruta.
- **Dónde:** `server.ts` (`/api/mercadopago/webhook`).
- **Depende de:** Tareas 2 y 5.
- **Criterio de hecho:** un aviso con id inventado no cambia nada; un aviso repetido del mismo pago no suma dos veces; un pago de Faro llegado aquí se ignora. (Pruebas con pagos simulados de la API y, al final, con un pago real de bajo monto.)

### Tarea 7 — Paquete: pago único o renovación mensual
- **Qué:** compra del Paquete con elección "pago único" (preferencia de Checkout Pro) o "renovar cada mes" (suscripción de US$15 en COP). Al confirmarse: 150 envíos y vencimiento a 1 mes; en cada renovación se recargan 150 sin acumular sobrantes.
- **Dónde:** `server.ts` (crear cobro del Paquete, manejo en el webhook), `src/components/LandingPage.tsx` y vista de planes en la app.
- **Depende de:** Tareas 3, 4 y 6.
- **Criterio de hecho:** tras un pago aprobado, la app muestra "Paquete · 150 envíos · vence DD/MM"; al vencer o llegar a 0 vuelve a Gratis; con renovación activa, el siguiente cobro recarga 150.

### Tarea 8 — Pro: suscripción con monto ajustado a la TRM
- **Qué:** alta de suscripción Pro en COP del día; una tarea programada mensual (Cloud Scheduler → ruta protegida) recalcula el monto con la TRM, lo actualiza en Mercado Pago **antes** del cobro y avisa al cliente con el nuevo monto. Mientras la suscripción esté al día, el usuario es Pro.
- **Dónde:** `server.ts` (alta, `/api/cron/ajuste-pro` protegido), Cloud Scheduler, webhook.
- **Depende de:** Tareas 4, 5, 6 y 0 (las condiciones legales del cambio de monto).
- **Requisitos legales (H2/H3/H8):** el aviso sale al menos 5 días hábiles antes del cobro con monto exacto, TRM y fecha; ese monto se guarda y es exactamente el que se cobra; si sube > 10 % frente al mes anterior no se cobra hasta aceptación expresa; sin TRM válida no se avisa ni se cobra (se reintenta). Mismas reglas para el Paquete renovable (Tarea 7).
- **Criterio de hecho:** al autorizar la suscripción, el usuario aparece como Pro; ejecutar el ajuste a mano cambia el monto de la suscripción y el cliente recibe el aviso con el monto nuevo; el cobro siguiente es igual al avisado; con una subida > 10 % simulada no se cobra sin aceptación; la ruta del ajuste rechaza llamadas sin la credencial de Scheduler.

### Tarea 9 — Cancelación y pagos fallidos
- **Qué:** botón "Cancelar renovación" para Paquete con renovación y para Pro; el usuario conserva su plan hasta la fecha pagada. Si Mercado Pago informa cobro fallido, aviso al cliente y a Leonardo; si no se regulariza a la fecha de vencimiento, vuelve a Gratis.
- **Dónde:** `server.ts` (cancelar suscripción en MP, estados en la cuenta), vista de plan en `src/App.tsx`.
- **Depende de:** Tareas 7 y 8.
- **Criterio de hecho:** tras cancelar, Mercado Pago muestra la suscripción cancelada, no hay cobro siguiente y la app muestra "Activo hasta DD/MM"; pasado esa fecha, Gratis.

### Tarea 10 — Vista "Mi plan" y regreso de Mercado Pago
- **Qué:** en la app, el usuario ve plan, saldo, vencimiento y estado de renovación. Al volver de Mercado Pago: "Estamos confirmando tu pago" y se actualiza al llegar la confirmación; si no llega en unos minutos, "en revisión, te avisamos por correo". Rechazado: "No se realizó ningún cobro". La landing también se muestra a usuarios ya logueados que quieran ver planes (hoy solo se ve sin sesión).
- **Dónde:** `src/App.tsx`, `src/components/LandingPage.tsx`, `src/utils/translations.ts` (ES/EN).
- **Depende de:** Tareas 3 y 7.
- **Criterio de hecho:** en el navegador, cada estado (confirmando, activo, en revisión, rechazado) se ve en ES y EN; abrir `?pago=ok` a mano NO activa nada.

### Tarea 11 — Textos de planes y precio en pesos
- **Qué:** alinear los textos a lo real: Pro = envíos ilimitados + soporte prioritario por correo; asunto y cuerpo personalizados disponibles en todos los planes; fuera "escaneo prioritario" y "24/7"; Paquete = "150 envíos, 1 mes"; mostrar "≈ $X COP hoy, se cobra en pesos a la TRM oficial" con `/api/precios`. Los botones "Comprar"/"Suscribirme" solo aparecen con `PAGOS_ACTIVOS` encendido; si no, "Hablemos de este plan".
- **Dónde:** `src/utils/translations.ts`, `src/components/LandingPage.tsx`.
- **Depende de:** Tareas 4 y 0.
- **Criterio de hecho:** ningún texto de plan promete algo que la app no hace (revisión línea por línea contra la app); el monto COP del día aparece junto a cada precio.

### Tarea 12 — Protección contra abuso de las rutas de cobro
- **Qué:** tope global por minuto para crear cobros (independiente de la IP, Sentinel M1) y por usuario autenticado; la URL directa de Cloud Run no debe permitir saltarse los límites de cobro.
- **Dónde:** `server.ts`.
- **Depende de:** Tarea 1.
- **Criterio de hecho:** 61 peticiones de cobro en un minuto → a partir del tope responde 429, aun rotando `X-Forwarded-For` contra la URL `*.run.app`.

### Tarea 14 — Términos, retracto y prueba de aceptación
- **Qué:** publicar en la app (y enlazar desde el footer y el checkout) los términos y la política de privacidad redactados por Legal_LAP; casilla sin marcar "Acepto los términos" obligatoria para crear cualquier cobro; texto de excepción de retracto; el servidor guarda la aceptación (usuario, versión de los términos, fecha y hora, plan, monto, referencia) y rechaza crear cobros sin ella.
- **Dónde:** `src/components/` (páginas legales), `src/components/LandingPage.tsx` / vista de planes, `server.ts`, Firestore.
- **Depende de:** Tareas 1, 2 y los documentos de Legal_LAP revisados por Abogado_LAP.
- **Criterio de hecho:** sin marcar la casilla no se puede pagar (y la API rechaza el cobro); con ella, la aceptación queda guardada con la versión vigente; los términos se ven desde cualquier página.

### Tarea 13 — Lanzamiento (flujo productos vitrina)
- **Qué:** puertas completas (Verify_After_Changes_LAP contra este plan y el spec, /code-review, /security-review, Sentinel_LAP diff —es pagos—, QA_Release_LAP, REVISOR_EXTERNO_LAP hasta GO), encender `PAGOS_ACTIVOS`, desplegar Cloud Run + reglas Firestore + Hosting, **un pago real de bajo monto** de cada tipo (Paquete único, Paquete renovable, Pro) verificado de punta a punta y cancelado/reembolsado manualmente, README y landing actualizados, memoria y changelog.
- **Dónde:** todo el repo + `Brain_Master_Business/WIKI/productos-vitrina.md`.
- **Depende de:** Tareas 0-12 y 14; **contador** (IVA/facturación) y **abogado colegiado** (documentos legales) con visto bueno; datos pendientes del proveedor (documento y dirección) completados por Leonardo.
- **Criterio de hecho:** los tres pagos reales activan el plan correcto, Leonardo recibió los avisos, la cancelación funciona, y el REVISOR da GO sobre el diff final.
