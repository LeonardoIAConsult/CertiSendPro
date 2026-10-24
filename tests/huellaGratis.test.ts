import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarCorreoParaGratis, huellaGratis } from "../server/huellaGratis";

const SECRETO = "secreto-de-prueba-no-es-real";

test("normalizar: minusculas y sin espacios", () => {
  assert.equal(normalizarCorreoParaGratis("  Ana.Gomez@Empresa.CO "), "ana.gomez@empresa.co");
});

test("normalizar: en Gmail ignora puntos y +sufijo, y googlemail.com es gmail.com", () => {
  const base = normalizarCorreoParaGratis("anagomez@gmail.com");
  for (const v of ["ana.gomez@gmail.com", "Ana.Gomez+promo@gmail.com", "a.n.a.g.o.m.e.z@googlemail.com", "ANAGOMEZ+1+2@GMAIL.COM"]) {
    assert.equal(normalizarCorreoParaGratis(v), base, v);
  }
});

test("normalizar: fuera de Gmail los puntos y el + SI importan (no se asume nada)", () => {
  assert.notEqual(normalizarCorreoParaGratis("ana.gomez@empresa.co"), normalizarCorreoParaGratis("anagomez@empresa.co"));
  assert.notEqual(normalizarCorreoParaGratis("ana+x@empresa.co"), normalizarCorreoParaGratis("ana@empresa.co"));
});

test("normalizar: entradas raras no lanzan", () => {
  for (const v of ["", "sin-arroba", "@dominio.com", "usuario@"]) assert.doesNotThrow(() => normalizarCorreoParaGratis(v));
});

test("huella: mismo correo => misma huella (aunque cambie el uid); distinto correo => distinta", () => {
  const a = huellaGratis("ana@gmail.com", "uid-1", SECRETO);
  assert.equal(a, huellaGratis("ANA@gmail.com", "uid-OTRO", SECRETO));
  assert.equal(a, huellaGratis("a.na+x@googlemail.com", "uid-2", SECRETO));
  assert.notEqual(a, huellaGratis("beto@gmail.com", "uid-1", SECRETO));
});

test("huella: depende del secreto, es hex de 64 y NO contiene el correo", () => {
  const h = huellaGratis("ana@gmail.com", "uid-1", SECRETO);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, huellaGratis("ana@gmail.com", "uid-1", "otro-secreto"));
  assert.equal(h.includes("ana"), false);
});

test("huella: sin correo se usa el uid y nunca colisiona con la huella de un correo", () => {
  const sinCorreo = huellaGratis(undefined, "uid-1", SECRETO);
  assert.equal(sinCorreo, huellaGratis(null, "uid-1", SECRETO));
  assert.equal(sinCorreo, huellaGratis("sin-arroba", "uid-1", SECRETO));
  assert.notEqual(sinCorreo, huellaGratis(undefined, "uid-2", SECRETO));
  assert.notEqual(sinCorreo, huellaGratis("uid-1@x.com", "uid-1", SECRETO));
});
