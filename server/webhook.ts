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
import { sumarUnMes } from "./cuentas";

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

// ── Aviso a Leonardo ante fallos repetidos (Tarea 5, requisito "vuelta 22", 2026-10-05) ────────
// El `catch`/los 500 transitorios de este webhook (red caida hablando con MP, MP devolviendo 5xx,
// o `MERCADO_PAGO_ACCESS_TOKEN` sin configurar) ya hacian que Mercado Pago reintentara solo; pero
// avisar a Leonardo en CADA 500 aislado seria ruido (un 500 transitorio es normal, MP reintenta
// solo). El umbral es "3 fallos SEGUIDOS del mismo paymentId" — `registrarResultadoWebhook` es
// PURA (sin Map, sin tiempo real) para poder probar la secuencia de fallos/exitos con node:test;
// quien la llama (server.ts) guarda el `EstadoFallosWebhook` devuelto en un `Map<paymentId, ...>`,
// mismo patron que los demas limitadores en memoria de ese archivo.
export interface EstadoFallosWebhook {
  /** Fallos SEGUIDOS (un httpStatus>=500) para este paymentId; un exito (httpStatus<500) lo
   * resetea a 0. */
  fallos: number;
  /** true si YA se avisó a Leonardo por esta racha de fallos — antirrepeticion: no se vuelve a
   * avisar hasta que la racha se resetee con un exito y vuelva a llegar al umbral. */
  avisado: boolean;
}

/**
 * Dado el estado previo (o `undefined` si es la primera vez que se ve este paymentId) y el
 * `httpStatus` que acaba de responder este webhook, decide el nuevo estado y si HAY que avisar a
 * Leonardo ahora mismo (exactamente una vez por racha, en el fallo que alcanza `umbral`, nunca en
 * los siguientes de la misma racha).
 */
export function registrarResultadoWebhook(
  previo: EstadoFallosWebhook | undefined,
  httpStatus: number,
  umbral = 3
): { estado: EstadoFallosWebhook; debeAvisar: boolean } {
  const exito = httpStatus < 500;
  if (exito) return { estado: { fallos: 0, avisado: false }, debeAvisar: false };

  const fallos = (previo?.fallos ?? 0) + 1;
  const avisadoAntes = previo?.avisado ?? false;
  const debeAvisar = fallos >= umbral && !avisadoAntes;
  return { estado: { fallos, avisado: avisadoAntes || debeAvisar }, debeAvisar };
}

