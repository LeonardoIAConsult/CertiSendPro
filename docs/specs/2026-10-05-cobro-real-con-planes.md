# Cobro real con planes en CertiSend Pro
**Fecha:** 2026-10-05 · **Autor:** Leonardo Antolinez · **Estado:** borrador v1

## 1. Overview
CertiSend pasa de "todo gratis con botones de compra que no cobran" a tres planes reales: **Gratis**, **Paquete de 150 envíos** (US$15, un mes) y **Pro ilimitado** (US$29 al mes, suscripción). Quien paga recibe de verdad lo que compró, la app lo respeta al enviar, y se cobra en pesos colombianos a la TRM oficial. Para qué: que CertiSend genere ingresos sin prometer nada que no entrega.

## 2. Usuario Objetivo
- **Organizador de eventos o formación** (fundación, academia, empresa) que emite certificados por lotes desde Canva o PDF y los envía desde su propio Gmail. No es técnico; quiere cargar, revisar y enviar. Paga con tarjeta o PSE desde Colombia.
- **Usuario ocasional** que tiene un evento puntual al mes y no quiere suscribirse a nada.

## 3. Contexto del problema
- Hoy la app no tiene planes: cualquiera envía lo que quiera gratis. La web anuncia "Pro US$29/mes" y "US$0,10 por envío", pero el cobro nunca funcionó (llamaba a una dirección de Mercado Pago inexistente) y hasta el 5-oct mostraba "pago exitoso" aunque no se cobrara nada. Hoy los botones dicen "Hablemos de este plan" y abren un correo.
- La web promete en Pro cosas que no existen ("escaneo prioritario", "soporte 24/7") y otra que ya es gratis para todos (asunto y cuerpo de correo personalizados en HTML).
- La cuenta de Mercado Pago es de Colombia: solo cobra en pesos, mientras la web muestra dólares.
- Hay 0 clientes de pago: es el momento de definir bien las reglas antes del primero.

## 4. Alcance de la versión 1
- **Incluye (v1):**
  - Plan **Gratis**: hasta 15 certificados por lote, para siempre.
  - **Paquete**: 150 envíos con éxito por US$15, válidos 1 mes desde el pago o hasta gastarlos, lo que ocurra primero. Al pagar, el usuario elige si se **renueva solo cada mes** o es un pago único.
  - **Pro**: envíos ilimitados por US$29 al mes, suscripción que se cobra cada mes en pesos, con el monto **ajustado cada mes a la TRM oficial** y aviso al cliente antes del cobro.
  - Cobro siempre en **pesos colombianos**; la web muestra el precio en dólares **y** el equivalente en pesos del día antes de pagar.
  - El plan se **activa solo cuando Mercado Pago confirma el pago** (no por volver a la página).
  - El usuario ve su **plan, envíos restantes y fecha de vencimiento** dentro de la app.
  - El usuario puede **cancelar** la renovación del paquete o la suscripción Pro desde la app; conserva lo pagado hasta su fecha.
  - Leonardo recibe un **aviso por cada venta, renovación, cancelación y pago fallido**.
  - Textos de planes alineados a lo real: Pro = ilimitado + soporte prioritario por correo; asunto y cuerpo personalizados se anuncian como disponibles en todos los planes; se retira "escaneo prioritario" y "24/7".
- **NO incluye (v1):**
  - Facturación electrónica DIAN (se emite aparte, manual).
  - Cupones, descuentos, prueba gratis de Pro, planes por equipo o varios usuarios por cuenta.
  - Cobro en dólares o con PayPal.
  - Reembolsos automáticos (se gestionan a mano desde Mercado Pago).
  - Escaneo prioritario real y soporte 24/7.
  - Panel de administración propio (Leonardo usa el panel de Mercado Pago y los avisos).

