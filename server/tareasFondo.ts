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
// webhook, el wrapper de tope de tiempo que esos dos necesitaban para sobrevivir a que Cloud Run
// congele el CPU justo despues de responder, y el tope de intentos con espera exponencial
// creciente (`MAX_INTENTOS_ACUSE`/backoff) — sin backoff, cada barrido reintenta todo lo
// pendiente; la decision de alertar/abandonar es por ANTIGUEDAD del pago (ver
// `reintentarAcusePendiente`, server/notificaciones.ts), no por cuantos intentos lleva.
import {
  pagoProcesadoAcuseDesdeDoc,
  paginaPagosProcesados as paginaPagosProcesadosReal,
  type PagoProcesadoAcuse,
} from "./cuentas";
import {
  reintentarAcusePendiente as reintentarAcusePendienteReal,
  reintentarAcusePorUsoPendiente as reintentarAcusePorUsoPendienteReal,
  type DatosReintentoAcusePendiente,
  type DatosReintentoAcusePorUsoPendiente,
} from "./notificaciones";
import { verificarTokenScheduler as verificarTokenSchedulerReal } from "./schedulerAuth";

/** Reconstruye lo que `reintentarAcusePendiente` necesita a partir de un `PagoProcesadoAcuse` de
 * Paquete ya leido de Firestore (via `pagoProcesadoAcuseDesdeDoc`). `uidRespaldo` solo importa
 * para pruebas viejas que no guardaban `uid` en el pago; en produccion un pago sin `uid` se
 * descarta antes de llegar aqui (ver `esCandidatoBarridoAcuse`). SOLO para `pago.tipo==="paquete"`
 * (`pago.vence` es `null` para un pago porUso — ver `datosReintentoPorUsoDesdePago`). */
export function datosReintentoDesdePago(pago: PagoProcesadoAcuse, uidRespaldo?: string): DatosReintentoAcusePendiente {
  return {
    paymentId: pago.paymentId,
    uid: pago.uid ?? uidRespaldo!,
    referenciaId: pago.referenciaId,
    cop: pago.cop,
    trm: pago.trm,
    fechaTrm: pago.fechaTrm,
    fecha: pago.fecha.toDate(),
    vence: pago.vence!.toDate(),
    revertido: pago.revertido,
  };
}

/** Paso 16A-3: equivalente de `datosReintentoDesdePago` para un pago `tipo:"porUso"` — reconstruye
 * lo que `reintentarAcusePorUsoPendiente` (server/notificaciones.ts) necesita, con `cantidad` en
 * vez del `vence` que no existe para este tipo. Mismo `uidRespaldo` por simetria con el de arriba
 * (nunca se ejerce en produccion: `esCandidatoBarridoAcuse` ya descarta un pago sin `uid`). */
export function datosReintentoPorUsoDesdePago(pago: PagoProcesadoAcuse, uidRespaldo?: string): DatosReintentoAcusePorUsoPendiente {
  return {
    paymentId: pago.paymentId,
    uid: pago.uid ?? uidRespaldo!,
    referenciaId: pago.referenciaId,
    cantidad: pago.cantidad ?? 0,
    cop: pago.cop,
    trm: pago.trm,
    fechaTrm: pago.fechaTrm,
    fecha: pago.fecha.toDate(),
    revertido: pago.revertido,
  };
}

/**
 * Candidatos del barrido completo (PURA, para poder probarla con node:test sin Firestore real):
 * nunca un pago ya revertido (el comprador ya no tiene nada que confirmar), nunca uno que
 * `activarPaqueteSiNoProcesadoTx` (server/cuentas.ts, Medio 4/Tarea 15) marco
 * `requiereReembolso=true` (nunca se activo nada: no hay nada que confirmarle al comprador), ni
 * uno cuyo acuse ya salio al comprador. Todo lo demas — pendiente, en cualquier antiguedad — se
 * reintenta; `reintentarAcusePendiente` decide por su cuenta, segun la antiguedad del pago, si
 * reintenta, alerta a las 20h, o deja de reintentar y alerta "abandonado" a las 48h.
 */
export function esCandidatoBarridoAcuse(data: Record<string, any>): boolean {
  if (data.revertido === true) return false;
  if (data.requiereReembolso === true) return false;
  if ((data.correoComprador ?? null) === "enviado") return false;
  return true;
}

export interface PaginaPagos {
  docs: Array<{ id: string; data: Record<string, any> }>;
  cursorSiguiente: unknown;
}

export interface DepsBarridoCompleto {
  obtenerPagina(cursor: unknown, tamanoPagina: number): Promise<PaginaPagos>;
  /** Paso 16A-3: variante de Paquete del reintento — solo para `pago.tipo==="paquete"`. */
  reintentarPaquete(datos: DatosReintentoAcusePendiente): Promise<void>;
  /** Paso 16A-3: variante de Pago por uso del reintento — solo para `pago.tipo==="porUso"`. */
  reintentarPorUso(datos: DatosReintentoAcusePorUsoPendiente): Promise<void>;
}

