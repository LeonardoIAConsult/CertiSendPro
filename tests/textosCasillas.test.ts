// M31 (cobro real con planes, corrige vuelta 26): prueba que el texto de las casillas del
// CLIENTE (src/utils/checkout.ts) y del SERVIDOR (server/cuentas.ts) sea EXACTAMENTE el mismo, en
// ES y EN y con dos montos distintos. Antes de esta tarea el mismo texto vivia copiado a mano en
// los dos archivos (cada uno con su propia constante/funcion) — un cambio en un lado sin el otro
// nunca lo habria detectado ninguna prueba existente, porque `tests/checkout.test.ts` solo
// comprueba el lado del cliente y la Tarea 14 solo comprobo el lado del servidor por separado.
//
// Los dos lados ahora DELEGAN a `shared/textosCasillas.ts` (ver ese archivo y su comentario), asi
// que hoy esta prueba pasaria incluso importando solo el modulo compartido dos veces — pero el
// punto de esta prueba es justamente blindar contra que alguien, en el futuro, reintroduzca una
// copia local en uno de los dos lados (p. ej. "total" un `textoTerminos` nuevo en checkout.ts sin
// tocar cuentas.ts): importa a proposito desde los DOS consumidores, nunca desde el modulo
// compartido directamente, para que la mutacion de abajo sea real.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  textoCasillaTerminos,
  textoCasillaRetracto,
  textoAceptacionTerminosUso,
  TERMINOS_VERSION as VERSION_SERVIDOR,
} from "../server/cuentas";
import { textoTerminos, textoRetracto, TERMINOS_VERSION as VERSION_CLIENTE } from "../src/utils/checkout";
import { textoCasillaRetractoPorUso } from "../shared/textosCasillas";

const MONTOS = [49102, 61845];
const IDIOMAS = ["es", "en"] as const;

test("textosCasillas: TERMINOS_VERSION es igual en cliente y servidor", () => {
  assert.equal(VERSION_CLIENTE, VERSION_SERVIDOR);
});

for (const idioma of IDIOMAS) {
  for (const monto of MONTOS) {
    test(`textosCasillas: T4 (Terminos) idioma=${idioma} monto=${monto} — cliente === servidor`, () => {
      const delServidor = textoCasillaTerminos(monto, idioma);
      const delCliente = textoTerminos(monto, idioma);
      assert.equal(delCliente, delServidor);
    });
  }

  test(`textosCasillas: T5 (retracto) idioma=${idioma} — cliente === servidor`, () => {
    const delServidor = textoCasillaRetracto(idioma);
    const delCliente = textoRetracto(idioma);
    assert.equal(delCliente, delServidor);
  });

  // Bajo (REVISOR_EXTERNO, 2026-10-06): la segunda casilla (O2, previa a "Entrar con Google")
  // cita la version vigente de los Terminos — sin esto, un usuario que acepta hoy y otro que
  // acepta despues de un cambio de version verian el MISMO texto, aunque `aceptacionesUso/{uid}`
  // guarde versiones distintas (no se podria probar cual version aceptaron a simple vista). No
  // hay una copia "cliente" separada para este texto (src/App.tsx importa la MISMA funcion de
  // shared/textosCasillas.ts, sin wrapper en src/utils/checkout.ts), por eso esta prueba solo
  // compara contra la propia constante, no cliente-vs-servidor como las de arriba.
  test(`textosCasillas: textoAceptacionTerminosUso incluye TERMINOS_VERSION (idioma=${idioma})`, () => {
    const texto = textoAceptacionTerminosUso(idioma);
    // ES dice "versión {X}", EN dice "version {X}" — en los dos casos, la palabra va INMEDIATAMENTE
    // antes del numero de version real (nunca un numero hardcodeado aparte de la constante).
    assert.match(texto, new RegExp(`versi[oó]n ${VERSION_SERVIDOR}\\b`, "i"));
  });
}

// ── Tarea 16A-2 (decision del Brain 2026-10-06): casilla de retracto de "Pago por uso" — distinta
// de la del Paquete (T5): el saldo se activa de inmediato (nunca "empieza un servicio") y la
// devolucion aplica a ESTA compra (nunca al "Paquete"). El cliente (src/utils/checkout.ts)
// TODAVIA no tiene su propio wrapper para este texto (Paso 16A-2 no toca src/): esta prueba solo
// cubre el lado compartido/servidor, igual que indica el punto 3 de la orden.
test("textoCasillaRetractoPorUso (ES): dice que el saldo se activa de inmediato y que la devolucion aplica a ESTA compra", () => {
  const texto = textoCasillaRetractoPorUso("es");
  assert.match(texto, /saldo se active de inmediato/);
  assert.match(texto, /esta compra/);
  assert.match(texto, /5 días hábiles/);
  assert.doesNotMatch(texto, /Paquete/);
});

test("textoCasillaRetractoPorUso (EN): mismo contenido, en ingles, nunca mezclado con ES", () => {
  const texto = textoCasillaRetractoPorUso("en");
  assert.match(texto, /activated immediately/);
  assert.match(texto, /this purchase/);
  assert.match(texto, /5 business/);
  assert.doesNotMatch(texto, /saldo/);
});

test("textoCasillaRetractoPorUso: distinto del texto de retracto del Paquete (nunca una copia)", () => {
  assert.notEqual(textoCasillaRetractoPorUso("es"), textoCasillaRetracto("es"));
  assert.notEqual(textoCasillaRetractoPorUso("en"), textoCasillaRetracto("en"));
});

// ── Mutacion (documentada, no comiteada): si `src/utils/checkout.ts` volviera a tener su propio
// texto hardcodeado en vez de delegar a `shared/textosCasillas.ts` (p. ej. revirtiendo
// `textoTerminos` a la version anterior a M31), esta prueba cae en cuanto ese texto se desvie del
// servidor en una sola letra — se verifico a mano reintroduciendo temporalmente la copia vieja de
// `textoRetracto` (con "dentro de los 5 días hábiles siguientes al pago" cambiado a "dentro de
// los 10 días") y confirmando que las pruebas de T5 fallan; restaurado de inmediato.
