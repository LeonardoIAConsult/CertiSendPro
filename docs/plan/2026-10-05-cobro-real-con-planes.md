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
| Ronda 2 (Abogado_LAP sobre borradores): N2 textos públicos falsos | Tarea 11 (retirar «precisión humana», «nunca persistidos», «máxima entregabilidad», USD; reemplazar `PrivacyPolicy.tsx` por la v2.0) |
| Ronda 2: N3 cláusula de envío equivocado | **Tarea 15** (condiciones de producto) |
| Ronda 2: H3 en código (TRM vieja/caché vencida) | Tarea 4 (nada de TRM se publica antes) |
| Ronda 3: R3-1 Paquete vs Gratis | **Decisión del Brain (más favorable al cliente):** lotes de 15 o menos nunca descuentan del saldo del Paquete → ajustar `decidirLote` (Tarea 3, corrección) |
| T5 "Paquete usado" (corrige vuelta 24, M-sin-número del Brain): la casilla de retracto (T5, `docs/legal/textos-checkout.md` v1.2) promete devolución completa de un Paquete sin ningún envío usado, pero "usado" no estaba definido | **Decisión del Brain (2026-10-05):** Paquete usado (para la devolución completa de la casilla T5) = se descontó al menos 1 envío de su saldo (lote > 15 certificados, el único caso que descuenta según R3-1); lotes de 15 o menos nunca cuentan como "usado" aunque se hayan enviado con el Paquete activo. El proceso de la devolución es MANUAL (Tarea 9), no automático: el servidor no reembolsa por su cuenta, solo decide si el Paquete califica mirando `reservadosPaquete`/`enviosRestantes` descontados. |
| Ronda 3: PayPal con rol equivocado en proveedores | **Pendiente aparte:** auditar el legal ya publicado de Faro (cobra con PayPal) |
| Ronda 2: N6 precio distinto entre tarjeta y resumen | Tareas 7, 8 y 10 (avisar y reconfirmar si sube) |
| NO-GO vuelta 20 (REVISOR_EXTERNO_LAP + Abogado_LAP sobre commits c53cca9/a26d961): H3/R3-3 — descartar saltos de TRM obligaba a cobrar con un dato viejo | **Decisión del Brain (D1):** se quita a propósito el tope de salto; la fuente es la TRM certificada oficial y los términos prometen la TRM vigente; la defensa contra un dato absurdo es el rango creíble [2000, 10000] (`TRM_MAX=10000` queda como decisión registrada); un salto > 10 % respecto a la última TRM conocida deja `console.warn` con las dos cifras y se usa igual → Tarea 4 (corrección, `server/trm.ts`) |
| NO-GO vuelta 20: M24/M25 — la fila de TRM se validaba por antigüedad fija (5 días) en vez de por su propia vigencia | **Decisión del Brain (D2):** una fila vale si `vigenciadesde ≤ hoy ≤ vigenciahasta` (texto `yyyy-mm-dd`, zona Bogotá vía `Intl`, nunca `new Date` sobre el dato del dataset); se quita el tope de 5 días; la caché se reutiliza mientras hoy esté en `[desde, hasta]`; sin fila que cubra hoy, `trmHoy()` da `null` y la ruta responde 503; consulta ordenada por `vigenciadesde DESC` con `$limit` pequeño, eligiendo la primera fila que cubra hoy → Tarea 4 (corrección, `server/trm.ts`) |
| Precio público antes de pagar (spec: "la web muestra USD + COP del día antes de pagar") | **Decisión del Brain (D3):** `GET /api/precios`, pública, con el limitador por IP ya montado en `/api`; devuelve `{ trm, fechaDesde, fechaHasta, paquete:{usd:15,cop}, pro:{usd:29,cop} }`; el COP sale de `copDesdeUsd`, la MISMA función que usa `create-preference` (sin duplicar la fórmula); 503 con `{error}` si no hay TRM; `Cache-Control: public, max-age=300` → Tarea 4 (ampliación, `server.ts`) |
| NO-GO vuelta 20: M26 — `reservarEnvioTx` podía rechazar un envío por saldo aunque `reservadosPaquete` estuviera desincronizado (p. ej. una reserva huérfana) | **Decisión del Brain (D4):** cuando `restantes <= cuenta.reservadosPaquete`, antes de rechazar se recalcula `reservadosPaquete` sumando `reservados` de los lotes Paquete no expirados del uid (consulta normal de Firestore, fuera de la transacción) y se vuelve a evaluar; si al final se reserva, se guarda el número corregido → Tarea 3 (corrección, `server/cuentas.ts`); **nuevo requisito de la Tarea 6** (abajo) |
| NO-GO vuelta 20: B23 — un Paquete vencido con `enviosRestantes` todavía positivo podía reservar | **Decisión del Brain (D5):** `reservarEnvioTx` rechaza un lote Paquete si `cuenta.vence` ya pasó, aunque el saldo nominal diga que hay envíos → Tarea 3 (corrección, `server/cuentas.ts`) |
| M22 — Decisión de Leonardo 2026-10-05: Gratis = solo 15 por lote, sin tope mensual. | Tarea 3 (ya cumplido: `decidirLote`/`LIMITE_GRATIS` solo limita CADA lote a 15; un usuario Gratis puede enviar todos los lotes de ≤15 que quiera en un mes, no hay contador mensual que lo bloquee) |

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
- **Requisito (vuelta 22):** aviso a Leonardo en el `catch` del webhook ante errores repetidos. Hoy `/api/mp/webhook` (`server.ts`) solo responde 500 y loguea cuando falla (red caída, error inesperado); sin este canal no hay a quién avisar. Cuando exista `enviarAviso`, el webhook debe notificar a Leonardo si el mismo tipo de error se repite (no en el primer intento aislado: Mercado Pago reintenta solo, y avisar en cada 500 transitorio sería ruido) — definir aquí el umbral de "repetido" (p. ej. N fallos en una ventana, o enviar en el reintento N-ésimo del mismo `paymentId`).
- **Dónde:** relé Apps Script (cuenta contacto@) + `server.ts` (función `enviarAviso`) + Secret Manager (`relay-secret`).
- **Depende de:** ninguna.
- **Criterio de hecho:** una llamada de prueba desde Cloud Run deja un correo en contacto@ y otro en una dirección de prueba; sin el secreto, el relé rechaza.

