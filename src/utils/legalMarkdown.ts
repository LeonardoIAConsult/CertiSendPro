// Markdown minimo para las paginas legales (/terminos, /privacidad — Tarea 11, cobro real con
// planes, 2026-10-05). Escalera YAGNI: el proyecto no tiene ningun renderer de markdown
// instalado (`grep -rn "marked\|remark\|markdown-it" package.json` -> nada) y no hay dependencia
// ya instalada que lo haga; una libreria nueva para dos paginas de texto legal seria sobre-
// ingenieria, asi que esto es la funcion minima propia que pide la orden: titulos, parrafos,
// listas, negrita y enlaces, sin nada mas. PURA (no toca el DOM, no lee import.meta.env) para
// poder probarla con node:test, mismo patron que server/trm.ts y shared/textosCasillas.ts.
//
// El markdown de entrada SIEMPRE es nuestro (src/legal/*.md, nunca contenido de un usuario), pero
// de todas formas se escapa < > & antes de generar cualquier etiqueta — asi un valor raro en una
// variable de entorno (PROVEEDOR_*, sustituida ANTES de llegar aqui) no puede inyectar HTML.

/** Valores conocidos del proveedor para sustituir los placeholders `{{PROVEEDOR_*}}` del
 * markdown legal. Cualquier campo ausente o vacio queda como "[dato pendiente]" — nunca se
 * inventa un dato (regla del Brain) y nunca rompe el reemplazo. */
export interface ValoresProveedor {
  nombre?: string;
  documento?: string;
  direccion?: string;
  telefono?: string;
}

const MARCADOR_PENDIENTE = "[dato pendiente]";

const CLAVE_A_CAMPO: Record<string, keyof ValoresProveedor> = {
  PROVEEDOR_NOMBRE: "nombre",
  PROVEEDOR_DOC: "documento",
  PROVEEDOR_DIR: "direccion",
  PROVEEDOR_TEL: "telefono",
};

/** Reemplaza cada `{{PROVEEDOR_NOMBRE|DOC|DIR|TEL}}` del markdown por el valor dado; si falta o
 * esta vacio (solo espacios), queda el literal "[dato pendiente]". Nunca lanza. */
export function reemplazarPlaceholdersProveedor(markdown: string, valores: ValoresProveedor): string {
  return markdown.replace(/\{\{(PROVEEDOR_[A-Z]+)\}\}/g, (coincidencia, clave: string) => {
    const campo = CLAVE_A_CAMPO[clave];
    const valor = campo ? valores[campo] : undefined;
    return valor && valor.trim() ? valor.trim() : MARCADOR_PENDIENTE;
  });
}

function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Reglas de linea (codigo en linea, negrita, enlaces) aplicadas DESPUES de escapar — por eso el
 * texto dentro de `` `..` ``, `**..**` o `[..](..)` nunca puede contener una etiqueta real, solo
 * las que esta funcion genera. Los enlaces solo aceptan http(s) o mailto: (nunca `javascript:` u
 * otro esquema). Medio 1 (correccion vuelta 33, 2026-10-06): el codigo en linea se procesa
 * PRIMERO, partiendo el texto en segmentos — dentro de un segmento de codigo nunca se interpreta
 * negrita ni enlaces (igual que cualquier markdown real), solo se escapa. */
