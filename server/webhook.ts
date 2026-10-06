// Logica del webhook de Mercado Pago (Tarea 6, cobro real con planes, 2026-10-05). Separado de
// server.ts (igual que server/trm.ts y server/cuentas.ts) para poder probarla con node:test, con
// un `obtenerPago` y un `obtenerPreferencia`/`activarPaquete` inyectados, sin red ni Firestore real
// ni arrancar Express (server.ts llama app.listen() al importarse).
//
// Regla de oro de este modulo: NUNCA confiar en el cuerpo ni en la query del webhook para decidir
// si se activa algo. Lo unico que se lee de la peticion entrante es el id del pago; todo lo demas
// (status, moneda, monto, referencia) se vuelve a consultar contra la API de Mercado Pago con el
// access token del servidor. Un cuerpo falsificado que diga "approved" no cambia nada: lo que
// decide es la respuesta de `obtenerPago`.
import type { Timestamp } from "firebase-admin/firestore";
import type { PreferenciaGuardada } from "./cuentas";

/** Forma minima de la respuesta de GET /v1/payments/{id} que necesita este modulo. */
export interface RespuestaPagoMP {
  ok: boolean;
  status: number;
  json(): Promise<any>;
}

export interface ResultadoWebhookMP {
  /** Lo que la ruta HTTP debe responder a Mercado Pago. */
  httpStatus: number;
  /** Motivo para logs internos (nunca se manda tal cual al cliente). */
  razon: string;
}

export interface ProcesarWebhookMPOpts {
  /** "payment" (unico tipo que procesa hoy; "subscription_preapproval" etc. son la Tarea 8). */
  tipo: string;
  paymentId: string;
  /** Consulta real GET /v1/payments/{id} con el access token del servidor (inyectable en pruebas). */
  obtenerPago(paymentId: string): Promise<RespuestaPagoMP>;
  /** Lee `preferencias/{id}` (el id aleatorio del external_reference). */
  obtenerPreferencia(id: string): Promise<PreferenciaGuardada | null>;
  /** Activa el Paquete de forma idempotente; ver server/cuentas.ts. */
  activarPaquete(
    uid: string,
    paymentId: string,
    datos: { cop: number; trm: number; fecha: Timestamp }
  ): Promise<"activado" | "repetido">;
  /** Para construir el Timestamp de la fecha del pago sin importar firebase-admin aqui (se inyecta
   * desde server.ts/los tests, que ya tienen el Timestamp real o uno falso). */
  timestampDesdeFecha(fecha: Date): Timestamp;
  /** Log minimo y no sensible (Tarea 6: "solo paymentId, uid y status, sin datos del pagador"). */
  log(linea: string): void;
}

/** Forma minima de lo que la ruta HTTP saca de la peticion entrante (query y body de Express). */
export interface AvisoWebhookCrudo {
  query: Record<string, any>;
  body: any;
}

/**
 * Extrae `{tipo, paymentId}` del aviso de Mercado Pago (Tarea 6, extraida a funcion PURA tras la
 * vuelta 22 para poder probarla con node:test sin Express). Acepta el formato nuevo
 * (`type`+`data.id`, por query o en el body v2) y el IPN viejo (`topic`+`id`). Prioridad, igual
 * que el codigo original de server.ts: `query["data.id"]` > `query.id` > `body.data.id` >
 * `body.id` — por eso un cuerpo v2 con un `id` de notificacion DISTINTO de `data.id` siempre usa
 * `data.id` (se mira primero). Esta funcion solo decide DE DONDE sacar el id; nunca decide si el
 * pago es real — eso lo hace `procesarWebhookMP` volviendo a consultar la API de Mercado Pago.
 */
/** Express parsea un parametro de query REPETIDO (`?type=a&type=b`) como arreglo, no como
 * string: sin esto, `String(["payment","payment"])` daria "payment,payment" y nunca igualaria
 * "payment" (bajo, corrige vuelta 24). Se toma el PRIMER valor, igual que si solo hubiera llegado
 * una vez; el body de Mercado Pago (JSON) nunca manda arreglos aqui, pero la funcion es segura
 * con cualquiera de los dos. */
function primerValor(valor: unknown): unknown {
  return Array.isArray(valor) ? valor[0] : valor;
}

export function extraerAvisoWebhookMP(crudo: AvisoWebhookCrudo): { tipo: string; paymentId: string } {
  const query = crudo.query || {};
  const body = crudo.body || {};
  const tipo = String(primerValor(query.type) || primerValor(query.topic) || body?.type || body?.topic || "");
  const paymentId = String(
    primerValor(query["data.id"]) || primerValor(query.id) || body?.data?.id || body?.id || ""
  );
  return { tipo, paymentId };
}

/** Separa `CERTISEND|<uid>|<plan>|<cop>|<idAleatorio>`. `null` si no tiene el prefijo o la forma
 * esperada (pago de Faro u otro producto que comparte la misma cuenta de Mercado Pago). */
function parsearExternalReference(
  externalReference: string
): { uid: string; plan: string; cop: number; referenciaId: string } | null {
  if (!externalReference.startsWith("CERTISEND|")) return null;
  const partes = externalReference.split("|");
  if (partes.length !== 5) return null;
  const [, uid, plan, copTexto, referenciaId] = partes;
  const cop = Number(copTexto);
  if (!uid || !plan || !referenciaId || !Number.isFinite(cop)) return null;
  return { uid, plan, cop, referenciaId };
}