### Tarea 6 — Webhook propio de CertiSend
- **Qué:** ruta que recibe avisos de Mercado Pago, **verifica cada pago o suscripción consultando la API con el token del vendedor**, ignora todo lo que no tenga referencia de CertiSend (cuenta compartida con Faro), procesa cada pago una sola vez y actualiza la cuenta del usuario. Cada cobro de CertiSend lleva su propio `notification_url` hacia esta ruta.
- **Dónde:** `server.ts` (`/api/mercadopago/webhook`).
- **Depende de:** Tareas 2 y 5.
- **Requisito nuevo (D4, decisión del Brain tras NO-GO vuelta 20):** toda compra o renovación pone `reservadosPaquete=0` en la misma escritura que activa/recarga el Paquete — un Paquete que se renueva o se compra de nuevo nunca hereda reservas de un ciclo anterior.
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
- **Requisito (vuelta 22):** decidir el cruce de una compra de Paquete con un Pro ya activo. Hoy `activarPaqueteSiNoProcesadoTx` (`server/cuentas.ts`) hace `tx.set(cuentaRef, {...})`, que REEMPLAZA el documento completo de `cuentas/{uid}` — si un usuario con Pro activo (`mpSuscripcionId` vigente) compra un Paquete, esa escritura lo convierte en `plan: "paquete"` y pierde el rastro de la suscripción Pro sin cancelarla en Mercado Pago (el cobro de Pro seguiría llegando, pero la cuenta ya no reflejaría que es Pro). Antes de implementar la activación de Pro (esta tarea) hay que decidir y documentar aquí la regla: ¿se bloquea comprar un Paquete con Pro activo (más simple, evita el cruce) o se permite y la escritura preserva/concilia los campos de Pro? Mientras no se decida, la activación de Pro no debe usar el mismo patrón de `tx.set` reemplazando todo el documento sin mirar el plan anterior.
- **Criterio de hecho:** al autorizar la suscripción, el usuario aparece como Pro; ejecutar el ajuste a mano cambia el monto de la suscripción y el cliente recibe el aviso con el monto nuevo; el cobro siguiente es igual al avisado; con una subida > 10 % simulada no se cobra sin aceptación; la ruta del ajuste rechaza llamadas sin la credencial de Scheduler.

