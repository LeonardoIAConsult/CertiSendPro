// Modulo de cuentas y pagos (Tarea 2, 2026-10-05).
// Guarda por usuario su plan, saldo de envios, vencimiento y suscripcion; y un registro de
// pagos ya procesados para no contarlos dos veces. Solo el servidor escribe aqui: el navegador
// nunca toca estas colecciones directamente (ver firestore.rules).
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { obtenerFirebaseApp } from "./firebaseAdmin";

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
  actualizado: Timestamp;
}

const CUENTA_GRATIS_BASE: Omit<Cuenta, "actualizado"> = {
  plan: "gratis",
  enviosRestantes: 0,
  vence: null,
  renueva: false,
  mpSuscripcionId: null,
  reservadosPaquete: 0,
};

// NOTA para la Tarea 6 (webhook de Mercado Pago, pendiente de implementar): al activar un plan
// "pro", el webhook DEBE escribir `vence` en la MISMA escritura (mismo tx.update/tx.set) que
// `plan: "pro"`. `decidirLote` solo trata "pro" como vigente si `vence` queda en el futuro
// (ver `vigente` abajo): un `plan: "pro"` escrito sin `vence`, o con `vence` actualizado en un
// paso aparte, deja una ventana donde la cuenta ya cobrada se trata como Gratis, o donde una
// falla a mitad de camino deja "pro" con una fecha de vencimiento vieja o inexistente.

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