## 5. Comportamiento esperado
**Elegir y pagar**
- Cuando el usuario abre los planes → ve Gratis, Paquete y Pro con el precio en dólares y "≈ $X COP hoy, se cobra en pesos a la TRM oficial".
- Cuando el usuario pulsa **Comprar paquete** → elige "pago único" o "renovar cada mes" → va a Mercado Pago con el monto en pesos del día.
- Cuando el usuario pulsa **Suscribirme a Pro** → ve el monto de este mes en pesos y el aviso "el monto se ajusta cada mes a la TRM; te avisamos antes de cada cobro" → va a Mercado Pago a autorizar la suscripción.
- Cuando el usuario vuelve de Mercado Pago → la app dice "Estamos confirmando tu pago"; cuando llega la confirmación, el plan aparece activo con su fecha. Si no llega en unos minutos, dice "Tu pago está en revisión; te avisamos por correo".
- Cuando el pago es rechazado → la app dice "No se realizó ningún cobro" y el plan no cambia.

**Usar la app según el plan**
- Cuando un usuario Gratis intenta enviar un lote de más de 15 → la app no envía y le muestra sus opciones (dividir el lote o pasar a Paquete o Pro).
- Cuando un usuario con Paquete envía → cada certificado enviado con éxito descuenta 1 de sus 150; los que fallan no descuentan. La app muestra "te quedan N envíos, vencen el DD/MM".
- Cuando al usuario de Paquete no le alcanzan los envíos para el lote → la app se lo dice antes de empezar ("tienes 40, el lote es de 60") y no envía a medias.
- Cuando el Paquete vence o llega a 0 → el usuario vuelve a Gratis; si eligió renovar, se cobra el siguiente mes y se recargan 150 (no se acumulan los sobrantes).
- Cuando un usuario Pro envía → no hay límite.

**Renovaciones, cambios y cancelación**
- Cada mes, antes de cobrar Pro → el usuario recibe un aviso con el monto en pesos de ese mes.
- Cuando el cobro mensual falla → el usuario recibe aviso y conserva el plan hasta la fecha pagada; si no se resuelve, vuelve a Gratis.
- Cuando el usuario cancela → sigue con su plan hasta la fecha pagada y luego vuelve a Gratis; no se le cobra de nuevo.

**Leonardo**
- Cuando hay una venta, renovación, cancelación o pago fallido → recibe un correo con plan, monto, usuario y referencia de Mercado Pago.

## 6. Posibles errores y mitigaciones
| Error/riesgo | Cuándo pasa | Mitigación |
|---|---|---|
| Alguien activa un plan sin pagar | Abre la página de "pago exitoso" a mano o manipula el navegador | El plan solo se activa con la confirmación de Mercado Pago verificada por el servidor; los límites se cuentan en el servidor, nunca en el navegador |
| Se activa dos veces o se descuentan envíos de más | Mercado Pago avisa el mismo pago más de una vez | Cada pago se procesa una sola vez por su identificador |
| Pagos de Faro y CertiSend se mezclan | La cuenta de Mercado Pago es compartida con Faro | Cada cobro lleva una referencia propia de CertiSend; los avisos que no son de CertiSend se ignoran |
| El cliente se molesta porque el monto cambia | Cobro mensual de Pro ajustado a la TRM | Aviso previo con el monto de ese mes y opción de cancelar; revisión legal (Abogado_LAP) del cambio de monto en suscripción antes de lanzar |
| La TRM no llega o llega rota | datos.gov.co caído o con un dato absurdo | Se usa la última TRM válida reciente; si no hay ninguna, no se ofrece pagar y se dice por qué |
| Se cobra pero el usuario no ve su plan | La confirmación tarda o falla | Mensaje "en revisión"; Leonardo recibe el aviso de la venta y puede activarlo a mano |
| Envío a medias en un lote | Al usuario de Paquete no le alcanzan los envíos | Se valida el saldo antes de empezar el lote |
| Abuso de las rutas de cobro | Peticiones masivas para crear cobros | Tope global de solicitudes de cobro por minuto, además del límite por usuario |
| El plan se ofrece pero el cobro está apagado | Falta configuración en producción | El interruptor de pagos sigue existiendo; la web solo muestra "Comprar" cuando está encendido |
| Promesas que no se cumplen | Textos de planes desalineados | Los textos de planes se revisan contra lo que la app hace antes de lanzar |
