// Barrido completo de acuses de compra pendientes — simplificado 2026-10-06 (decision del Brain
// tras el NO-GO de la revision externa, vuelta 32 sobre b93fbed: 3 vueltas seguidas parchando el
// reintento de acuses; la orden fue SIMPLIFICAR, no agregar otra capa).
//
// Diseno final (unico):
//   1. El webhook de Mercado Pago (server/webhook.ts, server.ts) manda el acuse de compra EN
//      LINEA, con `await` dentro de la propia peticion, al activar un pago. Si falla, el acuse
//      queda pendiente.
//   2. El UNICO mecanismo de reintento es `POST /api/tareas/barrido-acuses` (Cloud Scheduler cada
//      30 min, OIDC ya implementado via server/schedulerAuth.ts). Recorre por paginas los
//      `pagosProcesados` con acuse no enviado y no revertidos, y reintenta cada uno con el reclamo
//      transaccional de server/cuentas.ts.
// Ya NO existen: el reintento disparado desde GET /api/cuenta, el barrido disparado por el propio
// webhook, el tope de tiempo (`conTope`) que esos dos necesitaban para sobrevivir a que Cloud Run
// congele el CPU justo despues de responder, y el tope de intentos con espera exponencial
// creciente (`MAX_INTENTOS_ACUSE`/backoff) — sin backoff, cada barrido reintenta todo lo
// pendiente; la decision de alertar/abandonar es por ANTIGUEDAD del pago (ver
// `reintentarAcusePendiente`, server/notificaciones.ts), no por cuantos intentos lleva.
import {
  pagoProcesadoAcuseDesdeDoc,
  paginaPagosProcesados as paginaPagosProcesadosReal,
  type PagoProcesadoAcuse,
} from "./cuentas";
import { reintentarAcusePendiente as reintentarAcusePendienteReal, type DatosReintentoAcusePendiente } from "./notificaciones";
import { verificarTokenScheduler as verificarTokenSchedulerReal } from "./schedulerAuth";

/** Reconstruye lo que `reintentarAcusePendiente` necesita a partir de un `PagoProcesadoAcuse` ya
 * leido de Firestore (via `pagoProcesadoAcuseDesdeDoc`). `uidRespaldo` solo importa para pruebas
 * viejas que no guardaban `uid` en el pago; en produccion un pago sin `uid` se descarta antes de
 * llegar aqui (ver `esCandidatoBarridoAcuse`). */
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
    revertido: pago.revertido,
  };
}

/**
 * Candidatos del barrido completo (PURA, para poder probarla con node:test sin Firestore real):
 * nunca un pago ya revertido (el comprador ya no tiene nada que confirmar) ni uno cuyo acuse ya
 * salio al comprador. Todo lo demas — pendiente, en cualquier antiguedad — se reintenta;
 * `reintentarAcusePendiente` decide por su cuenta, segun la antiguedad del pago, si reintenta,
 * alerta a las 20h, o deja de reintentar y alerta "abandonado" a las 48h.
 */
export function esCandidatoBarridoAcuse(data: Record<string, any>): boolean {
  if (data.revertido === true) return false;
  if ((data.correoComprador ?? null) === "enviado") return false;
  return true;
}

export interface PaginaPagos {
  docs: Array<{ id: string; data: Record<string, any> }>;
  cursorSiguiente: unknown;
}

export interface DepsBarridoCompleto {
  obtenerPagina(cursor: unknown, tamanoPagina: number): Promise<PaginaPagos>;
  reintentar(datos: DatosReintentoAcusePendiente): Promise<void>;
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
// Tope razonable: hasta 50 paginas de 100 = 5000 pagos revisados por disparo del Scheduler (cada
// 30 min) — muy por encima de cualquier volumen real de CertiSend hoy, sin riesgo de un recorrido
// sin fin si algo queda mal configurado.
const MAX_PAGINAS_DEFECTO = 50;

/**
 * Recorre TODOS los `pagosProcesados` en paginas (via `deps.obtenerPagina`, cursor de Firestore
 * real o uno sintetico en pruebas), reintentando el acuse de cada candidato elegible
 * (`esCandidatoBarridoAcuse`). Se detiene al llegar a una pagina vacia, sin cursor siguiente, o al
 * tope de `maxPaginas`.
 */
export async function barrerTodosLosPagosPendientes(
  deps: DepsBarridoCompleto = depsBarridoCompletoReales,
  tamanoPagina = TAMANO_PAGINA_DEFECTO,
  maxPaginas = MAX_PAGINAS_DEFECTO
): Promise<ResultadoBarridoCompleto> {
  let cursor: unknown = null;
  let paginas = 0;
  let revisados = 0;
  let reintentados = 0;

  while (paginas < maxPaginas) {
    const pagina = await deps.obtenerPagina(cursor, tamanoPagina);
    paginas++;
    revisados += pagina.docs.length;

    for (const doc of pagina.docs) {
      if (!esCandidatoBarridoAcuse(doc.data)) continue;
      if (!doc.data.uid) continue; // pago sin uid guardado: nada que reconstruir.
      const pago = pagoProcesadoAcuseDesdeDoc(doc.id, doc.data);
      await deps.reintentar(datosReintentoDesdePago(pago));
      reintentados++;
    }

    if (pagina.docs.length === 0 || !pagina.cursorSiguiente) break;
    cursor = pagina.cursorSiguiente;
  }

  return { paginas, revisados, reintentados };
}

// ── Handler del endpoint protegido POST /api/tareas/barrido-acuses ─────────────────────────────

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
 * Logica (sin Express) del endpoint que dispara Cloud Scheduler. Sin encabezado
 * `Authorization: Bearer <idToken>` -> 401. Token que no verifica (otra cuenta de servicio,
 * audiencia distinta, token invencido/expirado) -> 403. Token valido -> ejecuta el barrido
 * completo y responde 200 con las estadisticas.
 *
 * El `try/catch` alrededor de `deps.barrer()` es a proposito: un fallo a mitad del barrido (p. ej.
 * Firestore sin red en la pagina 7 de 10) nunca debe quedar como un rechazo sin manejar — responde
 * 500 con un log estructurado (grepable, mismo formato que las alertas de
 * server/notificaciones.ts) para que Cloud Scheduler lo reintente en el proximo disparo.
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
  try {
    const resultado = await deps.barrer();
    return { status: 200, body: { ok: true, ...resultado } };
  } catch (error: any) {
    console.error(
      JSON.stringify({ severity: "ERROR", message: "BARRIDO_ACUSES_FALLO", error: error?.message || String(error) })
    );
    return { status: 500, body: { error: "Fallo el barrido de acuses pendientes." } };
  }
}
