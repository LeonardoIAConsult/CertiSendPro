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
  textoAutorizacionDatos,
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
export { TERMINOS_VERSION, normalizarIdioma, textoCasillaRetracto, textoCasillaTerminos, textoAutorizacionDatos, TEXTO_CASILLA_RETRACTO, TEXTO_CASILLA_RETRACTO_EN };
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
 * este archivo). `elegibleParaReintentoAcuse` (mas abajo) excluye estos pagos del reintento
 * automatico del acuse de compra: nunca se activaron, no hay nada que confirmarle al comprador.
 *
 * Devuelve "repetido" sin tocar la cuenta si `paymentId` ya estaba marcado como procesado (esto
 * cubre tambien una segunda entrega del MISMO pago que ya se marco "requiere_reembolso": el
 * aviso a Leonardo solo se manda la primera vez).
 */
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
  }
): Promise<"activado" | "repetido" | "requiere_reembolso"> {
  const pagoSnap = await tx.get(pagoRef);
  if (pagoSnap.exists) return "repetido";

  const cuentaSnap = await tx.get(cuentaRef); // lectura, no escritura: todavia no se hizo ningun tx.set/tx.update.
  const cuentaActual = cuentaSnap.exists ? (cuentaSnap.data() as Cuenta) : null;
  const vigentePorOtroPago =
    cuentaActual !== null &&
    cuentaActual.plan === "paquete" &&
    cuentaActual.enviosRestantes > 0 &&
    cuentaActual.vence !== null &&
    cuentaActual.vence.toMillis() > Date.now() &&
    cuentaActual.ultimoPago !== null &&
    cuentaActual.ultimoPago.id !== datos.paymentId;

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
    ultimoPago: { id: datos.paymentId, cop: datos.cop, trm: datos.trm, fecha: datos.fecha },
    actualizado: Timestamp.now(),
  });
  return "activado";
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
    activarPaqueteSiNoProcesadoTx(tx, pagoRef, cuentaRef, { paymentId, uid, ...datos })
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
export type DestinatarioCorreo = "comprador" | "leonardo" | "bloqueoProveedor" | "acuse20h";

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

/** Marca `<campo>="enviado"` tras enviar (con exito) el correo de ESE destinatario. Limpia tambien
 * `<campo>ReclamadoEn` (M37): un correo ya enviado no necesita recordar cuando se reclamo. */
export async function marcarCorreoEnviado(paymentId: string, destinatario: DestinatarioCorreo): Promise<void> {
  await db()
    .collection("pagosProcesados")
    .doc(String(paymentId))
    .update({ [campoCorreoDestinatario(destinatario)]: "enviado", [campoReclamadoEnDestinatario(destinatario)]: null });
}

/** Libera el reclamo (vuelve `<campo>` a `null`) cuando el envio a ESE destinatario fallo, para
 * que una entrega futura pueda reintentar SOLO ese destinatario sin reenviar al otro. Limpia
 * tambien `<campo>ReclamadoEn` (M37). */
export async function liberarReclamoCorreo(paymentId: string, destinatario: DestinatarioCorreo): Promise<void> {
  await db()
    .collection("pagosProcesados")
    .doc(String(paymentId))
    .update({ [campoCorreoDestinatario(destinatario)]: null, [campoReclamadoEnDestinatario(destinatario)]: null });
}

// ── M37: lectura/consulta de pagosProcesados para el reintento del acuse SIN Cloud Scheduler ────
// Sin la API de Cloud Scheduler habilitada en este proyecto, la unica forma de recuperar un acuse
// de compra que quedo sin enviar es que algo que YA se ejecuta por otra razon lo revise de paso:
// (1) el propio comprador consultando GET /api/cuenta justo despues de pagar (server.ts), y (2)
// cada aviso que llega al webhook de Mercado Pago (server.ts). Las dos rutas usan las funciones de
// abajo para encontrar candidatos; la decision de "cuales SI reintentar" es PURA
// (`seleccionarPagosParaBarrido`) para poder probarla con node:test sin Firestore real.
//
// Deliberado: nunca se consulta Firestore con `where("correoComprador", "!=", "enviado")` — esa
// clase de filtro EXCLUYE los documentos donde el campo es `null`/esta ausente (el caso mas comun:
// un pago cuyo primer intento de correo nunca se reclamo), asi que ni siquiera verificaria lo que
// se necesita. En su lugar, se consulta por un campo de IGUALDAD simple (`uid`, o ningun filtro
// mas que el orden) y se filtra en memoria.

