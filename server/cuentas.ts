// Modulo de cuentas y pagos (Tarea 2, 2026-10-05).
// Guarda por usuario su plan, saldo de envios, vencimiento y suscripcion; y un registro de
// pagos ya procesados para no contarlos dos veces. Solo el servidor escribe aqui: el navegador
// nunca toca estas colecciones directamente (ver firestore.rules).
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { obtenerFirebaseApp } from "./firebaseAdmin";
import {
  TERMINOS_VERSION,
  normalizarIdioma,
  textoCasillaRetracto,
  textoCasillaTerminos,
  TEXTO_CASILLA_RETRACTO,
  TEXTO_CASILLA_RETRACTO_EN,
  type Idioma,
} from "../shared/textosCasillas";

// M31 (corrige vuelta 26): los textos de las casillas T4/T5 y su idioma YA NO viven aqui — se
// movieron a `shared/textosCasillas.ts` (sin firebase-admin, importable tambien por el cliente) y
// se re-exportan debajo para no romper a quien ya importaba estos nombres desde este modulo
// (server/cobroPaquete.ts, server.ts, tests existentes). Antes este archivo y
// `src/utils/checkout.ts` tenian el MISMO texto copiado a mano en dos sitios; ahora los dos
// importan de la misma fuente (`tests/textosCasillas.test.ts` prueba que coincidan).
export { TERMINOS_VERSION, normalizarIdioma, textoCasillaRetracto, textoCasillaTerminos, TEXTO_CASILLA_RETRACTO, TEXTO_CASILLA_RETRACTO_EN };
export type { Idioma };

// Base de datos NOMBRADA de Firestore (us-west1), ya existente. NUNCA la "(default)".
const FIRESTORE_DATABASE_ID = "ai-studio-distribuidordece-740c63fd-b7de-43a7-92b2-a00fc7f81a8a";

let dbInstancia: Firestore | null = null;
function db(): Firestore {
  if (!dbInstancia) {
    dbInstancia = getFirestore(obtenerFirebaseApp(), FIRESTORE_DATABASE_ID);
  }
  return dbInstancia;
}

export type Plan = "gratis" | "paquete" | "pro";

export interface Cuenta {
  plan: Plan;
  enviosRestantes: number;
  vence: Timestamp | null;
  renueva: boolean;
  mpSuscripcionId: string | null;
  /**
   * Cupos del Paquete reservados AHORA MISMO, sumando TODOS los lotes abiertos de este usuario
   * (M23, corregido vuelta 19 del REVISOR_EXTERNO_LAP): antes, `reservarEnvioTx` solo comparaba
   * el saldo contra `lote.reservados` (reservas del MISMO lote), asi que dos lotes Paquete
   * abiertos a la vez podian reservar cada uno hasta el saldo completo y superarlo entre los dos.
   * Se incrementa en `reservarEnvioTx` cuando el lote es Paquete y se decrementa en
   * `confirmarEnvioExitosoTx` (la reserva se consume) o en `liberarReservaTx` (Gmail fallo), en
   * la MISMA transaccion que el resto de la escritura. Puede faltar en cuentas creadas antes de
   * este cambio: se lee siempre con `?? 0`.
   */
  reservadosPaquete: number;
  /** Ultimo pago de Mercado Pago que activo o renovo un plan (Tarea 6, 2026-10-05). `null` si la
   * cuenta nunca ha pagado nada (sigue en Gratis desde que se creo). */
  ultimoPago: UltimoPago | null;
  actualizado: Timestamp;
}

export interface UltimoPago {
  /** Id del pago en Mercado Pago (tambien la clave de `pagosProcesados/{id}`). */
  id: string;
  cop: number;
  trm: number;
  fecha: Timestamp;
}

const CUENTA_GRATIS_BASE: Omit<Cuenta, "actualizado"> = {
  plan: "gratis",
  enviosRestantes: 0,
  vence: null,
  renueva: false,
  mpSuscripcionId: null,
  reservadosPaquete: 0,
  ultimoPago: null,
};

// NOTA para la Tarea 8 (suscripcion Pro, pendiente de implementar): igual que
// `activarPaqueteSiNoProcesadoTx` hace para el Paquete (Tarea 6, de abajo), al activar un plan
// "pro" el webhook DEBE escribir `vence` en la MISMA escritura (mismo tx.set) que `plan: "pro"`.
// `decidirLote` solo trata "pro" como vigente si `vence` queda en el futuro (ver `vigente` abajo):
// un `plan: "pro"` escrito sin `vence`, o con `vence` actualizado en un paso aparte, deja una
// ventana donde la cuenta ya cobrada se trata como Gratis, o donde una falla a mitad de camino
// deja "pro" con una fecha de vencimiento vieja o inexistente.