export interface ProcesarWebhookMPOpts {
  /** "payment" (unico tipo que procesa hoy; "subscription_preapproval" etc. son la Tarea 8). */
  tipo: string;
  paymentId: string;
  /** Consulta real GET /v1/payments/{id} con el access token del servidor (inyectable en pruebas). */
  obtenerPago(paymentId: string): Promise<RespuestaPagoMP>;
  /** Lee `preferencias/{id}` (el id aleatorio del external_reference). */
  obtenerPreferencia(id: string): Promise<PreferenciaGuardada | null>;
  /** Activa el Paquete de forma idempotente; ver server/cuentas.ts. `referenciaId`/`fechaTrm`
   * (M37, corrige vuelta 28) se guardan junto con el pago para poder reconstruir el aviso de
   * compra en un reintento posterior sin volver a consultar Mercado Pago. "requiere_reembolso"
   * (Medio 4, correccion vuelta 31): la cuenta ya tenia un Paquete vigente activado por OTRO
   * pago — este NO se activa ni se pisa nada. */
  activarPaquete(
    uid: string,
    paymentId: string,
    datos: { cop: number; trm: number; fecha: Timestamp; referenciaId: string; fechaTrm: string }
  ): Promise<"activado" | "repetido" | "requiere_reembolso">;
  /**
   * Tarea 16A-2 (decision del Brain 2026-10-06): activa de forma idempotente el plan "Pago por
   * uso" (suma `cantidad` al saldo, SIN vencimiento, ACUMULABLE — ver
   * `activarPorUsoSiNoProcesado`, server/cuentas.ts). A diferencia del Paquete, nunca hay
   * "requiere_reembolso": el saldo Por uso no tiene un "pago activo" unico que proteger.
   */
  activarPorUso(
    uid: string,
    paymentId: string,
    datos: { cantidad: number; cop: number; trm: number; fecha: Timestamp }
  ): Promise<"activado" | "repetido">;
  /** Para construir el Timestamp de la fecha del pago sin importar firebase-admin aqui (se inyecta
   * desde server.ts/los tests, que ya tienen el Timestamp real o uno falso). */
  timestampDesdeFecha(fecha: Date): Timestamp;
  /** Log minimo y no sensible (Tarea 6: "solo paymentId, uid y status, sin datos del pagador"). */
  log(linea: string): void;
  /**
   * Tarea 5 (2026-10-05): tras una activacion exitosa (resultado "activado" O "repetido" — ver
   * mas abajo, esta funcion decide por su cuenta si ya se notifico), envia el correo de
   * confirmacion al comprador y el aviso de venta a Leonardo. Debe ser internamente idempotente
   * (nunca manda correos extra si ya se mandaron para este `paymentId`) y NUNCA debe lanzar: un
   * relay caido no puede tumbar la activacion ya confirmada ni hacer que este webhook responda
   * 500 (Mercado Pago reintentaria un pago que YA se activo). Por eso ademas se llama dentro de
   * un try/catch en `procesarWebhookMP` — defensa en profundidad, no confianza ciega en la
   * implementacion inyectada.
   */
  notificarActivacion(datos: {
    uid: string;
    paymentId: string;
    referenciaId: string;
    cop: number;
    trm: number;
    fechaTrm: string;
    fechaPago: Date;
    fechaVencimiento: Date;
  }): Promise<void>;
  /**
   * Tarea 16A-2: equivalente de `notificarActivacion` para el plan "Pago por uso" — correo de
   * confirmacion al comprador (cantidad, sin vencimiento) + aviso de venta a Leonardo. Mismas
   * garantias (idempotente por destinatario, nunca lanza — tambien envuelta en try/catch abajo).
   */
  notificarActivacionPorUso(datos: {
    uid: string;
    paymentId: string;
    referenciaId: string;
    cantidad: number;
    cop: number;
    trm: number;
    fechaTrm: string;
    fechaPago: Date;
  }): Promise<void>;
  /**
   * Tarea 9 (2026-10-05): ante `status` "refunded"/"charged_back" sobre un `paymentId` que YA
   * activo algo aqui, revierte la cuenta a Gratis SI ese pago era el activo (y avisa a Leonardo
   * en los dos casos, activo o no) — ver `server/cuentas.ts` `revertirPagoSiNoRevertidoTx` y
   * `server/notificaciones.ts` `avisarReembolsoPaquete`. Idempotente y, igual que
   * `notificarActivacion`, nunca debe lanzar (tambien envuelta en try/catch abajo).
   *
   * Tarea 16A-2: `plan` (derivado del `external_reference`, nunca leido de otra parte) le dice a
   * `avisarReembolsoPaquete` que variante de correo usar para el comprador — "tu saldo se ajustó"
   * (porUso) en vez de "volviste a Gratis" (paquete, comportamiento EXISTENTE sin cambios).
   */
  procesarReembolso(datos: {
    uid: string;
    paymentId: string;
    status: string;
    referenciaId: string;
    plan?: "paquete" | "porUso";
  }): Promise<void>;
  /**
   * Medio 4 (pago doble con 2 preferencias, correccion vuelta 31, 2026-10-06): se llama cuando
   * `activarPaquete` devuelve "requiere_reembolso" — avisa a Leonardo (log
   * `ALERTA_REEMBOLSO_REQUERIDO` + correo, ver server/notificaciones.ts) de que este pago quedo
   * sin activar porque la cuenta ya tenia un Paquete vigente de otro pago. Nunca debe lanzar (se
   * llama tambien dentro de un try/catch en `procesarWebhookMP`, defensa en profundidad).
   */
  avisarPagoDoble(datos: { uid: string; paymentId: string; cop: number }): Promise<void>;
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

/** Separa `CERTISEND|<uid>|<plan>|<cop>|<idAleatorio>` (paquete/pro, 5 partes) o
 * `CERTISEND|<uid>|porUso|<cantidad>|<cop>|<idAleatorio>` (porUso, 6 partes — Tarea 16A-2, decision
 * del Brain 2026-10-06). `null` si no tiene el prefijo o ninguna de las dos formas esperadas (pago
 * de Faro u otro producto que comparte la misma cuenta de Mercado Pago, o una referencia
 * manipulada con un numero de partes invalido). */
function parsearExternalReference(
  externalReference: string
): { uid: string; plan: string; cop: number; referenciaId: string; cantidad?: number } | null {
  if (!externalReference.startsWith("CERTISEND|")) return null;
  const partes = externalReference.split("|");

  if (partes.length === 5) {
    const [, uid, plan, copTexto, referenciaId] = partes;
    const cop = Number(copTexto);
    if (!uid || !plan || !referenciaId || !Number.isFinite(cop)) return null;
    return { uid, plan, cop, referenciaId };
  }

  if (partes.length === 6) {
    const [, uid, plan, cantidadTexto, copTexto, referenciaId] = partes;
    const cop = Number(copTexto);
    const cantidad = Number(cantidadTexto);
    if (!uid || !plan || !referenciaId || !Number.isFinite(cop) || !Number.isInteger(cantidad)) return null;
    return { uid, plan, cop, referenciaId, cantidad };
  }

  return null;
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
  const esPaquete = referencia.plan === "paquete";
  const esPorUso = referencia.plan === "porUso";
  if (!esPaquete && !esPorUso) {
    // "pro" desaparecio (decision del Brain 2026-10-06, Tarea 16A-2): hoy no hay nada que activar
    // para ningun plan distinto de "paquete"/"porUso" via este webhook.
    return { httpStatus: 200, razon: `plan "${referencia.plan}" no se activa aqui (Tarea 8 pendiente)` };
  }

  // ── Tarea 9 (2026-10-05): contracargo o reembolso TOTAL ya aprobados por MP ──────────────────
  // `status="refunded"`/`"charged_back"` (o, por robustez ante variantes de la API,
  // `status_detail` equivalente) sobre un pago que YA activo algo aqui: revertir si era el pago
  // activo, avisar a Leonardo siempre. Esto va ANTES del chequeo de "approved" de abajo porque un
  // pago revertido ya NO esta "approved" la mayoria de las veces (MP lo deja en "refunded"), asi
  // que si se mirara despues nunca se alcanzaria esta rama.
  //
  // M34 (corrige vuelta 27): si la REVERSION misma falla (`opts.procesarReembolso` lanza — p. ej.
  // Firestore sin red al intentar `revertirPagoSiNoRevertidoTx`), este webhook responde 500 para
  // que Mercado Pago reintente el aviso completo: la reversion ya es idempotente (gate en
  // `revertido`, server/cuentas.ts), asi que reintentarla es seguro, y un 200 aqui arriesgaria
  // perder para siempre un evento cuya cuenta nunca llego a revertirse. Ese 500 tambien CUENTA
  // para el aviso de "3 fallos seguidos" a Leonardo (server.ts `avisarSiFallaRepetido`, que mira
  // el `httpStatus` que esta funcion devuelve) — no hace falta logica aparte para eso.
  const statusDetailCrudo = String(pago?.status_detail || "");
  const esReembolsoOContracargo =
    status === "refunded" ||
    status === "charged_back" ||
    statusDetailCrudo === "refunded" ||
    statusDetailCrudo === "charged_back";
  if (esReembolsoOContracargo) {
    try {
      await opts.procesarReembolso({
        uid: referencia.uid,
        paymentId,
        status: status || statusDetailCrudo,
        referenciaId: referencia.referenciaId,
        plan: esPorUso ? "porUso" : "paquete",
      });
    } catch (error: any) {
      opts.log(`[MP WEBHOOK] fallo al revertir el pago (se reintenta, la reversion es idempotente). paymentId=${paymentId}: ${error?.message || error}`);
      return { httpStatus: 500, razon: "fallo al procesar reembolso/contracargo" };
    }
    return { httpStatus: 200, razon: `reembolso/contracargo procesado (status=${status || statusDetailCrudo})` };
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

  // ── Pago por uso (Tarea 16A-2, decision del Brain 2026-10-06) ─────────────────────────────────
  if (esPorUso) {
    // La preferencia guardada por create-preference (server/cobroPaquete.ts `crearCobroPorUso`)
    // SI guarda `cantidad`, aunque el tipo `PreferenciaGuardada` (server/cuentas.ts) no la declare
    // — se ensancha el tipo localmente aqui, sin tocar ese modulo.
    const prefPorUso = preferencia as (PreferenciaGuardada & { cantidad?: number }) | null;
    if (
      !prefPorUso ||
      prefPorUso.uid !== referencia.uid ||
      prefPorUso.plan !== "porUso" ||
      prefPorUso.cop !== referencia.cop ||
      prefPorUso.cantidad !== referencia.cantidad
    ) {
      // Cubre tambien una `cantidad` manipulada en el external_reference contra la preferencia
      // real: nunca se activa con un numero (monto o cantidad) que no se puede probar.
      opts.log(`[MP WEBHOOK] preferencia porUso no coincide o no existe. paymentId=${paymentId} uid=${referencia.uid}`);
      return { httpStatus: 200, razon: "la preferencia guardada no coincide" };
    }

    const fechaPagoPorUso = pago?.date_approved ? new Date(pago.date_approved) : new Date();
    const resultadoPorUso = await opts.activarPorUso(referencia.uid, paymentId, {
      cantidad: referencia.cantidad!,
      cop: referencia.cop,
      trm: prefPorUso.trm,
      fecha: opts.timestampDesdeFecha(fechaPagoPorUso),
    });

    try {
      await opts.notificarActivacionPorUso({
        uid: referencia.uid,
        paymentId,
        referenciaId: referencia.referenciaId,
        cantidad: referencia.cantidad!,
        cop: referencia.cop,
        trm: prefPorUso.trm,
        fechaTrm: prefPorUso.fechaTrm,
        fechaPago: fechaPagoPorUso,
      });
    } catch (error: any) {
      opts.log(`[MP WEBHOOK] fallo al notificar la activacion porUso (no afecta el pago, ya quedo activado). paymentId=${paymentId}: ${error?.message || error}`);
    }

    return { httpStatus: 200, razon: resultadoPorUso === "activado" ? "activado" : "pago ya procesado (idempotencia)" };
  }

  // ── Paquete (comportamiento EXISTENTE, sin cambios) ────────────────────────────────────────────
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
    referenciaId: referencia.referenciaId,
    fechaTrm: preferencia.fechaTrm,
  });

