// TRM robusta y validacion de precios en el servidor (Tarea 4, cobro real con planes,
// 2026-10-05; corregida tras NO-GO del REVISOR_EXTERNO_LAP + Abogado_LAP, vuelta 20). Separado de
// server.ts (igual que server/cuentas.ts) para poder probar la validacion y el cacheo SIN red ni
// arrancar el servidor Express completo (server.ts llama app.listen() al importarse).
//
// Decisiones del Brain (2026-10-05), por encima de las reglas de abajo:
//
// D1 — se quita a proposito el tope de salto entre TRM consecutivas. La fuente es la TRM
// CERTIFICADA oficial y los terminos prometen cobrar a la TRM vigente: descartar un salto real
// obligaba a cobrar con un dato viejo, la misma contradiccion que señalo Abogado_LAP (H3/R3-3).
// La defensa contra un dato absurdo es el rango creible [TRM_MIN, TRM_MAX] (TRM_MAX=10000 queda
// como decision registrada, no un numero arbitrario). Un salto > 10% respecto a la ultima TRM
// conocida NUNCA bloquea el cobro: solo deja un `console.warn` con las dos cifras.
//
// D2 — una fila vale si `vigenciadesde <= hoy <= vigenciahasta` (cierra M24/M25). Se compara
// SOLO la parte `yyyy-mm-dd` del texto del dataset contra el "hoy" de Bogota (nunca `new Date`
// sobre la fecha del dataset: datos.gov.co manda horas sin zona y un Date mal interpretado podia
// mover el dia). Se quita el tope fijo de 5 dias de antiguedad: el dataset real ya declara su
// propia vigencia (p. ej. una fila de Semana Santa cubre varios dias). Sin ninguna fila que cubra
// hoy, `trmHoy()` devuelve null — nunca se usa una fila vencida.
//
// Paso 16B (2026-10-07): `copDesdeUsd` se movio a `shared/precios.ts` (sin firebase-admin, nunca
// nada que Vite no pueda empaquetar) para que el panel de "Pago por uso" del cliente
// (src/utils/checkout.ts) pueda mostrar el MISMO total en COP que este modulo va a cobrar de
// verdad — se reexporta aqui para no romper a quien ya la importa de `./server/trm`
// (server.ts, server/cobroPaquete.ts, tests/trm.test.ts, tests/cobroPaquete.test.ts). Mismo
// patron que `TERMINOS_VERSION`/`textoCasillaRetracto` reexportados en server/cuentas.ts desde
// shared/textosCasillas.ts.
export { copDesdeUsd } from "../shared/precios";
export const TRM_MIN = 2000;
export const TRM_MAX = 10000;
const TRM_TIMEOUT_MS = 5000;
const TRM_SALTO_AVISO = 0.10; // 10%: solo advierte, nunca bloquea (D1).

export interface TrmValida {
  valor: number;
  /** Primer dia (yyyy-mm-dd) en que esta fila es vigente. */
  fechaDesde: string;
  /** Ultimo dia (yyyy-mm-dd) en que esta fila sigue siendo vigente (inclusive). */
  fechaHasta: string;
}

/** Forma minima de `fetch` que necesita este modulo, para poder inyectar un doble en pruebas. */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal }
) => Promise<{ ok: boolean; json(): Promise<any> }>;

