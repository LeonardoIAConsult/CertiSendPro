// Orquestacion del "trabajo en segundo plano" del webhook y de /api/cuenta (correccion NO-GO
// vuelta 30, 2026-10-05: G1/G2/M1/M3/B1). Separado de server.ts (mismo patron que
// server/webhook.ts/server/cuentas.ts/server/notificaciones.ts) para poder probarlo con node:test
// sin Express ni `app.listen()`.
//
// G1 (el hallazgo central de esta vuelta): en Cloud Run SIN minScale, el CPU se congela justo
// despues de que la respuesta HTTP sale (`res.json()`/`res.end()`) — cualquier `.catch()` sin
// `await` que quede "pendiente" para despues de responder simplemente no corre de forma
// confiable. Las funciones de este archivo SIEMPRE se esperan (`await`) ANTES de que quien las
// llama responda, con un tope de tiempo explicito (`conTope`, Promise.race) para no demorar la
// respuesta mas de lo razonable — lo que no alcanza a tiempo queda para el PROXIMO disparo (el
// webhook en el proximo aviso de Mercado Pago; `/api/cuenta` en la proxima consulta del usuario;
// el endpoint de tareas en el proximo Cloud Scheduler). Nunca mas trabajo "fire-and-forget".
import {
  listarPagosPendientesDeAcuse as listarPagosPendientesDeAcuseReal,
  listarPagosParaBarridoGlobal as listarPagosParaBarridoGlobalReal,
  seleccionarPagosParaBarrido,
  paginaPagosProcesados as paginaPagosProcesadosReal,
  type PagoProcesadoAcuse,
} from "./cuentas";
import { reintentarAcusePendiente as reintentarAcusePendienteReal, type DatosReintentoAcusePendiente } from "./notificaciones";
import { verificarTokenScheduler as verificarTokenSchedulerReal } from "./schedulerAuth";

// ── Tope de tiempo generico (G1) ────────────────────────────────────────────────────────────────

/**
 * Promise.race con un tope de tiempo: nunca deja a quien llama esperando mas de `ms`. El trabajo
 * de `promesa` sigue corriendo en el runtime de Node aunque el tope se agote (no hay forma de
 * "cancelar" una promesa ya en vuelo sin un AbortController propio en cada paso de su interior) —
 * pero su resultado o su error, si llegan DESPUES del tope, nunca quedan como un rechazo sin
 * manejar (unhandled rejection): se capturan y se loggean con `etiqueta`.
 *
 * `temporizador` (quinto parametro, SOLO PARA PRUEBAS) reemplaza `setTimeout` real — sin el, las
 * pruebas de esta mecanica dependerian del reloj de pared y del reloj real del sistema (flaky bajo
 * carga de CPU, p. ej. al correr la suite completa con muchos archivos de prueba a la vez); con un
 * temporizador inyectado, `tests/tareasFondo.test.ts` prueba la carrera (Promise.race) de forma
 * determinista, sin esperar tiempo real.
 */
export async function conTope(
  promesa: Promise<unknown>,
  ms: number,
  etiqueta: string,
  log: (linea: string) => void = (l) => console.error(l),
  temporizador: (cb: () => void, ms: number) => void = (cb, ms) => setTimeout(cb, ms)
): Promise<void> {
  const protegida = promesa.catch((error: any) => {
    log(`[${etiqueta}] fallo en segundo plano (puede haber corrido mas alla del tope de ${ms}ms): ${error?.message || error}`);
  });
  await Promise.race([protegida, new Promise<void>((resolve) => temporizador(resolve, ms))]);
}

// ── Reconstruccion de datos para un reintento (movido de server.ts, M1) ─────────────────────────

export function datosReintentoDesdePago(pago: PagoProcesadoAcuse, uidRespaldo?: string): DatosReintentoAcusePendiente {
  return {
    paymentId: pago.paymentId,
    uid: pago.uid ?? uidRespaldo!,
    referenciaId: pago.referenciaId,
    cop: pago.cop,
    trm: pago.trm,
    fechaTrm: pago.fechaTrm,
    fecha: pago.fecha.toDate(),
    vence: pago.vence.toDate(),
    revertido: pago.revertido, // G3
  };
}

// ── Reintento por uid y barrido parcial del webhook (movidos de server.ts, M1) ──────────────────

export interface DepsReintentoAcuses {
  listarPendientesDeUid(uid: string): Promise<PagoProcesadoAcuse[]>;
  listarBarridoGlobal(ahora: Date): Promise<PagoProcesadoAcuse[]>;
  reintentar(datos: DatosReintentoAcusePendiente): Promise<void>;
}

