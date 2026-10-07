// Modulo de cuentas y pagos (Tarea 2, 2026-10-05).
// Guarda por usuario su plan, saldo de envios, vencimiento y suscripcion; y un registro de
// pagos ya procesados para no contarlos dos veces. Solo el servidor escribe aqui: el navegador
// nunca toca estas colecciones directamente (ver firestore.rules).
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { obtenerFirebaseApp } from "./firebaseAdmin";
import {
  TERMINOS_VERSION,
  AUTORIZACION_DATOS_VERSION,
  normalizarIdioma,
  textoCasillaRetracto,
  textoCasillaTerminos,
  textoAutorizacionDatos,
  textoAceptacionTerminosUso,
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
//
// Fix (2026-10-07): `AUTORIZACION_DATOS_VERSION` vivia como una constante LOCAL de server.ts
// (desincronizada en "2.3" mientras la Politica de Privacidad ya paso a v2.4) — se mueve aqui, al
// lado de `TERMINOS_VERSION`, mismo patron, para que solo exista en UN sitio.
export { TERMINOS_VERSION, AUTORIZACION_DATOS_VERSION, normalizarIdioma, textoCasillaRetracto, textoCasillaTerminos, textoAutorizacionDatos, textoAceptacionTerminosUso, TEXTO_CASILLA_RETRACTO, TEXTO_CASILLA_RETRACTO_EN };
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

/**
 * SOLO PARA PRUEBAS (mismo patron que `_resetCacheParaPruebas` de server/trm.ts): fuerza que
 * `db()` devuelva `falso` en vez de abrir Firestore real. Esto permite probar los ENVOLTORIOS
 * REALES (p. ej. `activarPaqueteSiNoProcesado`, no solo su `...Tx`) contra el doble de Firestore
 * de tests/_fakeFirestore.ts — M1, correccion NO-GO vuelta 30, 2026-10-05: antes, las conexiones
 * de produccion (los envoltorios que de verdad abren `db().runTransaction(...)`) no tenian ninguna
 * prueba propia, solo sus `...Tx`. `falso` se tipa `any` a proposito: el doble de pruebas solo
 * necesita implementar `.collection(name).doc(id)` y `.runTransaction(fn)`, nunca la interfaz
 * completa de `Firestore` real. Pasar `null` vuelve a abrir Firestore real en la siguiente
 * llamada a `db()`.
 */
export function _usarFirestoreParaPruebas(falso: any): void {
  dbInstancia = falso;
}

export type Plan = "gratis" | "paquete" | "porUso";

/**
 * Plan EFECTIVO aplicado a un LOTE o a una DECISION (Tarea 16A-1, decision del Brain 2026-10-06:
 * se agrega el plan "Pago por uso" — US$0,15 por envio, saldo SIN vencimiento y ACUMULABLE; "Pro"
 * desaparece). "mixto" se suma a los 3 valores de `Plan`: aparece cuando un lote de mas de 15
 * certificados se reparte ENTRE el saldo del Paquete y el saldo Por Uso (ver `decidirLote`).
 * "mixto" nunca es el plan REAL de una cuenta (`Cuenta.plan`), solo una etiqueta de reparto para
 * un lote o una decision concretos.
 */
export type PlanEfectivo = Plan | "mixto";

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
  /**
   * Saldo del plan "Pago por uso" (Tarea 16A-1, decision del Brain 2026-10-06): envios comprados
   * de a uno (hoy US$0,15 cada uno), SIN fecha de vencimiento y ACUMULABLE entre compras — a
   * diferencia del Paquete (que REEMPLAZA la cuenta completa al activarse, "no se acumulan los
   * sobrantes"), cada activacion SUMA a este saldo (`activarPorUsoSiNoProcesadoTx`) y nunca lo
   * pisa. Puede faltar en cuentas creadas antes de este cambio: se lee siempre con `?? 0`, igual
   * que `reservadosPaquete`.
   */
  saldoPorUso: number;
  /**
   * Mismo patron que `reservadosPaquete` (M23), para el saldo Por Uso: cupos reservados AHORA
   * MISMO sumando TODOS los lotes abiertos de este usuario que consumen de esta fuente (lotes
   * "porUso" o "mixto"). Se incrementa en `reservarEnvioTx` y se decrementa en
   * `confirmarEnvioExitosoTx`/`liberarReservaTx`. Puede faltar en cuentas viejas: se lee siempre
   * con `?? 0`.
   */
  reservadosPorUso: number;
  /** Ultimo pago de Mercado Pago que activo o renovo un plan (Tarea 6, 2026-10-05). `null` si la
   * cuenta nunca ha pagado nada (sigue en Gratis desde que se creo). OJO: desde Tarea 16A-1 este
   * campo lo pisa TAMBIEN una compra Por Uso (`activarPorUsoSiNoProcesadoTx`) — por eso NUNCA basta
   * para saber si el Paquete sigue activo; ver `pagoPaqueteId` abajo (G1, corrige NO-GO 2026-10-07). */
  ultimoPago: UltimoPago | null;
  /**
   * Id del pago de Mercado Pago que activo el Paquete VIGENTE (G1, corrige NO-GO 2026-10-07):
   * `activarPaqueteSiNoProcesadoTx` es la UNICA funcion que lo escribe (al activar, con el
   * `paymentId` nuevo) y `revertirPagoSiNoRevertidoTx` lo vuelve a `null` al revertir el Paquete
   * activo. A diferencia de `ultimoPago` (que una compra Por Uso POSTERIOR tambien pisa), este
   * campo es inmune a esa compra: es lo que `esPagoActivo`/`vigentePorOtroPago` usan para saber
   * cual es el pago de Paquete activo de verdad. `undefined` (el campo ausente) en cuentas creadas
   * ANTES de este fix — `resolverPagoPaqueteId` hace el fallback para esas. */
  pagoPaqueteId?: string | null;
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
  saldoPorUso: 0,
  reservadosPorUso: 0,
  ultimoPago: null,
  pagoPaqueteId: null,
};

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
  /** "paquete" o "porUso" (Tarea 16A-2); "Pro" desaparecio (decision del Brain 2026-10-06) y nunca
   * llego a ofrecerse por esta ruta. */
  plan: Plan;
  cop: number;
  trm: number;
  fechaTrm: string;
  /** Cantidad de envios comprados — SOLO para `plan:"porUso"` (M4, corrige NO-GO 2026-10-07: antes
   * `server/webhook.ts` ensanchaba este tipo a mano con `& { cantidad?: number }` en vez de
   * declararlo aqui). `undefined` para una preferencia de Paquete. */
  cantidad?: number;
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
 * M37 (corrige vuelta 28, 2026-10-05): `pagoRef` tambien guarda `uid`/`referenciaId`/`fechaTrm`/
 * `fecha`/`vence` — lo minimo para poder RECONSTRUIR el aviso de compra (`notificarActivacion...`,
 * server/notificaciones.ts) en un reintento posterior (GET /api/cuenta o el barrido del webhook,
 * ver mas arriba) sin volver a consultar Mercado Pago ni depender de `cuentas/{uid}` (que para
 * entonces puede ya tener OTRO `vence`, de una compra posterior — spec: "no se acumulan"). Los 3
 * campos nuevos de `datos` son OPCIONALES para no romper llamadas viejas que no los necesitan
 * (esas llamadas simplemente no habilitan el reintento automatico para ESE pago); en produccion
 * (`activarPaqueteSiNoProcesado`, mas abajo) SIEMPRE se mandan.
 *
 * Medio 4 (pago doble con 2 preferencias, correccion vuelta 31, 2026-10-06): si la cuenta YA
 * tiene un Paquete VIGENTE con saldo, activado por OTRO `paymentId` (el comprador pago dos veces,
 * p. ej. generando dos preferencias), este pago NUNCA pisa ese Paquete ni "suma" nada — se marca
 * `pagosProcesados/{paymentId}.requiereReembolso = true` (sin `vence`: nunca se activo nada) y se
 * devuelve "requiere_reembolso" para que `server/webhook.ts` avise a Leonardo (log
 * `ALERTA_REEMBOLSO_REQUERIDO` + correo) y responda 200 — Mercado Pago no debe reintentar un pago
 * que ya se registro, aunque no se haya activado. La lectura de la cuenta ocurre ANTES de
 * cualquier escritura (misma regla de "todas las lecturas antes de escrituras" que el resto de
 * este archivo). `esCandidatoBarridoAcuse` (server/tareasFondo.ts) excluye estos pagos del
 * reintento automatico del acuse de compra: nunca se activaron, no hay nada que confirmarle al comprador.
 *
 * Devuelve "repetido" sin tocar la cuenta si `paymentId` ya estaba marcado como procesado (esto
 * cubre tambien una segunda entrega del MISMO pago que ya se marco "requiere_reembolso": el
 * aviso a Leonardo solo se manda la primera vez).
 */
/**
 * G1 (corrige NO-GO 2026-10-07): resuelve el id del pago de Paquete activo de `cuenta`, con
 * fallback para cuentas VIEJAS (activadas antes de que `pagoPaqueteId` existiera). `undefined`
 * (campo ausente) es "cuenta vieja"; `null` es "ya migrada, pero sin Paquete activo" — las dos se
 * tratan distinto.
 *
 * Fallback (cuenta vieja): se usa `cuenta.ultimoPago.id` SOLO si se puede confirmar que ESE pago
 * es de tipo "paquete" — via `obtenerTipoPago` (inyectable, mismo patron de DI que
 * `recalcularReservadosPaquete` de `reservarEnvioTx`), una consulta NORMAL de `pagosProcesados`
 * (fuera de la transaccion: es seguro, porque `tipo` es INMUTABLE una vez que un pago se procesa
 * — nunca cambia despues — asi que no hay ninguna ventana de inconsistencia que una lectura
 * transaccional necesite proteger aqui). Un pago viejo sin `tipo` guardado (de antes de que
 * existiera Pago por Uso) se interpreta como "paquete" — mismo criterio que
 * `pagoProcesadoAcuseDesdeDoc` mas abajo.
 *
 * "Si no se puede saber, de forma conservadora" (instruccion del Brain): sin `obtenerTipoPago`
 * inyectado, o si ese pago no tiene registro en `pagosProcesados` (no deberia pasar nunca — esa
 * coleccion no se borra), se devuelve `null` en vez de asumir que es el Paquete. Es mas seguro
 * equivocarse hacia "esto no es el pago activo" que hacia "si lo es": lo primero, en el peor caso,
 * solo repite el bug original de G1 para un caso practicamente imposible; lo segundo podria
 * revertir o bloquear la cuenta por un pago ajeno legitimo.
 */
async function resolverPagoPaqueteId(
  cuenta: Cuenta | null,
  obtenerTipoPago?: (paymentId: string) => Promise<string | undefined>
): Promise<string | null> {
  if (!cuenta) return null;
  if (cuenta.pagoPaqueteId !== undefined) return cuenta.pagoPaqueteId;
  if (!cuenta.ultimoPago || !obtenerTipoPago) return null; // nunca pago nada, o sin consulta inyectada: conservador.

  const tipo = await obtenerTipoPago(cuenta.ultimoPago.id);
  return tipo === "porUso" ? null : cuenta.ultimoPago.id;
}

/** Consulta real (fuera de cualquier transaccion): `pagosProcesados/{paymentId}.tipo`, o
 * `undefined` si el pago no existe. Inyectada en produccion a `resolverPagoPaqueteId` (arriba). */