/** Fecha de hoy en la zona de Bogota, como yyyy-mm-dd (misma zona que usa la consulta a datos.gov.co). */
function hoyBogota(ahora: Date): string {
  return ahora.toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

/**
 * Valida una fila cruda del dataset 32sa-8pi3 de datos.gov.co contra el "hoy" de Bogota derivado
 * de `ahora`. Funcion PURA (sin red), para poder probarla con node:test. Rechaza (devuelve null)
 * si:
 * - la fila no existe (respuesta vacia) o su `valor` no es un numero finito,
 * - el valor cae fuera de [TRM_MIN, TRM_MAX] (dato absurdo),
 * - falta `vigenciadesde` o `vigenciahasta`,
 * - hoy (zona Bogota) NO esta dentro de `[vigenciadesde, vigenciahasta]` (D2).
 *
 * La comparacion de vigencia es de TEXTO (`yyyy-mm-dd <= yyyy-mm-dd`), nunca `new Date` sobre el
 * valor del dataset: ese formato ordena igual que el calendario, y evita que una hora sin zona
 * (o con zona distinta) corra la fecha un dia.
 */
export function validarFilaTrm(fila: any, ahora: Date): TrmValida | null {
  if (!fila) return null;

  const valor = Number(fila.valor);
  if (!Number.isFinite(valor) || valor < TRM_MIN || valor > TRM_MAX) return null;

  const desdeRaw = fila.vigenciadesde;
  const hastaRaw = fila.vigenciahasta;
  if (!desdeRaw || !hastaRaw) return null;

  const fechaDesde = String(desdeRaw).slice(0, 10);
  const fechaHasta = String(hastaRaw).slice(0, 10);
  const hoy = hoyBogota(ahora);
  if (hoy < fechaDesde || hoy > fechaHasta) return null;

  return { valor, fechaDesde, fechaHasta };
}

/**
 * Devuelve `cache` solo si hoy (zona Bogota) sigue dentro de su rango de vigencia
 * `[fechaDesde, fechaHasta]`; si no, null. Funcion PURA: no toca el estado del modulo, para poder
 * probar "cache vigente" vs "cache vencida" sin manipular variables internas. Nunca se devuelve
 * una cache fuera de su vigencia, aunque la consulta nueva falle.
 */
export function cacheVigente(cache: TrmValida | null, ahora: Date): TrmValida | null {
  if (!cache) return null;
  const hoy = hoyBogota(ahora);
  return hoy >= cache.fechaDesde && hoy <= cache.fechaHasta ? cache : null;
}

/**
 * Trae filas candidatas de datos.gov.co, ordenadas por `vigenciadesde DESC` con un `$limit`
 * pequeno (D2: "elige la primera fila que cubra hoy" entre varias, no asume que la mas reciente
 * con `vigenciadesde <= hoy` sea siempre la vigente — p. ej. una fila de Semana Santa puede quedar
 * detras de otra mas nueva que todavia no empieza).
 */
async function consultarFilasTrm(fetchFn: FetchLike, hoy: string): Promise<any[]> {
  const url =
    "https://www.datos.gov.co/resource/32sa-8pi3.json?$order=vigenciadesde%20DESC&$limit=10" +
    "&$where=vigenciadesde%3C%3D%27" + hoy + "T23:59:59%27";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TRM_TIMEOUT_MS);
  try {
    const r = await fetchFn(url, { signal: controller.signal });
    if (!r.ok) return [];
    const filas = await r.json();
    return Array.isArray(filas) ? filas : [];
  } finally {
    clearTimeout(timeoutId);
  }
}

let trmCacheMemoria: TrmValida | null = null;
// Ultima TRM conocida (distinta de la cache: esta NUNCA se limpia solo porque cambio el dia de
// vigencia) para poder avisar de saltos grandes (D1) incluso cruzando dias.
let ultimaTrmConocida: number | null = null;

function avisarSaltoSiAplica(nuevoValor: number): void {
  if (ultimaTrmConocida !== null) {
    const salto = Math.abs(nuevoValor - ultimaTrmConocida) / ultimaTrmConocida;
    if (salto > TRM_SALTO_AVISO) {
      console.warn(
        `[TRM] salto > 10% respecto a la ultima TRM conocida (se usa igual, D1): anterior=${ultimaTrmConocida} nueva=${nuevoValor}`
      );
    }
  }
  ultimaTrmConocida = nuevoValor;
}

/**
 * TRM del dia: timeout de 5 s (AbortController) a datos.gov.co, primera fila (de las mas
 * recientes) que `validarFilaTrm` acepte, y cache en memoria valida mientras hoy siga dentro de
 * su rango de vigencia (`cacheVigente`). `fetchFn` es inyectable para pruebas (p. ej. simular un
 * timeout); en produccion usa el `fetch` global de Node, sin dependencias nuevas. Sin TRM valida
 * hoy, devuelve null — nunca una fila vencida ni un dato absurdo (D1/D2 son la unica defensa
 * ademas de esto: ya no hay tope de salto ni tope de antiguedad fijo).
 */
export async function trmHoy(
  fetchFn: FetchLike = fetch as unknown as FetchLike,
  ahora: Date = new Date()
): Promise<TrmValida | null> {
  const cacheDeHoy = cacheVigente(trmCacheMemoria, ahora);
  if (cacheDeHoy) return cacheDeHoy;

  try {
    const filas = await consultarFilasTrm(fetchFn, hoyBogota(ahora));
    for (const fila of filas) {
      const validada = validarFilaTrm(fila, ahora);
      if (validada) {
        avisarSaltoSiAplica(validada.valor);
        trmCacheMemoria = validada;
        return validada;
      }
    }
  } catch (e) {
    console.error("[TRM] datos.gov.co no respondio:", e);
  }
  return null;
}

/**
 * SOLO PARA PRUEBAS: limpia la cache y la ultima TRM conocida en memoria. Ambas son estado de
 * modulo (igual que en produccion, para no pagar una consulta de red en cada llamada dentro del
 * mismo dia); sin este reset, una prueba de `trmHoy` que cachea un valor contaminaria las pruebas
 * siguientes del mismo archivo (mismo proceso de node:test, mismo modulo).
 */
export function _resetCacheParaPruebas(): void {
  trmCacheMemoria = null;
  ultimaTrmConocida = null;
}
