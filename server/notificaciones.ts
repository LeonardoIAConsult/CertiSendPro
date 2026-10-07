// Composicion de avisos (Tareas 5 y 9, cobro real con planes, 2026-10-05; M34/M35/M36 corrigen la
// vuelta 27): une el canal generico de correo (server/avisos.ts, HMAC + relay) con la lectura/
// escritura de Firestore (server/cuentas.ts) para dar las DOS funciones que `server/webhook.ts`
// necesita inyectadas:
//   - `notificarActivacionPaquete`: correo de confirmacion al comprador + aviso de venta a
//     Leonardo, exactamente una vez POR DESTINATARIO (M35), con el acuse BLOQUEADO si el texto
//     todavia tiene un dato pendiente (M36(2)).
//   - `avisarReembolsoPaquete`: revierte la cuenta a Gratis si el pago era el activo y avisa a
//     Leonardo, exactamente una vez por evento de reembolso/contracargo (Tarea 9); si la
//     REVERSION misma falla, se propaga (M34) para que el webhook responda 500.
//
// Las dependencias de Firestore y del envio de correo son PARAMETROS con un valor por defecto
// (las funciones reales de server/cuentas.ts y server/avisos.ts) — mismo motivo que
// server/trm.ts/server/webhook.ts inyectan `fetchLike`/`obtenerPago`: permite probar la
// idempotencia end-to-end con el doble de Firestore de tests/_fakeFirestore.ts y un `enviarCorreo`
// falso, sin tocar Firestore real (que en este entorno no tiene emulador disponible, igual que el
// resto de Tareas 2/3/6/14).
import {
  enviarCorreo as enviarCorreoReal,
  construirCorreoConfirmacionCompra,
  construirCorreoConfirmacionCompraPorUso,
  construirAvisoVentaLeonardo,
  construirAvisoReembolsoLeonardo,
  construirAvisoBloqueoProveedorLeonardo,
  construirAvisoPagoDobleLeonardo,
  construirAvisoReversionComprador,
  construirAvisoUsoParcialPorUsoLeonardo,
  tienePlaceholderPendiente,
  type DatosCorreo,
  type DatosConfirmacionCompra,
  type DatosConfirmacionCompraPorUso,
} from "./avisos";
import {
  reclamarEnvioCorreo as reclamarEnvioCorreoReal,
  marcarCorreoEnviado as marcarCorreoEnviadoReal,
  liberarReclamoCorreo as liberarReclamoCorreoReal,
  obtenerAceptacion as obtenerAceptacionReal,
  revertirPagoSiNoRevertido as revertirPagoSiNoRevertidoReal,
  obtenerEstadoCorreoComprador as obtenerEstadoCorreoCompradorReal,
  obtenerUsadosAlRevertirPorUso as obtenerUsadosAlRevertirPorUsoReal,
  type DestinatarioCorreo,
  type Idioma,
  type ResultadoReversion,
} from "./cuentas";

/** Correo donde Leonardo recibe los avisos de venta/reembolso (Tarea 5/9) — el UNICO correo de
 * contacto del producto, igual que el resto del proyecto (checkout, plantilla de compra). */
export const CORREO_LEONARDO = "contacto@leonardoantolinez.com";

function enlaceTerminos(): string {
  const base = process.env.PUBLIC_BASE_URL || "https://certisendpro.online";
  return `${base}/terminos`;
}

export interface DatosNotificarActivacion {
  uid: string;
  paymentId: string;
  /** Id de `preferencias/{id}`/`aceptaciones/{id}` (el mismo, ver server/cobroPaquete.ts). */
  referenciaId: string;
  cop: number;
  trm: number;
  fechaTrm: string;
  fechaPago: Date;
  fechaVencimiento: Date;
}

export interface NotificarActivacionDeps {
  reclamarEnvioCorreo(paymentId: string, destinatario: DestinatarioCorreo, ahora: Date): Promise<boolean>;
  /**
   * `reclamadoEn` (simplificacion 2026-10-06): el MISMO `ahora` que recibio `reclamarEnvioCorreo`
   * al reclamar — `marcarCorreoEnviado`/`liberarReclamoCorreo` (server/cuentas.ts) solo cierran el
   * reclamo si sigue siendo exactamente ese (comparacion transaccional), para que un cierre tardio
   * nunca pise un reclamo ajeno mas nuevo sobre el mismo destinatario.
   */
  marcarCorreoEnviado(paymentId: string, destinatario: DestinatarioCorreo, reclamadoEn: Date): Promise<void>;
  liberarReclamoCorreo(paymentId: string, destinatario: DestinatarioCorreo, reclamadoEn: Date): Promise<void>;
  obtenerAceptacion(id: string): Promise<{ email: string | null; idioma: Idioma } | null>;
  enviarCorreo(datos: DatosCorreo): Promise<boolean>;
  /** Compone el correo de confirmacion al comprador — inyectable (por defecto,
   * `construirCorreoConfirmacionCompra` real) para poder probar el reclamo transaccional (M35) y
   * el bloqueo por dato pendiente (M36(2)) por separado, sin que uno dependa del contenido real
   * del otro. */
  construirCorreoComprador(datos: DatosConfirmacionCompra): { asunto: string; texto: string };
}

export const depsNotificarActivacionReales: NotificarActivacionDeps = {
  reclamarEnvioCorreo: reclamarEnvioCorreoReal,
  marcarCorreoEnviado: marcarCorreoEnviadoReal,
  liberarReclamoCorreo: liberarReclamoCorreoReal,
  obtenerAceptacion: obtenerAceptacionReal,
  enviarCorreo: enviarCorreoReal,
  construirCorreoComprador: construirCorreoConfirmacionCompra,
};