export interface PagoProcesadoAcuse {
  paymentId: string;
  uid: string | null;
  referenciaId: string | null;
  cop: number;
  trm: number;
  fechaTrm: string | null;
  /** Fecha del PAGO (nunca de cuando se proceso el aviso). */
  fecha: Timestamp;
  /** Fecha de vencimiento del Paquete que activo este pago (= `cuenta.vence` en el momento de la
   * activacion — puede diferir del `vence` ACTUAL de la cuenta si hubo una compra posterior). */
  vence: Timestamp;
  /** "enviado" | "reclamado" | null. */
  correoComprador: string | null;
  /** G3 (correccion NO-GO vuelta 30): true si Mercado Pago reembolso/contracargo este pago
   * (`revertirPagoSiNoRevertidoTx` ya lo marco). Un pago revertido nunca debe reintentar su acuse
   * de compra — el comprador ya no tiene nada que confirmar. */
  revertido: boolean;
}

function pagoProcesadoAcuseDesdeDoc(id: string, data: Record<string, any>): PagoProcesadoAcuse {
  return {
    paymentId: id,
    uid: data.uid ?? null,
    referenciaId: data.referenciaId ?? null,
    cop: data.cop,
    trm: data.trm,
    fechaTrm: data.fechaTrm ?? null,
    fecha: data.fecha,
    vence: data.vence,
    correoComprador: data.correoComprador ?? null,
    revertido: data.revertido === true,
  };
}

/** Lee `pagosProcesados/{paymentId}.correoComprador` tal cual ("enviado" | "reclamado" | null) —
 * usada por `reintentarAcusePendiente` (server/notificaciones.ts) para decidir, DESPUES de
 * reintentar, si el acuse sigue sin salir (y por tanto si hay que escalar a Leonardo tras 20h). */
export async function obtenerEstadoCorreoComprador(paymentId: string): Promise<string | null> {
  const snap = await db().collection("pagosProcesados").doc(String(paymentId)).get();
  return snap.exists ? (snap.data()?.correoComprador ?? null) : null;
}

// ── Tope de intentos con espera creciente (M2, correccion NO-GO vuelta 30, 2026-10-05) ──────────
// Antes, nada limitaba cuantas veces se podia reintentar el acuse de un mismo pago: cada disparo
// (GET /api/cuenta, el barrido del webhook, o el barrido completo de G2) lo volvia a intentar sin
// ninguna espera entre intentos ni un techo. Ahora `pagosProcesados/{id}` guarda `intentosAcuse`
// (cuantas veces se intento) y `ultimoIntentoAcuseEn` (Timestamp DEL SERVIDOR del ultimo intento);
// la espera antes del siguiente intento crece exponencialmente (2^intentosAcuse minutos: 2, 4, 8,
// 16... min) y al llegar a `MAX_INTENTOS_ACUSE` el pago se marca `estadoAcuse="agotado"` (estado
// TERMINAL, M3) y ya no se vuelve a reintentar automaticamente — se emite el log
// `ALERTA_ACUSE_ATRASADO` para que una alerta de Cloud Logging lo capture.
export const MAX_INTENTOS_ACUSE = 10;

/** Minutos (en ms) que hay que esperar desde `ultimoIntentoAcuseEn` antes del intento
 * `intentosPrevios + 1`. PURA, exportada para poder probarla sin Firestore. */
export function calcularEsperaBackoffMs(intentosPrevios: number): number {
  return Math.pow(2, intentosPrevios) * 60_000;
}