/**
 * Devuelve la cuenta del usuario; si no existe todavia, la crea como Gratis.
 * Unico punto de lectura/creacion de `cuentas/{uid}` — nunca lo llama el navegador.
 */
export async function obtenerCuenta(uid: string): Promise<Cuenta> {
  const ref = db().collection("cuentas").doc(uid);
  const snap = await ref.get();
  if (snap.exists) {
    return snap.data() as Cuenta;
  }

  const nueva: Cuenta = { ...CUENTA_GRATIS_BASE, actualizado: Timestamp.now() };
  try {
    // create() falla si el documento ya existe: nunca pisa una cuenta que el webhook acaba de
    // pasar a Paquete/Pro entre el get() y esta escritura (REVISOR M16; set() la habria borrado).
    await ref.create(nueva);
    return nueva;
  } catch (error: any) {
    if (error?.code === 6 /* ALREADY_EXISTS */) {
      return (await ref.get()).data() as Cuenta;
    }
    throw error;
  }
}

/**
 * Marca un pago de Mercado Pago (por su id) como ya procesado, de forma transaccional.
 * Devuelve false si ese id ya estaba marcado — asi un aviso repetido del mismo pago nunca
 * se cuenta dos veces (idempotencia, Tarea 6).
 */
export async function marcarProcesado(mpId: string): Promise<boolean> {
  const ref = db().collection("pagosProcesados").doc(String(mpId));
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return false;
    tx.set(ref, { procesadoEn: Timestamp.now() });
    return true;
  });
}

// ── Preferencias de cobro y activacion del Paquete (Tarea 6, webhook de Mercado Pago, 2026-10-05) ──
// `create-preference` guarda aqui, ANTES de llamar a Mercado Pago, el precio real que calculo con
// la TRM del dia. El webhook, cuando MP confirma un pago, vuelve a leer esta misma fila por el id
// aleatorio que viaja en `external_reference` y comprueba que el monto cobrado coincide con el que
// de verdad se ofrecio — no le basta con lo que diga el propio `external_reference`, que viaja por
// la red de MP y, aunque MP lo firma, esta es la defensa barata de "contra que se compara".

export interface PreferenciaGuardada {
  uid: string;
  /** Hoy solo puede ser "paquete" (Tarea 6); "pro" es la Tarea 8. */
  plan: Plan;
  cop: number;
  trm: number;
  fechaTrm: string;
  creado: Timestamp;
}

/** Guarda `preferencias/{id}` antes de pedirle la preferencia a Mercado Pago. Coleccion con
 * deny-all en firestore.rules: solo el servidor la toca. */
export async function guardarPreferencia(
  id: string,
  datos: Omit<PreferenciaGuardada, "creado">
): Promise<void> {
  await db()
    .collection("preferencias")
    .doc(String(id))
    .set({ ...datos, creado: Timestamp.now() });
}

/** Lee `preferencias/{id}`; `null` si no existe (id inventado o de otro producto). */
export async function obtenerPreferencia(id: string): Promise<PreferenciaGuardada | null> {
  const snap = await db().collection("preferencias").doc(String(id)).get();
  return snap.exists ? (snap.data() as PreferenciaGuardada) : null;
}

// ── Aceptacion de terminos y retracto (Tarea 14, cobro real con planes, 2026-10-05) ─────────────
// Textos citados LITERAL de `docs/legal/textos-checkout.md` v1.2 (T4 y T5), con los marcadores
// que el servidor ya conoce en el momento del cobro ({{version_terminos}}, {{monto_cop}})
// reemplazados. Hoy `create-preference` solo ofrece el Paquete como PAGO UNICO (Tarea 7 —
// "renovar cada mes" — no existe todavia), asi que el marcador `{{y_si_renueva}}` de T4 se omite
// a proposito: ese marcador solo aplica a modalidades renovables (ver textos-checkout.md, T4).
// Cuando llegue la Tarea 7, quien construya el texto de una renovable debe completar ese
// marcador en vez de omitirlo.

/** Modalidad de pago del Paquete. Hoy `create-preference` solo ofrece "unico" (Tarea 6); la
 * "renovable" es la Tarea 7, todavia no existe que activar en el webhook para esa modalidad. */
export type Modalidad = "unico" | "renovable";

export interface AceptacionGuardada {
  uid: string;
  /** Correo del token verificado (`req.email`), nunca uno que mande el navegador en el body
   * (M28, 2026-10-05). `null` si el token de Firebase no trae correo. */
  email: string | null;
  versionTerminos: string;
  plan: Plan;
  /** Modalidad elegida en el checkout (M28): hoy siempre "unico" (Tarea 7 agrega "renovable"). */
  modalidad: Modalidad;
  /** Idioma en el que el usuario vio y marco las casillas (M28): el mismo que `textoCasilla`
   * y `textoRetracto` de abajo. */
  idioma: Idioma;
  cop: number;
  trm: number;
  /** Id de `preferencias/{id}` a la que queda enlazada esta aceptacion (hoy, el mismo id). */
  preferenciaId: string;
  textoCasilla: string;
  textoRetracto: string;
  /** Fecha DEL SERVIDOR (nunca una fecha que mande el navegador). */
  fecha: Timestamp;
}