/**
 * M35 (corrige vuelta 27): reclama el envio a `destinatario` de forma TRANSACCIONAL ANTES de
 * mandar nada (`reclamarEnvioCorreo`, ver server/cuentas.ts `reclamarEnvioCorreoTx`). Si otra
 * entrega (casi simultanea, o una anterior) ya se quedo con este destinatario, no hace nada — por
 * eso dos avisos casi simultaneos del mismo pago producen UN solo correo por destinatario. Si el
 * envio falla, LIBERA el reclamo (vuelve a `null`) para que una entrega futura pueda reintentar
 * SOLO este destinatario, sin reenviar al otro.
 */
async function intentarEnviarUnDestinatario(
  paymentId: string,
  // Pick (no `NotificarActivacionDeps` completo): esta funcion nunca toca `construirCorreoComprador`
  // ni `obtenerAceptacion`, asi que el tipo mas angosto le permite recibir tanto
  // `NotificarActivacionDeps` (Paquete) como `NotificarActivacionPorUsoDeps` (Tarea 16A-2) —
  // sus `construirCorreoComprador` tienen formas incompatibles entre si, pero esta funcion no las usa.
  deps: Pick<NotificarActivacionDeps, "reclamarEnvioCorreo" | "enviarCorreo" | "marcarCorreoEnviado" | "liberarReclamoCorreo">,
  destinatario: DestinatarioCorreo,
  correo: DatosCorreo,
  ahora: Date
): Promise<void> {
  const reclamado = await deps.reclamarEnvioCorreo(paymentId, destinatario, ahora);
  if (!reclamado) return; // ya reclamado o ya enviado por otra entrega.

  // M-3(b): id idempotente de este correo logico — el relay (docs/relay/avisos-relay.gs) lo usa
  // para no reenviarlo si una entrega anterior ya lo mando de verdad pero Node la dio por fallida
  // (timeout del lado de Node mientras Apps Script seguia procesando, ver server/avisos.ts).
  const ok = await deps.enviarCorreo({ ...correo, idEnvio: `${paymentId}:${destinatario}` });
  await cerrarReclamoConReintento(paymentId, deps, destinatario, ok, ahora);
}

/**
 * Hallazgo de `/code-review` sobre el commit de M33-M36 (vuelta 27): `enviarCorreo` nunca lanza
 * (siempre resuelve `boolean`, ver server/avisos.ts), pero la escritura que CIERRA el reclamo
 * (`marcarCorreoEnviado`/`liberarReclamoCorreo`) SI puede fallar (Firestore sin red justo en ese
 * instante) — y si eso pasa, el campo queda en `"reclamado"` para siempre: `reclamarEnvioCorreoTx`
 * trata cualquier valor truthy como "ya tomado" (server/cuentas.ts), asi que ninguna entrega
 * futura del mismo `paymentId` reintentaria ESE destinatario.
 *
 * Mitigacion MINIMA (deliberada: NO es una reconciliacion completa con TTL/cron, que seria una
 * tarea aparte y el propio `/code-review` la califico de "no bloqueante" para el lanzamiento): un
 * reintento INMEDIATO de la MISMA operacion (nunca cambia de `marcarCorreoEnviado` a
 * `liberarReclamoCorreo` o viceversa — eso arriesgaria un reenvio duplicado si el correo YA se
 * mando). Si el reintento TAMBIEN falla, se deja un log con un marcador fijo y grepable
 * (`RECLAMO_SIN_SALIDA`) para resolverlo a mano en Firestore — mismo patron ya aceptado en este
 * proyecto para la devolucion manual de la Tarea 9.
 *
 * `deps` solo exige `marcarCorreoEnviado`/`liberarReclamoCorreo` (no el resto de
 * `NotificarActivacionDeps`) para que `avisarReembolsoPaquete` (Medio 1, vuelta 35) pueda
 * reutilizar la misma funcion para cerrar el reclamo del aviso de reversion al comprador.
 */
async function cerrarReclamoConReintento(
  paymentId: string,
  deps: Pick<NotificarActivacionDeps, "marcarCorreoEnviado" | "liberarReclamoCorreo">,
  destinatario: DestinatarioCorreo,
  envioOk: boolean,
  reclamadoEn: Date
): Promise<void> {
  const cerrarReclamo = () =>
    envioOk
      ? deps.marcarCorreoEnviado(paymentId, destinatario, reclamadoEn)
      : deps.liberarReclamoCorreo(paymentId, destinatario, reclamadoEn);
  try {
    await cerrarReclamo();
  } catch (error: any) {
    console.error(
      `[NOTIFICACIONES] fallo al cerrar el reclamo de correo (reintentando una vez). paymentId=${paymentId} destinatario=${destinatario}:`,
      error?.message || error
    );
    try {
      await cerrarReclamo();
    } catch (error2: any) {
      console.error(
        `[NOTIFICACIONES] RECLAMO_SIN_SALIDA: el reclamo de "${destinatario}" para paymentId=${paymentId} quedo en "reclamado" tras 2 fallos seguidos de Firestore. ` +
          `Resolver a mano en pagosProcesados/${paymentId}: debe quedar en ${envioOk ? '"enviado" (el correo SI se mando)' : "null (para que una entrega futura reintente)"}.`,
        error2?.message || error2
      );
    }
  }
}

/**
 * Tarea 5: envia el correo de confirmacion de compra al comprador + el aviso de venta a Leonardo.
 * Nunca lanza: cualquier fallo (relay caido, Firestore sin red) queda en un log y la funcion
 * resuelve igual — el llamador (`procesarWebhookMP`) ya la envuelve en su propio try/catch como
 * defensa en profundidad, pero esta funcion no depende de eso para ser segura.
 *
 * Los DOS destinatarios se reclaman/envian de forma INDEPENDIENTE (M35): si falla el de Leonardo,
 * el del comprador (si ya salio) nunca se reenvia, y viceversa — cada uno tiene su propio campo en
 * `pagosProcesados/{paymentId}` (ver server/cuentas.ts).
 *
 * M36(2): si el correo del comprador, ya compuesto, todavia contiene un dato marcado como
 * pendiente (el pie del proveedor, o cualquier otro placeholder — ver `tienePlaceholderPendiente`
 * en server/avisos.ts), NUNCA se manda al comprador: se registra el bloqueo (log) y se avisa a
 * Leonardo UNA SOLA VEZ por pago (mismo mecanismo de reclamo, destinatario "bloqueoProveedor").
 */
