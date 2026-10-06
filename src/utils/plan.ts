// Logica PURA de la Tarea 10 (cobro real con planes, 2026-10-05): el texto del plan que ve el
// usuario y el estado del sondeo al volver de Mercado Pago. Separada de App.tsx para poder
// probarse con node:test sin React ni red — mismo patron que server/trm.ts y server/cuentas.ts.
import { translations, type Lang } from "./translations";

export type Plan = "gratis" | "paquete" | "pro";

/** Forma de lo que devuelve GET /api/cuenta (server.ts), lo unico que esta logica necesita. */
export interface CuentaInfo {
  plan: Plan;
  enviosRestantes: number;
  /** ISO 8601, o null (Gratis, o un plan sin fecha de vencimiento). */
  vence: string | null;
  renueva: boolean;
  /**
   * Ultimo pago que activo/renovo el plan (G6, NO-GO del REVISOR_EXTERNO_LAP sobre la Tarea 10,
   * 2026-10-05): SOLO `{id, fecha}`, igual que lo que devuelve GET /api/cuenta (server.ts) —
   * nunca el monto ni datos del pagador. `null` si la cuenta nunca ha pagado nada. Se usa para
   * saber si YA llego un pago NUEVO durante el sondeo del regreso de Mercado Pago (ver
   * `decidirEstadoSondeo`): un plan vigente por si solo no basta, tiene que ser el plan vigente
   * causado por ESTE pago, no uno de una compra anterior.
   */
  ultimoPago: { id: string; fecha: string } | null;
}

/**
 * DD/MM/AAAA (o DD/MM si `conAnio` es false) en la zona de Bogota, sin importar el idioma de la
 * UI: es una convencion de fecha unica del proyecto, no de localizacion (igual que `trmHoy` en
 * server/trm.ts, que tambien usa `Intl` con `America/Bogota` en vez de `Date` crudo). `en-CA`
 * nombra las partes (day/month/year) de forma estable sin importar el locale real.
 */
export function formatearFechaBogota(iso: string, conAnio: boolean): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date(iso));
  const mapa: Record<string, string> = {};
  for (const p of partes) mapa[p.type] = p.value;
  return conAnio ? `${mapa.day}/${mapa.month}/${mapa.year}` : `${mapa.day}/${mapa.month}`;
}

export interface EstadoPlanTexto {
  titulo: string;
  /** Nota adicional (hoy solo el Paquete: los lotes <=15 no gastan saldo, R3-1). */
  nota?: string;
}

/**
 * Solo la parte de FECHA de la vigencia: tiene `vence` Y esa fecha todavia no paso. Un plan de
 * pago sin `vence` (dato incompleto o a medio camino de activarse) NUNCA se trata como vigente —
 * ver la nota de la Tarea 8 en cuentas.ts sobre por que esto importa tambien para Pro, no solo
 * para Paquete. Pieza interna de `planVigenteConSaldo` (el criterio COMPLETO, de abajo); no se
 * usa sola fuera de este archivo porque a un Paquete le falta todavia mirar el saldo.
 */
function planVigente(cuenta: CuentaInfo, ahora: Date): boolean {
  return cuenta.vence !== null && new Date(cuenta.vence).getTime() > ahora.getTime();
}

/**
 * UNICO criterio de que un plan de pago este vigente Y USABLE ahora mismo (G6, NO-GO del
 * REVISOR_EXTERNO_LAP sobre la Tarea 10: `planActivo` solo miraba `planVigente` y por eso un
 * Paquete con saldo en 0 pasaba como "activo" para el sondeo del regreso de Mercado Pago, aunque
 * el badge del header ya mostrara "Plan Gratis" via `formatearEstadoPlan`). Pro: `vence` en el
 * futuro. Paquete: ADEMAS `enviosRestantes > 0` — mismo criterio que usa `decidirLote` en
 * server/cuentas.ts. Compartido por `formatearEstadoPlan` y `planActivo` para que nunca puedan
 * volver a contradecirse.
 */
function planVigenteConSaldo(cuenta: CuentaInfo, ahora: Date): boolean {
  if (cuenta.plan === "pro") return planVigente(cuenta, ahora);
  if (cuenta.plan === "paquete") return planVigente(cuenta, ahora) && cuenta.enviosRestantes > 0;
  return false;
}

/**
 * Texto del plan que ve el usuario (spec §5 "Usar la app segun el plan"). Un Paquete o Pro
 * vencido (o sin `vence`) se muestra igual que Gratis: mismo trato que `decidirLote` en
 * server/cuentas.ts, para que la app nunca prometa un plan que el servidor ya no reconoce.
 */