/** Guarda `aceptaciones/{id}` ANTES de llamar a Mercado Pago (quien la llama decide el orden;
 * esta funcion solo escribe). Deny-all en firestore.rules: solo el servidor la toca. A proposito
 * NO guarda IP: no hace falta para probar la aceptacion y es un dato personal que no se pide. */
export async function guardarAceptacion(
  id: string,
  datos: Omit<AceptacionGuardada, "fecha">
): Promise<void> {
  await db()
    .collection("aceptaciones")
    .doc(String(id))
    .set({ ...datos, fecha: Timestamp.now() });
}

/** Lee `aceptaciones/{id}`; `null` si no existe. Usada por el webhook (Tarea 5, 2026-10-05) para
 * saber el correo real del comprador (`req.email` al momento del checkout) y el idioma en el que
 * debe ir el correo de confirmacion de compra — ninguno de los dos vive en `preferencias/{id}`. */
export async function obtenerAceptacion(id: string): Promise<AceptacionGuardada | null> {
  const snap = await db().collection("aceptaciones").doc(String(id)).get();
  return snap.exists ? (snap.data() as AceptacionGuardada) : null;
}

export const ENVIOS_PAQUETE = 150;

/** Componentes de fecha/hora en el calendario de BOGOTA (UTC-5 fijo, Colombia no tiene horario
 * de verano) para un instante `fecha`, via Intl — nunca via los getters UTC/locales de Date, que
 * dependen de la zona del proceso. `fecha` puede representar, en Bogota, un dia distinto de su
 * dia en UTC (p. ej. 31-ene 21:30 Bogota es ya 01-feb en UTC): por eso `sumarUnMes` (abajo) tiene
 * que leer el calendario de Bogota, no el de UTC, para saber de que dia parte. */
function componentesBogota(fecha: Date): {
  anio: number; mes: number; dia: number; horas: number; minutos: number; segundos: number; ms: number;
} {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(fecha);
  const numero = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  return {
    anio: numero("year"),
    mes: numero("month"), // 1-12
    dia: numero("day"),
    horas: numero("hour"),
    minutos: numero("minute"),
    segundos: numero("second"),
    ms: fecha.getUTCMilliseconds(), // los milisegundos no cambian con el huso horario.
  };
}

/** Ultimo dia del mes `mes1a12` (1-12) de `anio`, en el calendario gregoriano. */
function ultimoDiaDelMes(anio: number, mes1a12: number): number {
  // Date.UTC(anio, mes1a12, 0) es "el dia 0" del mes SIGUIENTE a mes1a12 (indice 0 = enero):
  // eso es, por definicion, el ultimo dia de mes1a12.
  return new Date(Date.UTC(anio, mes1a12, 0)).getUTCDate();
}

/** Misma fecha, 1 mes despues, en el calendario de BOGOTA (no "+30 dias", ni la aritmetica de
 * `Date.setUTCMonth`, que desborda al mes siguiente cuando el dia de origen no existe en el mes
 * destino: 31-ene + 1 mes con `setUTCMonth` da 03-mar, no 28-feb). El Paquete vence el mismo dia
 * del mes siguiente al pago (spec: "1 mes desde el pago"); si ese dia no existe en el mes
 * siguiente (p. ej. 31-ene -> febrero), se queda en el ULTIMO dia de ese mes (28 o 29 febrero),
 * sea cual sea la hora de Bogota del pago original. */
export function sumarUnMes(fecha: Date): Date {
  const c = componentesBogota(fecha);
  let anio = c.anio;
  let mes = c.mes + 1; // 1-12, puede pasar de 12
  if (mes > 12) {
    mes -= 12;
    anio += 1;
  }
  const dia = Math.min(c.dia, ultimoDiaDelMes(anio, mes));

  // Se reconstruye el instante UTC real que corresponde a esa fecha/hora EN BOGOTA: se arma como
  // si los componentes fueran UTC (Date.UTC) y se suman las 5 horas que Bogota esta detras de UTC.
  const comoSiFueraUTC = Date.UTC(anio, mes - 1, dia, c.horas, c.minutos, c.segundos, c.ms);
  return new Date(comoSiFueraUTC + 5 * 3600_000);
}

