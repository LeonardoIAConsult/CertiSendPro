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

// G5 (NO-GO del REVISOR_EXTERNO_LAP sobre la Tarea 10, 2026-10-05): "sin_sesion" es el estado
// cuando no hay sesion real de Firebase (ni siquiera el ID token, que SI sobrevive a volver de
// Mercado Pago aunque se haya perdido el access token de Gmail en memoria) — no se sondea ni se
// miente con "confirmando"/"en revision", se pide iniciar sesion. Lo decide App.tsx (sabe si
// `getIdToken()` dio null), no esta funcion pura.
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

/**
 * Decide que estado mostrar al volver de Mercado Pago, dado el parametro de la URL, la ULTIMA
 * respuesta conocida de /api/cuenta, el id de `ultimoPago` que la cuenta YA tenia al EMPEZAR a
 * sondear, y cuanto tiempo lleva sondeando. Pura: no hace fetch ni usa temporizadores (eso vive
 * en App.tsx); recibe el tiempo transcurrido como numero para poder probarla sin esperar reloj
 * real.
 *
 * - `pago=error` -> "rechazado" de inmediato (Mercado Pago ya dijo que no se cobro nada), sin
 *   sondear nada mas.
 * - `pago=ok` o `pago=pendiente` -> "activo" exige DOS cosas (G6, hallazgo del REVISOR: antes
 *   bastaba con que la cuenta YA tuviera algun plan vigente, aunque fuera de una compra VIEJA y
 *   el pago de ESTA visita todavia no hubiera llegado):
 *     1. que `ultimoPago.id` haya CAMBIADO respecto a `ultimoPagoIdInicial` (el que tenia la
 *        cuenta cuando empezo este sondeo) — asi se sabe que el pago de ESTA vuelta ya se
 *        proceso, no que el usuario ya tenia un Paquete/Pro de antes;
 *     2. que ese plan quede vigente y con saldo (`planActivo`).
 *   Si no se cumplen las dos, sigue "confirmando" hasta `LIMITE_SONDEO_MS`; agotado el plazo,
 *   "revision".
 * - sin parametro `pago` -> `null` (no hay nada que mostrar).
 */
export function decidirEstadoSondeo(params: {
  pago: PagoParam;
  cuenta: CuentaInfo | null;
  ultimoPagoIdInicial: string | null;
  msTranscurridos: number;
  ahora?: Date;
}): EstadoSondeoPago | null {
  const { pago, cuenta, ultimoPagoIdInicial, msTranscurridos, ahora } = params;
  if (!pago) return null;
  if (pago === "error") return "rechazado";

  const pagoNuevo = cuenta?.ultimoPago != null && cuenta.ultimoPago.id !== ultimoPagoIdInicial;
  if (pagoNuevo && planActivo(cuenta, ahora)) return "activo";
  if (msTranscurridos >= LIMITE_SONDEO_MS) return "revision";
  return "confirmando";
}
