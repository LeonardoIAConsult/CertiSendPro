// Pruebas de la composicion de avisos (Tareas 5 y 9, cobro real con planes, 2026-10-05):
// `notificarActivacionPaquete`/`avisarReembolsoPaquete` de server/notificaciones.ts. Inyectan
// dependencias falsas (nunca Firestore/relay real): la idempotencia de `correoYaEnviado`/
// `marcarCorreoEnviado` y de `revertirPago` YA se prueba sobre el doble de Firestore en
// tests/reembolso.test.ts; aqui lo que se prueba es la COMPOSICION — cuantos correos salen, en
// que orden, y que nunca lanza aunque el relay falle.
//
// Oraculo cubierto aqui:
//   1. activacion -> 1 correo al comprador y 1 a Leonardo.
//   2. el mismo pago dos veces -> 0 correos extra.
//   3. el relay falla -> la activacion queda (no se revierte nada) y la funcion no lanza.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  notificarActivacionPaquete,
  avisarReembolsoPaquete,
  CORREO_LEONARDO,
  type NotificarActivacionDeps,
  type AvisarReembolsoDeps,
} from "../server/notificaciones";
import type { DatosCorreo } from "../server/avisos";

function depsActivacionFalsas(overrides: Partial<NotificarActivacionDeps> = {}) {
  const correosEnviados: DatosCorreo[] = [];
  let correoEnviadoFlag = false;
  const deps: NotificarActivacionDeps = {
    correoYaEnviado: async () => correoEnviadoFlag,
    marcarCorreoEnviado: async () => {
      correoEnviadoFlag = true;
    },
    obtenerAceptacion: async () => ({ email: "comprador@test.com", idioma: "es" }),
    enviarCorreo: async (datos) => {
      correosEnviados.push(datos);
      return true;
    },
    ...overrides,
  };
  return { deps, correosEnviados, estaEnviado: () => correoEnviadoFlag };
}

const DATOS_BASE = {
  uid: "uid-1",
  paymentId: "pago-1",
  referenciaId: "ref-1",
  cop: 49102,
  trm: 3273.49,
  fechaTrm: "2026-10-03",
  fechaPago: new Date("2026-10-05T15:00:00.000Z"),
  fechaVencimiento: new Date("2026-11-05T15:00:00.000Z"),
};

// ── Oraculo 1: activacion -> 1 correo al comprador y 1 a Leonardo ──────────────────────────────

test("notificarActivacionPaquete: activacion manda exactamente 1 correo al comprador y 1 a Leonardo", async () => {
  const { deps, correosEnviados } = depsActivacionFalsas();
  await notificarActivacionPaquete(DATOS_BASE, deps);

  assert.equal(correosEnviados.length, 2);
  const paraComprador = correosEnviados.filter((c) => c.para === "comprador@test.com");
  const paraLeonardo = correosEnviados.filter((c) => c.para === CORREO_LEONARDO);
  assert.equal(paraComprador.length, 1);
  assert.equal(paraLeonardo.length, 1);
  assert.match(paraComprador[0].texto, /49\.102/);
  assert.match(paraLeonardo[0].texto, /pago-1/);
});

// ── Oraculo 2: el mismo pago dos veces -> 0 correos extra ──────────────────────────────────────

test("notificarActivacionPaquete: llamar dos veces para el MISMO paymentId no manda correos extra", async () => {
  const { deps, correosEnviados } = depsActivacionFalsas();
  await notificarActivacionPaquete(DATOS_BASE, deps);
  await notificarActivacionPaquete(DATOS_BASE, deps);

  assert.equal(correosEnviados.length, 2, "la segunda llamada no debe mandar ningun correo mas");
});

test("notificarActivacionPaquete: si correoYaEnviado ya dice true (otra entrega lo mando antes) -> 0 correos", async () => {
  const { deps, correosEnviados } = depsActivacionFalsas({ correoYaEnviado: async () => true });
  await notificarActivacionPaquete(DATOS_BASE, deps);
  assert.equal(correosEnviados.length, 0);
});

// ── Oraculo 3: el relay falla -> la activacion queda (no revierte nada) y no lanza ─────────────