/**
 * Cuerpo transaccional de la activacion del Paquete tras un pago de Mercado Pago aprobado y
 * verificado (Tarea 6). Idempotencia y activacion van en la MISMA transaccion (a proposito: NO se
 * usa `marcarProcesado`, que abre su propia transaccion por separado — eso dejaria una ventana
 * donde dos avisos simultaneos del mismo pago podrian leer "no procesado" los dos antes de que
 * cualquiera alcance a marcarlo). Ambas lecturas (`tx.get(pagoRef)`) van antes de cualquier
 * escritura; la cuenta se escribe en UNA sola llamada (`tx.set`, reemplaza el documento completo:
 * nunca se "suman" los 150 al saldo anterior, se vuelve a fijar — spec: "no se acumulan").
 *
 * Devuelve "repetido" sin tocar la cuenta si `paymentId` ya estaba marcado como procesado.
 */
export async function activarPaqueteSiNoProcesadoTx(
  tx: TransaccionLike,
  pagoRef: any,
  cuentaRef: any,
  datos: { paymentId: string; cop: number; trm: number; fecha: Timestamp }
): Promise<"activado" | "repetido"> {
  const pagoSnap = await tx.get(pagoRef);
  if (pagoSnap.exists) return "repetido";

  tx.set(pagoRef, { procesadoEn: Timestamp.now() });
  tx.set(cuentaRef, {
    plan: "paquete",
    enviosRestantes: ENVIOS_PAQUETE,
    vence: Timestamp.fromDate(sumarUnMes(datos.fecha.toDate())),
    renueva: false, // pago unico (Tarea 6); "renovar cada mes" es la Tarea 7.
    mpSuscripcionId: null,
    reservadosPaquete: 0, // D4/requisito de la Tarea 6: nunca hereda reservas de un ciclo anterior.
    ultimoPago: { id: datos.paymentId, cop: datos.cop, trm: datos.trm, fecha: datos.fecha },
    actualizado: Timestamp.now(),
  });
  return "activado";
}

/** Envoltorio real: abre la transaccion de Firestore y le pasa las referencias reales. */
export async function activarPaqueteSiNoProcesado(
  uid: string,
  paymentId: string,
  datos: { cop: number; trm: number; fecha: Timestamp }
): Promise<"activado" | "repetido"> {
  const pagoRef = db().collection("pagosProcesados").doc(String(paymentId));
  const cuentaRef = db().collection("cuentas").doc(uid);
  return db().runTransaction((tx) =>
    activarPaqueteSiNoProcesadoTx(tx, pagoRef, cuentaRef, { paymentId, ...datos })
  );
}

// ── Correo de confirmacion: idempotencia separada de la activacion (Tarea 5, 2026-10-05) ───────
// `activarPaqueteSiNoProcesadoTx` ya marca `pagosProcesados/{paymentId}` para no activar dos
// veces; el correo usa el MISMO documento con un campo aparte (`correoEnviado`) en vez de abrir
// una coleccion nueva, pero es deliberadamente una escritura SEPARADA de la transaccion de
// activacion: el correo se manda DESPUES de que esa transaccion ya termino bien (requisito de la
// Tarea 5) y, si el relay esta caido, una entrega posterior del MISMO webhook (Mercado Pago
// reintenta un aviso que respondio 500, o el propio reintento manual) debe poder volver a
// intentar el correo sin volver a activar nada — por eso NO comparte transaccion con
// `activarPaqueteSiNoProcesadoTx`.

/** true si YA se envio (con exito) el correo de este pago. `false` tambien si el pago nunca se
 * activo aqui (documento inexistente): no es a esta funcion a la que le toca decidir si hay algo
 * que notificar, solo si ya se noto. */
export async function correoYaEnviado(paymentId: string): Promise<boolean> {
  const snap = await db().collection("pagosProcesados").doc(String(paymentId)).get();
  return snap.exists && snap.data()?.correoEnviado === true;
}

/** Marca `correoEnviado=true` en `pagosProcesados/{paymentId}` tras enviar (con exito) el correo
 * de confirmacion + el aviso de venta a Leonardo. `update` (no `set`): conserva `procesadoEn` sin
 * reescribirlo. */
export async function marcarCorreoEnviado(paymentId: string): Promise<void> {
  await db().collection("pagosProcesados").doc(String(paymentId)).update({ correoEnviado: true });
}

// ── Reversion por contracargo o reembolso (Tarea 9, cobro real con planes, 2026-10-05) ─────────
// Mercado Pago puede avisar `status=refunded`/`charged_back` sobre un pago que YA activo un
// Paquete (su `pagosProcesados/{paymentId}` ya existe, escrito por `activarPaqueteSiNoProcesadoTx`
// arriba). Regla: si ese pago es el `ultimoPago` ACTIVO de la cuenta, la cuenta vuelve a Gratis
// (plan, saldo y vencimiento — "revierte" significa volver exactamente a `CUENTA_GRATIS_BASE`,
// nunca restar 150 a un numero que podria ya estar mezclado con una compra posterior); si no es
// el pago activo (el usuario ya compro o renovo de nuevo desde entonces), la cuenta NO SE TOCA.
// Idempotente: `revertido` en el MISMO documento de `pagosProcesados/{paymentId}` evita procesar
// dos veces el mismo evento de reembolso (Mercado Pago puede reintentar el aviso).
export type ResultadoReversion = "revertido" | "no_activo" | "ya_procesado" | "ignorado";