/**
 * Cuerpo transaccional de "registrar un intento mas" (M2): si `intentosAcuse` ya alcanzo
 * `MAX_INTENTOS_ACUSE`, NO cuenta un intento nuevo — marca `estadoAcuse="agotado"` (si no lo
 * estaba ya) y devuelve `agotado:true` para que quien llama (reintentarAcusePendiente) ni
 * siquiera intente enviar el correo esta vez. En caso contrario, incrementa `intentosAcuse` y
 * guarda `ultimoIntentoAcuseEn=ahora` en la MISMA escritura.
 */
export async function registrarIntentoAcuseTx(
  tx: TransaccionLike,
  pagoRef: any,
  ahora: Date
): Promise<{ intentos: number; agotado: boolean }> {
  const snap = await tx.get(pagoRef);
  const datos = snap.exists ? snap.data() : undefined;
  const intentosPrevios = datos?.intentosAcuse ?? 0;

  if (intentosPrevios >= MAX_INTENTOS_ACUSE) {
    if (datos?.estadoAcuse !== "agotado") tx.update(pagoRef, { estadoAcuse: "agotado" });
    return { intentos: intentosPrevios, agotado: true };
  }

  const intentos = intentosPrevios + 1;
  tx.update(pagoRef, { intentosAcuse: intentos, ultimoIntentoAcuseEn: Timestamp.fromDate(ahora) });
  return { intentos, agotado: false };
}

/** Envoltorio real: abre la transaccion de Firestore y le pasa la referencia real. */
export async function registrarIntentoAcuse(
  paymentId: string,
  ahora: Date = new Date()
): Promise<{ intentos: number; agotado: boolean }> {
  const pagoRef = db().collection("pagosProcesados").doc(String(paymentId));
  return db().runTransaction((tx) => registrarIntentoAcuseTx(tx, pagoRef, ahora));
}

/**
 * Criterios de ELEGIBILIDAD compartidos por las TRES vias de reintento del acuse de compra (GET
 * /api/cuenta por uid, el barrido parcial del webhook, y el barrido COMPLETO paginado del
 * endpoint de tareas protegido, G2): nunca un pago ya revertido (G3, defensa en profundidad —
 * `reintentarAcusePendiente` en server/notificaciones.ts tambien comprueba esto por su cuenta),
 * nunca un estado TERMINAL (M3: "agotado" de M2, el aviso de bloqueo de proveedor ya enviado, o el
 * aviso de 20h ya enviado — reintentar automaticamente mas alla de esos tres puntos no aporta
 * nada, son casos que ya esperan atencion humana), y nunca mientras la espera creciente de M2
 * siga corriendo. PURA, para poder probarla con node:test sin Firestore real.
 */
export function elegibleParaReintentoAcuse(data: Record<string, any>, ahora: Date): boolean {
  if ((data.correoComprador ?? null) === "enviado") return false;
  if (data.revertido === true) return false; // G3
  if (data.requiereReembolso === true) return false; // Medio 4: nunca se activo nada, nada que confirmarle al comprador.
  if (data.estadoAcuse === "agotado") return false; // M2/M3
  if ((data.avisoBloqueoProveedor ?? null) === "enviado") return false; // M3
  if ((data.avisoAcuse20h ?? null) === "enviado") return false; // M3

  const intentosPrevios = data.intentosAcuse ?? 0;
  if (intentosPrevios > 0) {
    const ultimo = data.ultimoIntentoAcuseEn;
    const ms = ultimo && typeof ultimo.toMillis === "function" ? ultimo.toMillis() : 0;
    if (ahora.getTime() - ms < calcularEsperaBackoffMs(intentosPrevios)) return false; // M2
  }
  return true;
}

/** Candidatos de UN `uid` para reintentar el acuse (M37, path (1): GET /api/cuenta). Hasta
 * `limite` pagos de ESTE usuario elegibles (ver `elegibleParaReintentoAcuse`) — consulta por `uid`
 * (indice de un solo campo, automatico en Firestore) y filtro en memoria. Sin tope de antiguedad
 * (`antiguedadMinMs=0`): es el propio comprador consultando su cuenta, no un barrido oportunista. */
