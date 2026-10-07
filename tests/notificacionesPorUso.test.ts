// Pruebas de la composicion de avisos para "Pago por uso" (Tarea 16A-2, decision del Brain
// 2026-10-06): mismo patron que tests/notificaciones.test.ts, pero para
// `notificarActivacionPorUso` y la variante "tu saldo se ajustó" de `avisarReembolsoPaquete`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  notificarActivacionPorUso,
  reintentarAcusePorUsoPendiente,
  avisarReembolsoPaquete,
  CORREO_LEONARDO,
  type NotificarActivacionPorUsoDeps,
  type ReintentarAcusePorUsoDeps,
  type AvisarReembolsoDeps,
} from "../server/notificaciones";
import { type DatosCorreo } from "../server/avisos";

function construirCorreoCompradorLimpio() {
  return { asunto: "Confirmación de tu compra", texto: "Texto de prueba sin ningún dato pendiente." };
}

function depsActivacionPorUsoFalsas(overrides: Partial<NotificarActivacionPorUsoDeps> = {}) {
  const reclamos = new Map<string, "reclamado" | "enviado">();
  const correosEnviados: DatosCorreo[] = [];
  const deps: NotificarActivacionPorUsoDeps = {
    reclamarEnvioCorreo: async (_paymentId, destinatario) => {
      if (reclamos.has(destinatario)) return false;
      reclamos.set(destinatario, "reclamado");
      return true;
    },
    marcarCorreoEnviado: async (_paymentId, destinatario) => {
      reclamos.set(destinatario, "enviado");
    },
    liberarReclamoCorreo: async (_paymentId, destinatario) => {
      reclamos.delete(destinatario);
    },
    obtenerAceptacion: async () => ({ email: "comprador@test.com", idioma: "es" }),
    enviarCorreo: async (datos) => {
      correosEnviados.push(datos);
      return true;
    },
    construirCorreoComprador: construirCorreoCompradorLimpio,
    ...overrides,
  };
  return { deps, correosEnviados, reclamos };
}

const DATOS_BASE = {
  uid: "uid-1",
  paymentId: "pago-1",
  referenciaId: "ref-1",
  cantidad: 50,
  cop: 7500,
  trm: 3900,
  fechaTrm: "2026-10-06",
  fechaPago: new Date("2026-10-06T15:00:00.000Z"),
};

test("notificarActivacionPorUso: activacion manda exactamente 1 correo al comprador y 1 a Leonardo (con la cantidad)", async () => {
  const { deps, correosEnviados } = depsActivacionPorUsoFalsas();
  await notificarActivacionPorUso(DATOS_BASE, new Date("2026-10-06T16:00:00.000Z"), deps);

  assert.equal(correosEnviados.length, 2);
  const paraComprador = correosEnviados.filter((c) => c.para === "comprador@test.com");
  const paraLeonardo = correosEnviados.filter((c) => c.para === CORREO_LEONARDO);
  assert.equal(paraComprador.length, 1);
  assert.equal(paraLeonardo.length, 1);
  assert.match(paraLeonardo[0].texto, /pago-1/);
  assert.match(paraLeonardo[0].texto, /50 envíos/);
  assert.equal(paraComprador[0].idEnvio, "pago-1:comprador");
  assert.equal(paraLeonardo[0].idEnvio, "pago-1:leonardo");
});

test("notificarActivacionPorUso: llamar dos veces no manda correos extra (idempotencia simple)", async () => {
  const { deps, correosEnviados } = depsActivacionPorUsoFalsas();
  await notificarActivacionPorUso(DATOS_BASE, new Date(), deps);
  await notificarActivacionPorUso(DATOS_BASE, new Date(), deps);
  assert.equal(correosEnviados.length, 2);
});