export async function revertirPagoSiNoRevertidoTx(
  tx: TransaccionLike,
  pagoRef: any,
  cuentaRef: any,
  paymentId: string
): Promise<ResultadoReversion> {
  const pagoSnap = await tx.get(pagoRef);
  if (!pagoSnap.exists) {
    // Este pago nunca activo nada aqui (id invalido, o un pago que nunca llego a "approved" en
    // nuestro webhook): no hay cuenta que revertir ni evento propio que recordar.
    return "ignorado";
  }
  if (pagoSnap.data()?.revertido === true) return "ya_procesado";

  const cuentaSnap = await tx.get(cuentaRef);
  const cuenta = cuentaSnap.exists ? (cuentaSnap.data() as Cuenta) : null;
  const esPagoActivo = (cuenta?.ultimoPago?.id ?? null) === paymentId;

  tx.update(pagoRef, { revertido: true });
  if (esPagoActivo) {
    tx.set(cuentaRef, { ...CUENTA_GRATIS_BASE, actualizado: Timestamp.now() });
    return "revertido";
  }
  return "no_activo";
}

/** Envoltorio real: abre la transaccion de Firestore y le pasa las referencias reales. */
export async function revertirPagoSiNoRevertido(paymentId: string, uid: string): Promise<ResultadoReversion> {
  const pagoRef = db().collection("pagosProcesados").doc(String(paymentId));
  const cuentaRef = db().collection("cuentas").doc(uid);
  return db().runTransaction((tx) => revertirPagoSiNoRevertidoTx(tx, pagoRef, cuentaRef, paymentId));
}

// ── Limites de lotes de envio en el servidor (Tarea 3, 2026-10-05) ──────────────────────────
// El navegador nunca decide cuanto puede enviar: pide permiso con la cantidad del lote y el
// servidor responde segun el plan. `decidirLote` es una funcion PURA (sin Firestore) para
// poder probarla con node:test; las funciones de abajo son las unicas que tocan la base de datos.

export type MotivoRechazoLote = "limite_gratis" | "saldo_insuficiente";

export interface DecisionLote {
  permitido: boolean;
  motivo?: MotivoRechazoLote;
  /** Plan REAL de la cuenta (para mostrarlo en la UI: "Mi plan", mensajes, etc). */
  plan: Plan;
  /**
   * Plan EFECTIVO aplicado a ESTE lote: lo que se guarda en `lotes/{loteId}` y lo que usan
   * `reservarEnvio`/`confirmarEnvioExitoso` para decidir si descuentan saldo. Nunca es el plan
   * de la cuenta a secas (ver regla R3-1 abajo).
   */
  planEfectivo: Plan;
  enviosRestantes: number;
  vence: Timestamp | null;
}

const LIMITE_GRATIS = 15;

/**
 * Decide si un lote de `cantidad` certificados cabe en el plan de `cuenta`, a la fecha `ahora`,
 * y que `planEfectivo` le corresponde a ESE lote.
 *
 * Regla R3-1 (decision del Brain, 2026-10-05, mas favorable al cliente — corrige M21): un lote
 * de 15 o menos SIEMPRE es Gratis, aunque la cuenta tenga un Paquete vigente con saldo: nunca
 * descuenta del saldo. Por eso esta comprobacion va ANTES de mirar el plan de la cuenta.
 *
 * Para lotes de mas de 15:
 * - Pro vigente (vence > ahora): permitido sin limite de cantidad, planEfectivo "pro".
 * - Paquete vigente (vence > ahora) con saldo que alcanza (enviosRestantes >= cantidad):
 *   permitido, planEfectivo "paquete". Si el Paquete esta vigente pero el saldo NO alcanza,
 *   rechazo especifico "saldo_insuficiente" (hay plan pagado, solo no cabe ESTE lote).
 * - Cualquier otro caso — Paquete o Pro vencidos, `vence` null, o Paquete vigente con saldo 0 —
 *   se trata exactamente igual que Gratis: rechazado por "limite_gratis" (ya se sabe que
 *   cantidad > 15, porque el caso <= 15 se resolvio arriba).
 */