export function formatearEstadoPlan(
  cuenta: CuentaInfo,
  lang: Lang,
  ahora: Date = new Date()
): EstadoPlanTexto {
  const t = translations[lang];

  if (cuenta.plan === "pro") {
    if (!planVigenteConSaldo(cuenta, ahora)) return { titulo: t.miPlanGratis };
    return { titulo: t.miPlanPro.replace("{fecha}", formatearFechaBogota(cuenta.vence!, false)) };
  }

  if (cuenta.plan === "paquete") {
    if (planVigenteConSaldo(cuenta, ahora)) {
      return {
        titulo: t.miPlanPaquete
          .replace("{restantes}", String(cuenta.enviosRestantes))
          .replace("{fecha}", formatearFechaBogota(cuenta.vence!, true)),
        nota: t.miPlanPaqueteNota,
      };
    }
    return { titulo: t.miPlanGratis };
  }

  return { titulo: t.miPlanGratis };
}

export type MotivoRechazoLote = "limite_gratis" | "saldo_insuficiente";

/**
 * Mensaje en lenguaje claro cuando el servidor rechaza un lote antes de enviar nada (spec §5):
 * el motivo exacto ("tienes 40, el lote es de 60" para saldo_insuficiente) mas las opciones
 * (dividir el lote o ver los planes).
 */
export function formatearMotivoRechazoLote(
  motivo: MotivoRechazoLote | undefined,
  enviosRestantes: number | undefined,
  cantidadLote: number,
  lang: Lang
): string {
  const t = translations[lang];
  const motivoTexto =
    motivo === "saldo_insuficiente"
      ? t.batchLimitSaldo
          .replace("{restantes}", String(enviosRestantes ?? 0))
          .replace("{lote}", String(cantidadLote))
      : t.batchLimitFree;
  return `${motivoTexto} ${t.batchLimitOpciones}`;
}

// ── Volver de Mercado Pago (Tarea 10) ───────────────────────────────────────────────────────
// El exito NUNCA lo decide la URL: `pago=ok`/`pago=pendiente` solo arrancan el sondeo contra
// /api/cuenta; "activo" solo sale de lo que el SERVIDOR responda en ese sondeo.

export type PagoParam = "ok" | "pendiente" | "error" | null;

/** Lee `?pago=` de un query string crudo (p. ej. `location.search`). Cualquier valor distinto de
 * los tres que manda `back_urls` en server.ts (ok/error/pendiente) se trata como "no hay pago". */
export function leerPagoParam(search: string): PagoParam {
  const valor = new URLSearchParams(search).get("pago");
  if (valor === "ok" || valor === "pendiente" || valor === "error") return valor;
  return null;
}

// G7/G8 (NO-GO del REVISOR_EXTERNO_LAP sobre el commit 1cdb8e7, vuelta 25, 2026-10-05): Mercado
// Pago agrega a CUALQUIERA de las tres `back_urls` (success/failure/pending) sus propios
// parametros — `payment_id` (Checkout Pro) o `collection_id` (algunos flujos viejos), y
// `status`/`collection_status` con el status REAL del pago segun Mercado Pago en ese instante
// (puede no coincidir con cual back_url se uso: p. ej. `pending` puede volver por la URL de
// `success` con `auto_return`). Esto reemplaza el viejo mecanismo de "ultimoPagoIdInicial"
// (capturar el id de pago que la cuenta YA tenia al EMPEZAR a sondear, comparando contra eso):
// esa captura dependia de una lectura async de /api/cuenta que corria en paralelo con el primer
// `setInterval`, y lo que de verdad se guardaba no era "el id ANTES de este pago" sino "el id en
// cualquier momento en que la promesa resolviera primero" — si el webhook de Mercado Pago ya
// habia activado el Paquete ANTES de que esa primera lectura terminara, el id "inicial" capturado
// YA ERA el nuevo, y `activo` nunca se alcanzaba (G8); si en cambio se leia via un `ref` que un
// `useEffect` separado sincronizaba un render despues de `setCuenta`, la lectura podia quedarse en
// `null` por una vuelta completa (G7). Comparar contra el `payment_id` que la URL YA TRAE (dato
// fijo, nunca cambia durante el sondeo) en vez de un valor capturado en tiempo de ejecucion
// elimina las dos carreras de una vez: no hace falta "antes" ni "despues", solo "¿el ultimo pago
// de la cuenta es ESTE pago?".

/** Lee `payment_id` (Checkout Pro) o, si falta, `collection_id` (flujos viejos) del query string
 * que Mercado Pago agrega a las `back_urls`. `null` si no viene ninguno de los dos (p. ej. el
 * usuario abrio `?pago=ok` a mano, o un flujo que no los manda). */
export function leerPaymentId(search: string): string | null {
  const params = new URLSearchParams(search);
  const id = params.get("payment_id") || params.get("collection_id");
  return id && id.trim() !== "" ? id : null;
}

