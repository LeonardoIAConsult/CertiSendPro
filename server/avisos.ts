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
import { createHmac, randomUUID } from "crypto";
import { esFestivoColombia } from "./festivosColombia";
import { enmascararCorreo } from "../shared/correo";

// ── Firma HMAC del relay ─────────────────────────────────────────────────────────────────────
// El cuerpo se firma sobre una cadena canonica simple (nunca sobre `JSON.stringify`, cuyo orden de
// claves no esta garantizado entre Node y Apps Script):
// `${ts}\n${nonce}\n${idEnvio}\n${para}\n${asunto}\n${texto}`. El relay (docs/relay/avisos-relay.gs)
// reconstruye la MISMA cadena con los campos que recibio y compara la firma EN TIEMPO CONSTANTE
// (M33, corrige vuelta 27) — nunca confia en una `firma` sin volver a calcularla con el secreto
// que solo conocen el servidor y el relay.
//
// `nonce` (M33): valor aleatorio generado AQUI en cada llamada (nunca reutilizado) y firmado junto
// con el resto del cuerpo. El relay guarda cada nonce que ya vio en CacheService durante 10
// minutos (`docs/relay/avisos-relay.gs`, funcion `nonceNuevo_`): una peticion con una firma VALIDA
// pero un nonce ya visto (alguien capturo e intento repetir una peticion firmada real) se rechaza
// igual que una firma invalida — sin este campo, una firma capturada seguiria siendo valida
// durante toda su ventana de antiguedad (5 min) y se podria reenviar el mismo correo varias veces.
//
// `idEnvio` (M-3, corrige vuelta 34 del REVISOR_EXTERNO): a diferencia del `nonce` (aleatorio,
// distinto en CADA llamada, incluida un reintento del MISMO correo logico), `idEnvio` es estable
// para un mismo correo logico — `${paymentId}:${destinatario}` para los avisos del acuse de compra
// (ver server/notificaciones.ts). El relay lo guarda en `PropertiesService` (nunca en
// `CacheService`: caduca, y esta deduplicacion debe sobrevivir mas que los 10 min del nonce) y si
// ya lo vio, responde OK sin volver a mandar el correo — protege contra el caso real que motivo
// esto: el relay de Apps Script tarda mas que el timeout de `enviarCorreo` (ver abajo), Node trata
// la llamada como fallida y el barrido la reintenta, pero Apps Script SI habia terminado de
// mandar el correo original. Cadena vacia (`""`) cuando el llamador no tiene un id idempotente que
// ofrecer (compatibilidad: el relay nunca deduplica una cadena vacia).

/** Cadena canonica que se firma — EXPORTADA para que la prueba de HMAC (tests/avisos.test.ts) y
 * el relay (docs/relay/avisos-relay.gs, funcion `cadenaCanonica_`) construyan exactamente la misma
 * cadena a partir de los mismos campos. */
export function cadenaCanonicaAviso(
  ts: number,
  nonce: string,
  idEnvio: string,
  para: string,
  asunto: string,
  texto: string
): string {
  return `${ts}\n${nonce}\n${idEnvio}\n${para}\n${asunto}\n${texto}`;
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
  /** M-3: id idempotente de este correo logico (`${paymentId}:${destinatario}`) — ver comentario
   * de `cadenaCanonicaAviso` arriba. Opcional: si se omite, el relay nunca deduplica este envio
   * (mismo comportamiento que antes de M-3). */
  idEnvio?: string;
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
  /** SOLO PARA PRUEBAS: fija el nonce en vez de generarlo aleatorio (M33). */
  generarNonce?: () => string;
  timeoutMs?: number;
  /** Log minimo, nunca con el secreto ni el cuerpo completo del correo (solo metadatos:
   * destinatario, estado HTTP). Por defecto, `console.warn`/`console.error`. */
  log?: (linea: string) => void;
}