export function decidirLote(cuenta: Cuenta, cantidad: number, ahora: Date): DecisionLote {
  const base = { plan: cuenta.plan, enviosRestantes: cuenta.enviosRestantes, vence: cuenta.vence };
  const vigente = cuenta.vence !== null && cuenta.vence.toMillis() > ahora.getTime();

  if (cantidad <= LIMITE_GRATIS) {
    return { permitido: true, planEfectivo: "gratis", ...base };
  }

  if (cuenta.plan === "pro" && vigente) {
    return { permitido: true, planEfectivo: "pro", ...base };
  }

  if (cuenta.plan === "paquete" && vigente && cuenta.enviosRestantes > 0) {
    if (cuenta.enviosRestantes >= cantidad) return { permitido: true, planEfectivo: "paquete", ...base };
    return { permitido: false, motivo: "saldo_insuficiente", planEfectivo: "paquete", ...base };
  }

  return { permitido: false, motivo: "limite_gratis", planEfectivo: "gratis", ...base };
}

export interface Lote {
  uid: string;
  cantidad: number;
  /** Plan EFECTIVO de este lote (de `decidirLote.planEfectivo`), no el plan de la cuenta. */
  planEfectivo: Plan;
  enviados: number;
  /**
   * Cupos reservados para envios EN CURSO (M19, corregido vuelta 18): se reservan ANTES de
   * llamar a Gmail y se confirman (pasan a `enviados`) o se liberan segun el resultado. Un envio
   * nunca descuenta cupo/saldo hasta que Gmail confirmo, pero tampoco deja que envios paralelos
   * se cuelen por encima del cupo mientras Gmail todavia esta en vuelo.
   */
  reservados: number;
  creado: Timestamp;
  expira: Timestamp;
}

// Mismo plazo que la sesion del PDF en memoria (server.ts): un lote autorizado no sobrevive
// mas que eso, para no arrastrar un permiso viejo sobre un plan/TRM que ya cambio. Tambien es la
// red de seguridad de las reservas (ver `reservarEnvioTx`): una reserva que nunca se confirma ni
// se libera (el proceso murio a mitad del envio) no bloquea el cupo para siempre porque, pasadas
// las 2 h, el lote entero deja de aceptar reservas y confirmaciones nuevas.
const DURACION_LOTE_MS = 2 * 3600_000;

/**
 * Crea `lotes/{loteId}` ya autorizado para `cantidad` envios bajo el `planEfectivo` que
 * `decidirLote` resolvio. El id lo genera Firestore (aleatorio, no adivinable ni secuencial).
 */
export async function crearLote(
  uid: string,
  cantidad: number,
  planEfectivo: Plan
): Promise<{ loteId: string; lote: Lote }> {
  const ref = db().collection("lotes").doc();
  const ahora = Timestamp.now();
  const lote: Lote = {
    uid,
    cantidad,
    planEfectivo,
    enviados: 0,
    reservados: 0,
    creado: ahora,
    expira: Timestamp.fromMillis(ahora.toMillis() + DURACION_LOTE_MS),
  };
  await ref.set(lote);
  return { loteId: ref.id, lote };
}

// ── Transacciones de reserva/confirmacion/liberacion (Tarea 3, corregida vuelta 18) ─────────
// Interfaz minima de una transaccion de Firestore (get/update/set) que necesitan las funciones
// `*Tx` de abajo. Se declara aqui — en vez de importar el tipo `Transaction` de firebase-admin —
// para poder probarlas con un doble en tests/ sin tocar Firestore real: el doble reproduce la
// regla real (lecturas antes de escrituras) sin credenciales ni red. En produccion, la
// `Transaction` real de firebase-admin cumple esta misma forma.
export interface TransaccionLike {
  get(ref: any): Promise<{ exists: boolean; data(): any }>;
  update(ref: any, data: Record<string, any>): void;
  set(ref: any, data: Record<string, any>): void;
}

/**
 * Recalcula `reservadosPaquete` sumando `reservados` de TODOS los lotes Paquete NO expirados de
 * `uid` (D4/M26, decision del Brain 2026-10-05, corrige el contador de `cuentas/{uid}` cuando
 * quedo desincronizado — p. ej. una reserva que quedo huerfana sin liberarse). Es una consulta
 * NORMAL de Firestore (`.get()`, no `tx.get()`): corre FUERA de la transaccion a proposito, para
 * no violar "todas las lecturas antes de cualquier escritura" (ver G3 en `confirmarEnvioExitosoTx`)
 * ni atar el resultado al reintento optimista de la transaccion que la llama.
 */
export async function contarReservadosPaqueteVigentes(uid: string, ahora: Date): Promise<number> {
  const snap = await db()
    .collection("lotes")
    .where("uid", "==", uid)
    .where("planEfectivo", "==", "paquete")
    .get();
  let total = 0;
  for (const doc of snap.docs) {
    const lote = doc.data() as Lote;
    if (lote.expira.toMillis() > ahora.getTime()) total += lote.reservados;
  }
  return total;
}