test("notificarActivacionPorUso: sin email en la aceptacion, igual se avisa a Leonardo", async () => {
  const { deps, correosEnviados } = depsActivacionPorUsoFalsas({ obtenerAceptacion: async () => null });
  await notificarActivacionPorUso(DATOS_BASE, new Date(), deps);
  assert.equal(correosEnviados.length, 1);
  assert.equal(correosEnviados[0].para, CORREO_LEONARDO);
});

test("notificarActivacionPorUso: si obtenerAceptacion lanza, la funcion no lanza", async () => {
  const { deps } = depsActivacionPorUsoFalsas({
    obtenerAceptacion: async () => {
      throw new Error("red caida");
    },
  });
  await assert.doesNotReject(notificarActivacionPorUso(DATOS_BASE, new Date(), deps));
});

// ── reintentarAcusePorUsoPendiente: reconstruye el acuse porUso desde los datos que
// `pagosProcesados/{paymentId}` ya guarda (`tipo:"porUso"`, `cantidad` — ver
// `activarPorUsoSiNoProcesadoTx`, server/cuentas.ts) y lo reintenta con el mismo criterio por
// antiguedad (20h/48h) que `reintentarAcusePendiente` ───────────────────────────────────────────

function depsReintentoPorUsoFalsas(overrides: Partial<ReintentarAcusePorUsoDeps> = {}) {
  const reclamos = new Map<string, "reclamado" | "enviado">();
  const correosEnviados: DatosCorreo[] = [];
  const deps: ReintentarAcusePorUsoDeps = {
    reclamarEnvioCorreo: async (_paymentId, destinatario) => {
      if (reclamos.has(destinatario)) return false;
      reclamos.set(destinatario, "reclamado");
      return true;
    },
    marcarCorreoEnviado: async (_paymentId, destinatario) => {
      reclamos.set(destinatario, "enviado");
    },
    liberarReclamoCorreo: async (_paymentId, destinatario) => {
      reclamos.delete(destinatario);
    },
    obtenerAceptacion: async () => ({ email: "comprador@test.com", idioma: "es" }),
    enviarCorreo: async (datos) => {
      correosEnviados.push(datos);
      return true;
    },
    construirCorreoComprador: construirCorreoCompradorLimpio,
    obtenerEstadoCorreoComprador: async () => (reclamos.get("comprador") === "enviado" ? "enviado" : reclamos.get("comprador") ?? null),
    ...overrides,
  };
  return { deps, correosEnviados, reclamos };
}

const DATOS_REINTENTO_POR_USO_BASE = {
  paymentId: "pago-1",
  uid: "uid-1",
  referenciaId: "ref-1",
  cantidad: 50,
  cop: 7500,
  trm: 3900,
  fechaTrm: "2026-10-06",
  fecha: new Date("2026-10-06T15:00:00.000Z"),
};

test("reintentarAcusePorUsoPendiente: reconstruye desde {cantidad,cop,trm} y manda el acuse al comprador", async () => {
  const { deps, correosEnviados } = depsReintentoPorUsoFalsas();
  const ahora2h = new Date(DATOS_REINTENTO_POR_USO_BASE.fecha.getTime() + 2 * 3600_000);
  await reintentarAcusePorUsoPendiente(DATOS_REINTENTO_POR_USO_BASE, ahora2h, deps);

  const paraComprador = correosEnviados.filter((c) => c.para === "comprador@test.com");
  assert.equal(paraComprador.length, 1);
});

test("reintentarAcusePorUsoPendiente: revertido=true nunca reintenta nada", async () => {
  const { deps, correosEnviados } = depsReintentoPorUsoFalsas();
  await reintentarAcusePorUsoPendiente({ ...DATOS_REINTENTO_POR_USO_BASE, revertido: true }, new Date(), deps);
  assert.equal(correosEnviados.length, 0);
});

