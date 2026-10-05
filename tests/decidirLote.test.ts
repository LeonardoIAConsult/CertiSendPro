// Pruebas de la logica PURA de decision de lotes (Tarea 3, cobro real con planes, 2026-10-05).
// Corren con el test runner nativo de Node (node:test) via tsx; no tocan Firestore ni la red:
// `decidirLote` no depende de nada externo, solo de los datos de la cuenta y la fecha.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { decidirLote, type Cuenta } from "../server/cuentas";

// Fecha de referencia fija para que las pruebas no dependan del reloj real.
const ahora = new Date("2026-10-05T12:00:00Z");
const futuro = Timestamp.fromMillis(ahora.getTime() + 30 * 24 * 3600_000); // +30 dias
const pasado = Timestamp.fromMillis(ahora.getTime() - 24 * 3600_000); // -1 dia

function cuenta(parcial: Partial<Cuenta>): Cuenta {
  return {
    plan: "gratis",
    enviosRestantes: 0,
    vence: null,
    renueva: false,
    mpSuscripcionId: null,
    actualizado: Timestamp.fromDate(ahora),
    ...parcial,
  };
}

test("gratis: lote de 15 permitido (limite exacto)", () => {
  const d = decidirLote(cuenta({ plan: "gratis" }), 15, ahora);
  assert.equal(d.permitido, true);
});

test("gratis: lote de 16 rechazado por limite_gratis", () => {
  const d = decidirLote(cuenta({ plan: "gratis" }), 16, ahora);
  assert.equal(d.permitido, false);
  assert.equal(d.motivo, "limite_gratis");
});

test("paquete: saldo 40, lote de 60 rechazado por saldo_insuficiente", () => {
  const d = decidirLote(cuenta({ plan: "paquete", enviosRestantes: 40, vence: futuro }), 60, ahora);
  assert.equal(d.permitido, false);
  assert.equal(d.motivo, "saldo_insuficiente");
});

test("paquete: saldo 40, lote de 40 permitido (alcanza exacto)", () => {
  const d = decidirLote(cuenta({ plan: "paquete", enviosRestantes: 40, vence: futuro }), 40, ahora);
  assert.equal(d.permitido, true);
});

test("paquete vencido con saldo: se trata como gratis (permite hasta 15)", () => {
  const dentroDelLimite = decidirLote(cuenta({ plan: "paquete", enviosRestantes: 40, vence: pasado }), 15, ahora);
  assert.equal(dentroDelLimite.permitido, true);

  const fueraDelLimite = decidirLote(cuenta({ plan: "paquete", enviosRestantes: 40, vence: pasado }), 20, ahora);
  assert.equal(fueraDelLimite.permitido, false);
  assert.equal(fueraDelLimite.motivo, "limite_gratis");
});

test("paquete vigente sin saldo (0 restantes): se trata como gratis", () => {
  const d = decidirLote(cuenta({ plan: "paquete", enviosRestantes: 0, vence: futuro }), 10, ahora);
  assert.equal(d.permitido, true);
});

test("pro vigente: lote de 500 permitido, sin limite de cantidad", () => {
  const d = decidirLote(cuenta({ plan: "pro", vence: futuro }), 500, ahora);
  assert.equal(d.permitido, true);
});

test("pro vencido: lote de 16 rechazado (se trata como gratis)", () => {
  const d = decidirLote(cuenta({ plan: "pro", vence: pasado }), 16, ahora);
  assert.equal(d.permitido, false);
  assert.equal(d.motivo, "limite_gratis");
});

test("pro con vence null: se trata como gratis (no vigente)", () => {
  const d = decidirLote(cuenta({ plan: "pro", vence: null }), 16, ahora);
  assert.equal(d.permitido, false);
  assert.equal(d.motivo, "limite_gratis");
});