function convertirLinea(texto: string): string {
  const segmentos = texto.split(/(`[^`]+`)/g);
  return segmentos
    .map((segmento) => {
      if (segmento.length >= 2 && segmento.startsWith("`") && segmento.endsWith("`")) {
        return `<code>${escaparHtml(segmento.slice(1, -1))}</code>`;
      }
      let salida = escaparHtml(segmento);
      salida = salida.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      salida = salida.replace(
        /\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g,
        (_m, textoEnlace: string, url: string) =>
          `<a href="${url}" target="_blank" rel="noopener noreferrer">${textoEnlace}</a>`
      );
      return salida;
    })
    .join("");
}

// ── Tablas GFM (Medio 1, correccion vuelta 33, 2026-10-06) ──────────────────────────────────────
// `| Encabezado | ... |` seguido de una fila separadora `|---|:--:|...` (solo guiones/colones/
// espacios por celda) es una tabla. Sin eso, los documentos legales reales (docs/legal/*.md,
// copiados a src/legal/) mostraban cada fila de tabla como una sola linea con los `|` literales
// (limite declarado en la correccion de la vuelta 31, GRAVE 3(a)) — ahora se reconoce y se
// convierte a <table>/<thead>/<tbody> de verdad. Sin tablas anidadas ni celdas con `|` escapado
// (no los pide la orden y ninguno de los documentos reales los usa).
function esFilaDeTabla(linea: string): boolean {
  return /^\|.*\|$/.test(linea.trim());
}

function celdasDeFila(linea: string): string[] {
  const sinBordes = linea.trim().replace(/^\|/, "").replace(/\|$/, "");
  return sinBordes.split("|").map((celda) => celda.trim());
}

function esFilaSeparadoraDeTabla(linea: string): boolean {
  if (!esFilaDeTabla(linea)) return false;
  const celdas = celdasDeFila(linea);
  return celdas.length > 0 && celdas.every((celda) => /^:?-+:?$/.test(celda));
}

/** Convierte markdown minimo a HTML: `#`..`######` como titulos, `---` como separador, lineas que
 * empiezan con "- " o "* " como lista, tablas GFM (encabezado + fila separadora + filas), lineas
 * en blanco separan parrafos, y dentro de cualquier linea `` `codigo` ``, `**negrita**` y
 * `[texto](url)`. Sin HTML crudo — no lo pide la orden y los documentos legales no lo necesitan. */
export function markdownAHtml(markdown: string): string {
  // GRAVE 3(a) (correccion vuelta 31, 2026-10-06): los `.plantilla.md` reales (copiados a
  // src/legal/terminos.md y privacidad.md) empiezan con un comentario HTML de uso interno
  // (`<!-- PLANTILLA PUBLICABLE generada desde... -->`, nota de mantenimiento para quien edita el
  // documento, nunca para el usuario final). Sin quitarlo, era la PRIMERA linea visible de la
  // pagina de Terminos/Privacidad publicada — se quita ANTES de partir en lineas, igual que
  // cualquier markdown real descarta los comentarios HTML.
  const sinComentarios = markdown.replace(/<!--[\s\S]*?-->/g, "");
  const lineas = sinComentarios.replace(/\r\n/g, "\n").split("\n");
  const bloques: string[] = [];

  let parrafoActual: string[] = [];
  let listaActual: string[] = [];

  const cerrarParrafo = () => {
    if (parrafoActual.length > 0) {
      bloques.push(`<p>${parrafoActual.map(convertirLinea).join(" ")}</p>`);
      parrafoActual = [];
    }
  };
  const cerrarLista = () => {
    if (listaActual.length > 0) {
      bloques.push(`<ul>${listaActual.map((item) => `<li>${convertirLinea(item)}</li>`).join("")}</ul>`);
      listaActual = [];
    }
  };

  let i = 0;
  while (i < lineas.length) {
    const linea = lineas[i].trim();

    if (linea === "") {
      cerrarParrafo();
      cerrarLista();
      i++;
      continue;
    }
    if (linea === "---") {
      cerrarParrafo();
      cerrarLista();
      bloques.push("<hr />");
      i++;
      continue;
    }
    // Tabla GFM: la linea actual es una fila (`| .. | .. |`) Y la SIGUIENTE es su separadora
    // (`|---|---|`) — necesita mirar una linea adelante, por eso este bucle es indexado y no
    // un `for..of` como antes.
    if (esFilaDeTabla(linea) && i + 1 < lineas.length && esFilaSeparadoraDeTabla(lineas[i + 1].trim())) {
      cerrarParrafo();
      cerrarLista();
      const encabezados = celdasDeFila(linea);
      i += 2; // la fila de encabezado + su separadora.
      const filas: string[][] = [];
      while (i < lineas.length && esFilaDeTabla(lineas[i].trim())) {
        filas.push(celdasDeFila(lineas[i].trim()));
        i++;
      }
      const thead = `<thead><tr>${encabezados.map((h) => `<th>${convertirLinea(h)}</th>`).join("")}</tr></thead>`;
      const tbody = `<tbody>${filas
        .map((fila) => `<tr>${fila.map((celda) => `<td>${convertirLinea(celda)}</td>`).join("")}</tr>`)
        .join("")}</tbody>`;
      bloques.push(`<table>${thead}${tbody}</table>`);
      continue;
    }
    const encabezado = /^(#{1,6})\s+(.+)$/.exec(linea);
    if (encabezado) {
      cerrarParrafo();
      cerrarLista();
      const nivel = encabezado[1].length;
      bloques.push(`<h${nivel}>${convertirLinea(encabezado[2])}</h${nivel}>`);
      i++;
      continue;
    }
    const item = /^[-*]\s+(.+)$/.exec(linea);
    if (item) {
      cerrarParrafo();
      listaActual.push(item[1]);
      i++;
      continue;
    }
    cerrarLista();
    parrafoActual.push(linea);
    i++;
  }
  cerrarParrafo();
  cerrarLista();

  return bloques.join("\n");
}