export async function obtenerTipoPagoGuardado(paymentId: string): Promise<string | undefined> {
  const snap = await db().collection("pagosProcesados").doc(String(paymentId)).get();
  return snap.exists ? snap.data()?.tipo : undefined;
}

export async function activarPaqueteSiNoProcesadoTx(
  tx: TransaccionLike,
  pagoRef: any,
  cuentaRef: any,
  datos: {
    paymentId: string;
    cop: number;
    trm: number;
    fecha: Timestamp;
    uid?: string;
    referenciaId?: string;
    fechaTrm?: string;
  },
  /** G1: inyectable para el fallback de `resolverPagoPaqueteId` en cuentas VIEJAS sin
   * `pagoPaqueteId` — ver esa funcion. La produccion (`activarPaqueteSiNoProcesado`, mas abajo)
   * SIEMPRE inyecta `obtenerTipoPagoGuardado`. */
  obtenerTipoPago?: (paymentId: string) => Promise<string | undefined>
): Promise<"activado" | "repetido" | "requiere_reembolso"> {
  const pagoSnap = await tx.get(pagoRef);
  if (pagoSnap.exists) return "repetido";

  const cuentaSnap = await tx.get(cuentaRef); // lectura, no escritura: todavia no se hizo ningun tx.set/tx.update.
  const cuentaActual = cuentaSnap.exists ? (cuentaSnap.data() as Cuenta) : null;

  // G1 (corrige NO-GO 2026-10-07): antes comparaba contra `cuentaActual.ultimoPago.id`, que una
  // compra Por Uso POSTERIOR al Paquete tambien pisa (`activarPorUsoSiNoProcesadoTx`) — eso podia
  // dejar pasar un pago doble sin detectarlo. Ahora compara contra `pagoPaqueteId` (con fallback
  // para cuentas viejas, ver `resolverPagoPaqueteId`); solo se calcula (lectura extra) cuando el
  // resto de las condiciones YA indican que hay un Paquete vigente que proteger.
  let vigentePorOtroPago = false;
  if (
    cuentaActual !== null &&
    cuentaActual.plan === "paquete" &&
    cuentaActual.enviosRestantes > 0 &&
    cuentaActual.vence !== null &&
    cuentaActual.vence.toMillis() > Date.now()
  ) {
    const pagoPaqueteIdActual = await resolverPagoPaqueteId(cuentaActual, obtenerTipoPago);
    vigentePorOtroPago = pagoPaqueteIdActual !== null && pagoPaqueteIdActual !== datos.paymentId;
  }

  if (vigentePorOtroPago) {
    tx.set(pagoRef, {
      procesadoEn: Timestamp.now(),
      uid: datos.uid ?? null,
      referenciaId: datos.referenciaId ?? null,
      cop: datos.cop,
      trm: datos.trm,
      fechaTrm: datos.fechaTrm ?? null,
      fecha: datos.fecha,
      vence: null, // nunca se activo nada con este pago.
      requiereReembolso: true,
    });
    return "requiere_reembolso";
  }

  const vence = Timestamp.fromDate(sumarUnMes(datos.fecha.toDate()));
  tx.set(pagoRef, {
    procesadoEn: Timestamp.now(),
    uid: datos.uid ?? null,
    referenciaId: datos.referenciaId ?? null,
    cop: datos.cop,
    trm: datos.trm,
    fechaTrm: datos.fechaTrm ?? null,
    fecha: datos.fecha,
    vence,
  });
  tx.set(cuentaRef, {
    plan: "paquete",
    enviosRestantes: ENVIOS_PAQUETE,
    vence,
    renueva: false, // pago unico (Tarea 6); "renovar cada mes" es la Tarea 7.
    mpSuscripcionId: null,
    reservadosPaquete: 0, // D4/requisito de la Tarea 6: nunca hereda reservas de un ciclo anterior.
    // Tarea 16A-1 (decision del Brain 2026-10-06): este `tx.set` REEMPLAZA el documento completo
    // (igual patron que GRAVE 1 de autorizaciones/aceptaciones, mas arriba) — sin esto, activar un
    // Paquete borraria el saldo Por Uso de la cuenta, que es ACUMULABLE y vive en el MISMO
    // documento. `cuentaActual` ya se leyo arriba (antes de cualquier escritura) para la
    // comprobacion de `vigentePorOtroPago`.
    saldoPorUso: cuentaActual?.saldoPorUso ?? 0,
    reservadosPorUso: cuentaActual?.reservadosPorUso ?? 0,
    ultimoPago: { id: datos.paymentId, cop: datos.cop, trm: datos.trm, fecha: datos.fecha },
    // G1: ESTE es el unico lugar que escribe `pagoPaqueteId` — es lo que protege el Paquete de
    // una compra Por Uso posterior pisando `ultimoPago` (ver el comentario del campo en `Cuenta`).
    pagoPaqueteId: datos.paymentId,
    actualizado: Timestamp.now(),
  });
  return "activado";
}

// ── Pago por uso (Tarea 16A-1, decision del Brain 2026-10-06): US$0,15 por envio, saldo SIN
// vencimiento y ACUMULABLE entre compras. "Pro" desaparece (nunca se implemento su activacion). ──

/**
 * Cuerpo transaccional de la activacion del plan "Pago por uso". A diferencia del Paquete (que
 * REEMPLAZA la cuenta completa con `tx.set`, "no se acumulan los sobrantes"), este saldo es
 * ACUMULABLE y SIN VENCIMIENTO: cada activacion SUMA `cantidad` a `saldoPorUso` con `tx.update`
 * (nunca `tx.set`), sin tocar ningun campo del Paquete (`plan`/`enviosRestantes`/`vence`/
 * `renueva`/`mpSuscripcionId`/`reservadosPaquete`). Si la cuenta todavia no existe (primera compra
 * de un usuario nuevo), se crea con `tx.set` sobre la base Gratis — unica vez que esta funcion usa
 * `set` en vez de `update`, porque Firestore no permite `update` sobre un documento inexistente.
 *
 * Idempotencia EN LA MISMA TRANSACCION que la suma (mismo patron que `activarPaqueteSiNoProcesadoTx`:
 * NO se usa `marcarProcesado`, que abre su propia transaccion aparte): `pagosProcesados/{paymentId}`
 * se lee ANTES de cualquier escritura; si ya existe, se devuelve "repetido" sin sumar nada — dos
 * avisos del mismo pago nunca se cuentan dos veces. `ultimoPago` SI se actualiza (igual que hace
 * el Paquete): es el ultimo pago aprobado de cualquier tipo, Paquete o Por Uso.
 *
 * El pago se guarda con `tipo: "porUso"` y `cantidad` (en vez del `vence` que guarda el Paquete):
 * `revertirPagoSiNoRevertidoTx` (mas abajo) los usa para saber RESTAR del saldo acumulado en vez
 * de resetear la cuenta entera a Gratis — un reembolso de Por Uso no "reemplaza" nada, solo resta
 * lo que ESE pago en concreto habia sumado.
 *
 * Fix (hallazgo 2026-10-07): igual que M37 ya hace para `activarPaqueteSiNoProcesadoTx`, el pago
 * tambien guarda `referenciaId`/`fechaTrm` (OPCIONALES en esta Tx, mismo motivo que el Paquete: no
 * romper llamadas viejas que no los necesitan) para poder RECONSTRUIR el acuse de compra
 * (`notificarActivacionPorUso`, server/notificaciones.ts) en un reintento posterior sin volver a
 * consultar Mercado Pago. Antes de este fix, un pago porUso nunca guardaba estos dos campos:
 * `reintentarAcusePorUsoPendiente` los leia `null` y abandonaba con un `console.warn` ("sin
 * referenciaId/fechaTrm guardados") sin reintentar nunca — el barrido programado
 * (`barrerTodosLosPagosPendientes`, server/tareasFondo.ts) jamas podia recuperar el acuse en linea
 * fallido de una compra porUso. En produccion (`activarPorUsoSiNoProcesado`, mas abajo) SIEMPRE se mandan.
 */
export async function activarPorUsoSiNoProcesadoTx(
  tx: TransaccionLike,
  pagoRef: any,
  cuentaRef: any,
  datos: {
    paymentId: string;
    uid: string;
    cantidad: number;
    cop: number;
    trm: number;
    fecha: Timestamp;
    referenciaId?: string;
    fechaTrm?: string;
  }
): Promise<"activado" | "repetido"> {
  const pagoSnap = await tx.get(pagoRef);
  if (pagoSnap.exists) return "repetido";

  const cuentaSnap = await tx.get(cuentaRef); // lectura, no escritura: todas las lecturas antes de escribir.
  const cuentaActual = cuentaSnap.exists ? (cuentaSnap.data() as Cuenta) : null;
  const saldoPorUsoNuevo = (cuentaActual?.saldoPorUso ?? 0) + datos.cantidad;
  const ultimoPago: UltimoPago = { id: datos.paymentId, cop: datos.cop, trm: datos.trm, fecha: datos.fecha };

  tx.set(pagoRef, {
    procesadoEn: Timestamp.now(),
    uid: datos.uid,
    referenciaId: datos.referenciaId ?? null,
    cop: datos.cop,
    trm: datos.trm,
    fechaTrm: datos.fechaTrm ?? null,
    fecha: datos.fecha,
    tipo: "porUso",
    cantidad: datos.cantidad,
  });

  if (cuentaActual) {
    tx.update(cuentaRef, { saldoPorUso: saldoPorUsoNuevo, ultimoPago });
  } else {
    tx.set(cuentaRef, { ...CUENTA_GRATIS_BASE, saldoPorUso: saldoPorUsoNuevo, ultimoPago, actualizado: Timestamp.now() });
  }
  return "activado";
}

/** Envoltorio real: abre la transaccion de Firestore y le pasa las referencias reales.
 * `referenciaId`/`fechaTrm` (fix 2026-10-07, ver el comentario de `activarPorUsoSiNoProcesadoTx`)
 * son REQUERIDOS aqui (a diferencia de la Tx, que los deja opcionales) — mismo patron que
 * `activarPaqueteSiNoProcesado`: en produccion el llamador (server/webhook.ts) siempre los tiene
 * disponibles (vienen de la preferencia y del external_reference). */
export async function activarPorUsoSiNoProcesado(
  uid: string,
  paymentId: string,
  datos: { cantidad: number; cop: number; trm: number; fecha: Timestamp; referenciaId: string; fechaTrm: string }
): Promise<"activado" | "repetido"> {
  const pagoRef = db().collection("pagosProcesados").doc(String(paymentId));
  const cuentaRef = db().collection("cuentas").doc(uid);
  return db().runTransaction((tx) =>
    activarPorUsoSiNoProcesadoTx(tx, pagoRef, cuentaRef, { paymentId, uid, ...datos })
  );
}

/** Envoltorio real: abre la transaccion de Firestore y le pasa las referencias reales. */
export async function activarPaqueteSiNoProcesado(
  uid: string,
  paymentId: string,
  datos: { cop: number; trm: number; fecha: Timestamp; referenciaId: string; fechaTrm: string }
): Promise<"activado" | "repetido" | "requiere_reembolso"> {
  const pagoRef = db().collection("pagosProcesados").doc(String(paymentId));
  const cuentaRef = db().collection("cuentas").doc(uid);
  return db().runTransaction((tx) =>
    activarPaqueteSiNoProcesadoTx(tx, pagoRef, cuentaRef, { paymentId, uid, ...datos }, obtenerTipoPagoGuardado)
  );
}

