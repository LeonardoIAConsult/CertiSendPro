// Composicion de avisos (Tareas 5 y 9, cobro real con planes, 2026-10-05): une el canal generico
// de correo (server/avisos.ts, HMAC + relay) con la lectura/escritura de Firestore (server/cuentas.ts)
// para dar las DOS funciones que `server/webhook.ts` necesita inyectadas:
//   - `notificarActivacionPaquete`: correo de confirmacion al comprador + aviso de venta a
//     Leonardo, exactamente una vez por pago (Tarea 5).
//   - `avisarReembolsoPaquete`: revierte la cuenta a Gratis si el pago era el activo y avisa a
//     Leonardo, exactamente una vez por evento de reembolso/contracargo (Tarea 9).
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
  type DatosCorreo,
} from "./avisos";
import {
  correoYaEnviado as correoYaEnviadoReal,
  marcarCorreoEnviado as marcarCorreoEnviadoReal,
  obtenerAceptacion as obtenerAceptacionReal,
  revertirPagoSiNoRevertido as revertirPagoSiNoRevertidoReal,
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
  correoYaEnviado(paymentId: string): Promise<boolean>;
  marcarCorreoEnviado(paymentId: string): Promise<void>;
  obtenerAceptacion(id: string): Promise<{ email: string | null; idioma: Idioma } | null>;
  enviarCorreo(datos: DatosCorreo): Promise<boolean>;
}

const depsNotificarActivacionReales: NotificarActivacionDeps = {
  correoYaEnviado: correoYaEnviadoReal,
  marcarCorreoEnviado: marcarCorreoEnviadoReal,
  obtenerAceptacion: obtenerAceptacionReal,
  enviarCorreo: enviarCorreoReal,
};

/**
 * Tarea 5: envia el correo de confirmacion de compra al comprador + el aviso de venta a Leonardo,
 * una sola vez por `paymentId` (idempotencia real via `correoYaEnviado`/`marcarCorreoEnviado` en
 * `pagosProcesados/{paymentId}`, NUNCA un contador en memoria). Nunca lanza: cualquier fallo
 * (relay caido, Firestore sin red) queda en un log y la funcion resuelve igual — el llamador
 * (`procesarWebhookMP`) ya la envuelve en su propio try/catch como defensa en profundidad, pero
 * esta funcion no depende de eso para ser segura.
 *
 * Solo se marca `correoEnviado` si AMBOS correos (comprador + Leonardo) salieron bien: si el
 * comprador no tiene correo guardado (no deberia pasar — `obtenerAceptacion` siempre deberia
 * tener uno, salvo un token de Firebase sin `email`), se trata ese lado como "no aplica" y no
 * bloquea el aviso a Leonardo ni la marca de enviado.
 */
export async function notificarActivacionPaquete(
  datos: DatosNotificarActivacion,
  deps: NotificarActivacionDeps = depsNotificarActivacionReales
): Promise<void> {
  try {
    if (await deps.correoYaEnviado(datos.paymentId)) return;

    const aceptacion = await deps.obtenerAceptacion(datos.referenciaId);

    let okComprador = true;
    if (aceptacion?.email) {
      const { asunto, texto } = construirCorreoConfirmacionCompra({
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
      okComprador = await deps.enviarCorreo({ para: aceptacion.email, asunto, texto });
    } else {
      console.warn(`[NOTIFICACIONES] sin correo de comprador para paymentId=${datos.paymentId} (aceptacion ausente o sin email).`);
    }

    const { asunto: asuntoVenta, texto: textoVenta } = construirAvisoVentaLeonardo({
      uid: datos.uid,
      paymentId: datos.paymentId,
      cop: datos.cop,
      plan: "paquete",
    });
    const okLeonardo = await deps.enviarCorreo({ para: CORREO_LEONARDO, asunto: asuntoVenta, texto: textoVenta });

    if (okComprador && okLeonardo) {
      await deps.marcarCorreoEnviado(datos.paymentId);
    }
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
 * nuestro. Nunca lanza.
 */
export async function avisarReembolsoPaquete(
  datos: { uid: string; paymentId: string; status: string },
  deps: AvisarReembolsoDeps = depsAvisarReembolsoReales
): Promise<void> {
  try {
    const resultado = await deps.revertirPago(datos.paymentId, datos.uid);
    if (resultado === "ya_procesado" || resultado === "ignorado") return;

    const { asunto, texto } = construirAvisoReembolsoLeonardo({
      uid: datos.uid,
      paymentId: datos.paymentId,
      status: datos.status,
      cuentaRevertida: resultado === "revertido",
    });
    await deps.enviarCorreo({ para: CORREO_LEONARDO, asunto, texto });
  } catch (error: any) {
    console.error(`[NOTIFICACIONES] fallo al procesar el reembolso/contracargo. paymentId=${datos.paymentId}:`, error?.message || error);
  }
}