export async function notificarActivacionPaquete(
  datos: DatosNotificarActivacion,
  ahora: Date = new Date(),
  deps: NotificarActivacionDeps = depsNotificarActivacionReales
): Promise<void> {
  try {
    const aceptacion = await deps.obtenerAceptacion(datos.referenciaId);

    if (aceptacion?.email) {
      const correoComprador = deps.construirCorreoComprador({
        paraEmail: aceptacion.email,
        idioma: aceptacion.idioma,
        cop: datos.cop,
        trm: datos.trm,
        fechaTrm: datos.fechaTrm,
        fechaPago: datos.fechaPago,
        fechaVencimiento: datos.fechaVencimiento,
        refMp: datos.paymentId,
        enlaceTerminos: enlaceTerminos(),
      });

      if (tienePlaceholderPendiente(correoComprador.texto)) {
        console.error(
          `[NOTIFICACIONES] acuse de compra BLOQUEADO (dato pendiente en el correo). paymentId=${datos.paymentId}`
        );
        const avisoBloqueo = construirAvisoBloqueoProveedorLeonardo({ uid: datos.uid, paymentId: datos.paymentId });
        await intentarEnviarUnDestinatario(
          datos.paymentId,
          deps,
          "bloqueoProveedor",
          { para: CORREO_LEONARDO, ...avisoBloqueo },
          ahora
        );
      } else {
        await intentarEnviarUnDestinatario(
          datos.paymentId,
          deps,
          "comprador",
          { para: aceptacion.email, ...correoComprador },
          ahora
        );
      }
    } else {
      console.warn(`[NOTIFICACIONES] sin correo de comprador para paymentId=${datos.paymentId} (aceptacion ausente o sin email).`);
    }

    const avisoVenta = construirAvisoVentaLeonardo({
      uid: datos.uid,
      paymentId: datos.paymentId,
      cop: datos.cop,
      plan: "paquete",
    });
    await intentarEnviarUnDestinatario(datos.paymentId, deps, "leonardo", { para: CORREO_LEONARDO, ...avisoVenta }, ahora);
  } catch (error: any) {
    console.error(`[NOTIFICACIONES] fallo al notificar la activacion. paymentId=${datos.paymentId}:`, error?.message || error);
  }
}

// ── Pago por uso: confirmacion de compra + aviso de venta (Tarea 16A-2, decision del Brain
// 2026-10-06) ────────────────────────────────────────────────────────────────────────────────────
// Mismo patron EXACTO que `notificarActivacionPaquete` (reclamo transaccional POR DESTINATARIO,
// bloqueo si el correo trae un dato pendiente, nunca lanza) — solo cambia el correo que se
// construye para el comprador (`construirCorreoConfirmacionCompraPorUso`: cantidad en vez de
// vencimiento, "tu saldo no vence") y que el aviso de venta a Leonardo lleva la cantidad comprada.

export interface DatosNotificarActivacionPorUso {
  uid: string;
  paymentId: string;
  /** Id de `preferencias/{id}`/`aceptaciones/{id}` (el mismo, ver server/cobroPaquete.ts). */
  referenciaId: string;
  cantidad: number;
  cop: number;
  trm: number;
  fechaTrm: string;
  fechaPago: Date;
}

export interface NotificarActivacionPorUsoDeps {
  reclamarEnvioCorreo(paymentId: string, destinatario: DestinatarioCorreo, ahora: Date): Promise<boolean>;
  marcarCorreoEnviado(paymentId: string, destinatario: DestinatarioCorreo, reclamadoEn: Date): Promise<void>;
  liberarReclamoCorreo(paymentId: string, destinatario: DestinatarioCorreo, reclamadoEn: Date): Promise<void>;
  obtenerAceptacion(id: string): Promise<{ email: string | null; idioma: Idioma } | null>;
  enviarCorreo(datos: DatosCorreo): Promise<boolean>;
  /** Compone el correo de confirmacion al comprador — inyectable (por defecto,
   * `construirCorreoConfirmacionCompraPorUso` real) por el mismo motivo que su equivalente del
   * Paquete. */
  construirCorreoComprador(datos: DatosConfirmacionCompraPorUso): { asunto: string; texto: string };
}

export const depsNotificarActivacionPorUsoReales: NotificarActivacionPorUsoDeps = {
  reclamarEnvioCorreo: reclamarEnvioCorreoReal,
  marcarCorreoEnviado: marcarCorreoEnviadoReal,
  liberarReclamoCorreo: liberarReclamoCorreoReal,
  obtenerAceptacion: obtenerAceptacionReal,
  enviarCorreo: enviarCorreoReal,
  construirCorreoComprador: construirCorreoConfirmacionCompraPorUso,
};

