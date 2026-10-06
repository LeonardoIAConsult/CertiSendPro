// Verificacion de tokens OIDC de Cloud Scheduler (G2, correccion NO-GO vuelta 30, 2026-10-05):
// protege `POST /api/tareas/barrido-acuses` (server.ts) para que SOLO Cloud Scheduler, con un
// token de identidad firmado por Google, pueda disparar el barrido completo de acuses pendientes.
//
// Decision de dependencias (reportada, nunca instalada sin auditar): `google-auth-library` existe
// en node_modules (package-lock.json la trae como dependencia TRANSITIVA de `firebase-admin`/
// `@google-cloud/firestore`), pero NO esta declarada en package.json de este proyecto. Importarla
// directamente desde aqui atara este codigo a un paquete que una futura version de firebase-admin
// podria dejar de traer, sin que `npm install` lo avise (regla de instalacion del Brain: toda
// dependencia nueva se audita antes de usarse, y una transitiva no declarada cuenta como nueva). En
// su lugar, se verifica el token con el endpoint publico de Google que YA valida la firma del lado
// de Google y devuelve las claims decodificadas
// (`https://oauth2.googleapis.com/tokeninfo?id_token=...`), documentado por Google para verificar
// ID tokens (https://developers.google.com/identity/sign-in/web/backend-auth) — con la unica
// salvedad de que Google pide no usarlo para volumenes altos; un cron de Cloud Scheduler cada 30
// minutos esta muy por debajo de cualquier limite razonable. Si Leonardo prefiere la verificacion
// criptografica local (sin llamar a Google en cada disparo), la via recomendada es declarar
// `google-auth-library` como dependencia DIRECTA en package.json y usar su
// `OAuth2Client.verifyIdToken` — deliberadamente NO se hace aqui sin que el lo decida.
//
// Separado de server.ts (mismo patron que server/trm.ts/server/avisos.ts) para poder probarse con
// node:test, con un `fetchLike` inyectado, sin red real.

/** Forma minima de `fetch` que necesita este modulo (inyectable en pruebas). */
export type FetchLike = (
  url: string,
  init: { signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const TIMEOUT_MS_DEFECTO = 5000;

export interface VerificarTokenSchedulerDeps {
  /** Email de la cuenta de servicio del Scheduler (por defecto, `process.env.SCHEDULER_SA_EMAIL`). */
  schedulerSaEmail?: string;
  /** Audiencia esperada del token — la URL del servicio de Cloud Run (por defecto,
   * `process.env.SCHEDULER_AUDIENCE`). */
  schedulerAudience?: string;
  fetchLike?: FetchLike;
  timeoutMs?: number;
  /** Log minimo, nunca con el token completo (solo el motivo del rechazo). */
  log?: (linea: string) => void;
}

/**
 * Verifica que `idToken` sea un ID token de Google valido (firma verificada por Google en
 * `tokeninfo`), emitido para la cuenta de servicio `SCHEDULER_SA_EMAIL` y con audiencia
 * `SCHEDULER_AUDIENCE`. `false` ante CUALQUIER duda (variables sin configurar, token vacio,
 * respuesta no-ok de Google, email/audiencia que no coinciden, red caida o timeout) — nunca
 * lanza, para que el llamador (server.ts) siempre pueda responder 403 sin un 500 de por medio.
 */
export async function verificarTokenScheduler(
  idToken: string,
  deps: VerificarTokenSchedulerDeps = {}
): Promise<boolean> {
  const log = deps.log ?? ((linea: string) => console.warn(linea));
  const saEmail = deps.schedulerSaEmail ?? process.env.SCHEDULER_SA_EMAIL;
  const audience = deps.schedulerAudience ?? process.env.SCHEDULER_AUDIENCE;
  if (!saEmail || !audience) {
    log("[TAREAS] SCHEDULER_SA_EMAIL/SCHEDULER_AUDIENCE no configurados; se rechaza cualquier token.");
    return false;
  }
  if (!idToken) return false;

  const fetchFn: FetchLike = deps.fetchLike ?? (globalThis.fetch as unknown as FetchLike);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), deps.timeoutMs ?? TIMEOUT_MS_DEFECTO);
  try {
    const respuesta = await fetchFn(`${TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`, {
      signal: controller.signal,
    });
    if (!respuesta.ok) {
      log(`[TAREAS] tokeninfo respondio ${respuesta.status}: token invalido, expirado o mal formado.`);
      return false;
    }
    const datos = JSON.parse(await respuesta.text());
    const emailOk = datos?.email === saEmail && datos?.email_verified === "true";
    const audienceOk = datos?.aud === audience;
    if (!emailOk || !audienceOk) {
      log("[TAREAS] token rechazado: el email o la audiencia no coinciden con lo esperado.");
      return false;
    }
    return true;
  } catch (error: any) {
    log(`[TAREAS] fallo al verificar el token (${error?.name || "error"}).`);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}