// ── Correo de confirmacion: reclamo transaccional POR DESTINATARIO (M35, corrige vuelta 27) ─────
// ANTES, la idempotencia del correo era UN solo campo (`correoEnviado`) para TODO el pago: dos
// avisos del webhook casi simultaneos para el MISMO pago (p. ej. Mercado Pago reintentando un
// 200 que se perdio en la red, o dos entregas distintas del mismo evento) podian los dos leer
// "no enviado" ANTES de que cualquiera alcanzara a marcarlo, y los dos mandar el correo — exactamente
// el mismo tipo de carrera que M23 (Tarea 3) ya habia encontrado para el saldo del Paquete. Y, al
// ser un solo campo para los DOS destinatarios, si fallaba el envio a Leonardo pero el del
// comprador ya habia salido, no habia forma de reintentar solo el de Leonardo sin arriesgar un
// reenvio al comprador.
//
// Ahora cada destinatario tiene su PROPIO campo en el MISMO documento `pagosProcesados/{id}`
// (`correoComprador`, `correoLeonardo`, y `avisoBloqueoProveedor` para el aviso de M36(2)), con
// dos estados: "reclamado" (alguien ya empezo a intentar enviarlo: nadie mas debe intentarlo) y
// "enviado" (ya salio con exito: nunca reintentar). `reclamarEnvioCorreoTx` es TRANSACCIONAL
// (lee+escribe en una sola transaccion de Firestore, igual que `reservarEnvioTx` de la Tarea 3):
// de dos llamadas casi simultaneas para el mismo destinatario, Firestore reintenta la que pierde
// la carrera con el estado ya actualizado, y esa segunda lectura ve "reclamado"/"enviado" y
// devuelve `false` — solo UNA de las dos manda el correo. Si el envio falla, quien llamo debe
// `liberarReclamoCorreo` para volver el campo a `null` y permitir que una entrega FUTURA reintente
// SOLO ese destinatario (nunca el otro, que puede ya estar en "enviado").
//
// M37 (corrige vuelta 28, "reclamo atascado y sin reintento", 2026-10-05): si quien reclamo un
// correo MUERE antes de llamar a `marcarCorreoEnviado`/`liberarReclamoCorreo` (el proceso se cae,
// Cloud Run recicla la instancia a mitad del envio...), el campo se quedaba en "reclamado" PARA
// SIEMPRE — `reclamarEnvioCorreoTx` trataba cualquier valor truthy como "ya tomado, no reintentar
// nunca". Ahora cada reclamo guarda TAMBIEN cuando se reclamo (`<campo>ReclamadoEn`, Timestamp DEL
// SERVIDOR, nunca uno que mande el llamador) y un reclamo "reclamado" de AL MENOS
// `UMBRAL_RECLAMO_ATASCADO_MS` (corrige B2/B3, revision externa vuelta 30: el comentario de
// `<campo>ReclamadoEn` decia "de mas de" pero el umbral real debe incluir el borde exacto, igual
// que ya hace la espera creciente de M2 mas abajo) se trata como LIBRE — se vuelve a reclamar, en
// vez de bloquear para siempre. Un reclamo "reclamado" FRESCO (dentro del umbral) sigue bloqueando
// igual que antes: dos intentos simultaneos de recuperar un reclamo atascado solo dejan ganar a
// uno (ver tests/reintentoAcuse.test.ts).
export type DestinatarioCorreo =
  | "comprador"
  | "leonardo"
  | "bloqueoProveedor"
  | "acuse20h"
  | "acuse48h"
  | "reversionComprador";

/** M37: un reclamo "reclamado" de AL MENOS 10 minutos se trata como libre (B3, corrige vuelta 30:
 * antes el borde exacto de los 10 minutos NO se consideraba atascado por usar `>` en vez de `>=`).
 * 10 minutos es mucho mas que lo que tarda un envio de correo real (segundos) pero deja margen
 * para una instancia de Cloud Run lenta en arrancar; no tan largo como para demorar un reintento
 * automatico de verdad. */
export const UMBRAL_RECLAMO_ATASCADO_MS = 10 * 60_000;

function campoCorreoDestinatario(destinatario: DestinatarioCorreo): string {
  if (destinatario === "comprador") return "correoComprador";
  if (destinatario === "leonardo") return "correoLeonardo";
  if (destinatario === "acuse20h") return "avisoAcuse20h";
  if (destinatario === "acuse48h") return "avisoAcuse48h";
  if (destinatario === "reversionComprador") return "avisoReversionComprador";
  return "avisoBloqueoProveedor";
}

function campoReclamadoEnDestinatario(destinatario: DestinatarioCorreo): string {
  return `${campoCorreoDestinatario(destinatario)}ReclamadoEn`;
}

/** Cuerpo transaccional del reclamo (M35; M37 agrega el reclamo ATASCADO): si
 * `pagosProcesados/{paymentId}.<campo>` ya dice "enviado", nunca reclama. Si dice "reclamado",
 * reclama de nuevo SOLO si quedo atascado (sin `<campo>ReclamadoEn` propio — datos de antes de
 * M37 — o con AL MENOS `UMBRAL_RECLAMO_ATASCADO_MS` desde que se reclamo, B3); si esta libre
 * (`null`/ausente) o atascado, lo marca "reclamado" con la fecha DE `ahora` y devuelve `true`:
 * quien recibe `true` es el UNICO responsable de, despues, marcarlo "enviado" (exito) o liberarlo
 * de vuelta a `null` (fallo). */
export async function reclamarEnvioCorreoTx(
  tx: TransaccionLike,
  pagoRef: any,
  destinatario: DestinatarioCorreo,
  ahora: Date = new Date()
): Promise<boolean> {
  const campo = campoCorreoDestinatario(destinatario);
  const campoFecha = campoReclamadoEnDestinatario(destinatario);
  const snap = await tx.get(pagoRef);
  const datos = snap.exists ? snap.data() : undefined;
  const valor = datos?.[campo];

  if (valor === "enviado") return false;
  if (valor) {
    const reclamadoEn = datos?.[campoFecha];
    const ms = reclamadoEn && typeof reclamadoEn.toMillis === "function" ? reclamadoEn.toMillis() : null;
    // B3 (corrige vuelta 30): `>=` en vez de `>` — exactamente en el umbral YA se considera
    // atascado, no solo estrictamente despues.
    const atascado = ms === null || ahora.getTime() - ms >= UMBRAL_RECLAMO_ATASCADO_MS;
    if (!atascado) return false; // reclamo fresco: otra entrega lo esta procesando AHORA MISMO.
  }

  tx.update(pagoRef, { [campo]: "reclamado", [campoFecha]: Timestamp.fromDate(ahora) });
  return true;
}

/** Envoltorio real: abre la transaccion de Firestore y le pasa la referencia real. */
export async function reclamarEnvioCorreo(
  paymentId: string,
  destinatario: DestinatarioCorreo,
  ahora: Date = new Date()
): Promise<boolean> {
  const pagoRef = db().collection("pagosProcesados").doc(String(paymentId));
  return db().runTransaction((tx) => reclamarEnvioCorreoTx(tx, pagoRef, destinatario, ahora));
}

/**
 * Simplificacion 2026-10-06 (decision del Brain, tras el NO-GO de la vuelta 32: dejar de parchear
 * el reintento de acuses y simplificar su mecanica en vez de agregarle otra capa): cerrar un
 * reclamo (marcarlo "enviado" o liberarlo a `null`) SOLO si `<campo>ReclamadoEn` sigue siendo
 * EXACTAMENTE el que puso ESTE mismo intento (comparacion TRANSACCIONAL del timestamp recibido en
 * `reclamadoEn` contra el guardado ahora mismo en Firestore). Antes, `marcarCorreoEnviado`/
 * `liberarReclamoCorreo` escribian a ciegas sin comprobar que el reclamo siguiera siendo suyo: un
 * cierre TARDIO (p. ej. la instancia que reclamo quedo colgada mas de
 * `UMBRAL_RECLAMO_ATASCADO_MS`, otra entrega ya liberó el reclamo atascado y volvio a reclamarlo, y
 * SOLO DESPUES la instancia vieja por fin intenta cerrar el suyo) podia pisar el reclamo AJENO mas
 * nuevo — marcarlo "enviado" sin haber mandado nada, o liberarlo a mitad de un envio en curso. Si
 * el reclamo ya no es el mismo, esta funcion no hace nada (el reclamo ajeno sigue su curso normal).
 */
export async function marcarCorreoEnviadoTx(
  tx: TransaccionLike,
  pagoRef: any,
  destinatario: DestinatarioCorreo,
  reclamadoEn: Date
): Promise<void> {
  const campo = campoCorreoDestinatario(destinatario);
  const campoFecha = campoReclamadoEnDestinatario(destinatario);
  const snap = await tx.get(pagoRef);
  const datos = snap.exists ? snap.data() : undefined;
  const actual = datos?.[campoFecha];
  const actualMs = actual && typeof actual.toMillis === "function" ? actual.toMillis() : null;
  if (actualMs !== reclamadoEn.getTime()) return; // ya no es el dueño de este reclamo: no tocar.
  tx.update(pagoRef, { [campo]: "enviado", [campoFecha]: null });
}

/** Envoltorio real: abre la transaccion de Firestore y le pasa la referencia real. `reclamadoEn`
 * es el `ahora` que devolvio `reclamarEnvioCorreo` al reclamar — quien llama debe guardarlo y
 * reenviarlo aqui tal cual. */
export async function marcarCorreoEnviado(
  paymentId: string,
  destinatario: DestinatarioCorreo,
  reclamadoEn: Date
): Promise<void> {
  const pagoRef = db().collection("pagosProcesados").doc(String(paymentId));
  await db().runTransaction((tx) => marcarCorreoEnviadoTx(tx, pagoRef, destinatario, reclamadoEn));
}

/** Mismo chequeo de dueño que `marcarCorreoEnviadoTx` (ver el comentario de arriba), para cuando el
 * envio a ESE destinatario fallo: libera el reclamo (vuelve `<campo>` a `null`) solo si sigue
 * siendo el reclamo que puso esta llamada, para que una entrega futura pueda reintentar SOLO ese
 * destinatario sin pisar un reclamo ajeno mas nuevo. */
export async function liberarReclamoCorreoTx(
  tx: TransaccionLike,
  pagoRef: any,
  destinatario: DestinatarioCorreo,
  reclamadoEn: Date
): Promise<void> {
  const campo = campoCorreoDestinatario(destinatario);
  const campoFecha = campoReclamadoEnDestinatario(destinatario);
  const snap = await tx.get(pagoRef);
  const datos = snap.exists ? snap.data() : undefined;
  const actual = datos?.[campoFecha];
  const actualMs = actual && typeof actual.toMillis === "function" ? actual.toMillis() : null;
  if (actualMs !== reclamadoEn.getTime()) return;
  tx.update(pagoRef, { [campo]: null, [campoFecha]: null });
}

/** Envoltorio real: abre la transaccion de Firestore y le pasa la referencia real. */
export async function liberarReclamoCorreo(
  paymentId: string,
  destinatario: DestinatarioCorreo,
  reclamadoEn: Date
): Promise<void> {
  const pagoRef = db().collection("pagosProcesados").doc(String(paymentId));
  await db().runTransaction((tx) => liberarReclamoCorreoTx(tx, pagoRef, destinatario, reclamadoEn));
}

