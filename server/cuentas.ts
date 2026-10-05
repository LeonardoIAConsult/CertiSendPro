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
