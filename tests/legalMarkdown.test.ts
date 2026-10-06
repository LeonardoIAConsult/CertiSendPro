// Pruebas de src/utils/legalMarkdown.ts (Tarea 11, cobro real con planes, 2026-10-05).
// node:test puro, sin DOM ni Vite — mismo patron que tests/trm.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reemplazarPlaceholdersProveedor, markdownAHtml } from "../src/utils/legalMarkdown";

// ── reemplazarPlaceholdersProveedor ─────────────────────────────────────────────────────────

test("reemplazarPlaceholdersProveedor: con valor, sustituye cada placeholder por su valor", () => {
  const md = "Proveedor: {{PROVEEDOR_NOMBRE}} · Doc: {{PROVEEDOR_DOC}} · Dir: {{PROVEEDOR_DIR}} · Tel: {{PROVEEDOR_TEL}}";
  const resultado = reemplazarPlaceholdersProveedor(md, {
    nombre: "ACME S.A.S.",
    documento: "900123456-7",
    direccion: "Calle 1 # 2-3",
    telefono: "+57 300 000 0000",
  });
  assert.equal(
    resultado,
    "Proveedor: ACME S.A.S. · Doc: 900123456-7 · Dir: Calle 1 # 2-3 · Tel: +57 300 000 0000"
  );
});

test("reemplazarPlaceholdersProveedor: sin valor, cada placeholder queda '[dato pendiente]'", () => {
  const md = "Nombre: {{PROVEEDOR_NOMBRE}}; Tel: {{PROVEEDOR_TEL}}";
  const resultado = reemplazarPlaceholdersProveedor(md, {});
  assert.equal(resultado, "Nombre: [dato pendiente]; Tel: [dato pendiente]");
});

test("reemplazarPlaceholdersProveedor: un valor vacio o solo espacios se trata igual que ausente", () => {
  const resultado = reemplazarPlaceholdersProveedor("{{PROVEEDOR_DOC}}", { documento: "   " });
  assert.equal(resultado, "[dato pendiente]");
});

test("reemplazarPlaceholdersProveedor: nunca lanza con un markdown sin placeholders", () => {
  assert.equal(reemplazarPlaceholdersProveedor("texto normal sin nada", {}), "texto normal sin nada");
});

test("reemplazarPlaceholdersProveedor: un marcador desconocido ({{OTRA_COSA}}) no se toca", () => {
  const resultado = reemplazarPlaceholdersProveedor("{{OTRA_COSA}} {{PROVEEDOR_NOMBRE}}", { nombre: "X" });
  assert.equal(resultado, "{{OTRA_COSA}} X");
});

// ── markdownAHtml ────────────────────────────────────────────────────────────────────────────

test("markdownAHtml: titulos de distinto nivel", () => {
  assert.equal(markdownAHtml("# Uno"), "<h1>Uno</h1>");
  assert.equal(markdownAHtml("## Dos"), "<h2>Dos</h2>");
  assert.equal(markdownAHtml("### Tres"), "<h3>Tres</h3>");
});

test("markdownAHtml: un parrafo simple", () => {
  assert.equal(markdownAHtml("Hola mundo."), "<p>Hola mundo.</p>");
});

test("markdownAHtml: lineas seguidas sin blanco forman UN parrafo unido con espacio", () => {
  assert.equal(markdownAHtml("linea uno\nlinea dos"), "<p>linea uno linea dos</p>");
});

test("markdownAHtml: una linea en blanco separa dos parrafos", () => {
  assert.equal(markdownAHtml("primero\n\nsegundo"), "<p>primero</p>\n<p>segundo</p>");
});

test("markdownAHtml: lista con guion y con asterisco", () => {
  assert.equal(markdownAHtml("- uno\n- dos"), "<ul><li>uno</li><li>dos</li></ul>");
  assert.equal(markdownAHtml("* uno\n* dos"), "<ul><li>uno</li><li>dos</li></ul>");
});

test("markdownAHtml: negrita dentro de un parrafo", () => {
  assert.equal(markdownAHtml("Esto es **importante** de verdad."), "<p>Esto es <strong>importante</strong> de verdad.</p>");
});

test("markdownAHtml: enlace http(s) y mailto", () => {
  assert.equal(
    markdownAHtml("Escribenos a [contacto](mailto:contacto@leonardoantolinez.com)."),
    '<p>Escribenos a <a href="mailto:contacto@leonardoantolinez.com" target="_blank" rel="noopener noreferrer">contacto</a>.</p>'
  );
  assert.equal(
    markdownAHtml("Ver [sitio](https://certisendpro.online)."),
    '<p>Ver <a href="https://certisendpro.online" target="_blank" rel="noopener noreferrer">sitio</a>.</p>'
  );
});

test("markdownAHtml: separador --- entre bloques", () => {
  assert.equal(markdownAHtml("uno\n\n---\n\ndos"), "<p>uno</p>\n<hr />\n<p>dos</p>");
});

test("markdownAHtml: escapa < > & en el texto, nunca permite HTML crudo", () => {
  assert.equal(markdownAHtml("1 < 2 & 3 > 1"), "<p>1 &lt; 2 &amp; 3 &gt; 1</p>");
});

test("markdownAHtml: un esquema de enlace no permitido (javascript:) no se convierte en <a>", () => {
  const resultado = markdownAHtml("[clic](javascript:alert(1))");
  assert.doesNotMatch(resultado, /<a /);
});

test("markdownAHtml: una comilla en la URL del enlace no puede inyectar un atributo nuevo", () => {
  const resultado = markdownAHtml('[clic](https://a.com/"onmouseover="x)');
  assert.doesNotMatch(resultado, /onmouseover="x/);
  assert.match(resultado, /href="https:\/\/a\.com\/&quot;onmouseover=&quot;x"/);
});

test("markdownAHtml: una comilla simple en el texto del enlace tambien queda escapada", () => {
  const resultado = markdownAHtml("[clic'onmouseover='x](https://a.com)");
  assert.doesNotMatch(resultado, /'onmouseover='x/);
  assert.match(resultado, /&#39;onmouseover=&#39;x/);
});

test("markdownAHtml: combinado — titulo, parrafo, lista y separador, como un documento legal real", () => {
  const md = [
    "# Politica de Privacidad",
    "",
    "**Documento en revision final; vuelve pronto.**",
    "",
    "- Punto uno",
    "- Punto dos",
    "",
    "---",
    "",
    "Proveedor: {{PROVEEDOR_NOMBRE}}",
  ].join("\n");
  const html = markdownAHtml(md);
  assert.match(html, /^<h1>Politica de Privacidad<\/h1>/);
  assert.match(html, /<strong>Documento en revision final; vuelve pronto\.<\/strong>/);
  assert.match(html, /<ul><li>Punto uno<\/li><li>Punto dos<\/li><\/ul>/);
  assert.match(html, /<hr \/>/);
  assert.match(html, /Proveedor: \{\{PROVEEDOR_NOMBRE\}\}/);
});