const depsReintentoAcusesReales: DepsReintentoAcuses = {
  listarPendientesDeUid: listarPagosPendientesDeAcuseReal,
  listarBarridoGlobal: listarPagosParaBarridoGlobalReal,
  reintentar: reintentarAcusePendienteReal,
};

/** M37 (1) / M1: reintenta los acuses pendientes de UN uid (disparado por GET /api/cuenta). */
export async function reintentarAcusesDeUid(
  uid: string,
  deps: DepsReintentoAcuses = depsReintentoAcusesReales
): Promise<void> {
  const pendientes = await deps.listarPendientesDeUid(uid);
  for (const pago of pendientes) {
    await deps.reintentar(datosReintentoDesdePago(pago, uid));
  }
}

/** M37 (2) / M1: barrido PARCIAL (ventana de hasta `TAMANO_VENTANA_BARRIDO` pagos recientes, ver
 * server/cuentas.ts) disparado tras cada aviso del webhook con httpStatus=200 (B1). */
export async function barrerAcusesPendientesGlobal(
  deps: DepsReintentoAcuses = depsReintentoAcusesReales,
  ahora: Date = new Date()
): Promise<void> {
  const pendientes = await deps.listarBarridoGlobal(ahora);
  for (const pago of pendientes) {
    if (!pago.uid) continue; // sin uid guardado (pago de antes de M37): nada que reconstruir.
    await deps.reintentar(datosReintentoDesdePago(pago));
  }
}

// ── B1: el barrido del webhook solo corre si httpStatus=200 y como mucho 1 vez/min (global) ─────

export interface EstadoBarridoWebhook {
  ultimoEnMs: number;
}

/**
 * Decision PURA (B1): el barrido del webhook (`barrerAcusesPendientesGlobal`) solo debe correr si
 * el webhook acaba de responder 200 (un aviso rechazado/fallido no tiene sentido usarlo de
 * disparador) Y si ha pasado al menos `ventanaMs` (1 minuto por defecto) desde la ultima vez que
 * corrio — Mercado Pago puede mandar varios avisos por minuto y no hace falta barrer en cada uno.
 */
export function debeCorrerBarridoWebhook(
  httpStatus: number,
  ahoraMs: number,
  previo: EstadoBarridoWebhook | null,
  ventanaMs = 60_000
): { correr: boolean; nuevoEstado: EstadoBarridoWebhook | null } {
  if (httpStatus !== 200) return { correr: false, nuevoEstado: previo };
  if (previo && ahoraMs - previo.ultimoEnMs < ventanaMs) return { correr: false, nuevoEstado: previo };
  return { correr: true, nuevoEstado: { ultimoEnMs: ahoraMs } };
}

export interface DepsBarridoWebhookConTope {
  barrer(): Promise<unknown>;
  log?(linea: string): void;
}

/**
 * G1 + B1: compone la decision de arriba con el `await` + tope de 4s que exige G1. Devuelve si de
 * verdad se ejecuto el barrido (para pruebas/observabilidad) y el estado a guardar para la
 * siguiente llamada. Quien llama (server.ts) la invoca con `await` ANTES de responder al webhook
 * de Mercado Pago.
 */
export async function ejecutarBarridoWebhookConTope(
  httpStatus: number,
  ahoraMs: number,
  previo: EstadoBarridoWebhook | null,
  deps: DepsBarridoWebhookConTope,
  topeMs = 4000
): Promise<{ ejecutado: boolean; nuevoEstado: EstadoBarridoWebhook | null }> {
  const decision = debeCorrerBarridoWebhook(httpStatus, ahoraMs, previo);
  if (!decision.correr) return { ejecutado: false, nuevoEstado: decision.nuevoEstado };
  await conTope(deps.barrer(), topeMs, "MP WEBHOOK barrido", deps.log);
  return { ejecutado: true, nuevoEstado: decision.nuevoEstado };
}

// ── G1: /api/cuenta espera el reintento (tope 3s) ANTES de responder ────────────────────────────

export interface DepsReintentoCuentaConTope {
  reintentar(uid: string): Promise<unknown>;
  log?(linea: string): void;
}

/** G1: envuelve `reintentarAcusesDeUid` con el tope de 3s que exige la orden, para que server.ts
 * la pueda `await` justo antes de responder `GET /api/cuenta`. */
export async function ejecutarReintentoCuentaConTope(
  uid: string,
  deps: DepsReintentoCuentaConTope,
  topeMs = 3000
): Promise<void> {
  await conTope(deps.reintentar(uid), topeMs, "CUENTA reintento", deps.log);
}