test("reintentarAcusePorUsoPendiente: >=48h deja de reintentar y avisa 'abandonado' una vez", async () => {
  const { deps, correosEnviados } = depsReintentoPorUsoFalsas();
  const ahora49h = new Date(DATOS_REINTENTO_POR_USO_BASE.fecha.getTime() + 49 * 3600_000);
  await reintentarAcusePorUsoPendiente(DATOS_REINTENTO_POR_USO_BASE, ahora49h, deps);

  assert.equal(correosEnviados.filter((c) => c.para === "comprador@test.com").length, 0);
  const avisosAbandono = correosEnviados.filter((c) => c.para === CORREO_LEONARDO && /ABANDONADO/.test(c.asunto));
  assert.equal(avisosAbandono.length, 1);
});

test("reintentarAcusePorUsoPendiente: sin referenciaId/fechaTrm, no reintenta nada y no lanza", async () => {
  const { deps, correosEnviados } = depsReintentoPorUsoFalsas();
  await assert.doesNotReject(
    reintentarAcusePorUsoPendiente({ ...DATOS_REINTENTO_POR_USO_BASE, referenciaId: null, fechaTrm: null }, new Date(), deps)
  );
  assert.equal(correosEnviados.length, 0);
});

// ── avisarReembolsoPaquete con plan:"porUso" -> variante "tu saldo se ajustó" ───────────────────

function depsReembolsoFalsas(overrides: Partial<AvisarReembolsoDeps> = {}): { deps: AvisarReembolsoDeps; correosEnviados: DatosCorreo[] } {
  const correosEnviados: DatosCorreo[] = [];
  const reclamos = new Set<string>();
  const deps: AvisarReembolsoDeps = {
    revertirPago: async () => "revertido",
    enviarCorreo: async (datos) => {
      correosEnviados.push(datos);
      return true;
    },
    obtenerAceptacion: async () => ({ email: "comprador@test.com", idioma: "es" }),
    reclamarEnvioCorreo: async (paymentId, destinatario) => {
      const clave = `${paymentId}:${destinatario}`;
      if (reclamos.has(clave)) return false;
      reclamos.add(clave);
      return true;
    },
    marcarCorreoEnviado: async () => {},
    liberarReclamoCorreo: async (paymentId, destinatario) => {
      reclamos.delete(`${paymentId}:${destinatario}`);
    },
    ...overrides,
  };
  return { deps, correosEnviados };
}

test("avisarReembolsoPaquete (plan:porUso): el comprador recibe la variante 'tu saldo se ajustó', nunca 'volviste a Gratis'", async () => {
  const { deps, correosEnviados } = depsReembolsoFalsas();
  await avisarReembolsoPaquete({ uid: "uid-1", paymentId: "pago-1", status: "refunded", referenciaId: "ref-1", plan: "porUso" }, deps);

  const alComprador = correosEnviados.find((c) => c.para === "comprador@test.com");
  assert.ok(alComprador, "el comprador debe recibir el aviso de reversion");
  assert.match(alComprador!.texto, /ajustamos tu saldo de Pago por uso/);
  assert.doesNotMatch(alComprador!.texto, /plan Gratis/);

  const aLeonardo = correosEnviados.find((c) => c.para === CORREO_LEONARDO);
  assert.match(aLeonardo!.texto, /Se ajustó el saldo de Pago por uso/);
});

test("avisarReembolsoPaquete: sin `plan` (o plan:'paquete'), el comportamiento EXISTENTE no cambia", async () => {
  const { deps, correosEnviados } = depsReembolsoFalsas();
  await avisarReembolsoPaquete({ uid: "uid-1", paymentId: "pago-1", status: "refunded", referenciaId: "ref-1" }, deps);

  const alComprador = correosEnviados.find((c) => c.para === "comprador@test.com");
  assert.match(alComprador!.texto, /plan Gratis/);
  const aLeonardo = correosEnviados.find((c) => c.para === CORREO_LEONARDO);
  assert.match(aLeonardo!.texto, /Se revirtió la cuenta a Gratis/);
});