/**
 * Cuerpo transaccional de la reserva (M19, corregido vuelta 19 — M23; vuelta 20 — D4/D5):
 * comprueba, ANTES de llamar a Gmail, que el lote exista, sea del usuario que llama, no haya
 * expirado, todavia tenga cupo (`enviados + reservados < cantidad`) y, si su `planEfectivo` es
 * Paquete, que el Paquete no haya vencido (D5/B23: un Paquete vencido nunca reserva, aunque
 * `enviosRestantes` todavia marque saldo nominal) y que el saldo alcance para cubrir TODAS las
 * reservas pendientes del usuario (`reservadosPaquete` en `cuentas/{uid}`, no solo las de este
 * lote — ver M23 en el tipo `Cuenta`). Si el contador de la cuenta parece decir que no hay saldo,
 * y se recibio `recalcularReservadosPaquete`, se recalcula el numero real (D4/M26) ANTES de
 * rechazar — y, si al final si se reserva, se guarda el numero corregido. Si todo eso se cumple,
 * reserva 1 cupo en el lote y, si es Paquete, 1 cupo a nivel de cuenta.
 *
 * TODAS las lecturas (`tx.get`) ocurren antes de cualquier escritura (`tx.update`) — ver G3 en
 * `confirmarEnvioExitosoTx` para el bug que esto evita. `recalcularReservadosPaquete` (D4) no usa
 * `tx`: es una consulta normal de Firestore, fuera de esta transaccion, asi que tampoco rompe esa
 * regla. La transaccion completa (lectura + comprobacion + reserva) es atomica: si dos envios en
 * paralelo —del mismo lote o de dos lotes distintos del mismo usuario— compiten por el mismo
 * saldo, Firestore serializa/reintenta y nunca deja que ambos reserven por encima del cupo o del
 * saldo.
 */
export async function reservarEnvioTx(
  tx: TransaccionLike,
  loteRef: any,
  cuentaRef: any,
  uid: string,
  recalcularReservadosPaquete?: (uid: string, ahora: Date) => Promise<number>
): Promise<{ ok: true; lote: Lote } | { ok: false; error: string }> {
  const loteSnap = await tx.get(loteRef);
  if (!loteSnap.exists) {
    return { ok: false, error: "El lote de envio no existe o ya expiro. Vuelve a iniciar el envio masivo." };
  }
  const lote = loteSnap.data() as Lote;
  if (lote.uid !== uid) {
    return { ok: false, error: "Este lote de envio no pertenece a tu cuenta." };
  }
  if (lote.expira.toMillis() <= Date.now()) {
    return { ok: false, error: "Este lote de envio expiro. Vuelve a iniciar el envio masivo." };
  }
  if (lote.enviados + lote.reservados >= lote.cantidad) {
    return { ok: false, error: "Este lote de envio ya alcanzo su cupo autorizado." };
  }

  let cuenta: Cuenta | null = null;
  let reservadosPaqueteParaGuardar = 0;
  if (lote.planEfectivo === "paquete") {
    // Sigue siendo una lectura: todavia no se ejecuto ningun tx.update/tx.set en esta transaccion.
    const cuentaSnap = await tx.get(cuentaRef);
    cuenta = cuentaSnap.exists ? (cuentaSnap.data() as Cuenta) : null;

    // D5/B23: un Paquete VENCIDO nunca reserva, aunque `enviosRestantes` todavia marque saldo.
    const vencido = !cuenta || cuenta.vence === null || cuenta.vence.toMillis() <= Date.now();
    if (vencido) {
      return { ok: false, error: "Tu Paquete ya vencio. Renueva para seguir enviando." };
    }

    const restantes = cuenta.enviosRestantes;
    let reservadosPaquete = cuenta.reservadosPaquete ?? 0;
    if (restantes <= reservadosPaquete && recalcularReservadosPaquete) {
      // D4/M26: el contador de la cuenta dice que no hay saldo; antes de rechazar, se recalcula
      // el numero REAL sumando los lotes Paquete no expirados del usuario (fuera de esta
      // transaccion) y se vuelve a evaluar con ese numero.
      reservadosPaquete = await recalcularReservadosPaquete(uid, new Date());
    }
    if (restantes <= reservadosPaquete) {
      return { ok: false, error: "Tu Paquete ya no tiene saldo disponible para este envio." };
    }
    reservadosPaqueteParaGuardar = reservadosPaquete;
  }

  tx.update(loteRef, { reservados: lote.reservados + 1 });
  if (lote.planEfectivo === "paquete" && cuenta) {
    // Se guarda `reservadosPaqueteParaGuardar + 1`: si hubo recalculo (D4/M26), esta escritura
    // tambien corrige el contador desincronizado de la cuenta, no solo desbloquea esta reserva.
    tx.update(cuentaRef, { reservadosPaquete: reservadosPaqueteParaGuardar + 1 });
  }
  return { ok: true, lote };
}

/** Envoltorio real: abre la transaccion de Firestore y le pasa las referencias reales, con el
 * recalculo real (D4) por si el contador de la cuenta esta desincronizado. */
