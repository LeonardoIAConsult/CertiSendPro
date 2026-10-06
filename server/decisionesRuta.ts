// Extraido de server.ts (vuelta 35/36, correccion sobre tests/decisionesRuta.test.ts): las partes
// de DECISION de dos rutas — POST /api/send-email (la huella) y POST /api/lote/iniciar (la
// autorizacion de datos) — con dependencias inyectadas, para poder probarlas de verdad con
// node:test sin Express/Firestore real. Antes, tests/decisionesRuta.test.ts solo grepeaba el
// texto fuente de server.ts (confirmaba que la palabra "decidirEnvioConHuella" aparecia cerca de
// la ruta, nunca que la decision fuera correcta); ahora server.ts delega en estas dos funciones y
// la prueba ejercita la logica real.
import { sanitizarCorreo } from "../shared/correo";
import { decidirEnvioConHuella } from "./huellaLote";
import { decidirAutorizacionLote, decidirAceptacionUso, type AutorizacionDatos, type AceptacionUso } from "./cuentas";

// ── POST /api/send-email: decision de la huella (sanear -> validar -> comparar) ─────────────────

export interface EntradaDecisionEnvio {
  to: unknown;
  fila: unknown;
  pageIndex: unknown;
}

export interface DepsDecisionEnvio {
  obtenerHuellasLote(loteId: string): Promise<string[] | null>;
  secretoHuella: string | undefined;
}

export type ResultadoDecisionEnvio =
  | { ok: true; correo: string }
  | { ok: false; httpStatus: 400 | 503 | 409; error: string };

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * GRAVE 3 (vuelta 33): `correo` SIEMPRE sale de `sanitizarCorreo` (el MISMO sanitizador que usa
 * el cliente al construir `pares` en `/api/lote/iniciar`) — nunca `String(entrada.to)` crudo. Si
 * se usara el valor crudo, un correo con un espacio interno o un caracter invisible produciria
 * una huella DISTINTA de la que `/api/lote/iniciar` guardo para ese mismo correo (ya saneado del
 * lado del cliente), y el envio caeria en 409 permanente aunque el usuario confirmara el lote
 * correctamente — ver `tests/decisionesRuta.test.ts`, mutacion "usa el correo crudo".
 *
 * El resultado de `decidirEnvioConHuella` NUNCA se ignora: es la UNICA defensa de que lo que esta
 * a punto de enviarse es EXACTAMENTE uno de los pares que el usuario confirmo en
 * `/api/lote/iniciar` (Medio 3) — ver `tests/decisionesRuta.test.ts`, mutacion "ignora el
 * resultado".
 */
export async function decidirEnvioSendEmail(
  loteId: string,
  entrada: EntradaDecisionEnvio,
  deps: DepsDecisionEnvio
): Promise<ResultadoDecisionEnvio> {
  const correo = sanitizarCorreo(String(entrada.to || ""));
  if (!EMAIL_REGEX.test(correo)) {
    return {
      ok: false,
      httpStatus: 400,
      error:
        `La dirección de correo "${correo}" no tiene un formato válido (p. ej., usuario@dominio.com). Por favor, ` +
        `en el PASO 1 (Configuración de Columnas), asegúrate de haber mapeado la 'COLUMNA DE CORREO' con la columna ` +
        `de tu Google Sheet que contiene los correos electrónicos reales.`,
    };
  }

  const fila = Number(entrada.fila);
  const pagina = Number(entrada.pageIndex);
  if (!Number.isFinite(fila) || !Number.isFinite(pagina)) {
    return { ok: false, httpStatus: 400, error: "Faltan los datos de verificación (pageIndex/fila) del certificado." };
  }

  const huellas = await deps.obtenerHuellasLote(loteId);
  const decision = decidirEnvioConHuella({ pagina, fila, correo }, huellas, deps.secretoHuella);
  if (decision.ok === false) {
    return { ok: false, httpStatus: decision.httpStatus, error: decision.error };
  }
  return { ok: true, correo };
}

// ── Sesiones de PDF en cache (POST /api/split-pdf + consumidores: get-page-pdf, analyze-page,
// send-email) — Sentinel/security-review sobre ad80fd6, hallazgo previo al diff ────────────────
// Extraida de server.ts (que guarda `pdfCache` en memoria, no Firestore) para poder probar el
// contrato de ownership con node:test sin montar Express: una sesion sin dueño (`uid: null`,
// creada sin sesion de Firebase — Modo Invitado, que SI sube PDFs reales) sigue siendo accesible
// por cualquiera que tenga el id (comportamiento historico, ahora con un id impredecible via
// `crypto.randomUUID()`); una sesion CON dueño solo la puede volver a leer ESE uid — cualquier
// otro (incluido anonimo) la ve igual que si no existiera.

/**
 * `cachedUid`: `undefined` si la sesion no existe en el cache; el valor de `PdfCacheEntry.uid` si
 * existe (`null` = sesion anonima, `string` = uid del dueño). `requesterUid`: el uid de quien pide
 * la pagina (`req.uid ?? null`). `true` = acceso permitido.
 */
export function decidirAccesoSesionPdf(cachedUid: string | null | undefined, requesterUid: string | null): boolean {
  if (cachedUid === undefined) return false; // la sesion no existe (o expiro).
  if (cachedUid === null) return true; // sesion anonima: accesible por cualquiera que tenga el id.
  return cachedUid === requesterUid; // sesion con dueño: solo ESE uid.
}

// ── POST /api/lote/iniciar: decision de la autorizacion de datos (Ley 1581, B.3) ────────────────

export interface DepsDecisionAutorizacionLote {
  obtenerAutorizacionDatos(uid: string): Promise<AutorizacionDatos | null>;
}

/**
 * Lee la autorizacion guardada del usuario y delega en `decidirAutorizacionLote` (server/cuentas.ts,
 * PURA, ya probada por su cuenta en tests/autorizacionDatos.test.ts) — esta funcion existe para
 * que la RUTA (server.ts) tenga un unico punto de llamada que SI se puede probar sin Firestore
 * real, en vez de leer la autorizacion inline y confiar en que nadie ignore el resultado.
 */
export async function decidirAutorizacionLoteRuta(
  uid: string,
  versionVigente: string,
  deps: DepsDecisionAutorizacionLote
): Promise<{ ok: true } | { ok: false; httpStatus: 403; error: string; motivo: "autorizacion" }> {
  const autorizacion = await deps.obtenerAutorizacionDatos(uid);
  return decidirAutorizacionLote(autorizacion, versionVigente);
}

// ── POST /api/lote/iniciar: decision de la aceptacion de Terminos y Condiciones (O2, Dictamen
// Abogado_LAP ronda 5, 2026-10-06) ──────────────────────────────────────────────────────────────

export interface DepsDecisionAceptacionUso {
  obtenerAceptacionUso(uid: string): Promise<AceptacionUso | null>;
}

/**
 * Lee la aceptacion de Terminos guardada del usuario y delega en `decidirAceptacionUso`
 * (server/cuentas.ts, PURA) — mismo motivo que `decidirAutorizacionLoteRuta`: un unico punto de
 * llamada en `server.ts` que SI se puede probar sin Firestore real.
 */
export async function decidirAceptacionUsoRuta(
  uid: string,
  versionVigente: string,
  deps: DepsDecisionAceptacionUso
): Promise<{ ok: true } | { ok: false; httpStatus: 403; error: string; motivo: "terminos" }> {
  const aceptacion = await deps.obtenerAceptacionUso(uid);
  return decidirAceptacionUso(aceptacion, versionVigente);
}