export async function notificarActivacionPorUso(
  datos: DatosNotificarActivacionPorUso,
  ahora: Date = new Date(),
  deps: NotificarActivacionPorUsoDeps = depsNotificarActivacionPorUsoReales
): Promise<void> {
  try {
    const aceptacion = await deps.obtenerAceptacion(datos.referenciaId);

    if (aceptacion?.email) {
      const correoComprador = deps.construirCorreoComprador({
        paraEmail: aceptacion.email,
        idioma: aceptacion.idioma,
        cantidad: datos.cantidad,
        cop: datos.cop,
        trm: datos.trm,
        fechaTrm: datos.fechaTrm,
        fechaPago: datos.fechaPago,
        refMp: datos.paymentId,
        enlaceTerminos: enlaceTerminos(),
      });

      if (tienePlaceholderPendiente(correoComprador.texto)) {
        console.error(
          `[NOTIFICACIONES] acuse de compra porUso BLOQUEADO (dato pendiente en el correo). paymentId=${datos.paymentId}`
        );
        const avisoBloqueo = construirAvisoBloqueoProveedorLeonardo({ uid: datos.uid, paymentId: datos.paymentId });
        await intentarEnviarUnDestinatario(
          datos.paymentId,
          deps,
          "bloqueoProveedor",
          { para: CORREO_LEONARDO, ...avisoBloqueo },
          ahora
        );
      } else {
        await intentarEnviarUnDestinatario(
          datos.paymentId,
          deps,
          "comprador",
          { para: aceptacion.email, ...correoComprador },
          ahora
        );
      }
    } else {
      console.warn(`[NOTIFICACIONES] sin correo de comprador para paymentId=${datos.paymentId} (aceptacion ausente o sin email).`);
    }

    const avisoVenta = construirAvisoVentaLeonardo({
      uid: datos.uid,
      paymentId: datos.paymentId,
      cop: datos.cop,
      plan: "porUso",
      cantidad: datos.cantidad,
    });
    await intentarEnviarUnDestinatario(datos.paymentId, deps, "leonardo", { para: CORREO_LEONARDO, ...avisoVenta }, ahora);
  } catch (error: any) {
    console.error(`[NOTIFICACIONES] fallo al notificar la activacion porUso. paymentId=${datos.paymentId}:`, error?.message || error);
  }
}

export interface AvisarReembolsoDeps {
  revertirPago(paymentId: string, uid: string): Promise<ResultadoReversion>;
  enviarCorreo(datos: DatosCorreo): Promise<boolean>;
  /** Medio 1 (vuelta 35): para leer `aceptaciones/{referenciaId}.email` e informarle al comprador
   * la reversion (Terminos sec. 9.2) — mismo mecanismo de reclamo que `notificarActivacionPaquete`. */
  obtenerAceptacion(id: string): Promise<{ email: string | null; idioma: Idioma } | null>;
  reclamarEnvioCorreo(paymentId: string, destinatario: DestinatarioCorreo, ahora: Date): Promise<boolean>;
  marcarCorreoEnviado(paymentId: string, destinatario: DestinatarioCorreo, reclamadoEn: Date): Promise<void>;
  liberarReclamoCorreo(paymentId: string, destinatario: DestinatarioCorreo, reclamadoEn: Date): Promise<void>;
  /** M1 (corrige NO-GO 2026-10-07): cuanto de la compra Por Uso revertida YA se habia usado
   * (0 si nada o si no aplica — Paquete, o nada usado). Leido DESPUES de que la reversion ya
   * aplico (ver `server/cuentas.ts` `obtenerUsadosAlRevertirPorUso`). */
  obtenerUsadosAlRevertirPorUso(paymentId: string): Promise<number>;
  /** M1: log + correo a Leonardo (`ALERTA_REVERSION_PORUSO_USADO`) cuando `obtenerUsadosAlRevertirPorUso`
   * devuelve > 0 — ver `server/notificaciones.ts` `avisarUsoParcialPorUso`, mas abajo. */
  avisarUsoParcialPorUso(datos: { paymentId: string; usados: number }): Promise<void>;
}

export const depsAvisarReembolsoReales: AvisarReembolsoDeps = {
  revertirPago: revertirPagoSiNoRevertidoReal,
  obtenerUsadosAlRevertirPorUso: obtenerUsadosAlRevertirPorUsoReal,
  avisarUsoParcialPorUso,
  enviarCorreo: enviarCorreoReal,
  obtenerAceptacion: obtenerAceptacionReal,
  reclamarEnvioCorreo: reclamarEnvioCorreoReal,
  marcarCorreoEnviado: marcarCorreoEnviadoReal,
  liberarReclamoCorreo: liberarReclamoCorreoReal,
};

/**
 * Medio 1 (vuelta 35); F1 (Abogado_LAP ronda 5/verificacion ronda 5, 2026-10-06): avisa al
 * COMPRADOR (mismo mecanismo de reclamo transaccional que `notificarActivacionPaquete` — nunca
 * duplica, nunca lanza) que su pago fue revertido, con la variante EXACTA que exige Terminos sec.
 * 9.2 segun lo que de verdad paso con su cuenta: `cuentaRevertida` es el resultado REAL de
 * `revertirPagoSiNoRevertidoTx` (nunca se infiere de otra cosa, nunca se asume) — si el pago no
 * era el activo, la cuenta no cambia y el correo tiene que decir eso, no "pasaste a Gratis".
 * Devuelve `{correoComprador, avisoEnviado}` para que `avisarReembolsoPaquete` pueda decirle a
 * Leonardo si todavia falta escribirle a mano (si no se encontro correo, o si el envio fallo).
 */
async function avisarReversionAlComprador(
  datos: { paymentId: string; referenciaId: string; status: string },
  cuentaRevertida: boolean,
  ahora: Date,
  deps: AvisarReembolsoDeps,
  plan: "paquete" | "porUso" = "paquete"
): Promise<{ correoComprador: string | null; avisoEnviado: boolean }> {
  try {
    const aceptacion = await deps.obtenerAceptacion(datos.referenciaId);
    const correoComprador = aceptacion?.email ?? null;
    if (!correoComprador) return { correoComprador: null, avisoEnviado: false };

    const reclamado = await deps.reclamarEnvioCorreo(datos.paymentId, "reversionComprador", ahora);
    if (!reclamado) {
      // Ya se reclamo/envio antes (reintento del mismo evento del webhook, o el barrido de
      // notificaciones.test.ts simultaneo) — no es un fallo, es la razon de ser del reclamo.
      return { correoComprador, avisoEnviado: true };
    }

    const { asunto, texto } = construirAvisoReversionComprador({
      idioma: aceptacion?.idioma ?? "es",
      paymentId: datos.paymentId,
      status: datos.status,
      cuentaRevertida,
      fecha: ahora,
      plan,
    });
    const ok = await deps.enviarCorreo({ para: correoComprador, asunto, texto, idEnvio: `${datos.paymentId}:reversionComprador` });
    await cerrarReclamoConReintento(datos.paymentId, deps, "reversionComprador", ok, ahora);
    return { correoComprador, avisoEnviado: ok };
  } catch (error: any) {
    console.error(`[NOTIFICACIONES] fallo al avisar la reversion al comprador. paymentId=${datos.paymentId}:`, error?.message || error);
    return { correoComprador: null, avisoEnviado: false };
  }
}

