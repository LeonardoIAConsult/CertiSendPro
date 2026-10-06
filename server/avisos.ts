// Canal de correo transaccional (Tarea 5, cobro real con planes, 2026-10-05): el UNICO lugar de
// este servidor que manda correos. Nunca usa un proveedor nuevo (SendGrid, Resend, etc. — habria
// que auditarlo primero, regla de instalacion del Brain): reutiliza el patron ya probado de
// Apps Script + MailApp en contacto@leonardoantolinez.com, igual que Faro
// (`Brain_Master_Business/TOOLS/faro-licencias-backend/Code.gs`), con un relay propio firmado por
// HMAC (ver `docs/relay/avisos-relay.gs`, que NO se despliega desde aqui — ver docs/relay/README.md).
//
// Separado de server.ts y de server/webhook.ts/server/cuentas.ts (mismo patron que server/trm.ts):
// probable con node:test, sin red real, inyectando `fetchLike`. `enviarCorreo` es la UNICA funcion
// que hace la llamada HTTP; todo lo demas en este archivo (construir el texto de cada correo, la
// firma HMAC, sumar dias habiles) es PURO.
import { createHmac } from "crypto";

// ── Firma HMAC del relay ─────────────────────────────────────────────────────────────────────
// El cuerpo se firma sobre una cadena canonica simple (nunca sobre `JSON.stringify`, cuyo orden de
// claves no esta garantizado entre Node y Apps Script): `${ts}\n${para}\n${asunto}\n${texto}`. El
// relay (docs/relay/avisos-relay.gs) reconstruye la MISMA cadena con los campos que recibio y
// compara la firma — nunca confia en una `firma` sin volver a calcularla con el secreto que solo
// conocen el servidor y el relay.

/** Cadena canonica que se firma — EXPORTADA para que la prueba de HMAC (tests/avisos.test.ts) y
 * el relay (docs/relay/avisos-relay.gs, funcion `cadenaCanonica_`) construyan exactamente la misma
 * cadena a partir de los mismos campos. */
export function cadenaCanonicaAviso(ts: number, para: string, asunto: string, texto: string): string {
  return `${ts}\n${para}\n${asunto}\n${texto}`;
}

/** HMAC-SHA256 en hexadecimal de `cuerpo` con `secreto`. Funcion PURA (sin red, sin Date.now):
 * dado el mismo cuerpo y secreto, siempre el mismo resultado — por eso se puede probar con un
 * vector fijo en TS y, por separado, con el mismo vector a mano en el editor de Apps Script
 * (`Utilities.computeHmacSha256Signature` + conversion a hex), sin depender de desplegar nada. */
export function firmarHmac(cuerpo: string, secreto: string): string {
  return createHmac("sha256", secreto).update(cuerpo, "utf8").digest("hex");
}

// ── Correo generico, via el relay ─────────────────────────────────────────────────────────────

export interface DatosCorreo {
  para: string;
  asunto: string;
  texto: string;
}

/** Forma minima de `fetch` que necesita este modulo (inyectable en pruebas, mismo patron que
 * `FetchLike` de server/trm.ts). */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface EnviarCorreoDeps {
  /** URL del relay de Apps Script (por defecto, `process.env.AVISOS_RELAY_URL`). */
  relayUrl?: string;
  /** Secreto compartido con el relay (por defecto, `process.env.AVISOS_RELAY_SECRET`). NUNCA se
   * registra ni se expone: ni en logs, ni en el valor de retorno, ni en un mensaje de error. */
  relaySecret?: string;
  fetchLike?: FetchLike;
  ahora?: () => Date;
  timeoutMs?: number;
  /** Log minimo, nunca con el secreto ni el cuerpo completo del correo (solo metadatos:
   * destinatario, estado HTTP). Por defecto, `console.warn`/`console.error`. */
  log?: (linea: string) => void;
}

const TIMEOUT_MS_DEFECTO = 5000;