/**
 * Procesa un aviso de webhook ya reducido a `{tipo, paymentId}` (la ruta HTTP en server.ts saca
 * esos dos datos de la query/body con `extraerAvisoWebhookMP`, arriba).
 *
 * Activa el Paquete SOLO si se cumplen las condiciones del spec (Tarea 6, mas `status_detail` de
 * la vuelta 22): status=approved, status_detail distinto de "partially_refunded", currency_id=COP,
 * transaction_amount === cop del external_reference, y ese cop coincide con el que de verdad se
 * guardo en `preferencias/{id}` al crear el cobro. Cualquier otra cosa se ignora respondiendo 200
 * (nunca activa, nunca hace que Mercado Pago reintente).
 */
export async function procesarWebhookMP(opts: ProcesarWebhookMPOpts): Promise<ResultadoWebhookMP> {
  const { tipo, paymentId } = opts;

  if (tipo !== "payment") {
    // merchant_order, subscription_preapproval (Tarea 8), etc.: no es un pago, no hay nada que
    // verificar hoy. 200 para que Mercado Pago no reintente un aviso que nunca vamos a procesar.
    return { httpStatus: 200, razon: `tipo distinto de payment (${tipo || "vacio"})` };
  }
  if (!paymentId) {
    return { httpStatus: 200, razon: "sin id de pago en el aviso" };
  }

  let respuesta: RespuestaPagoMP;
  try {
    respuesta = await opts.obtenerPago(paymentId);
  } catch (error: any) {
    // Red caida o timeout hablando con Mercado Pago: transitorio, que reintente.
    opts.log(`[MP WEBHOOK] red caida consultando el pago. paymentId=${paymentId}: ${error?.message || error}`);
    return { httpStatus: 500, razon: "fallo de red consultando a Mercado Pago" };
  }

  if (!respuesta.ok) {
    if (respuesta.status >= 500) {
      // Error transitorio DE MERCADO PAGO (no un id invalido): que reintente.
      opts.log(`[MP WEBHOOK] MP respondio ${respuesta.status} al consultar el pago. paymentId=${paymentId}`);
      return { httpStatus: 500, razon: `MP respondio ${respuesta.status}` };
    }
    // 404/400: id inventado o invalido. No es transitorio — reintentar no lo arregla.
    opts.log(`[MP WEBHOOK] MP respondio ${respuesta.status} (pago no encontrado). paymentId=${paymentId}`);
    return { httpStatus: 200, razon: `MP respondio ${respuesta.status} (no encontrado)` };
  }

  const pago = await respuesta.json();
  const status = String(pago?.status || "");
  const referencia = parsearExternalReference(String(pago?.external_reference || ""));
  // Log minimo exigido: paymentId, uid y status — nunca el email/nombre/metodo de pago del pagador.
  opts.log(`[MP WEBHOOK] paymentId=${paymentId} uid=${referencia?.uid || "desconocido"} status=${status}`);

  if (!referencia) {
    // No empieza con "CERTISEND|": es de Faro (misma cuenta de Mercado Pago) u otro producto.
    return { httpStatus: 200, razon: "external_reference no es de CertiSend" };
  }
  if (referencia.plan !== "paquete") {
    // "pro" es la Tarea 8: hoy no hay nada que activar para ese plan via este webhook.
    return { httpStatus: 200, razon: `plan "${referencia.plan}" no se activa aqui (Tarea 8 pendiente)` };
  }

  // `status_detail` distingue un "approved" de verdad de uno al que ya se le devolvio parte del
  // dinero (vuelta 22): Mercado Pago deja `status=approved` tras un reembolso PARCIAL, asi que
  // sin este chequeo un pago parcialmente reembolsado activaria el Paquete completo igual.
  const statusDetail = String(pago?.status_detail || "");
  const cumpleLasCondiciones =
    status === "approved" &&
    statusDetail !== "partially_refunded" &&
    String(pago?.currency_id || "") === "COP" &&
    Number(pago?.transaction_amount) === referencia.cop;
  if (!cumpleLasCondiciones) {
    return {
      httpStatus: 200,
      razon: `no cumple las condiciones de activacion (status=${status}, status_detail=${statusDetail || "ninguno"})`,
    };
  }

  const preferencia = await opts.obtenerPreferencia(referencia.referenciaId);
  if (
    !preferencia ||
    preferencia.uid !== referencia.uid ||
    preferencia.plan !== "paquete" ||
    preferencia.cop !== referencia.cop
  ) {
    // El cop del external_reference no coincide con lo que de verdad se ofrecio al crear el
    // cobro (o la preferencia no existe): no se activa nada con un numero que no se puede probar.
    opts.log(`[MP WEBHOOK] preferencia no coincide o no existe. paymentId=${paymentId} uid=${referencia.uid}`);
    return { httpStatus: 200, razon: "la preferencia guardada no coincide" };
  }

  const fechaPago = pago?.date_approved ? new Date(pago.date_approved) : new Date();
  const resultado = await opts.activarPaquete(referencia.uid, paymentId, {
    cop: referencia.cop,
    trm: preferencia.trm,
    fecha: opts.timestampDesdeFecha(fechaPago),
  });

  return { httpStatus: 200, razon: resultado === "activado" ? "activado" : "pago ya procesado (idempotencia)" };
}
