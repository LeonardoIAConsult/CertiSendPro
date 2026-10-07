// Pruebas del webhook de Mercado Pago para el plan "Pago por uso" (Tarea 16A-2, decision del
// Brain 2026-10-06: US$0,15 por envio, minimo 50, maximo 5000, saldo SIN vencimiento y
// ACUMULABLE). Mismo patron que tests/webhook.test.ts: doble de Firestore real
// (tests/_fakeFirestore.ts) para activar/revertir de verdad, nunca un mock que "simula el exito".
import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { procesarWebhookMP, type RespuestaPagoMP } from "../server/webhook";
import {
  activarPorUsoSiNoProcesado,
  revertirPagoSiNoRevertido,
  _usarFirestoreParaPruebas,
  type Cuenta,
  type PreferenciaGuardada,
} from "../server/cuentas";
import { FirestoreFalso } from "./_fakeFirestore";

function pagoOkPorUso(datos: Partial<{
  status: string;
  status_detail: string;
  currency_id: string;
  transaction_amount: number;
  external_reference: string;
  date_approved: string;
}>): RespuestaPagoMP {
  const cuerpo = {
    status: "approved",
    currency_id: "COP",
    transaction_amount: 7500,
    external_reference: "CERTISEND|uid-1|porUso|50|7500|ref-1",
    date_approved: "2026-10-06T10:00:00.000-05:00",
    ...datos,
  };
  return { ok: true, status: 200, json: async () => cuerpo };
}

function preferenciaPorUsoBase(parcial: Partial<PreferenciaGuardada & { cantidad: number }> = {}): PreferenciaGuardada & { cantidad: number } {
  return {
    uid: "uid-1",
    plan: "porUso" as any,
    cop: 7500,
    trm: 3900,
    fechaTrm: "2026-10-06",
    cantidad: 50,
    creado: Timestamp.now(),
    ...parcial,
  } as PreferenciaGuardada & { cantidad: number };
}

function activarPorUsoConFake(db: FirestoreFalso) {
  _usarFirestoreParaPruebas(db);
  return activarPorUsoSiNoProcesado;
}

function revertirConFake(db: FirestoreFalso) {
  _usarFirestoreParaPruebas(db);
  return revertirPagoSiNoRevertido;
}

function obtenerPreferenciaConFake(db: FirestoreFalso, preferencias: Record<string, any>) {
  for (const [id, datos] of Object.entries(preferencias)) {
    db.seed(`preferencias/${id}`, datos as Record<string, any>);
  }
  return async (id: string) => {
    const data = db.leer(`preferencias/${id}`);
    return data ? (data as any) : null;
  };
}

const llamadasNotificarPorUso: any[] = [];
const llamadasProcesarReembolso: any[] = [];

function construirOptsPorUso(db: FirestoreFalso, overrides: Record<string, any> = {}) {
  const activarPorUso = activarPorUsoConFake(db);
  return {
    tipo: "payment",
    paymentId: "pago-1",
    obtenerPago: async () => pagoOkPorUso({}),
    obtenerPreferencia: obtenerPreferenciaConFake(db, { "ref-1": preferenciaPorUsoBase() }),
    activarPaquete: async () => "activado" as const,
    activarPorUso,
    timestampDesdeFecha: (fecha: Date) => Timestamp.fromDate(fecha),
    log: () => {},
    notificarActivacion: async () => {},
    notificarActivacionPorUso: async (datos: any) => {
      llamadasNotificarPorUso.push(datos);
    },
    procesarReembolso: async (datos: any) => {
      llamadasProcesarReembolso.push(datos);
    },
    avisarPagoDoble: async () => {},
    ...overrides,
  };
}

// ── Aprobado porUso -> suma el saldo ─────────────────────────────────────────────────────────