export async function listarPagosPendientesDeAcuse(uid: string, limite = 5): Promise<PagoProcesadoAcuse[]> {
  const snap = await db().collection("pagosProcesados").where("uid", "==", uid).limit(20).get();
  const candidatos = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  return seleccionarPagosParaBarrido(candidatos, new Date(), 0, limite);
}

/** PURA (M37; G3/M2/M3 unifican el criterio con `elegibleParaReintentoAcuse`): de una tanda de
 * `pagosProcesados` (id + datos crudos del documento), elige hasta `limite` candidatos elegibles
 * con `uid` guardado (sin `uid` — un pago de antes de M37 — no hay con que reconstruir el aviso) y
 * `procesadoEn` con al menos `antiguedadMinMs` de antiguedad respecto a `ahora` (no tiene sentido
 * perseguir un pago que `notificarActivacionPaquete` todavia esta procesando en SU primera
 * entrega, hace unos segundos). */
export function seleccionarPagosParaBarrido(
  candidatos: Array<{ id: string; data: Record<string, any> }>,
  ahora: Date,
  antiguedadMinMs: number,
  limite: number
): PagoProcesadoAcuse[] {
  const seleccionados: PagoProcesadoAcuse[] = [];
  for (const { id, data } of candidatos) {
    if (seleccionados.length >= limite) break;
    if (!elegibleParaReintentoAcuse(data, ahora)) continue;
    if (!data.uid) continue;
    const procesadoEn = data.procesadoEn;
    const ms = procesadoEn && typeof procesadoEn.toMillis === "function" ? procesadoEn.toMillis() : 0;
    if (ahora.getTime() - ms < antiguedadMinMs) continue;
    seleccionados.push(pagoProcesadoAcuseDesdeDoc(id, data));
  }
  return seleccionados;
}

/** Envoltorio real de `seleccionarPagosParaBarrido`: mira los `TAMANO_VENTANA_BARRIDO` pagos
 * procesados MAS RECIENTES (sin filtro de Firestore sobre `correoComprador`, ver la nota de
 * arriba) y filtra/ordena en memoria. Barato a la escala actual de CertiSend (cero clientes de
 * pago en 2026-10-05); si el volumen crece mucho, esto puede necesitar un indice compuesto por
 * `correoComprador`+`procesadoEn` — no hoy. */
const TAMANO_VENTANA_BARRIDO = 50;

export async function listarPagosParaBarridoGlobal(
  ahora: Date,
  antiguedadMinMs = 5 * 60_000,
  limite = 5
): Promise<PagoProcesadoAcuse[]> {
  const snap = await db()
    .collection("pagosProcesados")
    .orderBy("procesadoEn", "desc")
    .limit(TAMANO_VENTANA_BARRIDO)
    .get();
  const candidatos = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  return seleccionarPagosParaBarrido(candidatos, ahora, antiguedadMinMs, limite);
}

/**
 * M3 (correccion NO-GO vuelta 30, 2026-10-05): una PAGINA de `pagosProcesados`, ordenada por
 * `procesadoEn` descendente, para el barrido COMPLETO que dispara el endpoint de tareas protegido
 * (G2, `POST /api/tareas/barrido-acuses`) — a diferencia de `listarPagosParaBarridoGlobal`
 * (ventana fija de `TAMANO_VENTANA_BARRIDO` para el disparo oportunista del webhook), este recorre
 * TODOS los pendientes paginando con `startAfter`. `cursor` es el cursor de Firestore devuelto por
 * la pagina anterior (`cursorSiguiente`, el ultimo `QueryDocumentSnapshot` de esa pagina) o `null`
 * para la primera pagina — se tipa `unknown` porque quien orquesta el recorrido completo
 * (`server/tareasFondo.ts`, `barrerTodosLosPagosPendientes`) nunca necesita conocer su forma real,
 * solo reenviarlo tal cual a la siguiente llamada.
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
