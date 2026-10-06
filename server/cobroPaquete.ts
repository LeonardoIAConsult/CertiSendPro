// Logica de creacion del cobro del Paquete (Tarea 14, cobro real con planes, 2026-10-05).
// Separada de server.ts (mismo patron que server/webhook.ts, server/trm.ts y server/cuentas.ts)
// para poder probar con node:test, sin red ni Firestore real ni arrancar Express, que:
//   - sin `aceptaTerminos`/`aceptaRetracto` en `true` -> 400 claro y NUNCA se guarda preferencia,
//     NUNCA se guarda aceptacion, NUNCA se llama a Mercado Pago;
//   - con las dos casillas -> la aceptacion queda guardada y ENLAZADA a la preferencia (mismo id)
//     ANTES de llamar a Mercado Pago — nunca despues, nunca en paralelo sin esperar el `await`.
//
// Quien llama a esta funcion (server.ts) ya resolvio antes: que `PAGOS_ACTIVOS` este encendido,
// que el plan pedido sea "paquete" y que exista el access token de Mercado Pago — esos tres no
// necesitan Firestore ni fetch inyectado para probarse, por eso se quedan en la ruta HTTP.
import type { Plan } from "./cuentas";
import { TERMINOS_VERSION, TEXTO_CASILLA_RETRACTO, textoCasillaTerminos } from "./cuentas";

export interface TrmDelDia {
  valor: number;
  fechaDesde: string;
}

/** Forma minima de la respuesta de POST /checkout/preferences que necesita este modulo. */
export interface RespuestaCrearPreferenciaMP {
  ok: boolean;
  status: number;
  json(): Promise<any>;
}

export interface CrearCobroPaqueteOpts {
  uid: string;
  /** Lo que mando el navegador en el body (`req.body.aceptaTerminos`/`.aceptaRetracto`): se
   * valida aqui, no antes, para que la prueba "sin casilla -> no se crea nada" sea real. */
  aceptaTerminos: unknown;
  aceptaRetracto: unknown;
  obtenerTrm(): Promise<TrmDelDia | null>;
  copDesdeUsd(usd: number, trmValor: number): number;
  usdPaquete: number;
  /** Genera el id aleatorio de la preferencia/aceptacion (en produccion, `randomUUID`). */
  generarId(): string;
  guardarPreferencia(
    id: string,
    datos: { uid: string; plan: Plan; cop: number; trm: number; fechaTrm: string }
  ): Promise<void>;
  guardarAceptacion(
    id: string,
    datos: {
      uid: string;
      versionTerminos: string;
      plan: Plan;
      cop: number;
      trm: number;
      preferenciaId: string;
      textoCasilla: string;
      textoRetracto: string;
    }
  ): Promise<void>;
  crearPreferenciaMP(payload: {
    cop: number;
    externalReference: string;
  }): Promise<RespuestaCrearPreferenciaMP>;
  /** Log minimo para errores de Mercado Pago (nunca se manda al navegador el detalle). */
  log(linea: string): void;
}

export type ResultadoCrearCobroPaquete =
  | {
      httpStatus: 200;
      body: { success: true; initPoint: string; cop: number; usd: number; trm: number; fechaTrm: string };
    }
  | { httpStatus: number; body: { error: string } };

export async function crearCobroPaquete(opts: CrearCobroPaqueteOpts): Promise<ResultadoCrearCobroPaquete> {
  // Tarea 14: sin las DOS casillas marcadas, no se crea preferencia, no se guarda aceptacion y
  // nunca se llama a Mercado Pago. `!== true` rechaza tambien `undefined`/`"true"`/cualquier cosa
  // que no sea el booleano `true` exacto.
  if (opts.aceptaTerminos !== true || opts.aceptaRetracto !== true) {
    return {
      httpStatus: 400,
      body: {
        error:
          "Debes marcar las casillas de los Términos y Condiciones y de inicio inmediato del servicio (sin derecho de retracto) antes de pagar.",
      },
    };
  }

  const trm = await opts.obtenerTrm();
  if (!trm) {
    return { httpStatus: 503, body: { error: "No podemos calcular el precio de hoy; intenta más tarde." } };
  }

  const cop = opts.copDesdeUsd(opts.usdPaquete, trm.valor);
  const referenciaId = opts.generarId();
  const externalReference = `CERTISEND|${opts.uid}|paquete|${cop}|${referenciaId}`;

  // El orden de estos dos `await` (y que ambos terminen ANTES de llamar a Mercado Pago, mas
  // abajo) es la prueba de la Tarea 14: nunca se dispara el pago sin que la preferencia y su
  // aceptacion ya existan guardadas, enlazadas por el mismo id.
  await opts.guardarPreferencia(referenciaId, {
    uid: opts.uid,
    plan: "paquete",
    cop,
    trm: trm.valor,
    fechaTrm: trm.fechaDesde,
  });
  await opts.guardarAceptacion(referenciaId, {
    uid: opts.uid,
    versionTerminos: TERMINOS_VERSION,
    plan: "paquete",
    cop,
    trm: trm.valor,
    preferenciaId: referenciaId,
    textoCasilla: textoCasillaTerminos(cop),
    textoRetracto: TEXTO_CASILLA_RETRACTO,
  });

  const respuestaMP = await opts.crearPreferenciaMP({ cop, externalReference });
  if (!respuestaMP.ok) {
    const cuerpo = await respuestaMP.json().catch(() => ({}));
    opts.log(`[MERCADO PAGO] error al crear preferencia (status=${respuestaMP.status}): ${JSON.stringify(cuerpo)}`);
    return { httpStatus: 500, body: { error: "No se pudo iniciar el pago con Mercado Pago." } };
  }

  const data = await respuestaMP.json();
  return {
    httpStatus: 200,
    body: { success: true, initPoint: data.init_point, cop, usd: opts.usdPaquete, trm: trm.valor, fechaTrm: trm.fechaDesde },
  };
}
