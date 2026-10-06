// O1 (Dictamen Abogado_LAP ronda 5, 2026-10-06, CRITICO): el acuse de compra REAL (con los cuatro
// PROVEEDOR_* puestos, como en produccion) nunca debe llevar un placeholder "[PENDIENTE"/
// "[PENDING" — antes, el precio pagado SIEMPRE lo llevaba (marcador fijo de IVA en el codigo),
// asi que `tienePlaceholderPendiente` bloqueaba el correo al comprador para TODA venta, sin
// importar que los datos del proveedor estuvieran completos.
//
// `PROVEEDOR_NOMBRE`/`_DOCUMENTO`/`_DIRECCION`/`_TELEFONO` (server/avisos.ts) son consts de nivel
// de modulo derivadas de `process.env` EN EL MOMENTO DEL IMPORT. Un `import ... from` estatico se
// evalua ANTES de que corra el cuerpo de este archivo (hoisting de ES modules), asi que fijar
// `process.env.PROVEEDOR_*` ANTES de un import estatico no sirve de nada — por eso este archivo
// usa `await import()` DINAMICO, que si respeta el orden real de ejecucion.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.PROVEEDOR_NOMBRE = "Proveedor de Prueba S.A.S.";
process.env.PROVEEDOR_DOC = "900000000-1";
process.env.PROVEEDOR_DIR = "Calle 1 # 2-3, Bogotá";
process.env.PROVEEDOR_TEL = "+57 300 000 0000";

const { construirCorreoConfirmacionCompra, construirAvisoReversionComprador, tienePlaceholderPendiente, PROVEEDOR_NOMBRE } =
  await import("../server/avisos");

const DATOS_BASE = {
  cop: 49102,
  trm: 3273.49,
  fechaTrm: "2026-10-03",
  fechaPago: new Date("2026-10-05T15:00:00.000Z"),
  fechaVencimiento: new Date("2026-11-05T15:00:00.000Z"),
  refMp: "123456789",
  enlaceTerminos: "https://certisendpro.online/terminos",
};

test("sanity: PROVEEDOR_NOMBRE SI tomo el valor de prueba (si esto falla, el resto del archivo no prueba nada)", () => {
  assert.equal(PROVEEDOR_NOMBRE, "Proveedor de Prueba S.A.S.");
});

test("O1: construirCorreoConfirmacionCompra (ES) con los 4 PROVEEDOR_* puestos -> SIN placeholder pendiente, nunca bloqueado", () => {
  const { texto } = construirCorreoConfirmacionCompra({ ...DATOS_BASE, paraEmail: "comprador@test.com", idioma: "es" });
  assert.equal(tienePlaceholderPendiente(texto), false, "con los datos del proveedor completos, el acuse ES ya no debe tener ningun [PENDIENTE");
  assert.doesNotMatch(texto, /\[PENDIENTE/);
  assert.match(texto, /precio total y final, sin cargos adicionales/);
});

test("O1: construirCorreoConfirmacionCompra (EN) con los 4 PROVEEDOR_* puestos -> SIN placeholder pendiente, nunca bloqueado", () => {
  const { texto } = construirCorreoConfirmacionCompra({ ...DATOS_BASE, paraEmail: "buyer@test.com", idioma: "en" });
  assert.equal(tienePlaceholderPendiente(texto), false, "con los datos del proveedor completos, el acuse EN ya no debe tener ningun [PENDING");
  assert.doesNotMatch(texto, /\[PENDING/);
  assert.match(texto, /total and final price, with no additional charges/);
});

// ── Mutacion del oraculo: volver a introducir el marcador de IVA en el codigo debe tumbar las dos
// pruebas de arriba. Esta prueba documenta que `tienePlaceholderPendiente` SI detecta ese texto
// exacto (confirma que la deteccion sigue viva; la mutacion real se corre aparte, reinsertando el
// marcador en server/avisos.ts y confirmando que las pruebas de arriba fallan).
test("tienePlaceholderPendiente: sigue detectando el marcador de IVA viejo si alguien lo reintroduce", () => {
  const conMarcadorViejo = `Precio pagado: $49.102 COP [PENDIENTE: confirmar con contador si este precio incluye IVA]\n`;
  assert.equal(tienePlaceholderPendiente(conMarcadorViejo), true);
});

// F1 (verificacion ronda 5, 2026-10-06), oraculo: el correo de reversion al comprador, con los 4
// PROVEEDOR_* puestos (como en produccion), tampoco debe llevar nunca un placeholder pendiente —
// ni en la variante (a) cuentaRevertida=true ni en la (b) false.
const FECHA_REVERSION = new Date("2026-10-06T15:00:00.000Z");

test("F1: construirAvisoReversionComprador (ES, cuentaRevertida=true) con los 4 PROVEEDOR_* puestos -> SIN placeholder pendiente", () => {
  const { texto } = construirAvisoReversionComprador({
    idioma: "es", paymentId: "pago-1", status: "refunded", cuentaRevertida: true, fecha: FECHA_REVERSION,
  });
  assert.equal(tienePlaceholderPendiente(texto), false);
  assert.doesNotMatch(texto, /\[PENDIENTE/);
});

test("F1: construirAvisoReversionComprador (EN, cuentaRevertida=false) con los 4 PROVEEDOR_* puestos -> SIN placeholder pendiente", () => {
  const { texto } = construirAvisoReversionComprador({
    idioma: "en", paymentId: "pago-1", status: "charged_back", cuentaRevertida: false, fecha: FECHA_REVERSION,
  });
  assert.equal(tienePlaceholderPendiente(texto), false);
  assert.doesNotMatch(texto, /\[PENDING/);
});
