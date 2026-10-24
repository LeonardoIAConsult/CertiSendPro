// Topes anti-abuso del servidor (Sentinel full 2026-10-24: H2, H3, H5, H7). Funciones PURAS, sin
// Express ni red, para poder probarlas (tests/limitesAbuso.test.ts). server.ts solo las cablea.
//
// Nota de despliegue: el servicio corre con maxScale=1 y 1 GiB, asi que los contadores en memoria
// son exactos (una sola instancia). Si algun dia se sube maxScale, estos topes pasan a ser POR
// INSTANCIA (mas laxos): habria que moverlos a Firestore/Redis.

/** Dia calendario de Colombia (UTC-5, sin horario de verano) como clave del contador diario. */
export function claveDiaColombia(ahoraMs: number): string {
  return new Date(ahoraMs - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

export interface ConteoDiario {
  dia: string;
  n: number;
}

/**
 * H2: tope diario de paginas analizadas con IA por usuario. Cuenta UNA pagina por llamada; el limite
 * por minuto del limitador global sigue aplicando aparte. `max <= 0` o no finito desactiva el tope.
 * Devuelve ok=false SIN contar la llamada rechazada.
 */
export function contarUsoDiario(
  conteos: Map<string, ConteoDiario>,
  clave: string,
  ahoraMs: number,
  max: number
): { ok: boolean; usadas: number; restantes: number } {
  if (!Number.isFinite(max) || max <= 0) return { ok: true, usadas: 0, restantes: Infinity };
  const dia = claveDiaColombia(ahoraMs);
  const actual = conteos.get(clave);
  const n = actual && actual.dia === dia ? actual.n : 0;
  if (n >= max) return { ok: false, usadas: n, restantes: 0 };
  conteos.set(clave, { dia, n: n + 1 });
  // limpieza: al cambiar de dia las entradas viejas ya no sirven.
  if (conteos.size > 5000) {
    for (const [k, v] of conteos) if (v.dia !== dia) conteos.delete(k);
  }
  return { ok: true, usadas: n + 1, restantes: max - (n + 1) };
}

export interface EntradaCache {
  clave: string;
  /** Peso real de la entrada: PDF original + paginas ya extraidas (base64). */
  bytes: number;
  /** Ultima vez que se USO la sesion (no la de creacion): ordena la expulsion (LRU). */
  ultimoUso: number;
  /** Sesion creada sin login (Modo Invitado). */
  invitado: boolean;
}

/**
 * H3: antes de guardar un PDF nuevo en la cache en memoria, decide si cabe bajo `maxTotalBytes`.
 * Politica (la sesion de un usuario con login no la pierde un invitado):
 *  - si el nuevo es de INVITADO: solo puede expulsar sesiones de invitado (las menos usadas primero);
 *  - si el nuevo es de usuario con login: expulsa primero invitados y, si no alcanza, las sesiones con
 *    login menos usadas.
 * Si el PDF nuevo solo ya supera el tope, o no cabe expulsando lo permitido, no se acepta (y no se
 * expulsa nada: el llamador solo borra si `aceptar` es true). No modifica nada.
 */
export function hacerEspacioEnCache(
  entradas: readonly EntradaCache[],
  nuevoBytes: number,
  maxTotalBytes: number,
  nuevoEsInvitado: boolean
): { aceptar: boolean; expulsar: string[] } {
  if (nuevoBytes > maxTotalBytes) return { aceptar: false, expulsar: [] };
  let total = entradas.reduce((s, e) => s + e.bytes, 0);
  if (total + nuevoBytes <= maxTotalBytes) return { aceptar: true, expulsar: [] };
  const menosUsadasPrimero = (a: EntradaCache, b: EntradaCache) => a.ultimoUso - b.ultimoUso;
  const invitados = entradas.filter((e) => e.invitado).sort(menosUsadasPrimero);
  const conLogin = entradas.filter((e) => !e.invitado).sort(menosUsadasPrimero);
  const candidatas = nuevoEsInvitado ? invitados : [...invitados, ...conLogin];
  const expulsar: string[] = [];
  for (const e of candidatas) {
    if (total + nuevoBytes <= maxTotalBytes) break;
    expulsar.push(e.clave);
    total -= e.bytes;
  }
  const cabe = total + nuevoBytes <= maxTotalBytes;
  return cabe ? { aceptar: true, expulsar } : { aceptar: false, expulsar: [] };
}

const SUFIJOS_INTERNOS = [".local", ".localhost", ".localdomain", ".internal", ".lan", ".intranet", ".corp", ".home", ".arpa"];

/**
 * H5: la URL de descarga que devuelve Canva debe ser https hacia un host publico con nombre (no IP,
 * no localhost, no nombres internos). No se fija una lista de dominios porque Canva puede cambiar de
 * CDN. Esto cierra lo evidente; server.ts ademas resuelve el DNS y rechaza IPs privadas
 * (`esIpPrivada`), valida CADA redireccion y limita tiempo y tamano.
 */
export function urlDescargaCanvaSegura(valor: unknown): boolean {
  if (typeof valor !== "string") return false;
  let u: URL;
  try {
    u = new URL(valor);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== "443") return false;
  // Un punto final ("localhost.", "metadata.google.internal.") es el mismo host para el DNS.
  const host = u.hostname.toLowerCase().replace(/\.+$/, "");
  if (!host.includes(".")) return false; // sin punto: "localhost", "metadata", nombres de red interna
  if (host.startsWith("[") || host.includes(":")) return false; // IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false; // IPv4 literal
  if (/^[\d.]+$/.test(host) || /^0x[0-9a-f.x]+$/i.test(host)) return false; // IP en decimal/octal/hex disfrazada
  if (SUFIJOS_INTERNOS.some((s) => host.endsWith(s))) return false;
  return true;
}

/** IP privada, loopback, link-local (incluye metadata 169.254.x), CGNAT, multicast o reservada (v4 y v6). */
export function esIpPrivada(ip: string): boolean {
  const s = ip.trim().toLowerCase();
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reservadas
    return false;
  }
  if (s.includes(":")) {
    if (s === "::" || s === "::1") return true;
    const v4 = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/); // IPv4 mapeada
    if (v4) return esIpPrivada(v4[1]);
    const hex = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
      return esIpPrivada(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (/^f[cd]/.test(s)) return true; // fc00::/7 (ULA)
    if (/^fe[89ab]/.test(s)) return true; // fe80::/10 (link-local)
    if (/^ff/.test(s)) return true; // multicast
    return false;
  }
  return true; // no es una IP valida: ante la duda, se trata como no segura
}

/** H7: el nombre del adjunto va dentro de cabeceras MIME entre comillas: sin controles (CR/LF/NUL), comillas ni barras. */
export function sanearNombreAdjunto(nombre: string): string {
  // eslint-disable-next-line no-control-regex
  return String(nombre).replace(/[\u0000-\u001f\u007f"\\]/g, "_").slice(0, 200);
}

/**
 * H3 (ronda 2 del REVISOR): cada pagina extraida con pdf-lib puede arrastrar recursos compartidos del PDF
 * (una imagen o fuente comun), asi que `extractedPages` puede crecer mucho mas que el PDF original. Una
 * pagina nueva solo se guarda en cache si el peso total de la sesion (PDF + paginas ya guardadas + la nueva)
 * sigue bajo el mayor de 64 MB y 4 veces el PDF; si no, se devuelve al cliente SIN cachearla.
 */
export function puedeCachearPagina(bufferBytes: number, bytesExtraidas: number, paginaBytes: number): boolean {
  const tope = Math.max(64 * 1024 * 1024, bufferBytes * 4);
  return bufferBytes + bytesExtraidas + paginaBytes <= tope;
}
