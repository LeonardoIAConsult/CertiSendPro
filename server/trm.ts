// TRM robusta y validacion de precios en el servidor (Tarea 4, cobro real con planes,
// 2026-10-05). Separado de server.ts (igual que server/cuentas.ts) para poder probar la
// validacion y el cacheo SIN red ni arrancar el servidor Express completo (server.ts llama
// app.listen() al importarse).
//
// Reglas (spec Tarea 4 / §4 "precio Pro por formula" y §6 "Cobro distinto del avisado"): NUNCA
// se cobra con un dato viejo. Una fila de datos.gov.co (dataset 32sa-8pi3) se rechaza si no
// tiene valor numerico, su vigencia tiene mas de 5 dias de antiguedad, o el valor cae fuera de
// un rango creible. La cache en memoria solo vale para el MISMO dia de vigencia — nunca se
// devuelve una cache vencida. Sin TRM valida hoy, `trmHoy()` devuelve null; quien llama (p. ej.
// /api/mercadopago/create-preference) responde 503 en vez de usar un dato malo.

export const TRM_MIN = 2000;
export const TRM_MAX = 10000;
const TRM_ANTIGUEDAD_MAX_MS = 5 * 24 * 3600_000; // 5 dias
const TRM_TIMEOUT_MS = 5000;

export interface TrmValida {
  valor: number;
  /** Fecha de VIGENCIA de la fila (yyyy-mm-dd) — no la fecha en la que se hizo la consulta. */
  fecha: string;
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
 * Valida una fila cruda del dataset 32sa-8pi3 de datos.gov.co. Funcion PURA (sin red), para
 * poder probarla con node:test sin tocar la caché ni el fetch. Rechaza (devuelve null) si:
 * - la fila no existe (respuesta vacia) o su `valor` no es un numero finito,
 * - el valor cae fuera de [TRM_MIN, TRM_MAX] (dato absurdo),
 * - `vigenciadesde` falta o no se puede leer como fecha,
 * - esa vigencia tiene mas de 5 dias de antiguedad respecto a `ahora`.
 */
export function validarFilaTrm(fila: any, ahora: Date): TrmValida | null {
  if (!fila) return null;

  const valor = Number(fila.valor);
  if (!Number.isFinite(valor) || valor < TRM_MIN || valor > TRM_MAX) return null;

  const vigenciaRaw = fila.vigenciadesde;
  if (!vigenciaRaw) return null;
  const vigencia = new Date(vigenciaRaw);
  if (Number.isNaN(vigencia.getTime())) return null;
  if (ahora.getTime() - vigencia.getTime() > TRM_ANTIGUEDAD_MAX_MS) return null;

  return { valor, fecha: String(vigenciaRaw).slice(0, 10) };
}

/**
 * Devuelve `cache` solo si su fecha de vigencia es la de HOY (zona Bogota); si no, null. Funcion
 * PURA: no toca el estado del modulo, para poder probar "cache de hoy" vs "cache de ayer" sin
 * manipular variables internas. Antes, la cache tenia un TTL fijo (horas) y se devolvia aunque
 * estuviera vencida si la consulta nueva fallaba; ahora nunca se devuelve una cache de un dia
 * distinto al de hoy.
 */
export function cacheVigente(cache: TrmValida | null, ahora: Date): TrmValida | null {
  if (!cache) return null;
  return cache.fecha === hoyBogota(ahora) ? cache : null;
}

async function consultarTrmRemota(fetchFn: FetchLike): Promise<any> {
  const hoy = hoyBogota(new Date());
  const url =
    "https://www.datos.gov.co/resource/32sa-8pi3.json?$order=vigenciadesde%20DESC&$limit=1" +
    "&$where=vigenciadesde%3C%3D%27" + hoy + "T00:00:00%27";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TRM_TIMEOUT_MS);
  try {
    const r = await fetchFn(url, { signal: controller.signal });
    if (!r.ok) return null;
    const filas = await r.json();
    return Array.isArray(filas) ? filas[0] ?? null : null;
  } finally {
    clearTimeout(timeoutId);
  }
}

let trmCacheMemoria: TrmValida | null = null;

/**
 * TRM del dia: timeout de 5 s (AbortController) a datos.gov.co, fila validada con
 * `validarFilaTrm`, y cache en memoria valida solo para el mismo dia de vigencia (`cacheVigente`).
 * `fetchFn` es inyectable para pruebas (p. ej. simular un timeout); en produccion usa el `fetch`
 * global de Node, sin dependencias nuevas. Sin TRM valida hoy, devuelve null — nunca una cache
 * vencida ni un dato viejo.
 */
export async function trmHoy(fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<TrmValida | null> {
  const ahora = new Date();
  const cacheDeHoy = cacheVigente(trmCacheMemoria, ahora);
  if (cacheDeHoy) return cacheDeHoy;

  try {
    const fila = await consultarTrmRemota(fetchFn);
    const validada = validarFilaTrm(fila, ahora);
    if (validada) {
      trmCacheMemoria = validada;
      return validada;
    }
  } catch (e) {
    console.error("[TRM] datos.gov.co no respondio:", e);
  }
  return null;
}

/**
 * SOLO PARA PRUEBAS: limpia la cache en memoria. `trmCacheMemoria` es estado de modulo (igual
 * que en produccion, para no pagar una consulta de red en cada llamada dentro del mismo dia);
 * sin este reset, una prueba de `trmHoy` que cachea un valor contaminaria las pruebas siguientes
 * del mismo archivo (mismo proceso de node:test, mismo modulo).
 */
export function _resetCacheParaPruebas(): void {
  trmCacheMemoria = null;
}