// ── Lectura de pagosProcesados para el UNICO mecanismo de reintento del acuse (simplificacion
// 2026-10-06, decision del Brain tras el NO-GO de la vuelta 32 sobre 3 vueltas previas de parches:
// SIMPLIFICAR, no parchear) ──────────────────────────────────────────────────────────────────────
// El webhook de Mercado Pago (server/webhook.ts) manda el acuse de compra EN LINEA, con `await`
// dentro de la propia peticion, al activar un pago; si falla, el acuse queda pendiente. El UNICO
// mecanismo de reintento es `POST /api/tareas/barrido-acuses` (Cloud Scheduler cada 30 min, ver
// server/tareasFondo.ts): recorre TODOS los `pagosProcesados` paginados y reintenta cada uno cuyo
// acuse no se mando y que no este revertido — `reintentarAcusePendiente` (server/notificaciones.ts)
// decide, segun la antiguedad del pago, si reintenta, alerta a Leonardo a las 20h o abandona (deja
// de reintentar) a las 48h. Ya no existen ni el reintento desde GET /api/cuenta ni el barrido
// disparado por el propio webhook (ambos quedaron redundantes con el barrido programado) ni el
// tope de intentos con espera creciente (`MAX_INTENTOS_ACUSE`/backoff exponencial): sin un techo de
// tiempo real (48h) que de verdad detenga el reintento, un tope de INTENTOS era una capa de mas que
// no cambiaba el resultado observable.

export interface PagoProcesadoAcuse {
  paymentId: string;
  uid: string | null;
  referenciaId: string | null;
  cop: number;
  trm: number;
  fechaTrm: string | null;
  /** Fecha del PAGO (nunca de cuando se proceso el aviso). */
  fecha: Timestamp;
  /** Paso 16A-3: "paquete" | "porUso", leido de `pagosProcesados/{id}.tipo` (ver
   * `activarPorUsoSiNoProcesadoTx`, que SI lo guarda). Un pago de Paquete viejo nunca guardo este
   * campo — se interpreta como "paquete", la unica variante que existia antes de la Tarea 16A-1.
   * `server/tareasFondo.ts` lo usa para enrutar a la variante correcta del reintento del acuse. */
  tipo: "paquete" | "porUso";
  /** Fecha de vencimiento del Paquete que activo este pago (= `cuenta.vence` en el momento de la
   * activacion — puede diferir del `vence` ACTUAL de la cuenta si hubo una compra posterior).
   * `null` para un pago `tipo:"porUso"` (ese saldo nunca vence). */
  vence: Timestamp | null;
  /** Cantidad de envios comprados — solo para `tipo:"porUso"` (ver `activarPorUsoSiNoProcesadoTx`);
   * `null` para un pago de Paquete. */
  cantidad: number | null;
  /** "enviado" | "reclamado" | null. */
  correoComprador: string | null;
  /** G3 (correccion NO-GO vuelta 30): true si Mercado Pago reembolso/contracargo este pago
   * (`revertirPagoSiNoRevertidoTx` ya lo marco). Un pago revertido nunca debe reintentar su acuse
   * de compra — el comprador ya no tiene nada que confirmar. */
  revertido: boolean;
  /** "enviado" | "reclamado" | null — si ya se avisó a Leonardo (log + mejor esfuerzo por correo)
   * de que este acuse lleva >=20h sin salir. */
  avisoAcuse20h: string | null;
  /** "enviado" | "reclamado" | null — si ya se avisó a Leonardo de que este acuse lleva >=48h sin
   * salir y se DEJO de reintentar (estado terminal). */
  avisoAcuse48h: string | null;
}

/** EXPORTADA (antes privada): `server/tareasFondo.ts` la necesita para convertir cada documento
 * crudo de una pagina de `paginaPagosProcesados` en `PagoProcesadoAcuse` antes de reintentar. */
export function pagoProcesadoAcuseDesdeDoc(id: string, data: Record<string, any>): PagoProcesadoAcuse {
  return {
    paymentId: id,
    uid: data.uid ?? null,
    referenciaId: data.referenciaId ?? null,
    cop: data.cop,
    trm: data.trm,
    fechaTrm: data.fechaTrm ?? null,
    fecha: data.fecha,
    tipo: data.tipo === "porUso" ? "porUso" : "paquete",
    vence: data.vence ?? null,
    cantidad: typeof data.cantidad === "number" ? data.cantidad : null,
    correoComprador: data.correoComprador ?? null,
    revertido: data.revertido === true,
    avisoAcuse20h: data.avisoAcuse20h ?? null,
    avisoAcuse48h: data.avisoAcuse48h ?? null,
  };
}

/** Lee `pagosProcesados/{paymentId}.correoComprador` tal cual ("enviado" | "reclamado" | null) —
 * usada por `reintentarAcusePendiente` (server/notificaciones.ts) para decidir, DESPUES de
 * reintentar, si el acuse sigue sin salir (y por tanto si hay que escalar a Leonardo tras 20h). */
export async function obtenerEstadoCorreoComprador(paymentId: string): Promise<string | null> {
  const snap = await db().collection("pagosProcesados").doc(String(paymentId)).get();
  return snap.exists ? (snap.data()?.correoComprador ?? null) : null;
}

/**
 * Una PAGINA de `pagosProcesados`, ordenada por `procesadoEn` descendente, para el barrido
 * COMPLETO que dispara el endpoint de tareas protegido (`POST /api/tareas/barrido-acuses`,
 * `server/tareasFondo.ts` `barrerTodosLosPagosPendientes`) — el UNICO mecanismo de reintento del
 * acuse de compra (simplificacion 2026-10-06). Recorre TODOS los pendientes paginando con
 * `startAfter`. `cursor` es el cursor de Firestore devuelto por la pagina anterior
 * (`cursorSiguiente`, el ultimo `QueryDocumentSnapshot` de esa pagina) o `null` para la primera
 * pagina — se tipa `unknown` porque quien orquesta el recorrido completo nunca necesita conocer
 * su forma real, solo reenviarlo tal cual a la siguiente llamada.
 */
export async function paginaPagosProcesados(
  cursor: unknown,
  tamanoPagina = 100
): Promise<{ docs: Array<{ id: string; data: Record<string, any> }>; cursorSiguiente: unknown }> {
  const base = db().collection("pagosProcesados").orderBy("procesadoEn", "desc").limit(tamanoPagina);
  const query = cursor ? base.startAfter(cursor as FirebaseFirestore.QueryDocumentSnapshot) : base;
  const snap = await query.get();
  const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  const cursorSiguiente = snap.docs.length === tamanoPagina ? snap.docs[snap.docs.length - 1] : null;
  return { docs, cursorSiguiente };
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
//
// Tarea 16A-1 (decision del Brain 2026-10-06): un pago `tipo: "porUso"` (los que guarda
// `activarPorUsoSiNoProcesadoTx`) NUNCA sigue la regla de arriba — el saldo Por Uso es ACUMULABLE
// y no tiene un "pago activo" unico que proteger, asi que revertirlo siempre RESTA la `cantidad`
// que ESE pago en concreto habia sumado (minimo 0), sin tocar el Paquete ni resetear la cuenta a
// Gratis. El dato de que fue "porUso" queda en `pagosProcesados/{paymentId}.tipo`, que la
// reversion nunca borra (solo agrega `revertido:true`) — quien necesite saber el tipo del pago
// revertido lo lee de ahi.
export type ResultadoReversion = "revertido" | "no_activo" | "ya_procesado" | "ignorado";

// ── M1 (corrige NO-GO 2026-10-07, Terminos SS8.5/8.5-bis): atribucion de USO por compra Por Uso ──
// Varias compras Por Uso de un mismo usuario caen en la MISMA bolsa (`cuenta.saldoPorUso`, sin
// marca de "a cual compra pertenece cada unidad restante"). Al revertir UNA compra en concreto,
// nunca se puede restar a ciegas su `cantidad` completa: si ya se uso parte del saldo (via
// `confirmarEnvioExitosoTx`), restar la cantidad completa le quitaria a la cuenta unidades que en
// realidad vinieron de OTRA compra, todavia vigente. Terminos SS8.5/8.5-bis fijan la regla: orden
// de llegada, y en caso de duda, a favor del cliente — aqui eso se traduce en que el saldo que
// SIGUE SIN USARSE se atribuye primero a las compras MAS RECIENTES (si hay que "inventar" cual
// unidad se gasto, se asume que se gasto la mas vieja primero, nunca la mas nueva).

export interface CompraPorUsoNoRevertida {
  paymentId: string;
  cantidad: number;
  fecha: Timestamp;
}

export interface AtribucionPorUso {
  paymentId: string;
  cantidad: number;
  /** Cuanto de ESTA compra sigue SIN usar (nunca mayor que `cantidad` ni que el saldo actual). */
  noUsado: number;
  /** `cantidad - noUsado`: cuanto de ESTA compra ya se gasto. */
  usado: number;
}

/**
 * Funcion PURA: dada la lista de compras Por Uso NO revertidas de un usuario, YA ORDENADAS por
 * orden de llegada (ascendente: la mas vieja primero, la mas reciente al final — el mismo orden
 * en que `listarComprasPorUsoNoRevertidas` las entrega), y el saldo ACTUAL de la cuenta, decide
 * cuanto de CADA compra sigue sin usar.
 *
 * Algoritmo (orden de llegada, mas favorable al cliente en caso de duda): el saldo que queda se
 * atribuye primero a las compras MAS RECIENTES — se recorre el arreglo de atras para adelante,
 * asignandole a cada compra `min(cantidad, saldoQueQueda)` como "no usado" y restando eso del
 * saldo que queda para la siguiente (mas vieja). Las compras mas viejas son las que "ya se
 * gastaron" cuando el saldo no alcanza para cubrirlas todas.
 *
 * Devuelve el resultado en el MISMO orden que `comprasOrdenadas` (no se reordena la salida).
 */
export function atribucionPorUso(comprasOrdenadas: CompraPorUsoNoRevertida[], saldoActual: number): AtribucionPorUso[] {
  let restante = Math.max(0, saldoActual);
  const noUsadoPorIndice = new Array<number>(comprasOrdenadas.length);
  for (let i = comprasOrdenadas.length - 1; i >= 0; i--) {
    const compra = comprasOrdenadas[i];
    const noUsado = Math.min(compra.cantidad, restante);
    noUsadoPorIndice[i] = noUsado;
    restante -= noUsado;
  }
  return comprasOrdenadas.map((compra, i) => ({
    paymentId: compra.paymentId,
    cantidad: compra.cantidad,
    noUsado: noUsadoPorIndice[i],
    usado: compra.cantidad - noUsadoPorIndice[i],
  }));
}

/** Consulta real (fuera de cualquier transaccion, mismo patron que `contarReservadosPorUsoVigentes`):
 * todas las compras Por Uso NO revertidas de `uid`, ordenadas por orden de llegada (ascendente). */
export async function listarComprasPorUsoNoRevertidas(uid: string): Promise<CompraPorUsoNoRevertida[]> {
  const snap = await db().collection("pagosProcesados").where("uid", "==", uid).get();
  const compras: CompraPorUsoNoRevertida[] = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data?.tipo === "porUso" && data?.revertido !== true && typeof data?.cantidad === "number" && data?.fecha) {
      compras.push({ paymentId: doc.id, cantidad: data.cantidad, fecha: data.fecha });
    }
  }
  compras.sort((a, b) => a.fecha.toMillis() - b.fecha.toMillis());
  return compras;
}

/** Lee `pagosProcesados/{paymentId}.usadosAlRevertir` — cuanto de esa compra Por Uso YA se habia
 * gastado en el momento de revertirla (0 si nada, o si el pago no existe/no es porUso). Lo usa
 * `avisarReembolsoPaquete` (server/notificaciones.ts), DESPUES de que la transaccion de reversion
 * ya aplico, para decidir si hay que alertar a Leonardo (`ALERTA_REVERSION_PORUSO_USADO`). */
