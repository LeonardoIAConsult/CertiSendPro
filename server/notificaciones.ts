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
  construirAvisoVentaLeonardo,
  construirAvisoReembolsoLeonardo,
  construirAvisoBloqueoProveedorLeonardo,
  tienePlaceholderPendiente,
  type DatosCorreo,
  type DatosConfirmacionCompra,
} from "./avisos";
import {
  reclamarEnvioCorreo as reclamarEnvioCorreoReal,
  marcarCorreoEnviado as marcarCorreoEnviadoReal,
  liberarReclamoCorreo as liberarReclamoCorreoReal,
  obtenerAceptacion as obtenerAceptacionReal,
  revertirPagoSiNoRevertido as revertirPagoSiNoRevertidoReal,
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
  reclamarEnvioCorreo(paymentId: string, destinatario: DestinatarioCorreo): Promise<boolean>;
  marcarCorreoEnviado(paymentId: string, destinatario: DestinatarioCorreo): Promise<void>;
  liberarReclamoCorreo(paymentId: string, destinatario: DestinatarioCorreo): Promise<void>;
  obtenerAceptacion(id: string): Promise<{ email: string | null; idioma: Idioma } | null>;
  enviarCorreo(datos: DatosCorreo): Promise<boolean>;
  /** Compone el correo de confirmacion al comprador — inyectable (por defecto,
   * `construirCorreoConfirmacionCompra` real) para poder probar el reclamo transaccional (M35) y
   * el bloqueo por dato pendiente (M36(2)) por separado, sin que uno dependa del contenido real
   * del otro. */
  construirCorreoComprador(datos: DatosConfirmacionCompra): { asunto: string; texto: string };
}

const depsNotificarActivacionReales: NotificarActivacionDeps = {
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
  deps: NotificarActivacionDeps,
  destinatario: DestinatarioCorreo,
  correo: DatosCorreo
): Promise<void> {
  const reclamado = await deps.reclamarEnvioCorreo(paymentId, destinatario);
  if (!reclamado) return; // ya reclamado o ya enviado por otra entrega.

  const ok = await deps.enviarCorreo(correo);
  await cerrarReclamoConReintento(paymentId, deps, destinatario, ok);
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
 */
async function cerrarReclamoConReintento(
  paymentId: string,
  deps: NotificarActivacionDeps,
  destinatario: DestinatarioCorreo,
  envioOk: boolean
): Promise<void> {
  const cerrarReclamo = () =>
    envioOk
      ? deps.marcarCorreoEnviado(paymentId, destinatario)
      : deps.liberarReclamoCorreo(paymentId, destinatario);
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
        await intentarEnviarUnDestinatario(datos.paymentId, deps, "bloqueoProveedor", {
          para: CORREO_LEONARDO,
          ...avisoBloqueo,
        });
      } else {
        await intentarEnviarUnDestinatario(datos.paymentId, deps, "comprador", {
          para: aceptacion.email,
          ...correoComprador,
        });
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
    await intentarEnviarUnDestinatario(datos.paymentId, deps, "leonardo", { para: CORREO_LEONARDO, ...avisoVenta });
  } catch (error: any) {
    console.error(`[NOTIFICACIONES] fallo al notificar la activacion. paymentId=${datos.paymentId}:`, error?.message || error);
  }
}

export interface AvisarReembolsoDeps {
  revertirPago(paymentId: string, uid: string): Promise<ResultadoReversion>;
  enviarCorreo(datos: DatosCorreo): Promise<boolean>;
}

const depsAvisarReembolsoReales: AvisarReembolsoDeps = {
  revertirPago: revertirPagoSiNoRevertidoReal,
  enviarCorreo: enviarCorreoReal,
};

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
 * reversion que ya se aplico.
 */
export async function avisarReembolsoPaquete(
  datos: { uid: string; paymentId: string; status: string },
  deps: AvisarReembolsoDeps = depsAvisarReembolsoReales
): Promise<void> {
  const resultado = await deps.revertirPago(datos.paymentId, datos.uid);
  if (resultado === "ya_procesado" || resultado === "ignorado") return;

  const { asunto, texto } = construirAvisoReembolsoLeonardo({
    uid: datos.uid,
    paymentId: datos.paymentId,
    status: datos.status,
    cuentaRevertida: resultado === "revertido",
  });
  try {
    await deps.enviarCorreo({ para: CORREO_LEONARDO, asunto, texto });
  } catch (error: any) {
    // El aviso a Leonardo es best-effort: la reversion (lo que de verdad importa) YA tuvo exito.
    console.error(`[NOTIFICACIONES] fallo al avisar el reembolso a Leonardo (la reversión SÍ quedó). paymentId=${datos.paymentId}:`, error?.message || error);
  }
}