export async function reservarEnvio(
  loteId: string,
  uid: string
): Promise<{ ok: true; lote: Lote } | { ok: false; error: string }> {
  const loteRef = db().collection("lotes").doc(loteId);
  const cuentaRef = db().collection("cuentas").doc(uid);
  return db().runTransaction((tx) =>
    reservarEnvioTx(tx, loteRef, cuentaRef, uid, contarReservadosPaqueteVigentes)
  );
}

/**
 * Cuerpo transaccional de la confirmacion: tras un envio EXITOSO de Gmail (nunca si fallo),
 * pasa 1 cupo de `reservados` a `enviados` y, si el `planEfectivo` recibido es Paquete,
 * descuenta 1 del saldo de la cuenta.
 *
 * Fix de G3 (NO-GO del REVISOR_EXTERNO_LAP, vuelta 18): ANTES, esta funcion hacia
 * `tx.update(loteRef)` y LUEGO `tx.get(cuentaRef)` — Firestore exige que TODAS las lecturas de
 * una transaccion ocurran antes de CUALQUIER escritura, y lanzaba
 * "Firestore transactions require all reads to be executed before all writes." en cada envio
 * exitoso de un Paquete. El usuario reintentaba (correo duplicado) y el saldo nunca bajaba.
 * Ahora las DOS lecturas (lote y, si aplica, cuenta) van primero; las escrituras, despues.
 */
export async function confirmarEnvioExitosoTx(
  tx: TransaccionLike,
  loteRef: any,
  cuentaRef: any,
  planEfectivo: Plan
): Promise<void> {
  const loteSnap = await tx.get(loteRef);
  const cuentaSnap = planEfectivo === "paquete" ? await tx.get(cuentaRef) : null; // lectura, no escritura.

  if (!loteSnap.exists) return; // el lote desaparecio entre la reserva y el envio: nada que confirmar.
  const lote = loteSnap.data() as Lote;
  tx.update(loteRef, {
    enviados: lote.enviados + 1,
    reservados: Math.max(0, lote.reservados - 1),
  });
  if (planEfectivo === "paquete" && cuentaSnap && cuentaSnap.exists) {
    const cuenta = cuentaSnap.data() as Cuenta;
    // M23: la reserva se CONSUME (sale de `reservadosPaquete` ademas de bajar el saldo), para
    // que otro lote del mismo usuario pueda volver a reservar ese cupo si queda saldo.
    tx.update(cuentaRef, {
      enviosRestantes: Math.max(0, cuenta.enviosRestantes - 1),
      reservadosPaquete: Math.max(0, (cuenta.reservadosPaquete ?? 0) - 1),
    });
  }
}

/** Envoltorio real: abre la transaccion de Firestore y le pasa las referencias reales. */
export async function confirmarEnvioExitoso(loteId: string, uid: string, planEfectivo: Plan): Promise<void> {
  const loteRef = db().collection("lotes").doc(loteId);
  const cuentaRef = db().collection("cuentas").doc(uid);
  await db().runTransaction((tx) => confirmarEnvioExitosoTx(tx, loteRef, cuentaRef, planEfectivo));
}

/**
 * Cuerpo transaccional de la liberacion: cuando Gmail FALLO (nunca se envio de verdad), resta 1
 * de `reservados` sin tocar `enviados` ni el saldo, para que ese envio fallido no deje el cupo
 * bloqueado hasta que el lote expire. Si el lote era Paquete, tambien libera el cupo reservado a
 * nivel de cuenta (M23: `reservadosPaquete`), para que otro lote del mismo usuario pueda usarlo.
 */
export async function liberarReservaTx(tx: TransaccionLike, loteRef: any, cuentaRef: any): Promise<void> {
  const loteSnap = await tx.get(loteRef);
  if (!loteSnap.exists) return;
  const lote = loteSnap.data() as Lote;
  const cuentaSnap = lote.planEfectivo === "paquete" ? await tx.get(cuentaRef) : null; // lectura, no escritura.

  tx.update(loteRef, { reservados: Math.max(0, lote.reservados - 1) });
  if (lote.planEfectivo === "paquete" && cuentaSnap && cuentaSnap.exists) {
    const cuenta = cuentaSnap.data() as Cuenta;
    tx.update(cuentaRef, { reservadosPaquete: Math.max(0, (cuenta.reservadosPaquete ?? 0) - 1) });
  }
}

/** Envoltorio real: abre la transaccion de Firestore y le pasa las referencias reales. */
export async function liberarReserva(loteId: string, uid: string): Promise<void> {
  const loteRef = db().collection("lotes").doc(loteId);
  const cuentaRef = db().collection("cuentas").doc(uid);
  await db().runTransaction((tx) => liberarReservaTx(tx, loteRef, cuentaRef));
}