// M-3(a) (corrige vuelta 34 del REVISOR_EXTERNO): subido de 5s a 20s. Con 5s, el relay de Apps
// Script (que puede demorar por cuota de MailApp o cold start del script) a veces NO terminaba a
// tiempo: Node abortaba la llamada (`false`), el barrido liberaba el reclamo y el SIGUIENTE
// disparo (30 min despues) reintentaba — pero Apps Script, que no se cancela solo porque el
// cliente HTTP se desconecto, a veces SI habia terminado de mandar el correo original, y el
// reintento producia un correo duplicado de verdad. 20s da mucho mas margen sin acercarse al
// `attempt-deadline` de 30s del propio job de Cloud Scheduler (docs/ops.md §3) ni al timeout de
// Express/Cloud Run en la peticion que dispara el barrido. El `idEnvio` de arriba es la segunda
// defensa (dedup del lado del relay) para el caso en que, aun con 20s, el relay siga tardando mas.
const TIMEOUT_MS_DEFECTO = 20_000;

/** Medio 2 (vuelta 35): si el relay de avisos esta configurado (`AVISOS_RELAY_URL` +
 * `AVISOS_RELAY_SECRET`), SIN revelar ninguno de los dos valores — mismo patron que
 * `huellaConfigurada` (server/huellaLote.ts). La usa `GET /api/health` (la reporta como booleano)
 * y, internamente, `enviarCorreo` para no duplicar el chequeo. PURA sobre un mapa de variables de
 * entorno (por defecto `process.env`), para poder probarla con node:test sin mutar el entorno
 * real del proceso. */
export function relayConfigurado(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.AVISOS_RELAY_URL && env.AVISOS_RELAY_URL.trim() && env.AVISOS_RELAY_SECRET && env.AVISOS_RELAY_SECRET.trim());
}

/** Medio 2 (vuelta 35): si `PROVEEDOR_NOMBRE` es un valor real (no vacio ni el marcador
 * `"[PENDIENTE]"`), SIN revelar el nombre — mismo patron que `relayConfigurado`/
 * `huellaConfigurada`. La usa `GET /api/health`. */
export function proveedorConfigurado(nombre: string = PROVEEDOR_NOMBRE): boolean {
  const limpio = nombre.trim();
  return Boolean(limpio) && limpio !== "[PENDIENTE]";
}