// ── M3: barrido COMPLETO paginado, para el endpoint de tareas protegido (G2) ─────────────────────

export interface PaginaPagos {
  docs: Array<{ id: string; data: Record<string, any> }>;
  cursorSiguiente: unknown;
}

export interface DepsBarridoCompleto {
  obtenerPagina(cursor: unknown, tamanoPagina: number): Promise<PaginaPagos>;
  reintentar(datos: DatosReintentoAcusePendiente): Promise<void>;
  ahora?(): Date;
}

const depsBarridoCompletoReales: DepsBarridoCompleto = {
  obtenerPagina: paginaPagosProcesadosReal,
  reintentar: reintentarAcusePendienteReal,
};

export interface ResultadoBarridoCompleto {
  paginas: number;
  revisados: number;
  reintentados: number;
}

const TAMANO_PAGINA_DEFECTO = 100;
// Tope razonable (G2/M3): hasta 50 paginas de 100 = 5000 pagos revisados por disparo del
// Scheduler (cada 30 min) — muy por encima de cualquier volumen real de CertiSend hoy, sin riesgo
// de un recorrido sin fin si algo queda mal configurado.
const MAX_PAGINAS_DEFECTO = 50;

/**
 * M3: recorre TODOS los `pagosProcesados` en paginas (via `deps.obtenerPagina`, cursor de
 * Firestore real o uno sintetico en pruebas), reintentando el acuse de cada candidato ELEGIBLE
 * (`seleccionarPagosParaBarrido`, que ya aplica G3/M2/M3: salta revertidos, estados terminales y
 * los que siguen en espera de backoff). Se detiene al llegar a una pagina vacia, sin cursor
 * siguiente, o al tope de `maxPaginas`.
 */
export async function barrerTodosLosPagosPendientes(
  deps: DepsBarridoCompleto = depsBarridoCompletoReales,
  tamanoPagina = TAMANO_PAGINA_DEFECTO,
  maxPaginas = MAX_PAGINAS_DEFECTO
): Promise<ResultadoBarridoCompleto> {
  const ahora = (deps.ahora ?? (() => new Date()))();
  let cursor: unknown = null;
  let paginas = 0;
  let revisados = 0;
  let reintentados = 0;

  while (paginas < maxPaginas) {
    const pagina = await deps.obtenerPagina(cursor, tamanoPagina);
    paginas++;
    revisados += pagina.docs.length;

    const elegibles =
      pagina.docs.length > 0
        ? seleccionarPagosParaBarrido(pagina.docs, ahora, 0, pagina.docs.length)
        : [];
    for (const pago of elegibles) {
      await deps.reintentar(datosReintentoDesdePago(pago));
      reintentados++;
    }

    if (pagina.docs.length === 0 || !pagina.cursorSiguiente) break;
    cursor = pagina.cursorSiguiente;
  }

  return { paginas, revisados, reintentados };
}

// ── G2: handler del endpoint protegido POST /api/tareas/barrido-acuses ──────────────────────────

export interface DepsBarridoTarea {
  verificarToken(idToken: string): Promise<boolean>;
  barrer(): Promise<ResultadoBarridoCompleto>;
}

const depsBarridoTareaReales: DepsBarridoTarea = {
  verificarToken: (idToken: string) => verificarTokenSchedulerReal(idToken),
  barrer: () => barrerTodosLosPagosPendientes(),
};

export interface RespuestaBarridoTarea {
  status: number;
  body: Record<string, any>;
}

/**
 * G2: logica (sin Express) del endpoint que dispara Cloud Scheduler. Sin encabezado
 * `Authorization: Bearer <idToken>` → 401. Token que no verifica (otra cuenta de servicio,
 * audiencia distinta, token invencido/expirado) → 403. Token valido → ejecuta el barrido completo
 * y responde 200 con las estadisticas.
 */
export async function manejarBarridoAcusesTarea(
  authorizationHeader: string | undefined,
  deps: DepsBarridoTarea = depsBarridoTareaReales
): Promise<RespuestaBarridoTarea> {
  const match = /^Bearer\s+(.+)$/.exec(authorizationHeader || "");
  if (!match) {
    return { status: 401, body: { error: "Falta el token de identidad de Cloud Scheduler." } };
  }
  const autorizado = await deps.verificarToken(match[1]);
  if (!autorizado) {
    return { status: 403, body: { error: "Token no autorizado para esta tarea." } };
  }
  const resultado = await deps.barrer();
  return { status: 200, body: { ok: true, ...resultado } };
}