test("webhook porUso: pago aprobado y correcto suma la cantidad comprada al saldoPorUso", async () => {
  llamadasNotificarPorUso.length = 0;
  const db = new FirestoreFalso();
  const resultado = await procesarWebhookMP(construirOptsPorUso(db) as any);

  assert.equal(resultado.httpStatus, 200);
  assert.equal(resultado.razon, "activado");

  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.saldoPorUso, 50);
  assert.equal(cuenta.plan, "gratis", "porUso nunca cambia el plan de la cuenta");

  assert.equal(llamadasNotificarPorUso.length, 1);
  assert.equal(llamadasNotificarPorUso[0].cantidad, 50);
  assert.equal(llamadasNotificarPorUso[0].cop, 7500);
  assert.equal(llamadasNotificarPorUso[0].uid, "uid-1");
});

// ── Cantidad manipulada en external_reference contra la preferencia -> no activa ──────────────

test("webhook porUso: cantidad manipulada en external_reference (distinta de la preferencia) no activa", async () => {
  const db = new FirestoreFalso();
  const resultado = await procesarWebhookMP(
    construirOptsPorUso(db, {
      // La preferencia real dice cantidad=50, pero el external_reference (manipulado) dice 500.
      obtenerPago: async () =>
        pagoOkPorUso({ external_reference: "CERTISEND|uid-1|porUso|500|7500|ref-1" }),
    }) as any
  );

  assert.equal(resultado.httpStatus, 200);
  assert.equal(resultado.razon, "la preferencia guardada no coincide");
  assert.equal(db.leer("cuentas/uid-1"), undefined, "sin coincidencia de cantidad, la cuenta no se toca");
});

// ── Repetido -> una sola vez ─────────────────────────────────────────────────────────────────

test("webhook porUso: el mismo pago avisado dos veces suma una sola vez (idempotencia real)", async () => {
  const db = new FirestoreFalso();
  const opts = construirOptsPorUso(db);

  const r1 = await procesarWebhookMP(opts as any);
  const r2 = await procesarWebhookMP(opts as any);

  assert.equal(r1.razon, "activado");
  assert.equal(r2.razon, "pago ya procesado (idempotencia)");

  const cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.saldoPorUso, 50, "nunca 100: la segunda entrega no vuelve a sumar");
});

// ── Reembolso porUso -> resta y pide la variante "tu saldo se ajustó" (nunca "volviste a Gratis") ─

test("webhook porUso: refunded llama a procesarReembolso con plan:\"porUso\" y NUNCA llama a activarPorUso", async () => {
  llamadasProcesarReembolso.length = 0;
  const db = new FirestoreFalso();
  const activarPorUso = activarPorUsoConFake(db);
  let activarPorUsoLlamado = false;

  const resultado = await procesarWebhookMP(
    construirOptsPorUso(db, {
      obtenerPago: async () => pagoOkPorUso({ status: "refunded" }),
      activarPorUso: async (...args: any[]) => {
        activarPorUsoLlamado = true;
        return activarPorUso(...(args as [any, any, any]));
      },
    }) as any
  );

  assert.equal(resultado.httpStatus, 200);
  assert.equal(activarPorUsoLlamado, false, "un reembolso nunca debe intentar activar nada");
  assert.equal(llamadasProcesarReembolso.length, 1);
  assert.deepEqual(llamadasProcesarReembolso[0], {
    uid: "uid-1",
    paymentId: "pago-1",
    status: "refunded",
    referenciaId: "ref-1",
    plan: "porUso",
  });
});

test("webhook porUso: revertirPagoSiNoRevertido (la funcion real) resta exactamente lo sumado", async () => {
  const db = new FirestoreFalso();
  const activarPorUso = activarPorUsoConFake(db);
  await activarPorUso("uid-1", "pago-1", { cantidad: 50, cop: 7500, trm: 3900, fecha: Timestamp.now() });

  let cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.saldoPorUso, 50);

  const revertir = revertirConFake(db);
  const resultadoReversion = await revertir("pago-1", "uid-1");
  assert.equal(resultadoReversion, "revertido");

  cuenta = db.leer("cuentas/uid-1") as Cuenta;
  assert.equal(cuenta.saldoPorUso, 0);
});
