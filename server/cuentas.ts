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
  actualizado: Timestamp;
}

const CUENTA_GRATIS_BASE: Omit<Cuenta, "actualizado"> = {
  plan: "gratis",
  enviosRestantes: 0,
  vence: null,
  renueva: false,
  mpSuscripcionId: null,
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

// ── Limites de lotes de envio en el servidor (Tarea 3, 2026-10-05) ──────────────────────────
// El navegador nunca decide cuanto puede enviar: pide permiso con la cantidad del lote y el
// servidor responde segun el plan. `decidirLote` es una funcion PURA (sin Firestore) para
// poder probarla con node:test; las funciones de abajo son las unicas que tocan la base de datos.

export type MotivoRechazoLote = "limite_gratis" | "saldo_insuficiente";

export interface DecisionLote {
  permitido: boolean;
  motivo?: MotivoRechazoLote;
  plan: Plan;
  enviosRestantes: number;
  vence: Timestamp | null;
}

const LIMITE_GRATIS = 15;

/**
 * Decide si un lote de `cantidad` certificados cabe en el plan de `cuenta`, a la fecha `ahora`.
 * - Gratis: permitido hasta 15.
 * - Paquete vigente (vence > ahora) con saldo (enviosRestantes > 0): permitido si el saldo
 *   alcanza; si no alcanza, rechazo especifico "saldo_insuficiente" (hay plan pagado, solo no
 *   cabe ESTE lote).
 * - Pro vigente (vence > ahora): permitido sin limite de cantidad.
 * - Cualquier otro caso — Paquete o Pro vencidos, `vence` null, o Paquete vigente pero con el
 *   saldo en 0 — se trata exactamente igual que Gratis (rechazo "limite_gratis" si no alcanza).
 */
export function decidirLote(cuenta: Cuenta, cantidad: number, ahora: Date): DecisionLote {
  const base = { plan: cuenta.plan, enviosRestantes: cuenta.enviosRestantes, vence: cuenta.vence };
  const vigente = cuenta.vence !== null && cuenta.vence.toMillis() > ahora.getTime();

  if (cuenta.plan === "pro" && vigente) {
    return { permitido: true, ...base };
  }

  if (cuenta.plan === "paquete" && vigente && cuenta.enviosRestantes > 0) {
    if (cuenta.enviosRestantes >= cantidad) return { permitido: true, ...base };
    return { permitido: false, motivo: "saldo_insuficiente", ...base };
  }

  if (cantidad <= LIMITE_GRATIS) return { permitido: true, ...base };
  return { permitido: false, motivo: "limite_gratis", ...base };
}

export interface Lote {
  uid: string;
  cantidad: number;
  plan: Plan;
  enviados: number;
  creado: Timestamp;
  expira: Timestamp;
}

// Mismo plazo que la sesion del PDF en memoria (server.ts): un lote autorizado no sobrevive
// mas que eso, para no arrastrar un permiso viejo sobre un plan/TRM que ya cambio.
const DURACION_LOTE_MS = 2 * 3600_000;

/**
 * Crea `lotes/{loteId}` ya autorizado para `cantidad` envios bajo el plan que `decidirLote`
 * aprobo. El id lo genera Firestore (aleatorio, no adivinable ni secuencial).
 */
export async function crearLote(uid: string, cantidad: number, plan: Plan): Promise<{ loteId: string; lote: Lote }> {
  const ref = db().collection("lotes").doc();
  const ahora = Timestamp.now();
  const lote: Lote = {
    uid,
    cantidad,
    plan,
    enviados: 0,
    creado: ahora,
    expira: Timestamp.fromMillis(ahora.toMillis() + DURACION_LOTE_MS),
  };
  await ref.set(lote);
  return { loteId: ref.id, lote };
}

/**
 * Comprueba, ANTES de intentar el envio por Gmail, que el lote exista, sea del usuario que
 * llama, no haya expirado y todavia tenga cupo. `/api/send-email` nunca envia sin esto.
 */
export async function validarLotePendiente(
  loteId: string,
  uid: string
): Promise<{ ok: true; lote: Lote } | { ok: false; error: string }> {
  const snap = await db().collection("lotes").doc(loteId).get();
  if (!snap.exists) {
    return { ok: false, error: "El lote de envio no existe o ya expiro. Vuelve a iniciar el envio masivo." };
  }
  const lote = snap.data() as Lote;
  if (lote.uid !== uid) {
    return { ok: false, error: "Este lote de envio no pertenece a tu cuenta." };
  }
  if (lote.expira.toMillis() <= Date.now()) {
    return { ok: false, error: "Este lote de envio expiro. Vuelve a iniciar el envio masivo." };
  }
  if (lote.enviados >= lote.cantidad) {
    return { ok: false, error: "Este lote de envio ya alcanzo su cupo autorizado." };
  }
  return { ok: true, lote };
}

/**
 * Tras un envio EXITOSO (nunca si Gmail fallo): descuenta 1 del lote y, si el plan del lote es
 * Paquete, 1 del saldo de la cuenta — en una sola transaccion, para que envios concurrentes
 * nunca descuenten de mas ni de menos (Tarea 3: 10 exitos + 2 fallos ⇒ el saldo baja
 * exactamente 10; el saldo nunca baja de 0).
 */
export async function registrarEnvioExitoso(loteId: string, uid: string, plan: Plan): Promise<void> {
  const loteRef = db().collection("lotes").doc(loteId);
  const cuentaRef = db().collection("cuentas").doc(uid);
  await db().runTransaction(async (tx) => {
    const loteSnap = await tx.get(loteRef);
    if (!loteSnap.exists) return; // el lote desaparecio entre la validacion y el envio: nada que descontar.
    tx.update(loteRef, { enviados: (loteSnap.data() as Lote).enviados + 1 });
    if (plan === "paquete") {
      const cuentaSnap = await tx.get(cuentaRef);
      if (cuentaSnap.exists) {
        const restantes = (cuentaSnap.data() as Cuenta).enviosRestantes;
        tx.update(cuentaRef, { enviosRestantes: Math.max(0, restantes - 1) });
      }
    }
  });
}