/**
 * Envia un correo a traves del relay de Apps Script, firmado con HMAC-SHA256. Nunca lanza: si
 * faltan las variables de entorno, si el relay no responde a tiempo (timeout `timeoutMs`, 20 s por
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
    log(`[AVISOS] AVISOS_RELAY_URL/AVISOS_RELAY_SECRET no configurados; correo NO enviado a ${enmascararCorreo(datos.para)}.`);
    return false;
  }

  const fetchFn: FetchLike = deps.fetchLike ?? (globalThis.fetch as unknown as FetchLike);
  const ahora = (deps.ahora ?? (() => new Date()))();
  const ts = Math.floor(ahora.getTime() / 1000);
  // M33: nonce aleatorio, nuevo en cada llamada, firmado junto con el resto del cuerpo — ver
  // comentario de `cadenaCanonicaAviso` arriba. `deps.generarNonce` solo existe para que las
  // pruebas puedan fijar un nonce determinista; en produccion siempre es `randomUUID()`.
  const nonce = (deps.generarNonce ?? randomUUID)();
  // M-3: cadena vacia cuando el llamador no mando `idEnvio` — el relay nunca deduplica ese caso.
  const idEnvio = datos.idEnvio ?? "";
  const firma = firmarHmac(cadenaCanonicaAviso(ts, nonce, idEnvio, datos.para, datos.asunto, datos.texto), relaySecret);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), deps.timeoutMs ?? TIMEOUT_MS_DEFECTO);
  try {
    const respuesta = await fetchFn(relayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ para: datos.para, asunto: datos.asunto, texto: datos.texto, ts, nonce, idEnvio, firma }),
      signal: controller.signal,
    });
    if (!respuesta.ok) {
      log(`[AVISOS] el relay respondio ${respuesta.status}; correo NO enviado a ${enmascararCorreo(datos.para)}.`);
      return false;
    }
    // Sentinel/security-review (ad80fd6, hallazgo Medio): Apps Script SIEMPRE responde HTTP 200
    // para un doPost (incluso sus propios errores logicos vienen envueltos en `json_({ok:false,
    // error:...})`, ver docs/relay/avisos-relay.gs) — `respuesta.ok` por si solo NUNCA detecta un
    // fallo del relay (secreto invalido, lock ocupado, destinatario inesperado, excepcion
    // interna). Hay que parsear el cuerpo y exigir `ok===true` de verdad.
    let cuerpo: { ok?: boolean; yaEnviado?: boolean; error?: string } = {};
    try {
      cuerpo = JSON.parse(await respuesta.text());
    } catch {
      log(`[AVISOS] el relay respondio 200 con un cuerpo no-JSON; correo NO enviado a ${enmascararCorreo(datos.para)}.`);
      return false;
    }
    if (cuerpo.ok !== true) {
      log(`[AVISOS] el relay respondio ok:false (${cuerpo.error || "sin detalle"}); correo NO enviado a ${enmascararCorreo(datos.para)}.`);
      return false;
    }
    return true;
  } catch (error: any) {
    // Timeout (AbortError) o red caida: nunca el detalle completo del error (podria incluir la
    // URL con query strings u otros datos), solo que fallo y a quien iba dirigido.
    log(`[AVISOS] fallo al llamar al relay (${error?.name || "error"}); correo NO enviado a ${enmascararCorreo(datos.para)}.`);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Dias habiles (para la fecha limite de devolucion del Paquete, plantilla-confirmacion-compra
// v1.2) ──────────────────────────────────────────────────────────────────────────────────────
// M36(3) (corrige vuelta 27): "dia habil" ahora excluye tambien los festivos de Colombia
// (server/festivosColombia.ts), no solo sabado/domingo — antes esta funcion solo saltaba fin de
// semana, asi que un plazo que cruzara, por ejemplo, Jueves/Viernes Santo contaba esos dos dias
// como habiles cuando no lo son. Fecha en la zona de Bogota (mismo patron de `Intl` que
// server/cuentas.ts/server/trm.ts, nunca los getters UTC/locales de `Date`, que dependen de la
// zona del proceso).
function diaDeSemanaBogota(fecha: Date): number {
  // 0=domingo … 6=sabado, igual que Date#getDay pero en la zona de Bogota.
  const nombre = new Intl.DateTimeFormat("en-US", { timeZone: "America/Bogota", weekday: "short" }).format(fecha);
  const indice: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return indice[nombre] ?? 0;
}

/** Fecha de Bogota como `yyyy-mm-dd` (mismo patron que `hoyBogota` de server/trm.ts) — formato que
 * usa `esFestivoColombia`. */