/** Lee `status` o, si falta, `collection_status` del query string de Mercado Pago. Es el status
 * REAL que Mercado Pago reporto en el momento del redirect — `"rejected"`/`"failure"` fuerza
 * "rechazado" sin importar cual `back_url` (pago=ok/pendiente/error) se uso para volver. */
export function leerStatusMp(search: string): string | null {
  const params = new URLSearchParams(search);
  const status = params.get("status") || params.get("collection_status");
  return status && status.trim() !== "" ? status : null;
}

// G5 (NO-GO del REVISOR_EXTERNO_LAP sobre la Tarea 10, 2026-10-05): "sin_sesion" es el estado
// cuando no hay sesion real de Firebase (ni siquiera el ID token, que SI sobrevive a volver de
// Mercado Pago aunque se haya perdido el access token de Gmail en memoria) — no se sondea ni se
// miente con "confirmando"/"en revision", se pide iniciar sesion. App.tsx decide SI hay sesion
// (via `fetchCuenta`/`getIdToken()`, devuelto como `ResultadoFetchCuenta.tipo`); `decidirEstadoSondeo`
// (abajo) es quien decide QUE mostrar con ese dato, junto con `authReady` (B28).
export type EstadoSondeoPago = "confirmando" | "activo" | "revision" | "rechazado" | "sin_sesion";

export const LIMITE_SONDEO_MS = 2 * 60 * 1000;
export const INTERVALO_SONDEO_MS = 5000;

/** Si el plan de `cuenta` esta activo Y USABLE ahora mismo (ni Gratis, ni vencido/sin `vence`,
 * ni un Paquete sin saldo) — mismo criterio `planVigenteConSaldo` que usa `formatearEstadoPlan`,
 * a proposito (ver su comentario: nunca pueden contradecirse). */
export function planActivo(cuenta: CuentaInfo | null, ahora: Date = new Date()): boolean {
  if (!cuenta) return false;
  return planVigenteConSaldo(cuenta, ahora);
}

/** Lo que una vuelta de sondeo sabe sobre la sesion/cuenta — devuelto por `fetchCuenta` en
 * App.tsx (G7, corrige vuelta 25): antes `fetchCuenta` solo devolvia un string
 * (`"ok"|"sin-sesion"|"error"`) y hacia `setCuenta(...)` como efecto secundario; el sondeo leia la
 * cuenta de un `cuentaRef` que un `useEffect` aparte sincronizaba un render DESPUES de ese
 * `setCuenta` — asi que, en el mismo tick en que `fetchCuenta` resolvia, `cuentaRef.current`
 * todavia podia ser el valor VIEJO (o `null` en la primera lectura). Ahora `fetchCuenta` devuelve
 * los datos leidos en la union misma: el sondeo decide con ESO, nunca con un ref ni con un efecto
 * que corre despues. */
export type ResultadoFetchCuenta =
  | { tipo: "ok"; cuenta: CuentaInfo }
  | { tipo: "sin-sesion" }
  | { tipo: "error" };

/**
 * Decide que estado mostrar al volver de Mercado Pago, dado el parametro `pago` de la URL, el
 * `paymentId` (`payment_id`/`collection_id`) que Mercado Pago agrego a esa misma URL, el
 * `statusMp` que tambien agrego, la lectura MAS RECIENTE de /api/cuenta (`lectura`, nunca un ref
 * ni un valor cacheado de una vuelta anterior), si `onAuthStateChanged` ya dio su primera
 * respuesta (`authReady`, B28) y cuanto tiempo lleva sondeando. Pura: no hace fetch ni usa
 * temporizadores (eso vive en App.tsx/`ejecutarRevisionSondeo`); recibe el tiempo transcurrido
 * como numero para poder probarla sin esperar reloj real.
 *
 * - sin parametro `pago` -> `null` (no hay nada que mostrar).
 * - `pago="error"`, o `statusMp` es `"rejected"`/`"failure"` (Mercado Pago lo reporto asi en la
 *   URL, sin importar CUAL `back_url` trajo de vuelta) -> "rechazado" de inmediato, sin sondear.
 * - sin sesion de Firebase (`lectura.tipo === "sin-sesion"`): si `onAuthStateChanged` TODAVIA no
 *   dio su primera respuesta, "confirmando" (B28 — no se afirma que no hay sesion sin saberlo
 *   todavia; `auth.currentUser` puede tardar en poblarse justo al montar). Con `authReady=true`,
 *   "sin_sesion" (pedir iniciar sesion; `debeDetenerSondeo`, abajo, decide cuando dejar de sondear).
 * - error transitorio leyendo /api/cuenta (`lectura.tipo === "error"`): sigue "confirmando" hasta
 *   `LIMITE_SONDEO_MS`, despues "revision" — nunca "rechazado" por un fallo de red propio.
 * - con la cuenta leida de verdad (`lectura.tipo === "ok"`): "activo" exige DOS cosas (G8: el
 *   match es contra `paymentId`, el dato FIJO de la URL — nunca contra un "ultimoPagoIdInicial"
 *   capturado en tiempo de ejecucion, que es justo lo que corria la carrera con el webhook):
 *     1. que `paymentId` no sea null Y que `cuenta.ultimoPago.id === paymentId` — el pago que la
 *        cuenta dice haber procesado es, literalmente, EL MISMO que Mercado Pago puso en esta URL
 *        (no "cualquier pago nuevo", no "cualquier ultimoPago" — sin `payment_id` en la URL,
 *        nunca puede dar "activo", sin importar que tan vigente este el plan);
 *     2. que ese plan quede vigente y con saldo (`planActivo`).
 *   Si no se cumplen las dos, sigue "confirmando" hasta `LIMITE_SONDEO_MS`; agotado el plazo,
 *   "revision".
 */