### Tarea 9 — Cancelación y pagos fallidos
- **Qué:** botón "Cancelar renovación" para Paquete con renovación y para Pro; el usuario conserva su plan hasta la fecha pagada. Si Mercado Pago informa cobro fallido, aviso al cliente y a Leonardo; si no se regulariza a la fecha de vencimiento, vuelve a Gratis.
- **Requisito (vuelta 22):** `refunded` o `charged_back` revierte el Paquete (o Pro) a Gratis y avisa a Leonardo. Hoy el webhook (`server/webhook.ts`) solo reconoce `status === "approved"` para activar; un aviso posterior de Mercado Pago con `status: "refunded"` o `status: "charged_back"` sobre un pago ya activado no tiene ningún manejo — la cuenta se queda en Paquete/Pro aunque el dinero se haya devuelto o se haya reversado por contracargo. Esta tarea debe agregar esa reacción: al recibir uno de esos dos status para un `paymentId` ya activado, poner la cuenta en Gratis (sin esperar a que venza) y enviar el aviso a Leonardo (Tarea 5).
- **Hecho (solo el lado del Paquete, 2026-10-05):** `server/cuentas.ts` (`revertirPagoSiNoRevertidoTx`/`revertirPagoSiNoRevertido`) revierte la cuenta a Gratis (plan/saldo/vencimiento/ultimoPago, igual que una cuenta nueva) SOLO si el `paymentId` reembolsado/contracargado era el `ultimoPago` activo de la cuenta; si no lo era (el usuario ya compró o renovó de nuevo desde entonces), la cuenta no se toca. Idempotente por su cuenta (`revertido` en `pagosProcesados/{paymentId}`, el mismo documento que ya marcaba la activación): un segundo aviso del mismo evento no vuelve a revertir ni a mandar el aviso dos veces. `server/webhook.ts` (`procesarWebhookMP`) reconoce `status`/`status_detail` iguales a `"refunded"`/`"charged_back"` ANTES del chequeo de "approved" (un pago revertido casi nunca sigue en `approved`) y nunca llama a `activarPaquete` en ese caso. `server/notificaciones.ts` (`avisarReembolsoPaquete`) compone la reversión con el aviso a Leonardo (`contacto@leonardoantolinez.com`, plan/monto/uid/paymentId/si se revirtió o no, Tarea 5). Pro queda pendiente de la Tarea 8 (todavía no existe nada que revertir para ese plan). Pruebas: `tests/reembolso.test.ts` (reversión real sobre el doble de Firestore), `tests/webhook.test.ts` (enrutamiento del status), `tests/notificaciones.test.ts` (composición del aviso).
- **Cómo se hace la devolución del DINERO (manual, 2026-10-05 — v1 nunca reembolsa automáticamente, ver spec §4 "NO incluye: reembolsos automáticos"):** lo de arriba solo revierte la CUENTA (plan/saldo) cuando Mercado Pago avisa que YA se reembolsó o se reversó el pago — nunca es quien decide devolver el dinero. El dinero lo devuelve Leonardo a mano, desde el panel de Mercado Pago:
  1. Entrar a `mercadopago.com.co` → *Tu negocio* → *Actividad* (o *Dinero* → *Tus cobros*) → buscar el pago por el `ref_mp`/`paymentId` que trae el correo de aviso de venta (Tarea 5) o el que el cliente reporte.
  2. Abrir el detalle del pago → botón **Devolver** (reembolso total; Mercado Pago también permite un reembolso parcial, pero v1 de CertiSend solo contempla la devolución COMPLETA de la casilla T5, ver regla "Paquete usado" abajo).
  3. Confirmar el monto (el total pagado) y el motivo. Mercado Pago procesa la devolución al medio de pago original (tarjeta: 1-2 ciclos de facturación; otros medios, según su propia política) y notifica al comprador por su cuenta.
  4. Mercado Pago manda el webhook de `status: "refunded"` a `/api/mp/webhook` — el código de esta tarea revierte la cuenta automáticamente (si ese pago era el activo) y avisa a Leonardo; no hace falta ningún paso adicional en CertiSend.
  5. Si el pago NO aparece en el panel con ese `paymentId` (datos equivocados, cuenta de Mercado Pago distinta), escalar con el propio soporte de Mercado Pago antes de prometerle nada al cliente.
  - **Plazo:** Términos sec. 8.4 promete responder la solicitud de devolución en máximo 15 días hábiles y, si procede, reembolsar en máximo 30 días calendario desde la respuesta — el paso 2-3 de arriba debe completarse dentro de esos plazos.
  - **Regla de "Paquete usado"** (decisión del Brain, ya en la tabla de decisiones de este plan, fila "T5 'Paquete usado'"): la devolución COMPLETA de un Paquete (casilla T5 del checkout) solo aplica si el Paquete está "sin usar" = **nunca se descontó ni un solo envío de su saldo** — y eso significa, exactamente, que `enviosRestantes` siga en 150 (lotes de ≤15 certificados NUNCA cuentan como "usado", según R3-1: nunca descuentan del saldo del Paquete, los descuenta solo un lote de >15). Antes de pulsar "Devolver" en el panel de Mercado Pago, Leonardo (o quien atienda la solicitud) debe comprobar `enviosRestantes` de la cuenta del cliente (`GET /api/cuenta` autenticado como ese usuario, o revisando `cuentas/{uid}` en Firestore) — si ya bajó de 150, el Paquete se considera "usado" y la devolución completa de la casilla T5 NO aplica (aunque pueda aplicar otra vía, p. ej. un contracargo legítimo por otra razón, que de todas formas revierte la cuenta igual que arriba).

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