/**
 * Tarea 9: ante un reembolso/contracargo, revierte la cuenta a Gratis SI el pago era el activo
 * (ver `revertirPagoSiNoRevertido`, idempotente por su cuenta) y avisa a Leonardo — en los DOS
 * casos (activo o no), salvo que el evento ya se hubiera procesado antes o el pago nunca fuera
 * nuestro.
 *
 * M34 (corrige vuelta 27): a diferencia de `notificarActivacionPaquete` (que traga CUALQUIER
 * error, porque el pago ya quedo activado y no hay nada que reintentar sin riesgo), aqui un fallo
 * de `revertirPago` (Firestore sin red, por ejemplo) se DEJA PROPAGAR a proposito: `revertirPago`
 * es idempotente (gate en `revertido`, server/cuentas.ts), asi que es seguro que
 * `server/webhook.ts` responda 500 y Mercado Pago reintente el aviso completo, en vez de tragar el
 * error y arriesgarse a que una cuenta que debia revertirse se quede en Paquete/Pro. El aviso a
 * Leonardo (una vez que la reversion YA tuvo exito) si es best-effort: nunca debe tumbar una
 * reversion que ya se aplico. El aviso al COMPRADOR (Medio 1, vuelta 35) es igualmente best-effort
 * y nunca condiciona el de Leonardo (si falla, el texto de arriba simplemente le dice que falta
 * escribirle a mano).
 */
export async function avisarReembolsoPaquete(
  datos: { uid: string; paymentId: string; status: string; referenciaId: string; plan?: "paquete" | "porUso" },
  deps: AvisarReembolsoDeps = depsAvisarReembolsoReales,
  ahora: Date = new Date()
): Promise<void> {
  const resultado = await deps.revertirPago(datos.paymentId, datos.uid);
  if (resultado === "ya_procesado" || resultado === "ignorado") return;

  const cuentaRevertida = resultado === "revertido";
  const plan = datos.plan ?? "paquete";

  // M1 (corrige NO-GO 2026-10-07): si la compra Por Uso revertida YA tenia parte de su saldo
  // usado (atribucion FIFO, server/cuentas.ts `atribucionPorUso`), avisar a Leonardo ANTES de
  // seguir — best-effort, nunca debe tumbar el resto del aviso (la reversion YA tuvo exito).
  if (plan === "porUso" && cuentaRevertida) {
    try {
      const usados = await deps.obtenerUsadosAlRevertirPorUso(datos.paymentId);
      if (usados > 0) {
        await deps.avisarUsoParcialPorUso({ paymentId: datos.paymentId, usados });
      }
    } catch (error: any) {
      console.error(`[NOTIFICACIONES] fallo al comprobar/avisar el uso parcial de Por Uso. paymentId=${datos.paymentId}:`, error?.message || error);
    }
  }

  const { correoComprador, avisoEnviado } = await avisarReversionAlComprador(datos, cuentaRevertida, ahora, deps, plan);

  const { asunto, texto } = construirAvisoReembolsoLeonardo({
    uid: datos.uid,
    paymentId: datos.paymentId,
    status: datos.status,
    cuentaRevertida,
    correoComprador,
    avisoCompradorEnviado: avisoEnviado,
    plan,
  });
  try {
    await deps.enviarCorreo({ para: CORREO_LEONARDO, asunto, texto, idEnvio: `${datos.paymentId}:reembolso` });
  } catch (error: any) {
    // El aviso a Leonardo es best-effort: la reversion (lo que de verdad importa) YA tuvo exito.
    console.error(`[NOTIFICACIONES] fallo al avisar el reembolso a Leonardo (la reversión SÍ quedó). paymentId=${datos.paymentId}:`, error?.message || error);
  }
}

export interface AvisarPagoDobleDeps {
  enviarCorreo(datos: DatosCorreo): Promise<boolean>;
}

export const depsAvisarPagoDobleReales: AvisarPagoDobleDeps = { enviarCorreo: enviarCorreoReal };

/**
 * Medio 4 (pago doble con 2 preferencias, correccion vuelta 31, 2026-10-06): avisa a Leonardo
 * (log con marcador fijo `ALERTA_REEMBOLSO_REQUERIDO` + correo) cuando el webhook detecto un pago
 * aprobado que NO se activo para no pisar un Paquete vigente de otro pago (ver
 * `server/cuentas.ts` `activarPaqueteSiNoProcesadoTx`, resultado "requiere_reembolso"). Se llama
 * EXACTAMENTE una vez por `paymentId`: ese resultado solo ocurre la PRIMERA vez que se ve ese id
 * (una entrega repetida del mismo aviso de Mercado Pago encuentra `pagosProcesados/{id}` ya
 * existente y `activarPaqueteSiNoProcesadoTx` devuelve "repetido" antes de llegar aqui). Nunca
 * lanza: el log (que SI debe quedar, para la alerta de Cloud Logging) va primero y por separado
 * del correo, que es best-effort.
 *
 * Medio 1 (vuelta 35): mismo formato de log estructurado que las alertas de acuses
 * (`emitirAlertaTiempoUnaVez` mas abajo) — `severity: "ERROR"` + `message` fijo, grepable para la
 * alerta de Cloud Logging (ver docs/ops.md). Nunca uid aqui (dato personal), igual que esas.
 */
