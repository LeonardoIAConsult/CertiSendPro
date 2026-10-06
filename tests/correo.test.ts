// Pruebas de shared/correo.ts (GRAVE 3, correccion vuelta 33, 2026-10-06): sanitizador UNICO de
// correos compartido entre cliente y servidor. node:test puro, sin DOM — mismo patron que
// tests/textosCasillas.test.ts (que tambien prueba un modulo de shared/ desde los DOS
// consumidores). Aqui se prueba directo el modulo compartido, en tests/huellaLote.test.ts se
// prueba a traves de `normalizarCorreo` (uno de sus consumidores reales).
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizarCorreo, enmascararCorreo, enmascararCorreosEnTexto } from "../shared/correo";

test("sanitizarCorreo: correo ya limpio queda igual (en minuscula)", () => {
  assert.equal(sanitizarCorreo("ana@x.com"), "ana@x.com");
});

test("sanitizarCorreo: caracter de ancho cero (U+200B) se quita", () => {
  assert.equal(sanitizarCorreo("ana​@x.com"), "ana@x.com");
});

test("sanitizarCorreo: espacio INTERNO se quita (no solo trim)", () => {
  assert.equal(sanitizarCorreo("ana @x.com"), "ana@x.com");
});

test("sanitizarCorreo: marca de direccion LRM (U+200E) al final se quita", () => {
  assert.equal(sanitizarCorreo("ana@x.com‎"), "ana@x.com");
});

test("sanitizarCorreo: mayusculas + espacio al final -> minuscula sin espacio", () => {
  assert.equal(sanitizarCorreo("Ana@X.com "), "ana@x.com");
});

test("sanitizarCorreo: las 4 variantes del oraculo (GRAVE 3) normalizan al MISMO valor", () => {
  const variantes = ["ana​@x.com", "ana @x.com", "ana@x.com‎", "Ana@X.com "];
  for (const v of variantes) {
    assert.equal(sanitizarCorreo(v), "ana@x.com", `variante "${v}" no normalizo a "ana@x.com"`);
  }
});

test("sanitizarCorreo: varios caracteres invisibles combinados con espacios y mayusculas", () => {
  assert.equal(sanitizarCorreo("‎ Ana ​ @ X . Com ‪"), "ana@x.com");
});

test("sanitizarCorreo: nunca lanza con una cadena vacia", () => {
  assert.equal(sanitizarCorreo(""), "");
});

// ── enmascararCorreo / enmascararCorreosEnTexto (Sentinel/security-review sobre ad80fd6, hallazgo
// Bajo: ningun log del servidor debe contener un "@" del destinatario) ─────────────────────────

test("enmascararCorreo: nunca deja un '@' en el resultado", () => {
  assert.ok(!enmascararCorreo("ana@dominio.com").includes("@"));
});

test("enmascararCorreo: conserva el dominio (util para depurar) pero oculta el usuario", () => {
  const resultado = enmascararCorreo("ana@dominio.com");
  assert.match(resultado, /^a\*\*\* en dominio\.com$/);
});

test("enmascararCorreo: normaliza (mayusculas/espacios) antes de enmascarar, igual que sanitizarCorreo", () => {
  assert.equal(enmascararCorreo("Ana@Dominio.Com "), enmascararCorreo("ana@dominio.com"));
});

test("enmascararCorreo: entrada sin '@' (formato invalido) -> '***' generico, nunca lanza", () => {
  assert.equal(enmascararCorreo("no-es-un-correo"), "***");
  assert.equal(enmascararCorreo(""), "***");
});

test("enmascararCorreosEnTexto: reemplaza TODOS los correos de un texto libre, nunca deja un '@'", () => {
  const texto = 'La API de Gmail rechazó la dirección "ana@dominio.com" y también falló para otro@x.com.';
  const resultado = enmascararCorreosEnTexto(texto);
  assert.ok(!resultado.includes("@"), `no debe quedar ningun '@': "${resultado}"`);
  assert.ok(!resultado.includes("ana@dominio.com"));
  assert.ok(!resultado.includes("otro@x.com"));
  assert.match(resultado, /a\*\*\* en dominio\.com/);
  assert.match(resultado, /o\*\*\* en x\.com/);
});

test("enmascararCorreosEnTexto: texto sin ningun correo queda intacto", () => {
  const texto = "Detalle de API de Gmail: Invalid To header (Código 400)";
  assert.equal(enmascararCorreosEnTexto(texto), texto);
});
