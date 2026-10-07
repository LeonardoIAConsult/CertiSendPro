// Pruebas de la logica PURA de `tienePaqueteVigenteConSaldo` (Tarea 15, requisito B.2, decision
// del Brain 2026-10-06: NO se permite recomprar un Paquete mientras el actual este vigente y
// tenga saldo). Mismo patron que tests/decidirLote.test.ts: node:test via tsx, sin Firestore.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { tienePaqueteVigenteConSaldo, type Cuenta } from "../server/cuentas";

const ahora = new Date("2026-10-05T12:00:00Z");
const futuro = Timestamp.fromMillis(ahora.getTime() + 30 * 24 * 3600_000);
const pasado = Timestamp.fromMillis(ahora.getTime() - 24 * 3600_000);

function cuenta(parcial: Partial<Cuenta>): Cuenta {
  return {
    plan: "gratis",
    enviosRestantes: 0,
    vence: null,
    renueva: false,
    mpSuscripcionId: null,
    reservadosPaquete: 0,
    saldoPorUso: 0,
    reservadosPorUso: 0,
    ultimoPago: null,
    actualizado: Timestamp.fromDate(ahora),
    ...parcial,
  };
}

test("Paquete vigente con saldo > 0 -> true (bloquea la recompra)", () => {
  const c = cuenta({ plan: "paquete", vence: futuro, enviosRestantes: 50 });
  assert.equal(tienePaqueteVigenteConSaldo(c, ahora), true);
});

test("Paquete vigente pero saldo en 0 -> false (puede recomprar)", () => {
  const c = cuenta({ plan: "paquete", vence: futuro, enviosRestantes: 0 });
  assert.equal(tienePaqueteVigenteConSaldo(c, ahora), false);
});

test("Paquete con saldo pero ya vencido -> false (puede recomprar)", () => {
  const c = cuenta({ plan: "paquete", vence: pasado, enviosRestantes: 50 });
  assert.equal(tienePaqueteVigenteConSaldo(c, ahora), false);
});

test("Paquete con saldo y sin vence (null) -> false (nunca vigente sin fecha)", () => {
  const c = cuenta({ plan: "paquete", vence: null, enviosRestantes: 50 });
  assert.equal(tienePaqueteVigenteConSaldo(c, ahora), false);
});

test("plan gratis, aunque vence/enviosRestantes digan otra cosa -> false", () => {
  const c = cuenta({ plan: "gratis", vence: futuro, enviosRestantes: 50 });
  assert.equal(tienePaqueteVigenteConSaldo(c, ahora), false);
});

test("plan porUso con saldo -> false (este bloqueo es solo para Paquete)", () => {
  const c = cuenta({ plan: "gratis", saldoPorUso: 500, vence: futuro, enviosRestantes: 50 });
  assert.equal(tienePaqueteVigenteConSaldo(c, ahora), false);
});