  // Medio 4 (pago doble con 2 preferencias, correccion vuelta 31, 2026-10-06): la cuenta ya tenia
  // un Paquete vigente de OTRO pago — este no se activo, nada que notificarle al comprador. Se
  // avisa a Leonardo (try/catch defensivo, igual que notificarActivacion/procesarReembolso: nunca
  // debe convertir un pago ya registrado en un 500) y se responde 200 (Mercado Pago no debe
  // reintentar algo que ya se registro, aunque no se haya activado).
  if (resultado === "requiere_reembolso") {
    try {
      await opts.avisarPagoDoble({ uid: referencia.uid, paymentId, cop: referencia.cop });
    } catch (error: any) {
      opts.log(`[MP WEBHOOK] fallo al avisar el pago doble (no afecta el registro del pago). paymentId=${paymentId}: ${error?.message || error}`);
    }
    return { httpStatus: 200, razon: "pago doble: la cuenta ya tenia un Paquete vigente de otro pago (requiere reembolso manual)" };
  }

  // Tarea 5 (2026-10-05): se intenta en los DOS casos ("activado" fresco o "repetido") — la propia
  // funcion inyectada decide si ya se notifico este `paymentId` (idempotencia real en
  // `server/cuentas.ts` reclamarEnvioCorreo/marcarCorreoEnviado, POR destinatario desde M35).
  // Esto es lo que permite que una
  // entrega anterior con el relay caido se recupere en una entrega posterior del mismo
  // `paymentId`, sin volver a activar nada ni mandar un correo de mas. Try/catch defensivo: nunca
  // debe convertir un pago ya activado en un 500 (oraculo "el relay falla -> la activacion queda
  // y el webhook responde 200").
  try {
    await opts.notificarActivacion({
      uid: referencia.uid,
      paymentId,
      referenciaId: referencia.referenciaId,
      cop: referencia.cop,
      trm: preferencia.trm,
      fechaTrm: preferencia.fechaTrm,
      fechaPago,
      fechaVencimiento: sumarUnMes(fechaPago),
    });
  } catch (error: any) {
    opts.log(`[MP WEBHOOK] fallo al notificar la activacion (no afecta el pago, ya quedo activado). paymentId=${paymentId}: ${error?.message || error}`);
  }

  return { httpStatus: 200, razon: resultado === "activado" ? "activado" : "pago ya procesado (idempotencia)" };
}