export async function avisarPagoDobleRequiereReembolso(
  datos: { uid: string; paymentId: string; cop: number },
  deps: AvisarPagoDobleDeps = depsAvisarPagoDobleReales
): Promise<void> {
  console.error(JSON.stringify({ severity: "ERROR", message: "ALERTA_REEMBOLSO_REQUERIDO", paymentId: datos.paymentId, cop: datos.cop }));
  try {
    const { asunto, texto } = construirAvisoPagoDobleLeonardo(datos);
    await deps.enviarCorreo({ para: CORREO_LEONARDO, asunto, texto });
  } catch (error: any) {
    console.error(
      `[NOTIFICACIONES] fallo al avisar el pago doble a Leonardo (el log ALERTA_REEMBOLSO_REQUERIDO ya quedo). paymentId=${datos.paymentId}:`,
      error?.message || error
    );
  }
}

export interface AvisarUsoParcialPorUsoDeps {
  enviarCorreo(datos: DatosCorreo): Promise<boolean>;
}

export const depsAvisarUsoParcialPorUsoReales: AvisarUsoParcialPorUsoDeps = { enviarCorreo: enviarCorreoReal };

/**
 * M1 (corrige NO-GO 2026-10-07, Terminos SS8.5/8.5-bis): avisa a Leonardo (log con marcador fijo
 * `ALERTA_REVERSION_PORUSO_USADO` + correo) cuando se revierte una compra Por Uso de la que YA se
 * habia usado parte del saldo (atribucion FIFO, `server/cuentas.ts` `atribucionPorUso`/
 * `obtenerUsadosAlRevertirPorUso`). Nunca lanza: el log va primero y por separado del correo, que
 * es best-effort. Nunca lleva uid ni email (mismo criterio que `avisarPagoDobleRequiereReembolso`).
 */
export async function avisarUsoParcialPorUso(
  datos: { paymentId: string; usados: number },
  deps: AvisarUsoParcialPorUsoDeps = depsAvisarUsoParcialPorUsoReales
): Promise<void> {
  console.error(JSON.stringify({ severity: "ERROR", message: "ALERTA_REVERSION_PORUSO_USADO", paymentId: datos.paymentId, usados: datos.usados }));
  try {
    const { asunto, texto } = construirAvisoUsoParcialPorUsoLeonardo(datos);
    await deps.enviarCorreo({ para: CORREO_LEONARDO, asunto, texto });
  } catch (error: any) {
    console.error(
      `[NOTIFICACIONES] fallo al avisar el uso parcial de Por Uso a Leonardo (el log ALERTA_REVERSION_PORUSO_USADO ya quedo). paymentId=${datos.paymentId}:`,
      error?.message || error
    );
  }
}

// ── Reintento del acuse de compra — simplificado 2026-10-06 ────────────────────────────────────
// Decision del Brain tras el NO-GO de la revision externa (vuelta 32 sobre b93fbed, 3 vueltas
// seguidas parchando esta misma pieza): SIMPLIFICAR en vez de agregar otra capa. El webhook manda
// el acuse de compra EN LINEA (await) al activar un pago; si falla, queda pendiente. El UNICO
// mecanismo de reintento es `POST /api/tareas/barrido-acuses` (Cloud Scheduler cada 30 min, ver
// server/tareasFondo.ts), que llama a `reintentarAcusePendiente` por cada pago pendiente. Se
// quitan: el reintento disparado desde GET /api/cuenta, el barrido disparado por el propio
// webhook, y el tope de intentos con espera exponencial creciente (`MAX_INTENTOS_ACUSE`) — sin
// backoff: cada barrido (cada 30 min) reintenta todo lo pendiente sin excepcion, y la alerta ya no
// depende de "cuantas veces se intento" sino de CUANTO TIEMPO lleva pendiente:
//   - a las 20h sin acuse enviado: alerta UNA vez (log + mejor esfuerzo por correo), sigue
//     reintentando.
//   - a las 48h sin acuse enviado: alerta UNA vez (mismo formato) y DEJA de reintentar (estado
//     terminal: el caso ya necesita atencion humana).
// Reconstruye los MISMOS datos que uso la entrega original del webhook a partir de lo que
// `activarPaqueteSiNoProcesadoTx` ya guardo en `pagosProcesados/{paymentId}` y vuelve a llamar a
// `notificarActivacionPaquete` — que YA es idempotente POR DESTINATARIO (M35): si Leonardo ya
// tiene su correo, no se reenvia; si el comprador ya lo tiene, tampoco. Nunca vuelve a consultar
// Mercado Pago ni toca el saldo/plan del usuario — el pago YA esta activado, esto es solo el
// correo.

export const VEINTE_HORAS_MS = 20 * 3600_000;
export const CUARENTA_Y_OCHO_HORAS_MS = 48 * 3600_000;

function construirAvisoAcuse20hLeonardo(datos: { uid: string; paymentId: string; horas: number }): {
  asunto: string;
  texto: string;
} {
  return {
    asunto: `[CertiSend] Acuse de compra SIN ENVIAR 20 horas despues del pago`,
    texto:
      `El acuse de compra del pago ${datos.paymentId} (uid ${datos.uid}) todavia no se ha enviado ` +
      `al comprador, ${datos.horas} horas despues del pago. La ley exige enviarlo a mas tardar el ` +
      `dia siguiente al pago (docs/legal/plantilla-confirmacion-compra.md). El barrido automatico ` +
      `(POST /api/tareas/barrido-acuses, cada 30 min) ya lo intento sin exito — revisa ` +
      `AVISOS_RELAY_URL/AVISOS_RELAY_SECRET y los logs de Cloud Run, y si hace falta manda el acuse ` +
      `a mano. El barrido seguira reintentando hasta las 48h; este aviso no se repite para este pago.`,
  };
}

function construirAvisoAcuseAbandonadoLeonardo(datos: { uid: string; paymentId: string; horas: number }): {
  asunto: string;
  texto: string;
} {
  return {
    asunto: `[CertiSend] Acuse de compra ABANDONADO — ${datos.horas} horas sin enviarse`,
    texto:
      `El acuse de compra del pago ${datos.paymentId} (uid ${datos.uid}) lleva ${datos.horas} horas ` +
      `sin enviarse al comprador. El barrido automatico (POST /api/tareas/barrido-acuses) DEJA de ` +
      `reintentarlo a partir de ahora (48h es el tope): revisa AVISOS_RELAY_URL/AVISOS_RELAY_SECRET ` +
      `y los logs de Cloud Run, y manda el acuse a mano. Este aviso no se repite para este pago.`,
  };
}