const depsBarridoCompletoReales: DepsBarridoCompleto = {
  obtenerPagina: paginaPagosProcesadosReal,
  reintentarPaquete: reintentarAcusePendienteReal,
  reintentarPorUso: reintentarAcusePorUsoPendienteReal,
};

export interface ResultadoBarridoCompleto {
  paginas: number;
  revisados: number;
  reintentados: number;
  /** M-2 (corrige vuelta 36 del REVISOR_EXTERNO): true si el barrido se CORTO por agotar
   * `presupuestoMs` antes de terminar todas las paginas — el resto queda para la siguiente
   * corrida del Scheduler (30 min despues), nunca se pierde ni se trata como error. Opcional
   * (no todas las implementaciones/dobles de `DepsBarridoTarea.barrer` lo devuelven, ver
   * tests/tareasFondo.test.ts) para no romper los que simulan la respuesta completa a mano. */
  detenidoPorTiempo?: boolean;
}

const TAMANO_PAGINA_DEFECTO = 100;
// Tope razonable: hasta 50 paginas de 100 = 5000 pagos revisados por disparo del Scheduler (cada
// 30 min) — muy por encima de cualquier volumen real de CertiSend hoy, sin riesgo de un recorrido
// sin fin si algo queda mal configurado.
const MAX_PAGINAS_DEFECTO = 50;

// M-2 (corrige vuelta 36 del REVISOR_EXTERNO): el barrido manda cada acuse EN SERIE (nunca en
// paralelo) y cada envio de correo puede tardar hasta 20s (`TIMEOUT_MS_DEFECTO`,
// server/avisos.ts) — con varias decenas de pagos pendientes, un disparo del Scheduler puede
// tardar mucho mas que el viejo `--attempt-deadline=30s` (ver docs/ops.md §3, ahora 600s). 540s
// (9 min) deja margen bajo esos 600s para que el barrido se corte A SI MISMO y responda ANTES de
// que Cloud Scheduler lo corte de un timeout — un 200 con `detenidoPorTiempo:true` es mucho mejor
// que un timeout que ni siquiera deja saber cuanto se alcanzo a procesar.
const PRESUPUESTO_MS_DEFECTO = 540_000;

/**
 * Recorre TODOS los `pagosProcesados` en paginas (via `deps.obtenerPagina`, cursor de Firestore
 * real o uno sintetico en pruebas), reintentando el acuse de cada candidato elegible
 * (`esCandidatoBarridoAcuse`). Se detiene al llegar a una pagina vacia, sin cursor siguiente, al
 * tope de `maxPaginas`, o al agotar `presupuestoMs` de tiempo total (M-2) — en los cuatro casos
 * devuelve lo que alcanzo a procesar; el resto (si lo hay) lo recoge la siguiente corrida.
 * `ahoraMs` es inyectable (por defecto `Date.now`) para poder probar el corte por tiempo con un
 * reloj FIJO, sin depender de temporizadores reales (mismo patron ya aceptado en este proyecto).
 */
