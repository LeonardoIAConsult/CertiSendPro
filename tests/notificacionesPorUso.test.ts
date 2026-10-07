// Pruebas de la composicion de avisos para "Pago por uso" (Tarea 16A-2, decision del Brain
// 2026-10-06): mismo patron que tests/notificaciones.test.ts, pero para
// `notificarActivacionPorUso` y la variante "tu saldo se ajustó" de `avisarReembolsoPaquete`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  notificarActivacionPorUso,
  reintentarAcusePorUsoPendiente,
  avisarReembolsoPaquete,
  avisarUsoParcialPorUso,
  CORREO_LEONARDO,
  type NotificarActivacionPorUsoDeps,
  type ReintentarAcusePorUsoDeps,
  type AvisarReembolsoDeps,
  type AvisarUsoParcialPorUsoDeps,
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
    obtenerUsadosAlRevertirPorUso: async () => 0,
    avisarUsoParcialPorUso: async () => {},
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

// ── M1 (NO-GO de la revision externa sobre la Tarea 16, 2026-10-07): avisarReembolsoPaquete
// avisa a Leonardo (log + correo) cuando la compra porUso revertida ya tenia parte USADA ────────

test("avisarReembolsoPaquete (plan:porUso, M1): usados>0 -> avisarUsoParcialPorUso se llama con paymentId+usados", async () => {
  const avisos: Array<{ paymentId: string; usados: number }> = [];
  const { deps, correosEnviados } = depsReembolsoFalsas({
    obtenerUsadosAlRevertirPorUso: async (paymentId) => {
      assert.equal(paymentId, "pago-1");
      return 7;
    },
    avisarUsoParcialPorUso: async (datos) => {
      avisos.push(datos);
    },
  });

  await avisarReembolsoPaquete({ uid: "uid-1", paymentId: "pago-1", status: "refunded", referenciaId: "ref-1", plan: "porUso" }, deps);

  assert.equal(avisos.length, 1);
  assert.deepEqual(avisos[0], { paymentId: "pago-1", usados: 7 });
  // El resto del aviso (comprador + Leonardo) sigue saliendo normal, sin que esto lo bloquee.
  assert.ok(correosEnviados.some((c) => c.para === CORREO_LEONARDO));
});

test("avisarReembolsoPaquete (plan:porUso, M1): usados=0 -> avisarUsoParcialPorUso NUNCA se llama", async () => {
  let llamadas = 0;
  const { deps } = depsReembolsoFalsas({
    obtenerUsadosAlRevertirPorUso: async () => 0,
    avisarUsoParcialPorUso: async () => {
      llamadas++;
    },
  });

  await avisarReembolsoPaquete({ uid: "uid-1", paymentId: "pago-1", status: "refunded", referenciaId: "ref-1", plan: "porUso" }, deps);
  assert.equal(llamadas, 0);
});

test("avisarReembolsoPaquete (plan:paquete, M1): nunca comprueba usados (eso es solo de porUso)", async () => {
  let llamadas = 0;
  const { deps } = depsReembolsoFalsas({
    obtenerUsadosAlRevertirPorUso: async () => {
      llamadas++;
      return 99;
    },
  });

  await avisarReembolsoPaquete({ uid: "uid-1", paymentId: "pago-1", status: "refunded", referenciaId: "ref-1" }, deps);
  assert.equal(llamadas, 0, "plan paquete (default) nunca debe consultar usadosAlRevertir");
});

test("avisarReembolsoPaquete (M1): si obtenerUsadosAlRevertirPorUso lanza, el resto del aviso sigue sin tumbarse", async () => {
  const { deps, correosEnviados } = depsReembolsoFalsas({
    obtenerUsadosAlRevertirPorUso: async () => {
      throw new Error("Firestore caido");
    },
  });

  await assert.doesNotReject(
    avisarReembolsoPaquete({ uid: "uid-1", paymentId: "pago-1", status: "refunded", referenciaId: "ref-1", plan: "porUso" }, deps)
  );
  assert.ok(correosEnviados.some((c) => c.para === CORREO_LEONARDO), "el aviso normal a Leonardo sigue saliendo");
});

// ── avisarUsoParcialPorUso (M1): log ALERTA_REVERSION_PORUSO_USADO + correo a Leonardo ───────────

function depsUsoParcialFalsas(overrides: Partial<AvisarUsoParcialPorUsoDeps> = {}): {
  deps: AvisarUsoParcialPorUsoDeps;
  correosEnviados: DatosCorreo[];
} {
  const correosEnviados: DatosCorreo[] = [];
  const deps: AvisarUsoParcialPorUsoDeps = {
    enviarCorreo: async (datos) => {
      correosEnviados.push(datos);
      return true;
    },
    ...overrides,
  };
  return { deps, correosEnviados };
}

test("avisarUsoParcialPorUso: manda exactamente 1 correo a Leonardo con el paymentId/usados", async () => {
  const { deps, correosEnviados } = depsUsoParcialFalsas();
  await avisarUsoParcialPorUso({ paymentId: "pago-1", usados: 7 }, deps);
  assert.equal(correosEnviados.length, 1);
  assert.equal(correosEnviados[0].para, CORREO_LEONARDO);
  assert.match(correosEnviados[0].texto, /pago-1/);
  assert.match(correosEnviados[0].texto, /7/);
});

test("avisarUsoParcialPorUso: emite el log ALERTA_REVERSION_PORUSO_USADO en JSON con severity ERROR, sin uid/email", async () => {
  const { deps } = depsUsoParcialFalsas();
  const original = console.error;
  const llamadas: any[] = [];
  console.error = (...args: any[]) => llamadas.push(args);
  try {
    await avisarUsoParcialPorUso({ paymentId: "pago-1", usados: 7 }, deps);
  } finally {
    console.error = original;
  }
  const logEstructurado = llamadas
    .map((args) => { try { return JSON.parse(args[0]); } catch { return null; } })
    .find((obj) => obj?.message === "ALERTA_REVERSION_PORUSO_USADO");
  assert.ok(logEstructurado, "debe loguear el marcador fijo ALERTA_REVERSION_PORUSO_USADO como JSON");
  assert.equal(logEstructurado.severity, "ERROR");
  assert.equal(logEstructurado.paymentId, "pago-1");
  assert.equal(logEstructurado.usados, 7);
  assert.equal(logEstructurado.uid, undefined, "nunca uid en el log (dato personal)");
  assert.equal(logEstructurado.email, undefined, "nunca email en el log (dato personal)");
});

test("avisarUsoParcialPorUso: si enviarCorreo falla/lanza, la funcion no lanza (el log ya quedo)", async () => {
  const { deps } = depsUsoParcialFalsas({
    enviarCorreo: async () => {
      throw new Error("relay caido");
    },
  });
  await assert.doesNotReject(avisarUsoParcialPorUso({ paymentId: "pago-1", usados: 7 }, deps));
});