/**
 * Envia un correo a traves del relay de Apps Script, firmado con HMAC-SHA256. Nunca lanza: si
 * faltan las variables de entorno, si el relay no responde a tiempo (timeout `timeoutMs`, 5 s por
 * defecto) o si responde con error, devuelve `false` y deja un `console.warn`/`console.error`
 * minimo (nunca el secreto, nunca el texto completo del correo — solo el destinatario y, si
 * aplica, el estado HTTP). Quien llama (server/notificaciones.ts, server.ts) decide que hacer con
 * `false`: la Tarea 5 exige que un correo fallido NUNCA revierta una activacion ni haga responder
 * 500 al webhook de Mercado Pago.
 */
export async function enviarCorreo(datos: DatosCorreo, deps: EnviarCorreoDeps = {}): Promise<boolean> {
  const log = deps.log ?? ((linea: string) => console.warn(linea));
  const relayUrl = deps.relayUrl ?? process.env.AVISOS_RELAY_URL;
  const relaySecret = deps.relaySecret ?? process.env.AVISOS_RELAY_SECRET;
  if (!relayUrl || !relaySecret) {
    log(`[AVISOS] AVISOS_RELAY_URL/AVISOS_RELAY_SECRET no configurados; correo NO enviado a ${datos.para}.`);
    return false;
  }

  const fetchFn: FetchLike = deps.fetchLike ?? (globalThis.fetch as unknown as FetchLike);
  const ahora = (deps.ahora ?? (() => new Date()))();
  const ts = Math.floor(ahora.getTime() / 1000);
  const firma = firmarHmac(cadenaCanonicaAviso(ts, datos.para, datos.asunto, datos.texto), relaySecret);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), deps.timeoutMs ?? TIMEOUT_MS_DEFECTO);
  try {
    const respuesta = await fetchFn(relayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ para: datos.para, asunto: datos.asunto, texto: datos.texto, ts, firma }),
      signal: controller.signal,
    });
    if (!respuesta.ok) {
      log(`[AVISOS] el relay respondio ${respuesta.status}; correo NO enviado a ${datos.para}.`);
      return false;
    }
    return true;
  } catch (error: any) {
    // Timeout (AbortError) o red caida: nunca el detalle completo del error (podria incluir la
    // URL con query strings u otros datos), solo que fallo y a quien iba dirigido.
    log(`[AVISOS] fallo al llamar al relay (${error?.name || "error"}); correo NO enviado a ${datos.para}.`);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Dias habiles (para la fecha limite de devolucion del Paquete, plantilla-confirmacion-compra
// v1.2) ──────────────────────────────────────────────────────────────────────────────────────
// Igual nivel de simplificacion que el resto del proyecto (Ley 1480 habla de "dias habiles"; esta
// funcion cuenta de lunes a viernes, sin calendario de festivos colombianos — anadir festivos es
// trabajo aparte, fuera de alcance de esta tarea, y se deja dicho aqui para no inventar que ya se
// cubre). Fecha en la zona de Bogota (mismo patron de `Intl` que server/cuentas.ts, nunca los
// getters UTC/locales de `Date`, que dependen de la zona del proceso).
function diaDeSemanaBogota(fecha: Date): number {
  // 0=domingo … 6=sabado, igual que Date#getDay pero en la zona de Bogota.
  const nombre = new Intl.DateTimeFormat("en-US", { timeZone: "America/Bogota", weekday: "short" }).format(fecha);
  const indice: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return indice[nombre] ?? 0;
}

/** Suma `dias` dias HABILES (lunes a viernes) a `fecha`, en la zona de Bogota. Usada para la
 * fecha limite de devolucion del Paquete (5 dias habiles tras el pago, Terminos sec. 8.4). */
export function sumarDiasHabiles(fecha: Date, dias: number): Date {
  let resultado = new Date(fecha.getTime());
  let restantes = dias;
  while (restantes > 0) {
    resultado = new Date(resultado.getTime() + 24 * 3600_000);
    const diaSemana = diaDeSemanaBogota(resultado);
    if (diaSemana !== 0 && diaSemana !== 6) restantes--;
  }
  return resultado;
}

/** DD/MM/AAAA en la zona de Bogota (mismo formato que `formatearFechaBogota` de src/utils/plan.ts,
 * reimplementado aqui a proposito: ese modulo es del cliente y no se importa desde el servidor). */
export function formatearFechaBogotaDDMMAAAA(fecha: Date): string {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Bogota",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(fecha);
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${valor("day")}/${valor("month")}/${valor("year")}`;
}

/** Monto en pesos formateado con puntos de miles (es-CO) — mismo formato que usa
 * `textoCasillaTerminos` de shared/textosCasillas.ts para el monto en los correos. */
function formatearCop(cop: number): string {
  return cop.toLocaleString("es-CO");
}

// ── Correo de confirmacion de compra al comprador (plantilla-confirmacion-compra.md v1.2) ──────
// ES es traduccion fiel de docs/legal/plantilla-confirmacion-compra.md v1.2 (texto plano, no
// HTML: `enviarCorreo` solo manda `{para, asunto, texto}`). EN es traduccion de cortesia, mismo
// nivel de fidelidad que las traducciones EN ya existentes de T4/T5 (docs/legal/textos-checkout.md
// v1.2). Los campos [PENDIENTE: ...] de la plantilla original (NIT, direccion de notificacion, IVA
// discriminado, obligacion de facturacion DIAN) siguen pendientes de que el contador y el abogado
// colegiado los confirmen (Tarea 0/13 del plan) — se mantienen como placeholders literales, igual
// que ya hace la plantilla, en vez de inventar un dato que el Brain no tiene.

export interface DatosConfirmacionCompra {
  paraEmail: string;
  idioma: "es" | "en";
  cop: number;
  trm: number;
  fechaTrm: string;
  fechaPago: Date;
  fechaVencimiento: Date;
  refMp: string;
  enlaceTerminos: string;
}

export function construirCorreoConfirmacionCompra(
  datos: DatosConfirmacionCompra
): { asunto: string; texto: string } {
  const copTexto = formatearCop(datos.cop);
  const fechaPagoTexto = formatearFechaBogotaDDMMAAAA(datos.fechaPago);
  const fechaVenceTexto = formatearFechaBogotaDDMMAAAA(datos.fechaVencimiento);
  const fechaLimiteDevolucion = formatearFechaBogotaDDMMAAAA(sumarDiasHabiles(datos.fechaPago, 5));

  if (datos.idioma === "en") {
    return {
      asunto: `Confirmation of your CertiSend Pro purchase — Bundle — COP $${copTexto}`,
      texto:
        `Hello,\n\n` +
        `We received and confirmed your payment. This email is the receipt for your purchase; please keep it.\n\n` +
        `PURCHASE SUMMARY\n` +
        `Plan: Bundle (150 sends)\n` +
        `What it includes: 150 successful sends, valid for 1 month or until used up, whichever comes first. Batches of 15 certificates or fewer never spend your Bundle balance. Unused sends expire and do not carry over.\n` +
        `Price paid: COP $${copTexto} [PENDING: confirm with accountant whether this price already includes VAT]\n` +
        `Calculation: US$15 x TRM ${datos.trm} (official rate, effective ${datos.fechaTrm}), rounded to the peso\n` +
        `Payment date: ${fechaPagoTexto}\n` +
        `Mercado Pago reference: ${datos.refMp}\n\n` +
        `VALIDITY\n` +
        `Your plan was activated on ${fechaPagoTexto}.\n` +
        `Valid until ${fechaVenceTexto}.\n\n` +
        `HOW TO REQUEST A REFUND\n` +
        `If you make no successful send with this Bundle, you can request a full refund of this payment until ${fechaLimiteDevolucion} (five business days after payment) by writing to contacto@leonardoantolinez.com with reference ${datos.refMp} (Terms, section 8.4).\n\n` +
        `Something wrong? If you don't recognize this charge or the plan doesn't appear active, write to contacto@leonardoantolinez.com with the reference above.\n\n` +
        `Terms and Conditions: ${datos.enlaceTerminos}\n\n` +
        `—\n` +
        `Provider: LEONARDO ANTOLINEZ P. · Tax ID: [PENDING] · Bogota, Colombia · contacto@leonardoantolinez.com · https://certisendpro.online`,
    };
  }

  return {
    asunto: `Confirmación de tu compra en CertiSend Pro — Paquete — $${copTexto} COP`,
    texto:
      `Hola:\n\n` +
      `Recibimos y confirmamos tu pago. Este correo es el acuse de recibo de tu compra; guárdalo como comprobante.\n\n` +
      `RESUMEN DE LA COMPRA\n` +
      `Plan: Paquete (150 envíos)\n` +
      `Qué incluye: 150 envíos con éxito, 1 mes de vigencia o hasta gastarlos, lo que ocurra primero. Los lotes de 15 certificados o menos no gastan tu Paquete. Los envíos que no uses vencen y no se acumulan.\n` +
      `Precio pagado: $${copTexto} COP [PENDIENTE: confirmar con contador si este precio incluye IVA]\n` +
      `Cálculo: US$15 × TRM ${datos.trm} (certificada por la Superintendencia Financiera, vigente el ${datos.fechaTrm}), redondeado al peso\n` +
      `Fecha del pago: ${fechaPagoTexto}\n` +
      `Referencia de Mercado Pago: ${datos.refMp}\n\n` +
      `VIGENCIA\n` +
      `Tu plan quedó activo el ${fechaPagoTexto}.\n` +
      `Vigente hasta el ${fechaVenceTexto}.\n\n` +
      `¿CÓMO PEDIR UNA DEVOLUCIÓN?\n` +
      `Si no haces ningún envío con éxito con este Paquete, puedes pedir la devolución completa de este pago hasta el ${fechaLimiteDevolucion} (cinco días hábiles después del pago) escribiendo a contacto@leonardoantolinez.com con la referencia ${datos.refMp} (Términos, sección 8.4).\n\n` +
      `¿Algo no está bien? Si no reconoces este cobro o el plan no aparece activo, escríbenos a contacto@leonardoantolinez.com con la referencia anterior.\n\n` +
      `Términos y Condiciones: ${datos.enlaceTerminos}\n\n` +
      `—\n` +
      `Proveedor: LEONARDO ANTOLINEZ P. · Documento: [PENDIENTE] · Bogotá, Colombia · contacto@leonardoantolinez.com · https://certisendpro.online`,
  };
}