export async function obtenerUsadosAlRevertirPorUso(paymentId: string): Promise<number> {
  const snap = await db().collection("pagosProcesados").doc(String(paymentId)).get();
  const valor = snap.exists ? snap.data()?.usadosAlRevertir : undefined;
  return typeof valor === "number" ? valor : 0;
}

export async function revertirPagoSiNoRevertidoTx(
  tx: TransaccionLike,
  pagoRef: any,
  cuentaRef: any,
  paymentId: string,
  /** M1: consulta REAL de las demas compras Por Uso no revertidas de este usuario, para la
   * atribucion FIFO (ver `atribucionPorUso` arriba) — inyectable, mismo patron que
   * `recalcularReservadosPaquete` de `reservarEnvioTx`. Sin este parametro (pruebas que no
   * necesitan FIFO entre varias compras), esta compra se trata como si fuera la UNICA pendiente —
   * eso degenera exactamente a la resta simple de antes (`Math.max(0, saldo - cantidad)`); la
   * funcion real (`revertirPagoSiNoRevertido`, mas abajo) SIEMPRE inyecta la consulta real. */
  listarComprasPorUsoNoRevertidas?: (uid: string) => Promise<CompraPorUsoNoRevertida[]>,
  /** G1: inyectable para el fallback de `resolverPagoPaqueteId` en cuentas VIEJAS sin
   * `pagoPaqueteId` — ver esa funcion. La produccion (`revertirPagoSiNoRevertido`, mas abajo)
   * SIEMPRE inyecta `obtenerTipoPagoGuardado`. */
  obtenerTipoPago?: (paymentId: string) => Promise<string | undefined>
): Promise<ResultadoReversion> {
  const pagoSnap = await tx.get(pagoRef);
  if (!pagoSnap.exists) {
    // Este pago nunca activo nada aqui (id invalido, o un pago que nunca llego a "approved" en
    // nuestro webhook): no hay cuenta que revertir ni evento propio que recordar.
    return "ignorado";
  }
  const pagoData = pagoSnap.data();
  if (pagoData?.revertido === true) return "ya_procesado";

  const cuentaSnap = await tx.get(cuentaRef);
  const cuenta = cuentaSnap.exists ? (cuentaSnap.data() as Cuenta) : null;

  if (pagoData?.tipo === "porUso") {
    const cantidadPago = typeof pagoData?.cantidad === "number" ? pagoData.cantidad : 0;
    let noUsado = cantidadPago;
    let usados = 0;

    if (cuenta) {
      const uid = typeof pagoData?.uid === "string" ? pagoData.uid : null;
      let compras: CompraPorUsoNoRevertida[];
      if (uid && listarComprasPorUsoNoRevertidas) {
        // Lectura FUERA de la transaccion (consulta normal), ANTES de cualquier escritura de esta
        // funcion — mismo criterio que `recalcularReservadosPaquete`.
        compras = await listarComprasPorUsoNoRevertidas(uid);
        if (!compras.some((c) => c.paymentId === paymentId)) {
          compras = [...compras, { paymentId, cantidad: cantidadPago, fecha: pagoData.fecha }];
        }
        compras = [...compras].sort((a, b) => a.fecha.toMillis() - b.fecha.toMillis());
      } else {
        compras = [{ paymentId, cantidad: cantidadPago, fecha: pagoData.fecha }];
      }
      const atribucion = atribucionPorUso(compras, cuenta.saldoPorUso ?? 0);
      const laDeEstePago = atribucion.find((a) => a.paymentId === paymentId);
      if (laDeEstePago) {
        noUsado = laDeEstePago.noUsado;
        usados = laDeEstePago.usado;
      }
    }

    tx.update(pagoRef, { revertido: true, usadosAlRevertir: usados });
    if (cuenta) {
      tx.update(cuentaRef, { saldoPorUso: Math.max(0, (cuenta.saldoPorUso ?? 0) - noUsado) });
    }
    return "revertido";
  }

  // G1 (corrige NO-GO 2026-10-07): antes comparaba contra `cuenta.ultimoPago.id`, que una compra
  // Por Uso POSTERIOR al Paquete tambien pisa — asi que un reembolso del Paquete despues de esa
  // compra siempre daba "no_activo", aunque el Paquete siguiera activo. Ahora usa `pagoPaqueteId`
  // (con fallback para cuentas viejas, ver `resolverPagoPaqueteId`), lectura ANTES de escribir.
  const pagoPaqueteIdActual = await resolverPagoPaqueteId(cuenta, obtenerTipoPago);
  const esPagoActivo = pagoPaqueteIdActual === paymentId;

  tx.update(pagoRef, { revertido: true });
  if (esPagoActivo) {
    // Tarea 16A-1: este `tx.set` REEMPLAZA el documento completo (mismo riesgo que el `tx.set` de
    // `activarPaqueteSiNoProcesadoTx`, arriba) — conserva el saldo Por Uso, que es ACUMULABLE y no
    // tiene nada que ver con el Paquete que se esta revirtiendo.
    tx.set(cuentaRef, {
      ...CUENTA_GRATIS_BASE,
      saldoPorUso: cuenta?.saldoPorUso ?? 0,
      reservadosPorUso: cuenta?.reservadosPorUso ?? 0,
      actualizado: Timestamp.now(),
    });
    return "revertido";
  }
  return "no_activo";
}

/** Envoltorio real: abre la transaccion de Firestore y le pasa las referencias reales, con la
 * consulta REAL de compras Por Uso pendientes (M1) para la atribucion FIFO entre varias compras. */
export async function revertirPagoSiNoRevertido(paymentId: string, uid: string): Promise<ResultadoReversion> {
  const pagoRef = db().collection("pagosProcesados").doc(String(paymentId));
  const cuentaRef = db().collection("cuentas").doc(uid);
  return db().runTransaction((tx) =>
    revertirPagoSiNoRevertidoTx(tx, pagoRef, cuentaRef, paymentId, listarComprasPorUsoNoRevertidas, obtenerTipoPagoGuardado)
  );
}

// ── Limites de lotes de envio en el servidor (Tarea 3, 2026-10-05) ──────────────────────────
// El navegador nunca decide cuanto puede enviar: pide permiso con la cantidad del lote y el
// servidor responde segun el plan. `decidirLote` es una funcion PURA (sin Firestore) para
// poder probarla con node:test; las funciones de abajo son las unicas que tocan la base de datos.

// Tarea 16A-1 (decision del Brain 2026-10-06): "limite_gratis" ya NO lo produce `decidirLote` —
// desde que existe Pago por uso, cualquier rechazo de un lote de mas de 15 es "saldo_insuficiente"
// (ver la funcion abajo). Se conserva el valor en el tipo por compatibilidad con quien ya lo sabe
// mostrar (src/utils/plan.ts, fuera de este archivo): nunca se borra en silencio un motivo que la
// UI todavia entiende, solo deja de producirse.
export type MotivoRechazoLote = "limite_gratis" | "saldo_insuficiente";

export interface DecisionLote {
  permitido: boolean;
  motivo?: MotivoRechazoLote;
  /** Plan REAL de la cuenta (para mostrarlo en la UI: "Mi plan", mensajes, etc). */
  plan: Plan;
  /**
   * Plan EFECTIVO aplicado a ESTE lote: lo que se guarda en `lotes/{loteId}` y lo que usan
   * `reservarEnvio`/`confirmarEnvioExitoso` para decidir si descuentan saldo. Nunca es el plan
   * de la cuenta a secas (ver regla R3-1 abajo). Puede ser "mixto" (Tarea 16A-1) cuando el lote
   * se reparte entre el Paquete y el saldo Por Uso — ver `consumo`.
   */
  planEfectivo: PlanEfectivo;
  /**
   * Reparto de ESTE lote entre las dos fuentes de saldo pagado (Tarea 16A-1): cuantos de los
   * `cantidad` certificados se cobran del Paquete y cuantos del saldo Por Uso. `paquete + porUso`
   * siempre suma `cantidad` cuando `permitido` es `true` y `planEfectivo` no es "gratis".
   * `undefined` cuando el lote es Gratis: no hay reparto, no se consume nada.
   */
  consumo?: { paquete: number; porUso: number };
  enviosRestantes: number;
  vence: Timestamp | null;
}

const LIMITE_GRATIS = 15;

/** `planEfectivo` que corresponde a un reparto de `cantidadPaquete` + `cantidadPorUso` unidades
 * (ya sea el reparto REAL de un lote aceptado, o el disponible de uno rechazado): "mixto" si las
 * dos fuentes aportan, "paquete"/"porUso" si solo una, "gratis" si ninguna. */
function planEfectivoDeReparto(cantidadPaquete: number, cantidadPorUso: number): PlanEfectivo {
  if (cantidadPaquete > 0 && cantidadPorUso > 0) return "mixto";
  if (cantidadPaquete > 0) return "paquete";
  if (cantidadPorUso > 0) return "porUso";
  return "gratis";
}

/**
 * Decide si un lote de `cantidad` certificados cabe en el saldo de `cuenta`, a la fecha `ahora`,
 * y como se reparte entre las dos fuentes pagadas (Tarea 16A-1, decision del Brain 2026-10-06:
 * se agrega "Pago por uso" — US$0,15 por envio, saldo SIN vencimiento y ACUMULABLE; "Pro"
 * desaparece y con el su via libre sin limite de cantidad).
 *
 * Regla R3-1 (decision del Brain, 2026-10-05, mas favorable al cliente — corrige M21): un lote
 * de 15 o menos SIEMPRE es Gratis, aunque la cuenta tenga saldo pagado: nunca descuenta. Por eso
 * esta comprobacion va ANTES de mirar el saldo de la cuenta.
 *
 * Para lotes de mas de 15:
 * - `disponiblePaquete` = saldo vigente del Paquete (`plan === "paquete"` y `vence` en el futuro)
 *   menos lo ya reservado por otros lotes abiertos (`reservadosPaquete`, M23) — 0 si el Paquete no
 *   esta vigente.
 * - `disponiblePorUso` = `saldoPorUso` menos lo ya reservado por otros lotes (`reservadosPorUso`)
 *   — el saldo Por Uso NUNCA vence, asi que no hay comprobacion de fecha para el.
 * - Si `disponiblePaquete + disponiblePorUso < cantidad`, se rechaza "saldo_insuficiente" (ya no
 *   existe el "limite_gratis" de antes: con Pago por uso, cualquier faltante tiene el mismo motivo,
 *   sea porque la cuenta nunca pago nada o porque el saldo pagado no alcanza para ESTE lote).
 * - Si alcanza, se reparte PRIMERO contra el Paquete (hasta `disponiblePaquete`) y el resto contra
 *   el saldo Por Uso — `consumo.paquete + consumo.porUso === cantidad`. `planEfectivo` es "mixto"
 *   si las dos fuentes aportan, o el nombre de la unica que aporto.
 */
