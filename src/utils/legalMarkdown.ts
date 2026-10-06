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

/** Reglas de linea (negrita, enlaces) aplicadas DESPUES de escapar — por eso el texto dentro de
 * `**..**` o `[..](..)` nunca puede contener una etiqueta real, solo las que esta funcion genera.
 * Los enlaces solo aceptan http(s) o mailto: (nunca `javascript:` u otro esquema). */
function convertirLinea(texto: string): string {
  let salida = escaparHtml(texto);
  salida = salida.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  salida = salida.replace(
    /\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g,
    (_m, textoEnlace: string, url: string) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer">${textoEnlace}</a>`
  );
  return salida;
}

/** Convierte markdown minimo a HTML: `#`..`######` como titulos, `---` como separador, lineas que
 * empiezan con "- " o "* " como lista, lineas en blanco separan parrafos, y dentro de cualquier
 * linea `**negrita**` y `[texto](url)`. Sin tablas, sin codigo, sin HTML crudo — no los pide la
 * orden y los documentos legales no los necesitan. */
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

  for (const lineaCruda of lineas) {
    const linea = lineaCruda.trim();

    if (linea === "") {
      cerrarParrafo();
      cerrarLista();
      continue;
    }
    if (linea === "---") {
      cerrarParrafo();
      cerrarLista();
      bloques.push("<hr />");
      continue;
    }
    const encabezado = /^(#{1,6})\s+(.+)$/.exec(linea);
    if (encabezado) {
      cerrarParrafo();
      cerrarLista();
      const nivel = encabezado[1].length;
      bloques.push(`<h${nivel}>${convertirLinea(encabezado[2])}</h${nivel}>`);
      continue;
    }
    const item = /^[-*]\s+(.+)$/.exec(linea);
    if (item) {
      cerrarParrafo();
      listaActual.push(item[1]);
      continue;
    }
    cerrarLista();
    parrafoActual.push(linea);
  }
  cerrarParrafo();
  cerrarLista();

  return bloques.join("\n");
}