export function decidirEstadoSondeo(params: {
  pago: PagoParam;
  paymentId: string | null;
  statusMp: string | null;
  lectura: ResultadoFetchCuenta;
  authReady: boolean;
  msTranscurridos: number;
  ahora?: Date;
}): EstadoSondeoPago | null {
  const { pago, paymentId, statusMp, lectura, authReady, msTranscurridos, ahora } = params;
  if (!pago) return null;
  if (pago === "error" || statusMp === "rejected" || statusMp === "failure") return "rechazado";

  if (lectura.tipo === "sin-sesion") {
    // B28: antes de la primera respuesta de onAuthStateChanged no se sabe si hay sesion o no —
    // nunca se afirma "inicia sesion" sobre una duda, se sigue mostrando "confirmando".
    return authReady ? "sin_sesion" : "confirmando";
  }
  if (lectura.tipo === "error") {
    return msTranscurridos >= LIMITE_SONDEO_MS ? "revision" : "confirmando";
  }

  // lectura.tipo === "ok"
  const pagoConfirmado =
    paymentId !== null && lectura.cuenta.ultimoPago != null && lectura.cuenta.ultimoPago.id === paymentId;
  if (pagoConfirmado && planActivo(lectura.cuenta, ahora)) return "activo";
  if (msTranscurridos >= LIMITE_SONDEO_MS) return "revision";
  return "confirmando";
}

/** B29 (corrige vuelta 25): ademas de "activo"/"revision"/"rechazado" (estados terminales de
 * siempre), un visitante que NUNCA inicia sesion se quedaria sondeando `/api/cuenta` cada
 * `INTERVALO_SONDEO_MS` para siempre — `"sin_sesion"` tambien debe detener el intervalo una vez
 * agotado `LIMITE_SONDEO_MS` (el mensaje sigue pidiendo iniciar sesion; solo se deja de gastar
 * peticiones de red mientras nadie lo hace). Separada de `decidirEstadoSondeo` porque decide algo
 * distinto (si HAY que seguir llamando al servidor, no que texto mostrar). */
export function debeDetenerSondeo(estado: EstadoSondeoPago, msTranscurridos: number): boolean {
  if (estado === "activo" || estado === "revision" || estado === "rechazado") return true;
  if (estado === "sin_sesion" && msTranscurridos >= LIMITE_SONDEO_MS) return true;
  return false;
}

/**
 * Una vuelta COMPLETA del sondeo (lee la cuenta, decide el estado, decide si hay que detenerse):
 * la pieza que `App.tsx` llama cada `INTERVALO_SONDEO_MS` desde su `setInterval`. Se extrae aqui
 * (en vez de dejarla inline en el componente) para poder probarla con `node:test` inyectando un
 * `leerCuenta` falso — sin React, sin DOM, sin temporizadores reales — y asi cubrir la secuencia
 * completa (incluida la carrera G8: un `leerCuenta` que YA devuelve el pago activado simula que
 * el webhook de Mercado Pago llego antes de esta primera lectura) sin depender de un arnes de
 * render que este proyecto no tiene instalado (ver nota en tests/plan.test.ts sobre por que no
 * hay una prueba que monte el componente real).
 */
export async function ejecutarRevisionSondeo(params: {
  pago: PagoParam;
  paymentId: string | null;
  statusMp: string | null;
  leerCuenta(): Promise<ResultadoFetchCuenta>;
  authReady: boolean;
  msTranscurridos: number;
  ahora?: Date;
}): Promise<{ estado: EstadoSondeoPago | null; detener: boolean }> {
  const lectura = await params.leerCuenta();
  const estado = decidirEstadoSondeo({ ...params, lectura });
  return { estado, detener: estado !== null && debeDetenerSondeo(estado, params.msTranscurridos) };
}