export function decidirLote(cuenta: Cuenta, cantidad: number, ahora: Date): DecisionLote {
  const base = { plan: cuenta.plan, enviosRestantes: cuenta.enviosRestantes, vence: cuenta.vence };

  if (cantidad <= LIMITE_GRATIS) {
    return { permitido: true, planEfectivo: "gratis", ...base };
  }

  const paqueteVigente = cuenta.plan === "paquete" && cuenta.vence !== null && cuenta.vence.toMillis() > ahora.getTime();
  const disponiblePaquete = paqueteVigente ? Math.max(0, cuenta.enviosRestantes - (cuenta.reservadosPaquete ?? 0)) : 0;
  const disponiblePorUso = Math.max(0, (cuenta.saldoPorUso ?? 0) - (cuenta.reservadosPorUso ?? 0));

  if (disponiblePaquete + disponiblePorUso < cantidad) {
    return {
      permitido: false,
      motivo: "saldo_insuficiente",
      planEfectivo: planEfectivoDeReparto(disponiblePaquete, disponiblePorUso),
      ...base,
    };
  }

  const consumoPaquete = Math.min(disponiblePaquete, cantidad);
  const consumoPorUso = cantidad - consumoPaquete;
  return {
    permitido: true,
    planEfectivo: planEfectivoDeReparto(consumoPaquete, consumoPorUso),
    consumo: { paquete: consumoPaquete, porUso: consumoPorUso },
    ...base,
  };
}