function fechaBogotaYYYYMMDD(fecha: Date): string {
  return fecha.toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

/** Suma `dias` dias HABILES (lunes a viernes, sin festivos colombianos) a `fecha`, en la zona de
 * Bogota. Usada para la fecha limite de devolucion del Paquete (5 dias habiles tras el pago,
 * Terminos sec. 8.4). */
export function sumarDiasHabiles(fecha: Date, dias: number): Date {
  let resultado = new Date(fecha.getTime());
  let restantes = dias;
  while (restantes > 0) {
    resultado = new Date(resultado.getTime() + 24 * 3600_000);
    const diaSemana = diaDeSemanaBogota(resultado);
    const esFinDeSemana = diaSemana === 0 || diaSemana === 6;
    const esFestivo = !esFinDeSemana && esFestivoColombia(fechaBogotaYYYYMMDD(resultado));
    if (!esFinDeSemana && !esFestivo) restantes--;
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

// ── Identidad del proveedor en el pie del acuse (M36(1), corrige vuelta 27; Tarea 11, 2026-10-05:
// se quita el hardcode) ──────────────────────────────────────────────────────────────────────
// Plantilla v1.2 (docs/legal/plantilla-confirmacion-compra.md) exige nombre, documento, direccion,
// telefono y correo del proveedor en el pie. El repo es PUBLICO: nombre/documento/direccion/
// telefono reales NUNCA se escriben aqui, solo se leen de las variables de entorno del servidor
// (PROVEEDOR_NOMBRE, PROVEEDOR_DOC, PROVEEDOR_DIR, PROVEEDOR_TEL — Cloud Run / Secret Manager en
// produccion, nunca un archivo versionado). Si una falta, queda el literal "[PENDIENTE]" (NUNCA
// inventado) y `tienePlaceholderPendiente` bloquea el envio del acuse (M36(2) abajo) — mismo
// comportamiento que ya existia para documento/direccion, ahora igual para las cuatro. El correo
// de contacto SI queda fijo: es el unico canal publico ya establecido en toda la app y los
// documentos legales (textos-checkout.md H9), no un dato personal sensible.
export const PROVEEDOR_NOMBRE = process.env.PROVEEDOR_NOMBRE || "[PENDIENTE]";
export const PROVEEDOR_DOCUMENTO = process.env.PROVEEDOR_DOC || "[PENDIENTE]";
export const PROVEEDOR_DIRECCION = process.env.PROVEEDOR_DIR || "[PENDIENTE]";
export const PROVEEDOR_TELEFONO = process.env.PROVEEDOR_TEL || "[PENDIENTE]";
export const PROVEEDOR_CORREO = "contacto@leonardoantolinez.com";
const PROVEEDOR_WEB = "https://certisendpro.online";

function pieProveedor(idioma: "es" | "en"): string {
  if (idioma === "en") {
    return (
      `—\n` +
      `Provider: ${PROVEEDOR_NOMBRE} · Tax ID: ${PROVEEDOR_DOCUMENTO} · Address: ${PROVEEDOR_DIRECCION} · ` +
      `Phone: ${PROVEEDOR_TELEFONO} · ${PROVEEDOR_CORREO} · ${PROVEEDOR_WEB}`
    );
  }
  return (
    `—\n` +
    `Proveedor: ${PROVEEDOR_NOMBRE} · Documento: ${PROVEEDOR_DOCUMENTO} · Dirección: ${PROVEEDOR_DIRECCION} · ` +
    `Tel. ${PROVEEDOR_TELEFONO} · ${PROVEEDOR_CORREO} · ${PROVEEDOR_WEB}`
  );
}

// ── M36(2): bloqueo del acuse mientras falte un dato (nunca enviar un acuse a medio llenar) ─────
// Si el texto final (pie de proveedor, o cualquier otro placeholder que siga pendiente — p. ej. la
// confirmacion del IVA, Tarea 0/13) todavia contiene un marcador de "falta este dato", el acuse NO
// se manda al comprador (server/notificaciones.ts lo comprueba antes de enviar, M35/M36). Se
// comprueban las DOS grafias porque el correo EN usa "[PENDING" como su propio marcador (traduccion
// fiel del mismo concepto) — revisar solo "[PENDIENTE" dejaria sin esta proteccion al correo en
// ingles, que hoy tambien trae sus propios placeholders (Tax ID, IVA).
export function tienePlaceholderPendiente(texto: string): boolean {
  return texto.includes("[PENDIENTE") || texto.includes("[PENDING");
}

// ── Correo de confirmacion de compra al comprador (plantilla-confirmacion-compra.md v1.2) ──────
// ES es traduccion fiel de docs/legal/plantilla-confirmacion-compra.md v1.2 (texto plano, no
// HTML: `enviarCorreo` solo manda `{para, asunto, texto}`). EN es traduccion de cortesia, mismo
// nivel de fidelidad que las traducciones EN ya existentes de T4/T5 (docs/legal/textos-checkout.md
// v1.2).
//
// O1 (Dictamen Abogado_LAP ronda 5, 2026-10-06, CRITICO): el precio pagado YA NO lleva el
// marcador "[PENDIENTE: confirmar con contador si este precio incluye IVA]" — ese marcador
// bloqueaba (via `tienePlaceholderPendiente`) el acuse de compra para TODA venta, asi que el
// comprador nunca lo recibia (incumple Terminos sec. 6.5 y Ley 1480 art. 50). La decision de
// Leonardo (sin contador; registrada en WIKI/registro-legal.md) ya resolvio el IVA: el precio es
// "total y final, sin cargos adicionales" — Leonardo absorbe cualquier IVA que llegue a deber, el
// comprador nunca paga de mas. Ver tests/avisos.test.ts ("O1: ...").

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
        `Price paid: COP $${copTexto}, total and final price, with no additional charges\n` +
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
        pieProveedor("en"),
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
      `Precio pagado: $${copTexto} COP, precio total y final, sin cargos adicionales\n` +
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
      pieProveedor("es"),
  };
}

// ── Correo de confirmacion de compra al comprador — Pago por uso (Tarea 16A-2, decision del Brain
// 2026-10-06) ────────────────────────────────────────────────────────────────────────────────────
// Misma fidelidad/estructura que `construirCorreoConfirmacionCompra` (Paquete): precio total y
// final sin cargos adicionales, TRM + fecha, y como pedir devolucion (5 dias habiles, Ley 1480).
// Difiere en que: (1) no hay vigencia/vencimiento que mostrar (el saldo Por uso NO vence); (2) el
// calculo cita la cantidad de envios comprados, no un plan fijo; (3) la devolucion aplica a "esta
// compra" (nunca al saldo acumulado total, que puede incluir compras anteriores ya usadas).

export interface DatosConfirmacionCompraPorUso {
  paraEmail: string;
  idioma: "es" | "en";
  cantidad: number;
  cop: number;
  trm: number;
  fechaTrm: string;
  fechaPago: Date;
  refMp: string;
  enlaceTerminos: string;
}

export function construirCorreoConfirmacionCompraPorUso(
  datos: DatosConfirmacionCompraPorUso
): { asunto: string; texto: string } {
  const copTexto = formatearCop(datos.cop);
  const fechaPagoTexto = formatearFechaBogotaDDMMAAAA(datos.fechaPago);
  const fechaLimiteDevolucion = formatearFechaBogotaDDMMAAAA(sumarDiasHabiles(datos.fechaPago, 5));

  if (datos.idioma === "en") {
    return {
      asunto: `Confirmation of your CertiSend Pro purchase — Pay-per-send — COP $${copTexto}`,
      texto:
        `Hello,\n\n` +
        `We received and confirmed your payment. This email is the receipt for your purchase; please keep it.\n\n` +
        `PURCHASE SUMMARY\n` +
        `Plan: Pay-per-send (${datos.cantidad} sends)\n` +
        `What it includes: ${datos.cantidad} sends added to your balance. Your balance never expires and adds up with any future purchase.\n` +
        `Price paid: COP $${copTexto}, total and final price, with no additional charges\n` +
        `Calculation: US$0.15 x ${datos.cantidad} sends x TRM ${datos.trm} (official rate, effective ${datos.fechaTrm}), rounded to the peso\n` +
        `Payment date: ${fechaPagoTexto}\n` +
        `Mercado Pago reference: ${datos.refMp}\n\n` +
        `YOUR BALANCE\n` +
        `Your balance was credited on ${fechaPagoTexto} and never expires.\n\n` +
        `HOW TO REQUEST A REFUND\n` +
        `If you make no send from this specific purchase, you can request a full refund of this payment until ${fechaLimiteDevolucion} (five business days after payment) by writing to contacto@leonardoantolinez.com with reference ${datos.refMp}.\n\n` +
        `Something wrong? If you don't recognize this charge, write to contacto@leonardoantolinez.com with the reference above.\n\n` +
        `Terms and Conditions: ${datos.enlaceTerminos}\n\n` +
        pieProveedor("en"),
    };
  }

  return {
    asunto: `Confirmación de tu compra en CertiSend Pro — Pago por uso — $${copTexto} COP`,
    texto:
      `Hola:\n\n` +
      `Recibimos y confirmamos tu pago. Este correo es el acuse de recibo de tu compra; guárdalo como comprobante.\n\n` +
      `RESUMEN DE LA COMPRA\n` +
      `Plan: Pago por uso (${datos.cantidad} envíos)\n` +
      `Qué incluye: ${datos.cantidad} envíos sumados a tu saldo. Tu saldo NO vence y se acumula con cualquier compra futura.\n` +
      `Precio pagado: $${copTexto} COP, precio total y final, sin cargos adicionales\n` +
      `Cálculo: US$0,15 × ${datos.cantidad} envíos × TRM ${datos.trm} (certificada por la Superintendencia Financiera, vigente el ${datos.fechaTrm}), redondeado al peso\n` +
      `Fecha del pago: ${fechaPagoTexto}\n` +
      `Referencia de Mercado Pago: ${datos.refMp}\n\n` +
      `TU SALDO\n` +
      `Tu saldo quedó activo el ${fechaPagoTexto} y NO vence.\n\n` +
      `¿CÓMO PEDIR UNA DEVOLUCIÓN?\n` +
      `Si no usas ningún envío de esta compra en particular, puedes pedir la devolución completa de este pago hasta el ${fechaLimiteDevolucion} (cinco días hábiles después del pago) escribiendo a contacto@leonardoantolinez.com con la referencia ${datos.refMp}.\n\n` +
      `¿Algo no está bien? Si no reconoces este cobro, escríbenos a contacto@leonardoantolinez.com con la referencia anterior.\n\n` +
      `Términos y Condiciones: ${datos.enlaceTerminos}\n\n` +
      pieProveedor("es"),
  };
}

// ── Aviso de reversion al COMPRADOR (Medio 1, vuelta 35; F1 Abogado_LAP ronda 5/verificacion
// ronda 5, 2026-10-06) ───────────────────────────────────────────────────────────────────────
// Terminos sec. 9.2 exige que, ante un reembolso/contracargo reportado por Mercado Pago, se
// informe al comprador — la via mas simple que cumple la seccion es mandarlo DIRECTO al correo de
// su cuenta (el mismo que ya recibio el acuse de compra), en vez de que Leonardo tenga que
// escribirlo a mano cada vez. F1: el correo tiene DOS variantes segun si la reversion de verdad
// toco la cuenta (`cuentaRevertida`, el resultado REAL de `revertirPagoSiNoRevertidoTx` — nunca se
// infiere de otra cosa): (a) revertida -> la cuenta volvio a Gratis, puede seguir enviando lotes
// de hasta 15 y que hacer si no reconoce el movimiento; (b) no revertida (el pago ya no era el
// activo) -> la cuenta no cambia. Decirle "tu cuenta volvio a Gratis" a quien SI conserva su
// Paquete seria una promesa falsa.
export function construirAvisoReversionComprador(datos: {
  idioma: "es" | "en";
  paymentId: string;
  status: string;
  cuentaRevertida: boolean;
  fecha: Date;
  /** Tarea 16A-2 (decision del Brain 2026-10-06): por defecto "paquete" (comportamiento EXISTENTE,
   * sin cambios). "porUso" cambia de variante por completo ("se ajustó tu saldo", nunca "volviste
   * a Gratis" — ese plan ni siquiera tiene un Paquete que perder). */
  plan?: "paquete" | "porUso";
}): {
  asunto: string;
  texto: string;
} {
  const refMp = datos.paymentId;
  const fechaTexto = formatearFechaBogotaDDMMAAAA(datos.fecha);
  const plan = datos.plan ?? "paquete";

  if (plan === "porUso") {
    const tipoEvento = datos.status === "charged_back";
    if (datos.idioma === "en") {
      return {
        asunto: `We adjusted your CertiSend Pro Pay-per-send balance`,
        texto:
          `Hello: Mercado Pago informed us of a ${tipoEvento ? "chargeback" : "refund"} of payment ` +
          `${refMp}. Because of this, we adjusted your Pay-per-send balance on ${fechaTexto} (we ` +
          `subtracted exactly what this specific payment had added; the rest of your balance is not ` +
          `affected). If you don't recognize this, write to ${PROVEEDOR_CORREO} with reference ${refMp}.\n\n` +
          pieProveedor("en"),
      };
    }
    return {
      asunto: `Ajustamos tu saldo de Pago por uso en CertiSend Pro`,
      texto:
        `Hola: Mercado Pago nos informó un ${tipoEvento ? "contracargo" : "reembolso"} del pago ${refMp}. ` +
        `Por eso ajustamos tu saldo de Pago por uso desde el ${fechaTexto} (restamos exactamente lo que ` +
        `este pago en concreto había sumado; el resto de tu saldo no se ve afectado). Si no reconoces ` +
        `este movimiento, escríbenos a ${PROVEEDOR_CORREO} con la referencia ${refMp}.\n\n` +
        pieProveedor("es"),
    };
  }

  if (datos.idioma === "en") {
    const tipo = datos.status === "charged_back" ? "chargeback" : "refund";
    if (datos.cuentaRevertida) {
      return {
        asunto: `Your CertiSend Pro account is back on the Free plan`,
        texto:
          `Hello: Mercado Pago informed us of a ${tipo} of payment ${refMp}. Because of this, your ` +
          `account moved to the Free plan on ${fechaTexto}: you can keep sending batches of up to ` +
          `15 certificates at no cost. If you don't recognize this, write to ${PROVEEDOR_CORREO} ` +
          `with reference ${refMp}.\n\n` +
          pieProveedor("en"),
      };
    }
    return {
      asunto: `CertiSend Pro: we recorded the reversal of your payment ${refMp}`,
      texto:
        `Hello: Mercado Pago informed us of a ${tipo} of payment ${refMp}. That payment was not ` +
        `your active plan, so your account does not change. If you don't recognize this, write to ` +
        `${PROVEEDOR_CORREO} with reference ${refMp}.\n\n` +
        pieProveedor("en"),
    };
  }

  const tipo = datos.status === "charged_back" ? "contracargo" : "reembolso";
  if (datos.cuentaRevertida) {
    return {
      asunto: `Tu cuenta de CertiSend Pro volvió al plan Gratis`,
      texto:
        `Hola: Mercado Pago nos informó un ${tipo} del pago ${refMp}. Por eso tu cuenta pasó al ` +
        `plan Gratis desde el ${fechaTexto}: puedes seguir enviando lotes de hasta 15 certificados ` +
        `sin costo. Si no reconoces este movimiento, escríbenos a ${PROVEEDOR_CORREO} con la ` +
        `referencia ${refMp}.\n\n` +
        pieProveedor("es"),
    };
  }
  return {
    asunto: `CertiSend Pro: registramos la reversión de tu pago ${refMp}`,
    texto:
      `Hola: Mercado Pago nos informó un ${tipo} del pago ${refMp}. Ese pago no correspondía a tu ` +
      `plan activo, así que tu cuenta no cambia. Si no reconoces este movimiento, escríbenos a ` +
      `${PROVEEDOR_CORREO} con la referencia ${refMp}.\n\n` +
      pieProveedor("es"),
  };
}

// ── Avisos a Leonardo ───────────────────────────────────────────────────────────────────────

export function construirAvisoVentaLeonardo(datos: {
  uid: string;
  paymentId: string;
  cop: number;
  plan: string;
  /** Tarea 16A-2: solo tiene sentido para "porUso" (cuantos envios compro); opcional, no rompe a
   * quien ya llama esta funcion sin este dato (Paquete). */
  cantidad?: number;
}): { asunto: string; texto: string } {
  const sufijoCantidad = datos.cantidad ? ` (${datos.cantidad} envíos)` : "";
  return {
    asunto: `[CertiSend] Nueva venta — ${datos.plan}${sufijoCantidad} — $${formatearCop(datos.cop)} COP`,
    texto:
      `Plan: ${datos.plan}${sufijoCantidad}\n` +
      `Monto: $${formatearCop(datos.cop)} COP\n` +
      `uid: ${datos.uid}\n` +
      `paymentId: ${datos.paymentId}`,
  };
}

/** Medio 1 (vuelta 35): `correoComprador` (leido de `aceptaciones/{referenciaId}.email`, nunca
 * inventado — `null` si no se encontro) se incluye para que Leonardo tenga el dato a mano si hace
 * falta escribirle a mano; `avisoCompradorEnviado` dice si el aviso automatico al comprador
 * (`construirAvisoReversionComprador`, mismo mecanismo de reclamo) ya salio, para que Leonardo
 * sepa si todavia tiene que escribirle el (Términos sec. 9.2) o si ya quedo cubierto. */
export function construirAvisoReembolsoLeonardo(datos: {
  uid: string;
  paymentId: string;
  status: string;
  cuentaRevertida: boolean;
  correoComprador: string | null;
  avisoCompradorEnviado: boolean;
  /** Tarea 16A-2: por defecto "paquete" (texto EXISTENTE, sin cambios). */
  plan?: "paquete" | "porUso";
}): { asunto: string; texto: string } {
  const plan = datos.plan ?? "paquete";
  const accion =
    plan === "porUso"
      ? "Se ajustó el saldo de Pago por uso (se restó lo que este pago había sumado)."
      : datos.cuentaRevertida
        ? "Se revirtió la cuenta a Gratis (era el pago activo)."
        : "La cuenta NO se tocó (este pago ya no era el activo).";
  const avisoComprador = datos.avisoCompradorEnviado
    ? `El comprador (${datos.correoComprador ?? "correo no encontrado"}) YA fue notificado automáticamente (Términos sec. 9.2).`
    : `El comprador (${datos.correoComprador ?? "correo no encontrado"}) todavía NO fue notificado — ` +
      `escríbele informando la reversión (Términos sec. 9.2).`;
  return {
    asunto: `[CertiSend] ${datos.status === "charged_back" ? "Contracargo" : "Reembolso"} — uid ${datos.uid}`,
    texto:
      `Mercado Pago reportó status="${datos.status}" para el pago ${datos.paymentId} del usuario ${datos.uid}.\n` +
      `${accion}\n${avisoComprador}`,
  };
}

/** M36(2): aviso a Leonardo cuando un acuse de compra se BLOQUEA porque el pie del proveedor (o
 * cualquier otro dato del correo) todavia tiene un placeholder pendiente. El pago YA esta
 * activado — esto es solo el correo del comprador, no la activacion — asi que el texto deja claro
 * que no hay urgencia de reembolso, solo de completar las variables de entorno `PROVEEDOR_DOC`/
 * `PROVEEDOR_DIR` (Cloud Run/Secret Manager — unifica aqui el nombre REAL de la variable, no el
 * de la constante interna `PROVEEDOR_DOCUMENTO`/`PROVEEDOR_DIRECCION` de server/avisos.ts, que es
 * lo que de verdad hay que configurar) y, si aplica, la confirmacion de IVA del contador. */
export function construirAvisoBloqueoProveedorLeonardo(datos: { uid: string; paymentId: string }): {
  asunto: string;
  texto: string;
} {
  return {
    asunto: `[CertiSend] Acuse de compra BLOQUEADO — faltan datos del proveedor`,
    texto:
      `El acuse de compra del pago ${datos.paymentId} (uid ${datos.uid}) NO se envió al comprador porque ` +
      `el correo todavía tiene un dato marcado como pendiente (revisa las variables de entorno ` +
      `PROVEEDOR_DOC/PROVEEDOR_DIR en Cloud Run, y la confirmación de IVA del contador). El pago YA está activado: solo falta ` +
      `completar esos datos para que el próximo acuse salga bien. Este aviso no se repite para este pago.`,
  };
}

/** Medio 4 (pago doble con 2 preferencias, correccion vuelta 31, 2026-10-06): aviso a Leonardo
 * cuando el webhook recibe un pago aprobado para un uid que YA tiene un Paquete vigente con
 * saldo activado por OTRO pago (p. ej. el comprador genero y pago dos preferencias). El pago
 * NUNCA pisa el Paquete vigente (ver server/cuentas.ts `activarPaqueteSiNoProcesadoTx`) — este
 * correo es la unica forma de que alguien se entere de que hay un cobro de mas por devolver a
 * mano (Tarea 9, proceso manual de devolucion desde el panel de Mercado Pago). */
export function construirAvisoPagoDobleLeonardo(datos: {
  uid: string;
  paymentId: string;
  cop: number;
}): { asunto: string; texto: string } {
  return {
    asunto: `[CertiSend] Pago duplicado — requiere reembolso manual — uid ${datos.uid}`,
    texto:
      `El pago ${datos.paymentId} ($${formatearCop(datos.cop)} COP, uid ${datos.uid}) llegó aprobado, ` +
      `pero esa cuenta YA tenía un Paquete vigente con saldo activado por OTRO pago. No se activó ni se ` +
      `pisó nada: este cobro quedó marcado requiereReembolso=true en pagosProcesados/${datos.paymentId}. ` +
      `Revísalo en el panel de Mercado Pago y devuelve el dinero a mano (ver Términos, proceso de devolución).`,
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