// ── Avisos a Leonardo ───────────────────────────────────────────────────────────────────────

export function construirAvisoVentaLeonardo(datos: {
  uid: string;
  paymentId: string;
  cop: number;
  plan: string;
}): { asunto: string; texto: string } {
  return {
    asunto: `[CertiSend] Nueva venta — ${datos.plan} — $${formatearCop(datos.cop)} COP`,
    texto:
      `Plan: ${datos.plan}\n` +
      `Monto: $${formatearCop(datos.cop)} COP\n` +
      `uid: ${datos.uid}\n` +
      `paymentId: ${datos.paymentId}`,
  };
}

export function construirAvisoReembolsoLeonardo(datos: {
  uid: string;
  paymentId: string;
  status: string;
  cuentaRevertida: boolean;
}): { asunto: string; texto: string } {
  const accion = datos.cuentaRevertida
    ? "Se revirtió la cuenta a Gratis (era el pago activo)."
    : "La cuenta NO se tocó (este pago ya no era el activo).";
  return {
    asunto: `[CertiSend] ${datos.status === "charged_back" ? "Contracargo" : "Reembolso"} — uid ${datos.uid}`,
    texto: `Mercado Pago reportó status="${datos.status}" para el pago ${datos.paymentId} del usuario ${datos.uid}.\n${accion}`,
  };
}

export function construirAvisoFalloWebhookLeonardo(datos: {
  paymentId: string;
  fallosConsecutivos: number;
}): { asunto: string; texto: string } {
  return {
    asunto: `[CertiSend] El webhook de Mercado Pago está fallando repetidamente`,
    texto:
      `El webhook de Mercado Pago lleva ${datos.fallosConsecutivos} fallos seguidos procesando el pago ` +
      `${datos.paymentId || "(sin id)"}. Revisa los logs de Cloud Run; Mercado Pago seguirá reintentando ` +
      `mientras el webhook responda con error.`,
  };
}
