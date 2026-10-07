// Tarea 16A-2 (decision del Brain 2026-10-06): el acuse de compra de "Pago por uso" (con los
// cuatro PROVEEDOR_* puestos, como en produccion) nunca debe llevar un placeholder "[PENDIENTE"/
// "[PENDING", y debe decir explicitamente que el saldo NO vence — mismo patron que
// tests/avisosProveedorCompleto.test.ts (O1) para el Paquete.
//
// `PROVEEDOR_NOMBRE`/`_DOCUMENTO`/`_DIRECCION`/`_TELEFONO` (server/avisos.ts) son consts de nivel
// de modulo derivadas de `process.env` EN EL MOMENTO DEL IMPORT: por eso este archivo usa
// `await import()` DINAMICO (fijar `process.env.PROVEEDOR_*` ANTES de un import ESTATICO no
// serviria de nada, por el hoisting de ES modules).
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.PROVEEDOR_NOMBRE = "Proveedor de Prueba S.A.S.";
process.env.PROVEEDOR_DOC = "900000000-1";
process.env.PROVEEDOR_DIR = "Calle 1 # 2-3, Bogotá";
process.env.PROVEEDOR_TEL = "+57 300 000 0000";

const { construirCorreoConfirmacionCompraPorUso, construirAvisoReversionComprador, tienePlaceholderPendiente } =
  await import("../server/avisos");

const DATOS_BASE = {
  cantidad: 50,
  cop: 7500,
  trm: 3900,
  fechaTrm: "2026-10-06",
  fechaPago: new Date("2026-10-06T15:00:00.000Z"),
  refMp: "123456789",
  enlaceTerminos: "https://certisendpro.online/terminos",
};

test("sanity: PROVEEDOR_NOMBRE SI tomo el valor de prueba (si esto falla, el resto del archivo no prueba nada)", async () => {
  const { PROVEEDOR_NOMBRE } = await import("../server/avisos");
  assert.equal(PROVEEDOR_NOMBRE, "Proveedor de Prueba S.A.S.");
});

test("construirCorreoConfirmacionCompraPorUso (ES): SIN placeholder pendiente, precio total y final, saldo NO vence", () => {
  const { texto } = construirCorreoConfirmacionCompraPorUso({ ...DATOS_BASE, paraEmail: "comprador@test.com", idioma: "es" });
  assert.equal(tienePlaceholderPendiente(texto), false, "con los datos del proveedor completos, nunca debe quedar bloqueado");
  assert.doesNotMatch(texto, /\[PENDIENTE/);
  assert.match(texto, /precio total y final, sin cargos adicionales/);
  assert.match(texto, /NO vence/);
  assert.match(texto, /50 envíos/);
  assert.match(texto, /TRM 3900/);
  assert.match(texto, /2026-10-06/);
  assert.match(texto, /123456789/);
});

test("construirCorreoConfirmacionCompraPorUso (EN): SIN placeholder pendiente, total and final price, never expires", () => {
  const { texto } = construirCorreoConfirmacionCompraPorUso({ ...DATOS_BASE, paraEmail: "buyer@test.com", idioma: "en" });
  assert.equal(tienePlaceholderPendiente(texto), false);
  assert.doesNotMatch(texto, /\[PENDING/);
  assert.match(texto, /total and final price, with no additional charges/);
  assert.match(texto, /never expires/);
  assert.match(texto, /50 sends/);
});

// ── La devolucion aplica a ESTA compra, nunca al saldo acumulado total ──────────────────────────

test("construirCorreoConfirmacionCompraPorUso (ES): la devolucion se pide sobre ESTA compra, no sobre 'el Paquete'", () => {
  const { texto } = construirCorreoConfirmacionCompraPorUso({ ...DATOS_BASE, paraEmail: "comprador@test.com", idioma: "es" });
  assert.match(texto, /esta compra en particular/);
  assert.doesNotMatch(texto, /Paquete/);
});

// ── Reversion al comprador con plan "porUso": "tu saldo se ajustó", NUNCA "volviste a Gratis" ───

test("construirAvisoReversionComprador (plan:porUso, ES): dice que se ajusto el saldo, nunca 'plan Gratis'", () => {
  const { asunto, texto } = construirAvisoReversionComprador({
    idioma: "es",
    paymentId: "pago-1",
    status: "refunded",
    cuentaRevertida: true,
    fecha: new Date("2026-10-06T15:00:00.000Z"),
    plan: "porUso",
  });
  assert.equal(tienePlaceholderPendiente(texto), false);
  assert.doesNotMatch(texto, /\[PENDIENTE/);
  assert.match(asunto, /Ajustamos tu saldo/);
  assert.match(texto, /ajustamos tu saldo de Pago por uso/);
  assert.doesNotMatch(texto, /plan Gratis/);
  assert.doesNotMatch(texto, /pasó al plan Gratis/);
});

test("construirAvisoReversionComprador (plan:porUso, EN): dice que se ajusto el saldo, nunca 'Free plan'", () => {
  const { asunto, texto } = construirAvisoReversionComprador({
    idioma: "en",
    paymentId: "pago-1",
    status: "charged_back",
    cuentaRevertida: true,
    fecha: new Date("2026-10-06T15:00:00.000Z"),
    plan: "porUso",
  });
  assert.match(asunto, /adjusted your/);
  assert.match(texto, /adjusted your Pay-per-send balance/);
  assert.doesNotMatch(texto, /Free plan/);
});

// ── Sin `plan` (o plan:"paquete") el comportamiento EXISTENTE no cambia ─────────────────────────

test("construirAvisoReversionComprador: sin `plan`, el comportamiento sigue siendo el del Paquete (compatibilidad)", () => {
  const { texto } = construirAvisoReversionComprador({
    idioma: "es",
    paymentId: "pago-1",
    status: "refunded",
    cuentaRevertida: true,
    fecha: new Date("2026-10-06T15:00:00.000Z"),
  });
  assert.match(texto, /plan Gratis/);
});
