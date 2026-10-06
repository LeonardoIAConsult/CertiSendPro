// Correccion vuelta 35/36 (orden del Brain, 2026-10-06): esta prueba antes solo greppeaba el
// TEXTO FUENTE de server.ts (confirmaba que la palabra "decidirEnvioConHuella"/
// "decidirAutorizacionLote" aparecia cerca de la ruta, nunca que la decision fuera correcta — una
// prueba que no prueba nada). Ahora `server.ts` delega las dos decisiones en funciones extraidas
// con dependencias inyectadas (`server/decisionesRuta.ts`) y esta prueba ejercita esa logica real.
//
// Mutaciones pedidas por la orden (las dos deben hacer caer una prueba):
//   1. "ignora el resultado" — si `decidirEnvioSendEmail` dejara de propagar `decision.ok===false`
//      de `decidirEnvioConHuella` (p. ej. devolviera `{ok:true}` siempre), un correo cuya huella
//      NO coincide se aceptaria igual.
//   2. "usa el correo crudo" — si se llamara a `decidirEnvioConHuella` con `String(entrada.to)` en
//      vez del correo YA saneado (`sanitizarCorreo`), un correo con un caracter invisible/espacio
//      interno (saneado SI coincide con la huella guardada) se rechazaria con 409 por error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirEnvioSendEmail, decidirAutorizacionLoteRuta } from "../server/decisionesRuta";
import { huellaPar } from "../server/huellaLote";
import type { AutorizacionDatos } from "../server/cuentas";
import { Timestamp } from "firebase-admin/firestore";

const SECRETO = "secreto-de-pruebas-bien-largo";
const LOTE_ID = "lote-1";

// ── decidirEnvioSendEmail ────────────────────────────────────────────────────────────────────

test("decidirEnvioSendEmail: correo con formato invalido -> 400, nunca llega a mirar la huella", async () => {
  let llamadoObtenerHuellas = false;
  const resultado = await decidirEnvioSendEmail(
    LOTE_ID,
    { to: "no-es-un-correo", fila: 1, pageIndex: 1 },
    { obtenerHuellasLote: async () => { llamadoObtenerHuellas = true; return null; }, secretoHuella: SECRETO }
  );
  assert.equal(resultado.ok, false);
  if (resultado.ok === false) assert.equal(resultado.httpStatus, 400);
  assert.equal(llamadoObtenerHuellas, false);
});

test("decidirEnvioSendEmail: pageIndex/fila no numericos -> 400", async () => {
  const resultado = await decidirEnvioSendEmail(
    LOTE_ID,
    { to: "ok@test.com", fila: "no-numero", pageIndex: 1 },
    { obtenerHuellasLote: async () => null, secretoHuella: SECRETO }
  );
  assert.equal(resultado.ok, false);
  if (resultado.ok === false) assert.equal(resultado.httpStatus, 400);
});

test("decidirEnvioSendEmail: sin HUELLA_LOTE_SECRET -> 503 (falla cerrado)", async () => {
  const resultado = await decidirEnvioSendEmail(
    LOTE_ID,
    { to: "ok@test.com", fila: 1, pageIndex: 1 },
    { obtenerHuellasLote: async () => null, secretoHuella: undefined }
  );
  assert.equal(resultado.ok, false);
  if (resultado.ok === false) assert.equal(resultado.httpStatus, 503);
});

test("decidirEnvioSendEmail: huella que SI coincide -> ok:true con el correo saneado", async () => {
  const huella = huellaPar({ pagina: 1, fila: 1, correo: "ok@test.com" }, SECRETO);
  const resultado = await decidirEnvioSendEmail(
    LOTE_ID,
    { to: "ok@test.com", fila: 1, pageIndex: 1 },
    { obtenerHuellasLote: async () => [huella], secretoHuella: SECRETO }
  );
  assert.equal(resultado.ok, true);
  if (resultado.ok === true) assert.equal(resultado.correo, "ok@test.com");
});

test("decidirEnvioSendEmail: huella que NO coincide -> 409, el resultado de decidirEnvioConHuella NUNCA se ignora", async () => {
  const huellaDeOtroCorreo = huellaPar({ pagina: 1, fila: 1, correo: "otro@test.com" }, SECRETO);
  const resultado = await decidirEnvioSendEmail(
    LOTE_ID,
    { to: "ok@test.com", fila: 1, pageIndex: 1 },
    { obtenerHuellasLote: async () => [huellaDeOtroCorreo], secretoHuella: SECRETO }
  );
  assert.equal(resultado.ok, false);
  if (resultado.ok === false) assert.equal(resultado.httpStatus, 409);
});

test("decidirEnvioSendEmail: el correo se SANEA antes de comparar la huella (espacio interno + mayusculas)", async () => {
  // La huella guardada en /api/lote/iniciar se calculo sobre el correo YA SANEADO ("ok@test.com").
  // Si la decision usara `String(entrada.to)` crudo (con el espacio y las mayusculas) en vez del
  // saneado, esta huella NUNCA coincidiria -> 409 por error, aunque el usuario confirmo
  // exactamente este correo en el PASO 1.
  const huella = huellaPar({ pagina: 2, fila: 5, correo: "ok@test.com" }, SECRETO);
  const resultado = await decidirEnvioSendEmail(
    LOTE_ID,
    { to: " OK@Test.com ", fila: 5, pageIndex: 2 },
    { obtenerHuellasLote: async () => [huella], secretoHuella: SECRETO }
  );
  assert.equal(resultado.ok, true, "el correo saneado debe coincidir con la huella guardada");
  if (resultado.ok === true) assert.equal(resultado.correo, "ok@test.com");
});

// ── decidirAutorizacionLoteRuta ──────────────────────────────────────────────────────────────

const VERSION_VIGENTE = "2.3";

function autorizacionFalsa(version: string): AutorizacionDatos {
  return { version, fecha: Timestamp.now(), idioma: "es", texto: "texto-aceptado" };
}

test("decidirAutorizacionLoteRuta: sin autorizacion guardada -> 403 motivo autorizacion", async () => {
  const resultado = await decidirAutorizacionLoteRuta("uid-1", VERSION_VIGENTE, {
    obtenerAutorizacionDatos: async () => null,
  });
  assert.equal(resultado.ok, false);
  if (resultado.ok === false) {
    assert.equal(resultado.httpStatus, 403);
    assert.equal(resultado.motivo, "autorizacion");
  }
});

test("decidirAutorizacionLoteRuta: autorizacion de una VERSION VIEJA -> 403 (se vuelve a pedir)", async () => {
  const resultado = await decidirAutorizacionLoteRuta("uid-1", VERSION_VIGENTE, {
    obtenerAutorizacionDatos: async () => autorizacionFalsa("2.2"),
  });
  assert.equal(resultado.ok, false);
});

test("decidirAutorizacionLoteRuta: autorizacion de la version VIGENTE -> ok:true", async () => {
  const resultado = await decidirAutorizacionLoteRuta("uid-1", VERSION_VIGENTE, {
    obtenerAutorizacionDatos: async () => autorizacionFalsa(VERSION_VIGENTE),
  });
  assert.equal(resultado.ok, true);
});

test("decidirAutorizacionLoteRuta: pasa el uid tal cual a obtenerAutorizacionDatos (nunca otro)", async () => {
  let uidRecibido: string | null = null;
  await decidirAutorizacionLoteRuta("uid-especifico", VERSION_VIGENTE, {
    obtenerAutorizacionDatos: async (uid) => {
      uidRecibido = uid;
      return null;
    },
  });
  assert.equal(uidRecibido, "uid-especifico");
});
