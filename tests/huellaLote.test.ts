// Pruebas de server/huellaLote.ts (Tarea 15, requisito A.3, 2026-10-06): huella HMAC-SHA256 por
// cada par pagina-fila-correo de un lote confirmado, SIN guardar la lista ni los correos en
// claro. node:test puro, sin Firestore ni Express — mismo patron que tests/webhook.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarCorreo, cadenaCanonicaPar, huellaPar, huellasLote, type ParConfirmacion } from "../server/huellaLote";

const SECRETO = "secreto-de-prueba-no-real";

test("normalizarCorreo: lowercase + trim", () => {
  assert.equal(normalizarCorreo("  Ana@Correo.com  "), "ana@correo.com");
});

test("cadenaCanonicaPar: pagina|fila|correoNormalizado", () => {
  const par: ParConfirmacion = { pagina: 3, fila: 7, correo: "Ana@Correo.com" };
  assert.equal(cadenaCanonicaPar(par), "3|7|ana@correo.com");
});

test("huellaPar: mismo par + mismo secreto -> siempre la misma huella (determinista)", () => {
  const par: ParConfirmacion = { pagina: 1, fila: 2, correo: "ana@correo.com" };
  const h1 = huellaPar(par, SECRETO);
  const h2 = huellaPar(par, SECRETO);
  assert.equal(h1, h2);
  assert.equal(h1.length, 64); // hex de SHA-256
});

test("huellaPar: cambiar el correo cambia la huella", () => {
  const h1 = huellaPar({ pagina: 1, fila: 2, correo: "ana@correo.com" }, SECRETO);
  const h2 = huellaPar({ pagina: 1, fila: 2, correo: "otra@correo.com" }, SECRETO);
  assert.notEqual(h1, h2);
});

test("huellaPar: una mayuscula/espacio distinto en el correo da la MISMA huella (normalizado)", () => {
  const h1 = huellaPar({ pagina: 1, fila: 2, correo: "ana@correo.com" }, SECRETO);
  const h2 = huellaPar({ pagina: 1, fila: 2, correo: "  Ana@Correo.com  " }, SECRETO);
  assert.equal(h1, h2);
});

test("huellaPar: cambiar la pagina o la fila cambia la huella", () => {
  const base = huellaPar({ pagina: 1, fila: 2, correo: "ana@correo.com" }, SECRETO);
  assert.notEqual(base, huellaPar({ pagina: 9, fila: 2, correo: "ana@correo.com" }, SECRETO));
  assert.notEqual(base, huellaPar({ pagina: 1, fila: 9, correo: "ana@correo.com" }, SECRETO));
});

test("huellaPar: cambiar el secreto cambia la huella", () => {
  const par: ParConfirmacion = { pagina: 1, fila: 2, correo: "ana@correo.com" };
  assert.notEqual(huellaPar(par, SECRETO), huellaPar(par, "otro-secreto"));
});

test("huellasLote: una huella por par, en el mismo orden", () => {
  const pares: ParConfirmacion[] = [
    { pagina: 1, fila: 1, correo: "a@x.com" },
    { pagina: 2, fila: 2, correo: "b@x.com" },
    { pagina: 3, fila: 3, correo: "c@x.com" },
  ];
  const huellas = huellasLote(pares, SECRETO);
  assert.equal(huellas.length, 3);
  assert.deepEqual(huellas, pares.map((p) => huellaPar(p, SECRETO)));
});

test("huellasLote: nunca contiene el correo en claro", () => {
  const pares: ParConfirmacion[] = [{ pagina: 1, fila: 1, correo: "secreto@correo.com" }];
  const [huella] = huellasLote(pares, SECRETO);
  assert.doesNotMatch(huella, /secreto@correo\.com/);
});