export interface DatosReintentoAcusePendiente {
  paymentId: string;
  uid: string;
  /** `null` si el pago se activo sin estos datos guardados: en ese caso no hay con que reconstruir
   * el aviso de forma segura y no se reintenta nada automaticamente. */
  referenciaId: string | null;
  cop: number;
  trm: number;
  fechaTrm: string | null;
  /** Fecha DEL PAGO (nunca de cuando se detecto el pendiente). */
  fecha: Date;
  /** Fecha de vencimiento del Paquete activado por ESTE pago. */
  vence: Date;
  /** G3: true si Mercado Pago reembolso/contracargo este pago. Opcional (`?? false`) para no
   * romper llamadas existentes que todavia no lo reconstruyen; `datosReintentoDesdePago`
   * (server/tareasFondo.ts) SIEMPRE lo manda en produccion. */
  revertido?: boolean;
}

export interface ReintentarAcuseDeps extends NotificarActivacionDeps {
  obtenerEstadoCorreoComprador(paymentId: string): Promise<string | null>;
}

const depsReintentarAcuseReales: ReintentarAcuseDeps = {
  ...depsNotificarActivacionReales,
  obtenerEstadoCorreoComprador: obtenerEstadoCorreoCompradorReal,
};

/**
 * Emite la alerta de "lleva demasiado tiempo pendiente" EXACTAMENTE una vez por pago (reclamo
 * transaccional, destinatario `"acuse20h"`/`"acuse48h"` — mismo mecanismo que los demas
 * destinatarios de correo). El canal FUERTE es el log estructurado de abajo (nunca con uid/email:
 * es lo que lee la alerta de Cloud Logging, ver docs/ops.md); el correo a Leonardo es de MEJOR
 * ESFUERZO y no condiciona la unicidad de la alerta — si el relay falla, la alerta YA quedo
 * emitida igual, y no se reintenta el correo en el siguiente barrido (simplificacion deliberada:
 * esta alerta es secundaria al log, que es el canal autoritativo).
 */
async function emitirAlertaTiempoUnaVez(
  datos: { uid: string; paymentId: string },
  horas: number,
  destinatario: "acuse20h" | "acuse48h",
  mensaje: "ALERTA_ACUSE_ATRASADO" | "ALERTA_ACUSE_ABANDONADO",
  construirAviso: (d: { uid: string; paymentId: string; horas: number }) => { asunto: string; texto: string },
  ahora: Date,
  // Pick (no `ReintentarAcuseDeps` completo): esta funcion nunca toca `construirCorreoComprador`
  // ni `obtenerEstadoCorreoComprador`, y el tipo mas angosto le permite recibir TANTO
  // `ReintentarAcuseDeps` (Paquete) COMO `ReintentarAcusePorUsoDeps` (Tarea 16A-2) — sus
  // `construirCorreoComprador` tienen formas incompatibles entre si, pero esta funcion no las usa.
  deps: Pick<ReintentarAcuseDeps, "reclamarEnvioCorreo" | "enviarCorreo" | "marcarCorreoEnviado">
): Promise<void> {
  const reclamado = await deps.reclamarEnvioCorreo(datos.paymentId, destinatario, ahora);
  if (!reclamado) return; // ya se emitio antes para este pago (esta u otra entrega).

  const horasRedondeadas = Math.round(horas);
  // Canal FUERTE: nunca uid ni email aqui (dato personal) — solo lo que la alerta de Cloud
  // Logging necesita para el filtro (ver docs/ops.md).
  console.error(JSON.stringify({ severity: "ERROR", message: mensaje, paymentId: datos.paymentId, horas: horasRedondeadas }));

  const { asunto, texto } = construirAviso({ ...datos, horas: horasRedondeadas });
  await deps.enviarCorreo({ para: CORREO_LEONARDO, asunto, texto, idEnvio: `${datos.paymentId}:${destinatario}` });
  // Se marca "enviado" en los dos casos (correo OK o no): la unicidad de la alerta ya la dio el
  // log de arriba; reintentar solo el envio del correo (sin repetir el log) es complejidad que
  // esta alerta, de mejor esfuerzo, no necesita.
  await deps.marcarCorreoEnviado(datos.paymentId, destinatario, ahora);
}

/**
 * Reintenta el acuse de UN pago que todavia no tiene `correoComprador="enviado"`. Nunca lanza
 * (defensa en profundidad: la llama el barrido de `server/tareasFondo.ts` una vez por pago, sin
 * que el fallo de uno tumbe a los demas).
 *
 * G3: defensa en profundidad — un pago `revertido` NUNCA reintenta (el comprador ya no tiene nada
 * que confirmar). En la practica, quien selecciona los candidatos (`esCandidatoBarridoAcuse`,
 * server/tareasFondo.ts) ya filtra esto antes de llegar aqui; este chequeo es la segunda capa.
 *
 * Simplificacion 2026-10-06 (sin backoff/tope de intentos): la decision es por ANTIGUEDAD del
 * pago, no por cuantas veces se intento. >=48h: deja de reintentar, alerta "abandonado" una vez.
 * [20h, 48h): reintenta igual y, si sigue sin salir, alerta "atrasado" una vez. <20h: reintenta
 * sin alertar nada.
 */