test("notificarActivacionPaquete: si enviarCorreo falla (relay caido), la funcion no lanza y NO marca correoEnviado", async () => {
  const { deps, estaEnviado } = depsActivacionFalsas({ enviarCorreo: async () => false });
  await assert.doesNotReject(notificarActivacionPaquete(DATOS_BASE, deps));
  assert.equal(estaEnviado(), false, "no se marca enviado si el envio fallo: una entrega futura puede reintentar");
});

test("notificarActivacionPaquete: si obtenerAceptacion lanza (Firestore sin red), la funcion no lanza", async () => {
  const { deps } = depsActivacionFalsas({
    obtenerAceptacion: async () => {
      throw new Error("red caida");
    },
  });
  await assert.doesNotReject(notificarActivacionPaquete(DATOS_BASE, deps));
});

test("notificarActivacionPaquete: sin email en la aceptacion, igual se avisa a Leonardo (y se marca enviado)", async () => {
  const { deps, correosEnviados, estaEnviado } = depsActivacionFalsas({ obtenerAceptacion: async () => null });
  await notificarActivacionPaquete(DATOS_BASE, deps);
  assert.equal(correosEnviados.length, 1);
  assert.equal(correosEnviados[0].para, CORREO_LEONARDO);
  assert.equal(estaEnviado(), true);
});

// ── avisarReembolsoPaquete: aviso a Leonardo, nunca lanza, idempotente por `revertirPago` ──────

function depsReembolsoFalsas(overrides: Partial<AvisarReembolsoDeps> = {}): {
  deps: AvisarReembolsoDeps;
  correosEnviados: DatosCorreo[];
} {
  const correosEnviados: DatosCorreo[] = [];
  const deps: AvisarReembolsoDeps = {
    revertirPago: async () => "revertido",
    enviarCorreo: async (datos) => {
      correosEnviados.push(datos);
      return true;
    },
    ...overrides,
  };
  return { deps, correosEnviados };
}

test("avisarReembolsoPaquete: pago activo revertido -> 1 aviso a Leonardo", async () => {
  const { deps, correosEnviados } = depsReembolsoFalsas({ revertirPago: async () => "revertido" });
  await avisarReembolsoPaquete({ uid: "uid-1", paymentId: "pago-1", status: "charged_back" }, deps);
  assert.equal(correosEnviados.length, 1);
  assert.equal(correosEnviados[0].para, CORREO_LEONARDO);
});

test("avisarReembolsoPaquete: pago no activo -> igual avisa a Leonardo (informativo)", async () => {
  const { deps, correosEnviados } = depsReembolsoFalsas({ revertirPago: async () => "no_activo" });
  await avisarReembolsoPaquete({ uid: "uid-1", paymentId: "pago-1", status: "refunded" }, deps);
  assert.equal(correosEnviados.length, 1);
});

test("avisarReembolsoPaquete: evento ya procesado antes -> 0 avisos extra (antirrepeticion)", async () => {
  const { deps, correosEnviados } = depsReembolsoFalsas({ revertirPago: async () => "ya_procesado" });
  await avisarReembolsoPaquete({ uid: "uid-1", paymentId: "pago-1", status: "refunded" }, deps);
  assert.equal(correosEnviados.length, 0);
});

test("avisarReembolsoPaquete: pago que nunca fue nuestro -> ignorado, 0 avisos", async () => {
  const { deps, correosEnviados } = depsReembolsoFalsas({ revertirPago: async () => "ignorado" });
  await avisarReembolsoPaquete({ uid: "uid-1", paymentId: "pago-1", status: "refunded" }, deps);
  assert.equal(correosEnviados.length, 0);
});

test("avisarReembolsoPaquete: si enviarCorreo falla, la funcion no lanza", async () => {
  const { deps } = depsReembolsoFalsas({ enviarCorreo: async () => false });
  await assert.doesNotReject(
    avisarReembolsoPaquete({ uid: "uid-1", paymentId: "pago-1", status: "charged_back" }, deps)
  );
});

test("avisarReembolsoPaquete: si revertirPago lanza (Firestore sin red), la funcion no lanza", async () => {
  const { deps } = depsReembolsoFalsas({
    revertirPago: async () => {
      throw new Error("red caida");
    },
  });
  await assert.doesNotReject(
    avisarReembolsoPaquete({ uid: "uid-1", paymentId: "pago-1", status: "charged_back" }, deps)
  );
});