export async function barrerTodosLosPagosPendientes(
  deps: DepsBarridoCompleto = depsBarridoCompletoReales,
  tamanoPagina = TAMANO_PAGINA_DEFECTO,
  maxPaginas = MAX_PAGINAS_DEFECTO,
  presupuestoMs = PRESUPUESTO_MS_DEFECTO,
  ahoraMs: () => number = Date.now
): Promise<ResultadoBarridoCompleto> {
  const inicioMs = ahoraMs();
  let cursor: unknown = null;
  let paginas = 0;
  let revisados = 0;
  let reintentados = 0;
  let detenidoPorTiempo = false;

  recorrido: while (paginas < maxPaginas) {
    const pagina = await deps.obtenerPagina(cursor, tamanoPagina);
    paginas++;
    revisados += pagina.docs.length;

    for (const doc of pagina.docs) {
      if (ahoraMs() - inicioMs >= presupuestoMs) {
        detenidoPorTiempo = true;
        break recorrido;
      }
      if (!esCandidatoBarridoAcuse(doc.data)) continue;
      if (!doc.data.uid) continue; // pago sin uid guardado: nada que reconstruir.
      const pago = pagoProcesadoAcuseDesdeDoc(doc.id, doc.data);
      // Paso 16A-3: enruta por `pago.tipo` a la variante correcta — un pago `porUso` NUNCA debe
      // caer en `reintentarPaquete` (le falta `vence`, y reconstruiria mal el acuse).
      if (pago.tipo === "porUso") {
        await deps.reintentarPorUso(datosReintentoPorUsoDesdePago(pago));
      } else {
        await deps.reintentarPaquete(datosReintentoDesdePago(pago));
      }
      reintentados++;
    }

    if (pagina.docs.length === 0 || !pagina.cursorSiguiente) break;
    cursor = pagina.cursorSiguiente;
  }

  return { paginas, revisados, reintentados, detenidoPorTiempo };
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
 * M-1/M-2 (corrige vuelta 34 del REVISOR_EXTERNO): log estructurado grepable (mismo formato que
 * `BARRIDO_ACUSES_FALLO` abajo y las alertas de server/notificaciones.ts) ante un 401/403 — un
 * token OIDC que de pronto deja de verificar (SA/audiencia mal configurada, permiso revocado) es
 * exactamente el tipo de fallo "silencioso" que esta alerta busca atrapar: el barrido completo
 * deja de correr y, sin este log, nadie se entera hasta que algun acuse lleva dias pendiente.
 * Nunca lleva el token ni ningun dato del llamador (la peticion, antes de verificar el token, no
 * tiene ninguna identidad que loguear).
 */
function logTareaBarridoRechazada(motivo: "sin_token" | "token_invalido"): void {
  console.error(JSON.stringify({ severity: "ERROR", message: "TAREA_BARRIDO_RECHAZADA", motivo }));
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
    logTareaBarridoRechazada("sin_token");
    return { status: 401, body: { error: "Falta el token de identidad de Cloud Scheduler." } };
  }
  const autorizado = await deps.verificarToken(match[1]);
  if (!autorizado) {
    logTareaBarridoRechazada("token_invalido");
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

// ── M-4 (corrige vuelta 34 del REVISOR_EXTERNO): registro de la ruta extraido de server.ts ─────
// Antes, `app.post("/api/tareas/barrido-acuses", ...)` vivia inline en server.ts, sin forma de
// probar que el endpoint REAL (el que Express de verdad expone) delega en
// `manejarBarridoAcusesTarea` sin pasar por una copia casi-igual del mismo codigo. Ahora
// `registrarRutasTareas` es la UNICA definicion de esa ruta; server.ts solo la llama.

/** Ruta del endpoint que dispara Cloud Scheduler — un solo literal, usado tanto al registrar la
 * ruta como al verificar (al arrancar) que quedo registrada. */
export const RUTA_BARRIDO_ACUSES = "/api/tareas/barrido-acuses";

/** Forma minima de una app de Express (o un doble de pruebas) que necesita `registrarRutasTareas`. */
export interface AppConRutasTareas {
  post(path: string, handler: (req: any, res: any) => void | Promise<void>): void;
}

/** Registra `POST /api/tareas/barrido-acuses` en `app`, delegando en `manejarBarridoAcusesTarea`. */
export function registrarRutasTareas(app: AppConRutasTareas, deps: DepsBarridoTarea = depsBarridoTareaReales): void {
  app.post(RUTA_BARRIDO_ACUSES, async (req: any, res: any) => {
    const resultado = await manejarBarridoAcusesTarea(req.headers.authorization, deps);
    res.status(resultado.status).json(resultado.body);
  });
}

/**
 * M-4: chequeo de arranque — de mejor esfuerzo, nunca lanza. Si `server.ts` dejara de llamar a
 * `registrarRutasTareas` (p. ej. al refactorizar y olvidar la linea), NINGUNA prueba de este
 * archivo puede detectarlo: una prueba aqui solo puede comprobar que esta FUNCION registra la
 * ruta cuando SI se la llama, nunca que `server.ts` la llame de verdad. Por eso la defensa real es
 * esta: inspecciona el router de Express YA ARRANCADO y deja un log estructurado grepable si la
 * ruta no aparece, para que el problema se note en los logs de arranque de Cloud Run en vez de
 * descubrirse dias despues con acuses atascados.
 */
export function verificarRutaTareasRegistrada(
  app: any,
  log: (linea: string) => void = (linea) => console.error(linea)
): boolean {
  try {
    const capas: any[] = app?._router?.stack ?? [];
    const registrada = capas.some(
      (capa) => capa?.route?.path === RUTA_BARRIDO_ACUSES && capa?.route?.methods?.post === true
    );
    if (!registrada) {
      log(JSON.stringify({ severity: "ERROR", message: "RUTA_TAREAS_NO_REGISTRADA", ruta: RUTA_BARRIDO_ACUSES }));
    }
    return registrada;
  } catch (error: any) {
    log(
      JSON.stringify({
        severity: "ERROR",
        message: "RUTA_TAREAS_NO_REGISTRADA",
        ruta: RUTA_BARRIDO_ACUSES,
        error: error?.message || String(error),
      })
    );
    return false;
  }
}
