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
    reservadosPaquete: 0,
    saldoPorUso: 0,
    reservadosPorUso: 0,
    ultimoPago: null,
    actualizado: Timestamp.fromDate(ahora),
    ...parcial,
  };
}

test("gratis: lote de 15 permitido (limite exacto), nunca gasta ni reparte", () => {
  const d = decidirLote(cuenta({ plan: "gratis" }), 15, ahora);
  assert.equal(d.permitido, true);
  assert.equal(d.planEfectivo, "gratis");
  assert.equal(d.consumo, undefined, "un lote Gratis no reparte nada");
});

// Tarea 16A-1 (decision del Brain 2026-10-06): desde que existe Pago por uso, "limite_gratis" ya
// no lo produce decidirLote — cualquier rechazo de un lote >15 es "saldo_insuficiente" (abajo).
test("gratis: lote de 16 rechazado por saldo_insuficiente (sin Paquete ni saldo Por Uso)", () => {
  const d = decidirLote(cuenta({ plan: "gratis" }), 16, ahora);
  assert.equal(d.permitido, false);
  assert.equal(d.motivo, "saldo_insuficiente");
  assert.equal(d.planEfectivo, "gratis");
});

test("paquete: saldo 40, lote de 60 rechazado por saldo_insuficiente", () => {
  const d = decidirLote(cuenta({ plan: "paquete", enviosRestantes: 40, vence: futuro }), 60, ahora);
  assert.equal(d.permitido, false);
  assert.equal(d.motivo, "saldo_insuficiente");
});

test("paquete: saldo 40, lote de 40 permitido (alcanza exacto)", () => {
  const d = decidirLote(cuenta({ plan: "paquete", enviosRestantes: 40, vence: futuro }), 40, ahora);
  assert.equal(d.permitido, true);
  assert.deepEqual(d.consumo, { paquete: 40, porUso: 0 });
});

test("paquete vencido con saldo: se trata como gratis (permite hasta 15)", () => {
  const dentroDelLimite = decidirLote(cuenta({ plan: "paquete", enviosRestantes: 40, vence: pasado }), 15, ahora);
  assert.equal(dentroDelLimite.permitido, true);

  const fueraDelLimite = decidirLote(cuenta({ plan: "paquete", enviosRestantes: 40, vence: pasado }), 20, ahora);
  assert.equal(fueraDelLimite.permitido, false);
  assert.equal(fueraDelLimite.motivo, "saldo_insuficiente");
});

test("paquete vigente sin saldo (0 restantes): se trata como gratis", () => {
  const d = decidirLote(cuenta({ plan: "paquete", enviosRestantes: 0, vence: futuro }), 10, ahora);
  assert.equal(d.permitido, true);
});

// ── Pago por uso (Tarea 16A-1, decision del Brain 2026-10-06): US$0,15 por envio, saldo SIN
// vencimiento y ACUMULABLE. El Paquete se consume PRIMERO; el saldo Por Uso cubre el resto. ────

test("Paquete 150 + Por uso 100, lote de 200 -> reparto 150 + 50, planEfectivo mixto", () => {
  const d = decidirLote(cuenta({ plan: "paquete", enviosRestantes: 150, vence: futuro, saldoPorUso: 100 }), 200, ahora);
  assert.equal(d.permitido, true);
  assert.equal(d.planEfectivo, "mixto");
  assert.deepEqual(d.consumo, { paquete: 150, porUso: 50 });
});

test("saldo total insuficiente (Paquete 100 + Por uso 50 = 150), lote de 200 -> rechazo saldo_insuficiente", () => {
  const d = decidirLote(cuenta({ plan: "paquete", enviosRestantes: 100, vence: futuro, saldoPorUso: 50 }), 200, ahora);
  assert.equal(d.permitido, false);
  assert.equal(d.motivo, "saldo_insuficiente");
  assert.equal(d.planEfectivo, "mixto", "las dos fuentes aportan algo, aunque no alcancen juntas");
});

test("solo Por uso (sin Paquete) con saldo 60, lote de 40 -> usa porUso entero", () => {
  const d = decidirLote(cuenta({ plan: "gratis", saldoPorUso: 60 }), 40, ahora);
  assert.equal(d.permitido, true);
  assert.equal(d.planEfectivo, "porUso");
  assert.deepEqual(d.consumo, { paquete: 0, porUso: 40 });
});

test("Por uso resta lo ya reservado por otros lotes (reservadosPorUso) antes de decidir", () => {
  const d = decidirLote(cuenta({ plan: "gratis", saldoPorUso: 60, reservadosPorUso: 25 }), 40, ahora);
  assert.equal(d.permitido, false, "disponible real es 35 (60-25), no alcanza para 40");
  assert.equal(d.motivo, "saldo_insuficiente");
});

// ── planEfectivo (R3-1, corregida tras M21 en la vuelta 18 del REVISOR) ─────────────────────
// decidirLote ahora devuelve `planEfectivo`: lo que se guarda en el lote y lo que usan
// reservarEnvio/confirmarEnvioExitoso para decidir si descuentan saldo. Un lote de 15 o menos
// SIEMPRE es "gratis" en planEfectivo, aunque la cuenta tenga saldo pagado de sobra: nunca debe
// descontar.

test("planEfectivo: lote <=15 con Paquete vigente y saldo de sobra -> gratis (R3-1, no descuenta)", () => {
  const d = decidirLote(cuenta({ plan: "paquete", enviosRestantes: 100, vence: futuro }), 15, ahora);
  assert.equal(d.permitido, true);
  assert.equal(d.planEfectivo, "gratis");
  assert.equal(d.plan, "paquete"); // el plan REAL de la cuenta se sigue informando para la UI.
});

test("planEfectivo: lote <=15 con saldo Por uso de sobra -> igual gratis (R3-1)", () => {
  const d = decidirLote(cuenta({ plan: "gratis", saldoPorUso: 500 }), 10, ahora);
  assert.equal(d.permitido, true);
  assert.equal(d.planEfectivo, "gratis");
});

test("planEfectivo: lote >15 con Paquete vigente y saldo justo (exacto) -> paquete", () => {
  const d = decidirLote(cuenta({ plan: "paquete", enviosRestantes: 20, vence: futuro }), 20, ahora);
  assert.equal(d.permitido, true);
  assert.equal(d.planEfectivo, "paquete");
});

test("planEfectivo: lote >15 con Paquete VENCIDO y sin saldo Por uso -> gratis, y >15 se rechaza", () => {
  const d = decidirLote(cuenta({ plan: "paquete", enviosRestantes: 999, vence: pasado }), 16, ahora);
  assert.equal(d.permitido, false);
  assert.equal(d.motivo, "saldo_insuficiente");
  assert.equal(d.planEfectivo, "gratis");
});

test("planEfectivo: lote >15 con saldo Por uso de sobra -> porUso", () => {
  const d = decidirLote(cuenta({ plan: "gratis", saldoPorUso: 500 }), 500, ahora);
  assert.equal(d.permitido, true);
  assert.equal(d.planEfectivo, "porUso");
});