export async function reintentarAcusePendiente(
  datos: DatosReintentoAcusePendiente,
  ahora: Date = new Date(),
  deps: ReintentarAcuseDeps = depsReintentarAcuseReales
): Promise<void> {
  try {
    if (datos.revertido === true) {
      console.warn(`[NOTIFICACIONES] G3: pago ${datos.paymentId} revertido; no se reintenta el acuse.`);
      return;
    }

    if (!datos.referenciaId || !datos.fechaTrm) {
      // Pago activado sin estos datos guardados, o con datos incompletos: no hay con que
      // reconstruir el correo con seguridad. Atendible a mano, sin reintento automatico (mismo
      // patron ya aceptado en este proyecto para otros "pendiente").
      console.warn(`[NOTIFICACIONES] pago ${datos.paymentId} sin referenciaId/fechaTrm guardados; no se puede reintentar el acuse automaticamente.`);
      return;
    }

    const horas = (ahora.getTime() - datos.fecha.getTime()) / 3600_000;

    if (horas >= CUARENTA_Y_OCHO_HORAS_MS / 3600_000) {
      await emitirAlertaTiempoUnaVez(datos, horas, "acuse48h", "ALERTA_ACUSE_ABANDONADO", construirAvisoAcuseAbandonadoLeonardo, ahora, deps);
      return; // >=48h: deja de reintentar.
    }

    await notificarActivacionPaquete(
      {
        uid: datos.uid,
        paymentId: datos.paymentId,
        referenciaId: datos.referenciaId,
        cop: datos.cop,
        trm: datos.trm,
        fechaTrm: datos.fechaTrm,
        fechaPago: datos.fecha,
        fechaVencimiento: datos.vence,
      },
      ahora,
      deps
    );

    if (horas < VEINTE_HORAS_MS / 3600_000) return;

    // Se relee el estado DESPUES del reintento de arriba (pudo acabar de enviarse justo ahora).
    const estadoActual = await deps.obtenerEstadoCorreoComprador(datos.paymentId);
    if (estadoActual === "enviado") return;

    await emitirAlertaTiempoUnaVez(datos, horas, "acuse20h", "ALERTA_ACUSE_ATRASADO", construirAvisoAcuse20hLeonardo, ahora, deps);
  } catch (error: any) {
    console.error(`[NOTIFICACIONES] fallo el reintento del acuse pendiente. paymentId=${datos.paymentId}:`, error?.message || error);
  }
}

// ── Reintento del acuse — Pago por uso (Tarea 16A-2, decision del Brain 2026-10-06) ─────────────
// Mismo mecanismo (por antigüedad, alerta a 20h/48h) que `reintentarAcusePendiente`, pero
// reconstruyendo el acuse desde `pagosProcesados/{paymentId}` para un pago `tipo:"porUso"` (que
// guarda `cantidad` en vez de `vence` — ver `activarPorUsoSiNoProcesadoTx`, server/cuentas.ts).
// Cableada dentro del barrido programado desde la Tarea 16A-3 (`server/tareasFondo.ts`
// `barrerTodosLosPagosPendientes`/`datosReintentoPorUsoDesdePago`): un porUso pendiente SI se
// reintenta en el barrido de 30 min, no solo en el acuse en linea del webhook.

export interface DatosReintentoAcusePorUsoPendiente {
  paymentId: string;
  uid: string;
  referenciaId: string | null;
  cantidad: number;
  cop: number;
  trm: number;
  fechaTrm: string | null;
  /** Fecha DEL PAGO (nunca de cuando se detecto el pendiente). */
  fecha: Date;
  revertido?: boolean;
}

export interface ReintentarAcusePorUsoDeps extends NotificarActivacionPorUsoDeps {
  obtenerEstadoCorreoComprador(paymentId: string): Promise<string | null>;
}

const depsReintentarAcusePorUsoReales: ReintentarAcusePorUsoDeps = {
  ...depsNotificarActivacionPorUsoReales,
  obtenerEstadoCorreoComprador: obtenerEstadoCorreoCompradorReal,
};

/** Mismo criterio por antiguedad que `reintentarAcusePendiente` (>=48h: deja de reintentar y
 * alerta "abandonado"; [20h,48h): reintenta e alerta "atrasado" si sigue sin salir; <20h: solo
 * reintenta), aplicado a un pago `tipo:"porUso"`. Nunca lanza. */
export async function reintentarAcusePorUsoPendiente(
  datos: DatosReintentoAcusePorUsoPendiente,
  ahora: Date = new Date(),
  deps: ReintentarAcusePorUsoDeps = depsReintentarAcusePorUsoReales
): Promise<void> {
  try {
    if (datos.revertido === true) {
      console.warn(`[NOTIFICACIONES] G3: pago porUso ${datos.paymentId} revertido; no se reintenta el acuse.`);
      return;
    }

    if (!datos.referenciaId || !datos.fechaTrm) {
      console.warn(`[NOTIFICACIONES] pago porUso ${datos.paymentId} sin referenciaId/fechaTrm guardados; no se puede reintentar el acuse automaticamente.`);
      return;
    }

    const horas = (ahora.getTime() - datos.fecha.getTime()) / 3600_000;

    if (horas >= CUARENTA_Y_OCHO_HORAS_MS / 3600_000) {
      await emitirAlertaTiempoUnaVez(datos, horas, "acuse48h", "ALERTA_ACUSE_ABANDONADO", construirAvisoAcuseAbandonadoLeonardo, ahora, deps);
      return;
    }

    await notificarActivacionPorUso(
      {
        uid: datos.uid,
        paymentId: datos.paymentId,
        referenciaId: datos.referenciaId,
        cantidad: datos.cantidad,
        cop: datos.cop,
        trm: datos.trm,
        fechaTrm: datos.fechaTrm,
        fechaPago: datos.fecha,
      },
      ahora,
      deps
    );

    if (horas < VEINTE_HORAS_MS / 3600_000) return;

    const estadoActual = await deps.obtenerEstadoCorreoComprador(datos.paymentId);
    if (estadoActual === "enviado") return;

    await emitirAlertaTiempoUnaVez(datos, horas, "acuse20h", "ALERTA_ACUSE_ATRASADO", construirAvisoAcuse20hLeonardo, ahora, deps);
  } catch (error: any) {
    console.error(`[NOTIFICACIONES] fallo el reintento del acuse porUso pendiente. paymentId=${datos.paymentId}:`, error?.message || error);
  }
}
