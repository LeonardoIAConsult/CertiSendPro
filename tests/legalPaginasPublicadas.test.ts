// GRAVE 1 (NO-GO del REVISOR_EXTERNO_LAP, vuelta 33, 2026-10-06): las paginas legales publicadas
// (/terminos, /privacidad) mostraban notas internas de desarrollo — bloques
// "[CONDICIÓN DE PRODUCTO ...]" (seguimiento de que tarea de codigo cumple cada clausula) y el
// comentario HTML de mantenimiento ("Preparada con asistencia de IA...") — visibles para
// cualquier usuario real. Esta prueba renderiza los DOS .md reales de src/legal/ (el contenido
// que de verdad sirve LegalPage.tsx) con el MISMO pipeline de produccion
// (reemplazarPlaceholdersProveedor + markdownAHtml) y falla si el resultado contiene cualquier
// rastro de nota interna. Tambien falla sobre el ARCHIVO CRUDO si contiene un comentario HTML —
// nunca debe depender solo de que markdownAHtml lo filtre en el render.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { reemplazarPlaceholdersProveedor, markdownAHtml } from "../src/utils/legalMarkdown";

const RAIZ = process.cwd();
const ARCHIVOS_LEGALES = ["src/legal/terminos.md", "src/legal/privacidad.md"] as const;

// Las mismas rachas de texto que encontro el REVISOR en la vuelta 33: notas de seguimiento de
// tarea, rutas del codigo del servidor/cliente, referencias a "vuelta N" de revision, y la
// instruccion interna "Leonardo debe...". `vuelta\s+\d` (no solo "vuelta ") evita un falso
// positivo con la prosa legitima de la Politica de Privacidad ("CertiSend recibe de vuelta solo
// lo descrito...", sección 6) que SI contiene la palabra "vuelta" sin ser una nota de revision.
// O8 (Dictamen Abogado_LAP ronda 5, 2026-10-06, Medio): §4.5 de terminos.md citaba
// "T6-bis de `textos-checkout.md`" — una referencia interna a un documento de trabajo
// (docs/legal/textos-checkout.md, BORRADOR, gitignored) que un usuario real nunca puede abrir.
// Igual que "vuelta N" o "server/"/"src/", ninguna de las dos cadenas debe volver a aparecer en
// el texto PUBLICADO: ni el nombre del documento interno ("textos-checkout") ni el id de la
// clausula de trabajo ("T6-bis").
const PATRONES_PROHIBIDOS: RegExp[] = [
  /CONDICI[ÓO]N DE PRODUCTO/i,
  /PRODUCTO CUMPLIDA/i,
  /\bserver\//,
  /\bsrc\//,
  /vuelta\s+\d+/i,
  /Leonardo debe/i,
  /<!--/,
  /textos-checkout/i,
  /T6-bis/i,
];

function valoresDePrueba() {
  return { nombre: "Proveedor de Prueba S.A.S.", documento: "900000000-1", direccion: "Calle 1 # 2-3, Bogotá", telefono: "+57 300 000 0000" };
}

for (const archivo of ARCHIVOS_LEGALES) {
  const rutaAbsoluta = path.join(RAIZ, archivo);

  test(`${archivo}: el archivo CRUDO no contiene ningun comentario HTML`, () => {
    const crudo = fs.readFileSync(rutaAbsoluta, "utf8");
    assert.doesNotMatch(crudo, /<!--/, `${archivo} todavia tiene un comentario HTML en el codigo fuente`);
  });

  test(`${archivo}: el archivo CRUDO no contiene ninguna nota interna de "CONDICIÓN DE PRODUCTO"`, () => {
    const crudo = fs.readFileSync(rutaAbsoluta, "utf8");
    assert.doesNotMatch(crudo, /CONDICI[ÓO]N DE PRODUCTO/i, `${archivo} todavia tiene una nota [CONDICIÓN DE PRODUCTO ...]`);
  });

  test(`${archivo}: el archivo CRUDO no referencia "textos-checkout" ni "T6-bis" (O8, Dictamen ronda 5)`, () => {
    const crudo = fs.readFileSync(rutaAbsoluta, "utf8");
    assert.doesNotMatch(crudo, /textos-checkout/i, `${archivo} todavia referencia el documento interno textos-checkout.md`);
    assert.doesNotMatch(crudo, /T6-bis/i, `${archivo} todavia referencia la clausula interna T6-bis`);
  });

  test(`${archivo}: renderizado con reemplazarPlaceholdersProveedor + markdownAHtml, nunca expone una nota interna`, () => {
    const crudo = fs.readFileSync(rutaAbsoluta, "utf8");
    const html = markdownAHtml(reemplazarPlaceholdersProveedor(crudo, valoresDePrueba()));
    for (const patron of PATRONES_PROHIBIDOS) {
      assert.doesNotMatch(html, patron, `${archivo} renderizado contiene el patron prohibido ${patron}`);
    }
    // Control positivo: el render SI produjo contenido real (no una prueba vacia que pasa por
    // no comparar nada de verdad).
    assert.ok(html.length > 500, `${archivo} renderizo un HTML sospechosamente corto`);
  });
}