### Tarea 15 — Revisión segura antes de enviar (bug de homónimos)
- **Qué:** en la pantalla de revisión, mostrar para cada certificado el nombre leído por la IA y el destinatario con **nombre y correo**; el emparejamiento manual se hace por la **fila** del destinatario, no por su nombre (hoy, con dos personas del mismo nombre, siempre se toma la primera: `handleManualPairing` en `src/App.tsx`); la confirmación de envío se registra en el servidor (uid, lote, número de envíos, fecha y hora).
- **Dónde:** `src/App.tsx`, `server.ts` (registro de confirmación, junto a `/api/lote/iniciar`).
- **Depende de:** Tarea 3.
- **Criterio de hecho:** con dos destinatarios homónimos en la hoja, elegir el segundo en la revisión envía al segundo (prueba en navegador); la pantalla muestra los correos; el registro de confirmación queda guardado.

### Tarea 13 — Lanzamiento (flujo productos vitrina)
- **Qué:** puertas completas (Verify_After_Changes_LAP contra este plan y el spec, /code-review, /security-review, Sentinel_LAP diff —es pagos—, QA_Release_LAP, REVISOR_EXTERNO_LAP hasta GO), encender `PAGOS_ACTIVOS`, desplegar Cloud Run + reglas Firestore + Hosting, **un pago real de bajo monto** de cada tipo (Paquete único, Paquete renovable, Pro) verificado de punta a punta y cancelado/reembolsado manualmente, README y landing actualizados, memoria y changelog.
- **Dónde:** todo el repo + `Brain_Master_Business/WIKI/productos-vitrina.md`.
- **Depende de:** Tareas 0-12, 14 y 15; **contador** (IVA/facturación) y **abogado colegiado** (documentos legales) con visto bueno; datos pendientes del proveedor (documento y dirección) completados por Leonardo.
- **Criterio de hecho:** los tres pagos reales activan el plan correcto, Leonardo recibió los avisos, la cancelación funciona, y el REVISOR da GO sobre el diff final.