export interface Lote {
  uid: string;
  cantidad: number;
  /** Plan EFECTIVO de este lote (de `decidirLote.planEfectivo`), no el plan de la cuenta. Puede
   * ser "mixto" (Tarea 16A-1) cuando el lote se reparte entre el Paquete y el saldo Por Uso. */
  planEfectivo: PlanEfectivo;
  enviados: number;
  /**
   * Cupos reservados para envios EN CURSO (M19, corregido vuelta 18): se reservan ANTES de
   * llamar a Gmail y se confirman (pasan a `enviados`) o se liberan segun el resultado. Un envio
   * nunca descuenta cupo/saldo hasta que Gmail confirmo, pero tampoco deja que envios paralelos
   * se cuelen por encima del cupo mientras Gmail todavia esta en vuelo. Es el TOTAL (cualquier
   * fuente, incluyendo Gratis); `reservadosPaquete`/`reservadosPorUso` de abajo son el desglose
   * por fuente dentro de ese total.
   */
  reservados: number;
  /**
   * De las `reservados` de este lote, cuantas salieron del Paquete (Tarea 16A-1): necesario para
   * que `confirmarEnvioExitosoTx`/`liberarReservaTx` sepan, en un lote "mixto", de que fuente
   * restar — un envio reservado no lleva un identificador propio que lo amarre a su fuente, asi
   * que se confirma/libera contra la fuente que el LOTE todavia tenga pendiente (ver esas
   * funciones). En un lote "paquete" puro siempre es igual a `reservados`; en uno "gratis" o
   * "porUso" puro se queda en 0 toda su vida.
   */
  reservadosPaquete: number;
  /** Mismo patron que `reservadosPaquete`, para el saldo Por Uso. */
  reservadosPorUso: number;
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
  planEfectivo: PlanEfectivo
): Promise<{ loteId: string; lote: Lote }> {
  const ref = db().collection("lotes").doc();
  const ahora = Timestamp.now();
  const lote: Lote = {
    uid,
    cantidad,
    planEfectivo,
    enviados: 0,
    reservados: 0,
    reservadosPaquete: 0,
    reservadosPorUso: 0,
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
 * Recalcula `reservadosPaquete` sumando `reservadosPaquete` de TODOS los lotes NO expirados de
 * `uid` que consumen del Paquete ("paquete" o "mixto", Tarea 16A-1) — D4/M26, decision del Brain
 * 2026-10-05, corrige el contador de `cuentas/{uid}` cuando quedo desincronizado (p. ej. una
 * reserva que quedo huerfana sin liberarse). Es una consulta NORMAL de Firestore (`.get()`, no
 * `tx.get()`): corre FUERA de la transaccion a proposito, para no violar "todas las lecturas antes
 * de cualquier escritura" (ver G3 en `confirmarEnvioExitosoTx`) ni atar el resultado al reintento
 * optimista de la transaccion que la llama.
 *
 * Filtra solo por `uid` (sin `where("planEfectivo", ...)`) para no depender de un indice
 * compuesto nuevo por el agregado de "mixto": el filtro por fuente se hace en memoria. `lote.
 * reservadosPaquete ?? lote.reservados` cubre un lote "paquete" PURO escrito antes de esta tarea
 * (sin el campo nuevo, pero donde `reservados` ya era, por definicion, 100% Paquete).
 */
export async function contarReservadosPaqueteVigentes(uid: string, ahora: Date): Promise<number> {
  const snap = await db().collection("lotes").where("uid", "==", uid).get();
  let total = 0;
  for (const doc of snap.docs) {
    const lote = doc.data() as Lote;
    const esFuentePaquete = lote.planEfectivo === "paquete" || lote.planEfectivo === "mixto";
    if (esFuentePaquete && lote.expira.toMillis() > ahora.getTime()) {
      total += lote.reservadosPaquete ?? lote.reservados ?? 0;
    }
  }
  return total;
}

/** Mismo patron que `contarReservadosPaqueteVigentes`, para el saldo Por Uso (Tarea 16A-1):
 * recalcula `reservadosPorUso` sumando `reservadosPorUso` de TODOS los lotes NO expirados de
 * `uid` que consumen de esta fuente ("porUso" o "mixto"). El saldo Por Uso nunca vence, pero el
 * LOTE si (`lote.expira`): una reserva de un lote expirado ya no cuenta. */
export async function contarReservadosPorUsoVigentes(uid: string, ahora: Date): Promise<number> {
  const snap = await db().collection("lotes").where("uid", "==", uid).get();
  let total = 0;
  for (const doc of snap.docs) {
    const lote = doc.data() as Lote;
    const esFuentePorUso = lote.planEfectivo === "porUso" || lote.planEfectivo === "mixto";
    if (esFuentePorUso && lote.expira.toMillis() > ahora.getTime()) {
      total += lote.reservadosPorUso ?? 0;
    }
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
// Tarea 16A-1 (decision del Brain 2026-10-06): "porUso" y "mixto" son caminos NUEVOS que se
// agregan al lado del de "paquete" existente.
//
// B2 (corrige NO-GO 2026-10-07): el camino `lote.planEfectivo === "paquete"` ya NO rechaza de
// inmediato si el Paquete vencio o se agoto A MITAD del lote (decidirLote decidio, al CREAR el
// lote, que el Paquete alcanzaba para TODO el lote; pero puede vencer o agotarse ENTRE reservas de
// un mismo lote largo — otro lote del mismo usuario consumiendo en paralelo, o el vencimiento
// llegando a mitad del envio) — cae al saldo Por Uso si lo hay, exactamente igual que ya hacia un
// lote "mixto". Por eso `fuenteDelLote` (mas abajo) ya no puede inferir la fuente solo del
// `planEfectivo` ESTATICO del lote para "paquete": decide por los contadores REALES del lote.
export async function reservarEnvioTx(
  tx: TransaccionLike,
  loteRef: any,
  cuentaRef: any,
  uid: string,
  recalcularReservadosPaquete?: (uid: string, ahora: Date) => Promise<number>,
  recalcularReservadosPorUso?: (uid: string, ahora: Date) => Promise<number>
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

  // Gratis nunca toca la cuenta (R3-1): ni lectura, ni descuento.
  if (lote.planEfectivo === "gratis") {
    tx.update(loteRef, { reservados: lote.reservados + 1 });
    return { ok: true, lote };
  }

  // Unica lectura de la cuenta (todas las variantes de abajo la necesitan): sigue siendo una
  // lectura, todavia no se ejecuto ningun tx.update/tx.set en esta transaccion.
  const cuentaSnap = await tx.get(cuentaRef);
  const cuenta = cuentaSnap.exists ? (cuentaSnap.data() as Cuenta) : null;

  if (lote.planEfectivo === "paquete") {
    // D5/B23: un Paquete VENCIDO (o agotado) no reserva del Paquete — pero, a diferencia de antes
    // (B2, corrige NO-GO 2026-10-07), eso ya no rechaza el envio de inmediato: cae al saldo Por
    // Uso si lo hay, igual que un lote "mixto" ya hacia. Mismo orden/criterio exacto que el bloque
    // "mixto" de abajo (Paquete primero mientras le quede, Por Uso despues).
    const paqueteVigente = !!cuenta && cuenta.vence !== null && cuenta.vence.toMillis() > Date.now();
    let reservadosPaquete = cuenta?.reservadosPaquete ?? 0;
    let disponiblePaquete = 0;
    if (paqueteVigente && cuenta) {
      if (cuenta.enviosRestantes <= reservadosPaquete && recalcularReservadosPaquete) {
        // D4/M26: el contador de la cuenta dice que no hay saldo; antes de rechazar, se recalcula
        // el numero REAL sumando los lotes Paquete no expirados del usuario (fuera de esta
        // transaccion) y se vuelve a evaluar con ese numero.
        reservadosPaquete = await recalcularReservadosPaquete(uid, new Date());
      }
      disponiblePaquete = Math.max(0, cuenta.enviosRestantes - reservadosPaquete);
    }

    if (disponiblePaquete > 0) {
      tx.update(loteRef, { reservados: lote.reservados + 1, reservadosPaquete: (lote.reservadosPaquete ?? 0) + 1 });
      // Se guarda `reservadosPaquete + 1`: si hubo recalculo (D4/M26), esta escritura tambien
      // corrige el contador desincronizado de la cuenta, no solo desbloquea esta reserva.
      tx.update(cuentaRef, { reservadosPaquete: reservadosPaquete + 1 });
      return { ok: true, lote };
    }

    let reservadosPorUso = cuenta?.reservadosPorUso ?? 0;
    const saldoPorUso = cuenta?.saldoPorUso ?? 0;
    if (saldoPorUso <= reservadosPorUso && recalcularReservadosPorUso) {
      reservadosPorUso = await recalcularReservadosPorUso(uid, new Date());
    }
    if (saldoPorUso <= reservadosPorUso) {
      // Ni el Paquete ni Por Uso alcanzan: mismo mensaje especifico que antes segun el motivo
      // (vencimiento vs saldo agotado), para no romper los textos que M19/M23/M26/D5/B23 ya fijan.
      return {
        ok: false,
        error: paqueteVigente
          ? "Tu Paquete ya no tiene saldo disponible para este envio."
          : "Tu Paquete ya vencio. Renueva para seguir enviando.",
      };
    }

    tx.update(loteRef, { reservados: lote.reservados + 1, reservadosPorUso: (lote.reservadosPorUso ?? 0) + 1 });
    tx.update(cuentaRef, { reservadosPorUso: reservadosPorUso + 1 });
    return { ok: true, lote };
  }

  if (lote.planEfectivo === "porUso") {
    const saldo = cuenta?.saldoPorUso ?? 0;
    let reservadosPorUso = cuenta?.reservadosPorUso ?? 0;
    if (saldo <= reservadosPorUso && recalcularReservadosPorUso) {
      reservadosPorUso = await recalcularReservadosPorUso(uid, new Date());
    }
    if (saldo <= reservadosPorUso) {
      return { ok: false, error: "No tienes saldo Por Uso disponible para este envio." };
    }

    tx.update(loteRef, { reservados: lote.reservados + 1, reservadosPorUso: (lote.reservadosPorUso ?? 0) + 1 });
    tx.update(cuentaRef, { reservadosPorUso: reservadosPorUso + 1 });
    return { ok: true, lote };
  }

  // "mixto" (Tarea 16A-1): primero el Paquete mientras le quede (vigente y con disponible real),
  // luego el saldo Por Uso. Un Paquete vencido o agotado en un lote MIXTO nunca es un error (a
  // diferencia del lote puramente "paquete" de arriba): simplemente no aporta, y porUso cubre el
  // envio — `decidirLote` ya garantizo, al crear el lote, que entre las dos fuentes hay cupo.
  const paqueteVigente = !!cuenta && cuenta.vence !== null && cuenta.vence.toMillis() > Date.now();
  let reservadosPaquete = cuenta?.reservadosPaquete ?? 0;
  let disponiblePaquete = 0;
  if (paqueteVigente && cuenta) {
    if (cuenta.enviosRestantes <= reservadosPaquete && recalcularReservadosPaquete) {
      reservadosPaquete = await recalcularReservadosPaquete(uid, new Date());
    }
    disponiblePaquete = Math.max(0, cuenta.enviosRestantes - reservadosPaquete);
  }

  if (disponiblePaquete > 0) {
    tx.update(loteRef, { reservados: lote.reservados + 1, reservadosPaquete: (lote.reservadosPaquete ?? 0) + 1 });
    tx.update(cuentaRef, { reservadosPaquete: reservadosPaquete + 1 });
    return { ok: true, lote };
  }

  let reservadosPorUso = cuenta?.reservadosPorUso ?? 0;
  const saldoPorUso = cuenta?.saldoPorUso ?? 0;
  if (saldoPorUso <= reservadosPorUso && recalcularReservadosPorUso) {
    reservadosPorUso = await recalcularReservadosPorUso(uid, new Date());
  }
  if (saldoPorUso <= reservadosPorUso) {
    return { ok: false, error: "No tienes saldo disponible para este envio." };
  }

  tx.update(loteRef, { reservados: lote.reservados + 1, reservadosPorUso: (lote.reservadosPorUso ?? 0) + 1 });
  tx.update(cuentaRef, { reservadosPorUso: reservadosPorUso + 1 });
  return { ok: true, lote };
}

/** Envoltorio real: abre la transaccion de Firestore y le pasa las referencias reales, con el
 * recalculo real (D4) por si el contador de la cuenta esta desincronizado — para las dos fuentes
 * (Tarea 16A-1). */
export async function reservarEnvio(
  loteId: string,
  uid: string
): Promise<{ ok: true; lote: Lote } | { ok: false; error: string }> {
  const loteRef = db().collection("lotes").doc(loteId);
  const cuentaRef = db().collection("cuentas").doc(uid);
  return db().runTransaction((tx) =>
    reservarEnvioTx(tx, loteRef, cuentaRef, uid, contarReservadosPaqueteVigentes, contarReservadosPorUsoVigentes)
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
// Tarea 16A-1: `reservarEnvioTx` solo cuenta CUPOS por fuente, nunca amarra un envio individual a
// la reserva que lo cubrio — asi que, para un lote "mixto", confirmar/liberar UN envio no sabe de
// cual de las dos fuentes era ESE envio en particular. Se resuelve igual que una bolsa comun:
// se confirma/libera contra la fuente que el LOTE todavia tenga pendiente, Paquete primero
// (`fuenteDelLote`) — la MISMA prioridad que usa `reservarEnvioTx` al reservar. Da igual que envio
// exacto se confirme primero: al final de las `reservados` confirmaciones/liberaciones del lote,
// el reparto por fuente que queda vivo es exactamente el que corresponde.
//
// B2 (corrige NO-GO 2026-10-07): un lote "paquete" PURO ya puede, igual que uno "mixto", haber
// caido parcialmente al saldo Por Uso si el Paquete se agoto o vencio A MITAD del lote (ver
// `reservarEnvioTx`) — por eso ya NO basta con el `planEfectivo` ESTATICO del lote (fijado una
// sola vez en `crearLote`) para decidir la fuente de "paquete": se decide SIEMPRE por los
// contadores REALES del lote, igual que ya hacia "mixto". "porUso" PURO si sigue siendo siempre
// "porUso": `reservarEnvioTx` nunca reserva Paquete para un lote de ese tipo.
function fuenteDelLote(lote: Lote, planEfectivo: PlanEfectivo): "paquete" | "porUso" | null {
  if (planEfectivo === "gratis") return null; // nunca toca la cuenta.
  if (planEfectivo === "porUso") return "porUso";
  return (lote.reservadosPaquete ?? 0) > 0 ? "paquete" : "porUso"; // "paquete" o "mixto".
}

export async function confirmarEnvioExitosoTx(
  tx: TransaccionLike,
  loteRef: any,
  cuentaRef: any,
  planEfectivo: PlanEfectivo
): Promise<void> {
  const loteSnap = await tx.get(loteRef);
  const cuentaSnap = planEfectivo === "gratis" ? null : await tx.get(cuentaRef); // lectura, no escritura.

  if (!loteSnap.exists) return; // el lote desaparecio entre la reserva y el envio: nada que confirmar.
  const lote = loteSnap.data() as Lote;
  const fuente = fuenteDelLote(lote, planEfectivo);

  tx.update(loteRef, {
    enviados: lote.enviados + 1,
    reservados: Math.max(0, lote.reservados - 1),
    ...(fuente === "paquete" ? { reservadosPaquete: Math.max(0, (lote.reservadosPaquete ?? 0) - 1) } : {}),
    ...(fuente === "porUso" ? { reservadosPorUso: Math.max(0, (lote.reservadosPorUso ?? 0) - 1) } : {}),
  });

  if (fuente && cuentaSnap && cuentaSnap.exists) {
    const cuenta = cuentaSnap.data() as Cuenta;
    if (fuente === "paquete") {
      // M23: la reserva se CONSUME (sale de `reservadosPaquete` ademas de bajar el saldo), para
      // que otro lote del mismo usuario pueda volver a reservar ese cupo si queda saldo.
      tx.update(cuentaRef, {
        enviosRestantes: Math.max(0, cuenta.enviosRestantes - 1),
        reservadosPaquete: Math.max(0, (cuenta.reservadosPaquete ?? 0) - 1),
      });
    } else {
      tx.update(cuentaRef, {
        saldoPorUso: Math.max(0, (cuenta.saldoPorUso ?? 0) - 1),
        reservadosPorUso: Math.max(0, (cuenta.reservadosPorUso ?? 0) - 1),
      });
    }
  }
}

/** Envoltorio real: abre la transaccion de Firestore y le pasa las referencias reales. */
export async function confirmarEnvioExitoso(loteId: string, uid: string, planEfectivo: PlanEfectivo): Promise<void> {
  const loteRef = db().collection("lotes").doc(loteId);
  const cuentaRef = db().collection("cuentas").doc(uid);
  await db().runTransaction((tx) => confirmarEnvioExitosoTx(tx, loteRef, cuentaRef, planEfectivo));
}

/**
 * Cuerpo transaccional de la liberacion: cuando Gmail FALLO (nunca se envio de verdad), resta 1
 * de `reservados` sin tocar `enviados` ni el saldo, para que ese envio fallido no deje el cupo
 * bloqueado hasta que el lote expire. Si el lote consumia del Paquete o del saldo Por Uso,
 * tambien libera el cupo reservado a nivel de cuenta (M23/Tarea 16A-1), para que otro lote del
 * mismo usuario pueda usarlo. A diferencia de `confirmarEnvioExitosoTx`, lee el `planEfectivo`
 * del propio lote (nunca lo recibe de quien llama) — `fuenteDelLote` resuelve "mixto" igual en
 * los dos casos.
 */
export async function liberarReservaTx(tx: TransaccionLike, loteRef: any, cuentaRef: any): Promise<void> {
  const loteSnap = await tx.get(loteRef);
  if (!loteSnap.exists) return;
  const lote = loteSnap.data() as Lote;
  const fuente = fuenteDelLote(lote, lote.planEfectivo);
  const cuentaSnap = fuente ? await tx.get(cuentaRef) : null; // lectura, no escritura.

  tx.update(loteRef, {
    reservados: Math.max(0, lote.reservados - 1),
    ...(fuente === "paquete" ? { reservadosPaquete: Math.max(0, (lote.reservadosPaquete ?? 0) - 1) } : {}),
    ...(fuente === "porUso" ? { reservadosPorUso: Math.max(0, (lote.reservadosPorUso ?? 0) - 1) } : {}),
  });
  if (fuente && cuentaSnap && cuentaSnap.exists) {
    const cuenta = cuentaSnap.data() as Cuenta;
    if (fuente === "paquete") {
      tx.update(cuentaRef, { reservadosPaquete: Math.max(0, (cuenta.reservadosPaquete ?? 0) - 1) });
    } else {
      tx.update(cuentaRef, { reservadosPorUso: Math.max(0, (cuenta.reservadosPorUso ?? 0) - 1) });
    }
  }
}

/** Envoltorio real: abre la transaccion de Firestore y le pasa las referencias reales. */
export async function liberarReserva(loteId: string, uid: string): Promise<void> {
  const loteRef = db().collection("lotes").doc(loteId);
  const cuentaRef = db().collection("cuentas").doc(uid);
  await db().runTransaction((tx) => liberarReservaTx(tx, loteRef, cuentaRef));
}

// ── 409 de recompra de Paquete (Tarea 15, requisito B.2, decision del Brain 2026-10-06) ────────
// Decision explicita: NO se permite comprar un Paquete nuevo mientras el actual siga vigente y
// tenga saldo > 0 (antes, docs/legal/terminos-y-condiciones.md §4.5 y textos-checkout.md T6-bis
// describian que la compra nueva "reemplaza" al Paquete vigente; esos textos se actualizaron en
// la misma tarea para dejar de contradecir este bloqueo). Mismo criterio de vigencia que
// `decidirLote` (arriba): `vence` en el futuro, nunca null.
export function tienePaqueteVigenteConSaldo(cuenta: Cuenta, ahora: Date): boolean {
  const vigente = cuenta.vence !== null && cuenta.vence.toMillis() > ahora.getTime();
  return cuenta.plan === "paquete" && vigente && cuenta.enviosRestantes > 0;
}

// ── Autorizacion de tratamiento de datos, Ley 1581 (Tarea 15, requisito B.3; GRAVE 1, correccion
// vuelta 31, 2026-10-06) ─────────────────────────────────────────────────────────────────────────
// Casilla de autorizacion explicita ANTES del primer uso (texto canonico T11 de
// docs/legal/textos-checkout.md v1.3): nunca se infiere ni se asume con el solo login de Google.
//
// GRAVE 1 (NO-GO del REVISOR_EXTERNO_LAP, vuelta 31): esto vivia como un campo
// `cuentas/{uid}.autorizacionDatos` (merge). `activarPaqueteSiNoProcesadoTx` (abajo) y
// `revertirPagoSiNoRevertidoTx` hacen `tx.set(cuentaRef, {...})` SIN merge — eso REEMPLAZA el
// documento completo y borraba la autorizacion de cualquier usuario que activara o revirtiera un
// Paquete despues de autorizar. Arreglo del Brain: la autorizacion se mueve a su PROPIA coleccion
// (`autorizaciones/{uid}`, deny-all en firestore.rules, igual patron que `cuentas`/
// `pagosProcesados`), totalmente desacoplada de `cuentas/{uid}` — ningun `tx.set` de la cuenta
// puede volver a tocarla, sea completo o con merge.
//
// `autorizado` = la version guardada coincide con la version VIGENTE de la Politica de
// Privacidad (comprobado por quien llama, p. ej. `server.ts` contra `AUTORIZACION_DATOS_VERSION`):
// si la politica cambia de version, se vuelve a pedir, aunque exista una autorizacion vieja.
export interface AutorizacionDatos {
  version: string;
  fecha: Timestamp;
  idioma: Idioma;
  /** Texto LITERAL que el usuario vio y acepto (T11, en su idioma) — requisito de prueba de
   * aceptacion (MENORES, 2026-10-06): si alguna vez cambia el texto sin cambiar la version, sigue
   * quedando registrado que se vio EXACTAMENTE esto. */
  texto: string;
}

/** Una entrada vieja de `historial` (misma forma que `AutorizacionDatos`, nombrada aparte para
 * dejar claro que es un registro PASADO, no el vigente). */
export type AutorizacionHistorialEntrada = AutorizacionDatos;

export interface AutorizacionGuardada extends AutorizacionDatos {
  /** Autorizaciones ANTERIORES de este usuario (p. ej. si la Politica cambio de version y se le
   * volvio a pedir) — nunca se borran, solo se archivan aqui al guardar una nueva. */
  historial: AutorizacionHistorialEntrada[];
}

/** Guarda la autorizacion de tratamiento de datos del usuario para la version vigente de la
 * Politica de Privacidad, con el idioma y el texto EXACTO que vio y acepto. Si ya existia una
 * autorizacion previa (p. ej. de una version anterior de la Politica), la archiva en `historial`
 * antes de reemplazarla — nunca se pierde el registro de que se autorizo en su momento. */
export async function guardarAutorizacionDatos(
  uid: string,
  version: string,
  idioma: Idioma,
  texto: string
): Promise<void> {
  const ref = db().collection("autorizaciones").doc(uid);
  const snap = await ref.get();
  const actual = snap.exists ? (snap.data() as AutorizacionGuardada) : null;
  const historial: AutorizacionHistorialEntrada[] = actual
    ? [
        ...(actual.historial ?? []),
        { version: actual.version, fecha: actual.fecha, idioma: actual.idioma, texto: actual.texto },
      ]
    : [];
  const nueva: AutorizacionGuardada = { version, fecha: Timestamp.now(), idioma, texto, historial };
  await ref.set(nueva);
}

/** Devuelve la autorizacion de datos guardada del usuario (version/fecha/idioma/texto VIGENTES,
 * sin el historial), o `null` si nunca la dio. Quien llama decide si la `version` devuelta
 * coincide con la vigente (B.3: `autorizado = version === POLITICA_VERSION_VIGENTE`). */
export async function obtenerAutorizacionDatos(uid: string): Promise<AutorizacionDatos | null> {
  const snap = await db().collection("autorizaciones").doc(uid).get();
  if (!snap.exists) return null;
  const datos = snap.data() as AutorizacionGuardada;
  return { version: datos.version, fecha: datos.fecha, idioma: datos.idioma, texto: datos.texto };
}

/** Decision de `POST /api/lote/iniciar` sobre la autorizacion de datos (correccion vuelta 33,
 * 2026-10-06): antes vivia como un `if` suelto dentro de la ruta de `server.ts`. Se extrae aqui
 * como funcion PURA (sin Firestore, recibe la autorizacion YA leida) para poder probar el
 * contrato exacto (403 + `motivo:"autorizacion"` cuando falta o la version no es la vigente) y
 * para que `server.ts` tenga un unico punto de llamada en vez de reimplementar la comparacion. */
export function decidirAutorizacionLote(
  autorizacion: AutorizacionDatos | null,
  versionVigente: string
): { ok: true } | { ok: false; httpStatus: 403; error: string; motivo: "autorizacion" } {
  if (!autorizacion || autorizacion.version !== versionVigente) {
    return {
      ok: false,
      httpStatus: 403,
      error: "Debes autorizar el tratamiento de tus datos personales antes de enviar.",
      motivo: "autorizacion",
    };
  }
  return { ok: true };
}

// ── Aceptacion de Terminos y Condiciones ANTES del primer uso (O2, Dictamen Abogado_LAP ronda 5,
// 2026-10-06, Alto) ──────────────────────────────────────────────────────────────────────────────
// La UNICA casilla de Terminos que existia vivia en el checkout del Paquete (`aceptaciones/{id}`,
// T4/T5 de textos-checkout.md): un usuario del plan Gratis nunca la ve, asi que nunca acepta la
// secc. 12 (responsable de los datos de sus destinatarios) ni la secc. 13.3 (revision obligatoria
// antes de enviar) de los Terminos. Mismo patron que `autorizaciones/{uid}` (coleccion PROPIA,
// deny-all en firestore.rules, separada de `cuentas/{uid}` para que un `tx.set` sin merge de la
// activacion/reversion de un Paquete nunca la borre): `aceptacionesUso/{uid}`.
export interface AceptacionUso {
  version: string;
  fecha: Timestamp;
  idioma: Idioma;
  /** Texto LITERAL que el usuario vio y acepto (shared/textosCasillas.ts, `textoAceptacionTerminosUso`). */
  texto: string;
}

export type AceptacionUsoHistorialEntrada = AceptacionUso;

export interface AceptacionUsoGuardada extends AceptacionUso {
  /** Aceptaciones ANTERIORES (p. ej. si los Terminos cambiaron de version y se volvio a pedir) —
   * nunca se borran, se archivan aqui, igual que `AutorizacionGuardada.historial`. */
  historial: AceptacionUsoHistorialEntrada[];
}

/** Guarda la aceptacion de Terminos y Condiciones del usuario para la version vigente, con el
 * idioma y el texto EXACTO que vio y acepto. Si ya existia una aceptacion previa (de una version
 * anterior de los Terminos), la archiva en `historial` antes de reemplazarla. */
export async function guardarAceptacionUso(uid: string, version: string, idioma: Idioma, texto: string): Promise<void> {
  const ref = db().collection("aceptacionesUso").doc(uid);
  const snap = await ref.get();
  const actual = snap.exists ? (snap.data() as AceptacionUsoGuardada) : null;
  const historial: AceptacionUsoHistorialEntrada[] = actual
    ? [...(actual.historial ?? []), { version: actual.version, fecha: actual.fecha, idioma: actual.idioma, texto: actual.texto }]
    : [];
  const nueva: AceptacionUsoGuardada = { version, fecha: Timestamp.now(), idioma, texto, historial };
  await ref.set(nueva);
}

/** Devuelve la aceptacion de Terminos guardada del usuario (version/fecha/idioma/texto VIGENTES,
 * sin el historial), o `null` si nunca la dio. Quien llama decide si la `version` devuelta
 * coincide con la vigente (`TERMINOS_VERSION`). */
export async function obtenerAceptacionUso(uid: string): Promise<AceptacionUso | null> {
  const snap = await db().collection("aceptacionesUso").doc(uid).get();
  if (!snap.exists) return null;
  const datos = snap.data() as AceptacionUsoGuardada;
  return { version: datos.version, fecha: datos.fecha, idioma: datos.idioma, texto: datos.texto };
}

/** Decision de `POST /api/lote/iniciar` sobre la aceptacion de Terminos y Condiciones (O2):
 * mismo contrato que `decidirAutorizacionLote` (403 + `motivo` dedicado cuando falta o la version
 * no es la vigente), con `motivo: "terminos"` para que el cliente reabra el modal correcto (en vez
 * de reabrir, por error, el de autorizacion de datos). Funcion PURA: no toca Firestore. */
export function decidirAceptacionUso(
  aceptacion: AceptacionUso | null,
  versionVigente: string
): { ok: true } | { ok: false; httpStatus: 403; error: string; motivo: "terminos" } {
  if (!aceptacion || aceptacion.version !== versionVigente) {
    return {
      ok: false,
      httpStatus: 403,
      error: "Debes aceptar los Términos y Condiciones antes de enviar.",
      motivo: "terminos",
    };
  }
  return { ok: true };
}

const MARCADOR_PROVEEDOR_PENDIENTE = "[PENDIENTE]";

/** Medio 2 (correccion vuelta 33, 2026-10-06): decision de `POST /api/autorizacion-datos` sobre
 * el nombre del proveedor. Dos defensas en una: (1) sin `PROVEEDOR_NOMBRE` real configurado en el
 * servidor (vacio o todavia `"[PENDIENTE]"`), nunca se guarda una autorizacion cuyo texto cite un
 * marcador interno — 503, falla cerrado, igual criterio que `huellaConfigurada`/GRAVE 2. (2) el
 * nombre que el CLIENTE mostro (`VITE_PROVEEDOR_NOMBRE`, interpolado en el texto T11 que el
 * usuario de verdad vio y acepto) debe coincidir EXACTO con el que el servidor va a escribir en
 * el registro (`PROVEEDOR_NOMBRE`, variable de entorno de Cloud Run) — si no coincide (build
 * viejo en cache del navegador, o las dos variables de entorno desincronizadas entre el bundle
 * del cliente y el runtime del servidor), lo que el usuario aceptó no es exactamente lo que el
 * servidor registraría: 409, nunca se guarda silenciosamente un texto distinto del aceptado.
 * PURA: no lee `process.env` ni el body de la peticion, solo compara los dos valores que le
 * pasan. */
export function decidirRegistroAutorizacion(
  nombreMostrado: unknown,
  proveedorNombre: string
): { ok: true } | { ok: false; httpStatus: 503 | 409; error: string } {
  const nombreServidor = proveedorNombre.trim();
  if (!nombreServidor || nombreServidor === MARCADOR_PROVEEDOR_PENDIENTE) {
    return { ok: false, httpStatus: 503, error: "Configuración incompleta. Intenta más tarde." };
  }
  const nombreCliente = typeof nombreMostrado === "string" ? nombreMostrado.trim() : "";
  if (nombreCliente !== nombreServidor) {
    return {
      ok: false,
      httpStatus: 409,
      error: "El texto que aceptaste no coincide con el vigente. Recarga la página e inténtalo de nuevo.",
    };
  }
  return { ok: true };
}

// ── Registro de confirmacion HMAC de un lote (Tarea 15, requisito A.3) ──────────────────────────
// docs/legal/terminos-y-condiciones.md §13.3(c) y §12.4 exigen una huella HMAC-SHA256 por cada
// par pagina-fila-correo confirmado en un lote, SIN guardar la lista ni los correos en claro.
// Las huellas mismas se calculan en server/huellaLote.ts (modulo puro, sin Firestore); esta
// funcion solo las guarda en el MISMO doc `lotes/{loteId}` que ya crea `crearLote` (merge, nunca
// pisa `enviados`/`reservados`/etc.).
export async function guardarConfirmacionLote(
  loteId: string,
  numPares: number,
  huellas: string[],
  ahora: Timestamp
): Promise<void> {
  await db()
    .collection("lotes")
    .doc(loteId)
    .set({ confirmacion: { fecha: ahora, numPares, huellas } }, { merge: true });
}

/**
 * Medio 3 (correccion vuelta 31, 2026-10-06): lee `lotes/{loteId}.confirmacion.huellas` — las
 * huellas que `/api/lote/iniciar` guardo al crear el lote (arriba). `/api/send-email` las usa
 * para comprobar que el par pagina-fila-correo que esta a punto de enviar es EXACTAMENTE uno de
 * los que se confirmaron al iniciar el lote (rechaza con 409 si no lo es): la huella prueba lo
 * que de verdad se envia, no solo lo que se autorizo a enviar en general. `null` si el lote no
 * existe o no tiene confirmacion guardada (nunca debería pasar desde GRAVE 2: todo lote nuevo
 * exige HUELLA_LOTE_SECRET configurado y pares completos antes de crearse).
 */
export async function obtenerHuellasLote(loteId: string): Promise<string[] | null> {
  const snap = await db().collection("lotes").doc(loteId).get();
  if (!snap.exists) return null;
  const datos = snap.data() as Lote & { confirmacion?: { huellas: string[] } };
  return datos.confirmacion?.huellas ?? null;
}
