// Pruebas de la composicion de avisos (Tareas 5 y 9, cobro real con planes; M34/M35/M36 corrigen
// la vuelta 27, 2026-10-05; simplificacion 2026-10-06 tras el NO-GO de la vuelta 32: el reclamo de
// correo ahora exige `ahora`/`reclamadoEn` explicito en las tres funciones, con comparacion
// transaccional de dueño al cerrar — ver server/cuentas.ts).
//
// Oraculo cubierto aqui:
//   1. activacion -> 1 correo al comprador y 1 a Leonardo.
//   2. DOS avisos casi simultaneos del mismo pago (reclamo transaccional real, con el doble de
//      Firestore de tests/_fakeFirestore.ts — no un booleano en memoria) -> 1 solo correo POR
//      DESTINATARIO (M35).
//   3. si falla el envio a Leonardo, el comprador NO recibe un reenvio, y Leonardo SI se reintenta
//      en una entrega posterior (M35).
//   4. el relay falla -> la activacion queda (no se revierte nada) y la funcion no lanza.
//   5. texto con un dato pendiente -> 0 correos al comprador y 1 aviso a Leonardo (M36(2)).
//   6. avisarReembolsoPaquete: si `revertirPago` lanza, la funcion AHORA propaga el error (M34),
//      para que server/webhook.ts pueda responder 500.
//   7. un liberar TARDIO (con el `reclamadoEn` de un reclamo viejo) nunca pisa un reclamo AJENO
//      mas nuevo sobre el mismo destinatario (simplificacion 2026-10-06, punto 6 de la orden).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  notificarActivacionPaquete,
  avisarReembolsoPaquete,
  CORREO_LEONARDO,
  type NotificarActivacionDeps,
  type AvisarReembolsoDeps,
} from "../server/notificaciones";
import { reclamarEnvioCorreoTx, marcarCorreoEnviadoTx, liberarReclamoCorreoTx, type DestinatarioCorreo } from "../server/cuentas";
import { construirCorreoConfirmacionCompra, type DatosCorreo } from "../server/avisos";
import { FirestoreFalso } from "./_fakeFirestore";

const AHORA = new Date("2026-10-06T12:00:00.000Z");

// `construirCorreoComprador` por defecto en estas pruebas devuelve un texto SIN placeholders —
// simula el estado "despues de que Leonardo completo PROVEEDOR_DOCUMENTO/PROVEEDOR_DIRECCION"
// (ver server/avisos.ts), para poder probar el reclamo transaccional (M35) y el reintento de
// Leonardo de forma AISLADA del bloqueo de M36(2) (que tiene sus propias pruebas dedicadas, mas
// abajo, usando la composicion REAL — hoy bloqueada de verdad, porque esos datos siguen pendientes).
function construirCorreoCompradorLimpio() {
  return { asunto: "Confirmación de tu compra", texto: "Texto de prueba sin ningún dato pendiente." };
}

function depsActivacionFalsas(overrides: Partial<NotificarActivacionDeps> = {}) {
  const reclamos = new Map<string, "reclamado" | "enviado">();
  const correosEnviados: DatosCorreo[] = [];
  const deps: NotificarActivacionDeps = {
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
  cop: 49102,
  trm: 3273.49,
  fechaTrm: "2026-10-03",
  fechaPago: new Date("2026-10-05T15:00:00.000Z"),
  fechaVencimiento: new Date("2026-11-05T15:00:00.000Z"),
};

// ── Oraculo 1: activacion -> 1 correo al comprador y 1 a Leonardo ──────────────────────────────

test("notificarActivacionPaquete: activacion manda exactamente 1 correo al comprador y 1 a Leonardo", async () => {
  const { deps, correosEnviados } = depsActivacionFalsas();
  await notificarActivacionPaquete(DATOS_BASE, AHORA, deps);

  assert.equal(correosEnviados.length, 2);
  const paraComprador = correosEnviados.filter((c) => c.para === "comprador@test.com");
  const paraLeonardo = correosEnviados.filter((c) => c.para === CORREO_LEONARDO);
  assert.equal(paraComprador.length, 1);
  assert.equal(paraLeonardo.length, 1);
  assert.match(paraComprador[0].texto, /sin ningún dato pendiente/);
  assert.match(paraLeonardo[0].texto, /pago-1/);
  assert.match(paraLeonardo[0].texto, /49\.102/);
});

test("notificarActivacionPaquete: llamar dos veces (deps en memoria, idempotencia simple) no manda correos extra", async () => {
  const { deps, correosEnviados } = depsActivacionFalsas();
  await notificarActivacionPaquete(DATOS_BASE, AHORA, deps);
  await notificarActivacionPaquete(DATOS_BASE, AHORA, deps);

  assert.equal(correosEnviados.length, 2, "la segunda llamada no debe mandar ningun correo mas");
});

// ── Oraculo 2 (M35): DOS avisos casi simultaneos del MISMO pago, con reclamo TRANSACCIONAL real
// (FirestoreFalso + reclamarEnvioCorreoTx, no un booleano en memoria) -> 1 correo por destinatario.
// FirestoreFalso reproduce el reintento optimista real de Firestore: de las dos llamadas a
// `reclamarEnvioCorreo` para el MISMO destinatario que corren "al mismo tiempo" (Promise.all), una
// gana la carrera y la otra, al reintentar con el estado ya actualizado, ve "ya reclamado" y
// devuelve false — ver tests/_fakeFirestore.ts para la prueba de que esto reproduce la regla real
// de Firestore (conflicto de version -> reintento).

function depsConFirestoreFalsoReal(db: FirestoreFalso, paymentId: string, overrides: Partial<NotificarActivacionDeps> = {}) {
  const correosEnviados: DatosCorreo[] = [];
  const pagoRef = db.doc(`pagosProcesados/${paymentId}`);
  const deps: NotificarActivacionDeps = {
    reclamarEnvioCorreo: (_pid, destinatario: DestinatarioCorreo, ahora: Date) =>
      db.runTransaction((tx) => reclamarEnvioCorreoTx(tx, pagoRef, destinatario, ahora)),
    marcarCorreoEnviado: async (_pid, destinatario: DestinatarioCorreo, reclamadoEn: Date) => {
      await db.runTransaction((tx) => marcarCorreoEnviadoTx(tx, pagoRef, destinatario, reclamadoEn));
    },
    liberarReclamoCorreo: async (_pid, destinatario: DestinatarioCorreo, reclamadoEn: Date) => {
      await db.runTransaction((tx) => liberarReclamoCorreoTx(tx, pagoRef, destinatario, reclamadoEn));
    },
    obtenerAceptacion: async () => ({ email: "comprador@test.com", idioma: "es" }),
    enviarCorreo: async (datos) => {
      correosEnviados.push(datos);
      return true;
    },
    construirCorreoComprador: construirCorreoCompradorLimpio,
    ...overrides,
  };
  return { deps, correosEnviados };
}

test("notificarActivacionPaquete (M35): dos avisos CASI SIMULTANEOS del mismo pago producen 1 solo correo por destinatario", async () => {
  const db = new FirestoreFalso();
  db.seed("pagosProcesados/pago-1", { procesadoEn: {} });
  const { deps, correosEnviados } = depsConFirestoreFalsoReal(db, "pago-1");

  await Promise.all([
    notificarActivacionPaquete(DATOS_BASE, AHORA, deps),
    notificarActivacionPaquete(DATOS_BASE, AHORA, deps),
  ]);

  const paraComprador = correosEnviados.filter((c) => c.para === "comprador@test.com");
  const paraLeonardo = correosEnviados.filter((c) => c.para === CORREO_LEONARDO);
  assert.equal(paraComprador.length, 1, "exactamente 1 correo al comprador, nunca 2, aunque las dos llamadas corran casi al mismo tiempo");
  assert.equal(paraLeonardo.length, 1, "exactamente 1 correo a Leonardo");
});

test("notificarActivacionPaquete: si correoYaEnviado/reclamo ya dice 'enviado' (otra entrega lo mando antes) -> 0 correos", async () => {
  const db = new FirestoreFalso();
  db.seed("pagosProcesados/pago-1", { correoComprador: "enviado", correoLeonardo: "enviado" });
  const { deps, correosEnviados } = depsConFirestoreFalsoReal(db, "pago-1");
  await notificarActivacionPaquete(DATOS_BASE, AHORA, deps);
  assert.equal(correosEnviados.length, 0);
});

// ── Oraculo 3 (M35): falla Leonardo -> el comprador NO recibe un reenvio, y Leonardo SI se
// reintenta en una entrega POSTERIOR (p. ej. una entrega repetida del webhook) ──────────────────

test("notificarActivacionPaquete: si enviarCorreo falla SOLO para Leonardo, el comprador recibe su correo igual y Leonardo queda liberado para reintentar", async () => {
  const db = new FirestoreFalso();
  const { deps, correosEnviados } = depsConFirestoreFalsoReal(db, "pago-1", {
    enviarCorreo: async (datos) => {
      if (datos.para === CORREO_LEONARDO) return false; // Leonardo falla
      correosEnviados.push(datos);
      return true;
    },
  });

  await notificarActivacionPaquete(DATOS_BASE, AHORA, deps);

  assert.equal(correosEnviados.length, 1, "el comprador SI recibio su correo");
  assert.equal(correosEnviados[0].para, "comprador@test.com");
  const pago = db.leer("pagosProcesados/pago-1");
  assert.equal(pago?.correoComprador, "enviado");
  assert.equal(pago?.correoLeonardo, null, "el reclamo de Leonardo se libero (no quedo 'reclamado' para siempre)");
});

test("notificarActivacionPaquete: tras el fallo de Leonardo, una entrega POSTERIOR reintenta Leonardo SIN reenviar al comprador", async () => {
  const db = new FirestoreFalso();
  let fallarLeonardo = true;
  const correosReales: DatosCorreo[] = [];
  const { deps } = depsConFirestoreFalsoReal(db, "pago-1", {
    enviarCorreo: async (datos) => {
      if (datos.para === CORREO_LEONARDO && fallarLeonardo) return false;
      correosReales.push(datos);
      return true;
    },
  });

  await notificarActivacionPaquete(DATOS_BASE, AHORA, deps); // 1er intento: comprador OK, Leonardo falla
  fallarLeonardo = false;
  // 2a entrega (p. ej. webhook repetido): con un `ahora` DISTINTO (otra entrega real), el reclamo
  // libre de Leonardo se vuelve a reclamar con un `reclamadoEn` nuevo.
  await notificarActivacionPaquete(DATOS_BASE, new Date(AHORA.getTime() + 60_000), deps);

  const paraComprador = correosReales.filter((c) => c.para === "comprador@test.com");
  const paraLeonardo = correosReales.filter((c) => c.para === CORREO_LEONARDO);
  assert.equal(paraComprador.length, 1, "el comprador NUNCA recibe un reenvio");
  assert.equal(paraLeonardo.length, 1, "Leonardo SI se reintenta y esta vez sale bien");
});

test("notificarActivacionPaquete: si obtenerAceptacion lanza (Firestore sin red), la funcion no lanza", async () => {
  const { deps } = depsActivacionFalsas({
    obtenerAceptacion: async () => {
      throw new Error("red caida");
    },
  });
  await assert.doesNotReject(notificarActivacionPaquete(DATOS_BASE, AHORA, deps));
});

test("notificarActivacionPaquete: sin email en la aceptacion, igual se avisa a Leonardo (y se marca enviado)", async () => {
  const { deps, correosEnviados, reclamos } = depsActivacionFalsas({ obtenerAceptacion: async () => null });
  await notificarActivacionPaquete(DATOS_BASE, AHORA, deps);
  assert.equal(correosEnviados.length, 1);
  assert.equal(correosEnviados[0].para, CORREO_LEONARDO);
  assert.equal(reclamos.get("leonardo"), "enviado");
});

// ── Oraculo 5 (M36(2)): texto con un dato pendiente -> 0 correos al comprador, 1 aviso a Leonardo,
// con antirrepeticion propia (destinatario "bloqueoProveedor") ────────────────────────────────

test("notificarActivacionPaquete (M36(2)): el acuse con datos del proveedor pendientes NO se envia al comprador; se avisa a Leonardo 1 vez", async () => {
  // Deliberadamente se usa aqui la composicion REAL (`construirCorreoConfirmacionCompra`, nunca
  // sobreescrita): mientras PROVEEDOR_DOCUMENTO/PROVEEDOR_DIRECCION sigan en "[PENDIENTE]"
  // (server/avisos.ts), el correo compuesto para el comprador SIEMPRE trae ese placeholder — es
  // exactamente el escenario real de hoy, no uno simulado.
  const { deps, correosEnviados } = depsActivacionFalsas({ construirCorreoComprador: construirCorreoConfirmacionCompra });
  await notificarActivacionPaquete(DATOS_BASE, AHORA, deps);

  const paraComprador = correosEnviados.filter((c) => c.para === "comprador@test.com");
  const paraLeonardo = correosEnviados.filter((c) => c.para === CORREO_LEONARDO);
  assert.equal(paraComprador.length, 0, "el comprador nunca recibe un acuse con datos pendientes");
  // 2 correos a Leonardo: el aviso de bloqueo + el aviso de venta normal (son avisos distintos,
  // cada uno con su propio reclamo/destinatario).
  assert.equal(paraLeonardo.length, 2);
  assert.ok(paraLeonardo.some((c) => /BLOQUEADO/.test(c.asunto)));
  assert.ok(paraLeonardo.some((c) => /Nueva venta/.test(c.asunto)));
});

test("notificarActivacionPaquete (M36(2)): el aviso de bloqueo a Leonardo tiene antirrepeticion propia (no se repite en una 2a entrega)", async () => {
  const db = new FirestoreFalso();
  const { deps, correosEnviados } = depsConFirestoreFalsoReal(db, "pago-1", {
    construirCorreoComprador: construirCorreoConfirmacionCompra, // real: hoy siempre bloqueado.
  });

  await notificarActivacionPaquete(DATOS_BASE, AHORA, deps);
  await notificarActivacionPaquete(DATOS_BASE, AHORA, deps); // entrega repetida del mismo pago

  const avisosBloqueo = correosEnviados.filter((c) => /BLOQUEADO/.test(c.asunto));
  assert.equal(avisosBloqueo.length, 1, "el aviso de bloqueo no se repite en una entrega posterior");
});

// ── B-2 (corrige vuelta 34 del REVISOR_EXTERNO): el bloqueo de M36(2) NO es terminal ────────────
// Con el dato del proveedor pendiente, el barrido NUNCA reclama/envia el correo al comprador (el
// unico reclamo que toma es el de "bloqueoProveedor", para el aviso a Leonardo) — por eso, en
// cuanto el dato se corrige (Leonardo completa PROVEEDOR_DOCUMENTO/PROVEEDOR_DIRECCION), el
// SIGUIENTE barrido (`reintentarAcusePendiente` -> `notificarActivacionPaquete`, que relee
// `construirCorreoComprador` desde cero en cada llamada) SI logra mandarlo — nada quedo
// permanentemente bloqueado.

test("B-2: con dato del proveedor pendiente no se envia al comprador; al corregirse, el SIGUIENTE barrido SI envia", async () => {
  const db = new FirestoreFalso();
  let datoPendiente = true; // simula PROVEEDOR_DOCUMENTO/PROVEEDOR_DIRECCION aun sin configurar.
  const construirCorreoCompradorSimulado = () => ({
    asunto: "Confirmación de tu compra",
    texto: datoPendiente ? "Texto con un dato [PENDIENTE: completar] del proveedor." : "Texto ya completo, sin ningún dato pendiente.",
  });
  const { deps, correosEnviados } = depsConFirestoreFalsoReal(db, "pago-1", {
    construirCorreoComprador: construirCorreoCompradorSimulado,
  });

  // 1er barrido: el dato SIGUE pendiente -> 0 correos al comprador.
  await notificarActivacionPaquete(DATOS_BASE, AHORA, deps);
  assert.equal(correosEnviados.filter((c) => c.para === "comprador@test.com").length, 0, "con dato pendiente, el comprador no debe recibir nada");
  assert.equal(db.leer("pagosProcesados/pago-1")?.correoComprador ?? null, null, "el bloqueo NUNCA reclama el campo del comprador (no es terminal)");

  // Leonardo completa el dato del proveedor entre un barrido y el siguiente.
  datoPendiente = false;

  // 2o barrido (30 min despues, mismo pago): ya no hay placeholder -> SI se manda al comprador.
  await notificarActivacionPaquete(DATOS_BASE, new Date(AHORA.getTime() + 30 * 60_000), deps);
  const paraComprador = correosEnviados.filter((c) => c.para === "comprador@test.com");
  assert.equal(paraComprador.length, 1, "al corregirse el dato, el SIGUIENTE barrido SI manda el acuse");
  assert.equal(db.leer("pagosProcesados/pago-1")?.correoComprador, "enviado");
});

// ── Hallazgo de /code-review sobre el commit de M33-M36 (vuelta 27): si la escritura que CIERRA
// el reclamo falla, `cerrarReclamoConReintento` reintenta UNA vez la MISMA operacion antes de
// darse por vencido (y nunca lanza, con o sin exito en el reintento) ───────────────────────────

test("notificarActivacionPaquete: si marcarCorreoEnviado falla UNA vez (transitorio), el reintento lo resuelve sin lanzar", async () => {
  let llamadas = 0;
  const { deps, correosEnviados, reclamos } = depsActivacionFalsas({
    marcarCorreoEnviado: async (_paymentId, destinatario) => {
      llamadas++;
      if (llamadas === 1) throw new Error("Firestore sin red (transitorio)");
      reclamos.set(destinatario, "enviado");
    },
  });
  await assert.doesNotReject(notificarActivacionPaquete(DATOS_BASE, AHORA, deps));
  assert.equal(correosEnviados.length, 2, "los correos SI se mandaron (el fallo fue solo en el cierre del reclamo)");
  assert.equal(reclamos.get("leonardo"), "enviado", "el reintento si logro marcar el reclamo como enviado");
});

test("notificarActivacionPaquete: si marcarCorreoEnviado falla DOS veces seguidas, la funcion no lanza (queda 'reclamado', log RECLAMO_SIN_SALIDA)", async () => {
  const logs: string[] = [];
  const logOriginal = console.error;
  console.error = (...args: any[]) => logs.push(args.map(String).join(" "));
  try {
    const { deps } = depsActivacionFalsas({
      marcarCorreoEnviado: async () => {
        throw new Error("Firestore sin red (persistente)");
      },
    });
    await assert.doesNotReject(notificarActivacionPaquete(DATOS_BASE, AHORA, deps));
  } finally {
    console.error = logOriginal;
  }
  assert.ok(logs.some((l) => l.includes("RECLAMO_SIN_SALIDA")), "debe quedar un log grepable para resolverlo a mano");
});

// ── Punto 6 de la orden de simplificacion (2026-10-06): un liberar TARDIO (con el `reclamadoEn`
// de un reclamo ya viejo) nunca pisa un reclamo AJENO mas nuevo sobre el MISMO destinatario ────

test("liberarReclamoCorreoTx: un liberar tardio (reclamadoEn viejo) no pisa un reclamo ajeno mas nuevo", async () => {
  const db = new FirestoreFalso();
  const pagoRef = db.doc("pagosProcesados/pago-1");
  const ahoraA = new Date("2026-10-06T10:00:00.000Z");
  const ahoraB = new Date("2026-10-06T10:20:00.000Z"); // 20 min despues: A ya esta atascado (>10 min).

  // Entrega A reclama "comprador" a las 10:00.
  const reclamoA = await db.runTransaction((tx) => reclamarEnvioCorreoTx(tx, pagoRef, "comprador", ahoraA));
  assert.equal(reclamoA, true);

  // Entrega B, 20 min despues, encuentra el reclamo de A atascado y lo vuelve a reclamar (fresco).
  const reclamoB = await db.runTransaction((tx) => reclamarEnvioCorreoTx(tx, pagoRef, "comprador", ahoraB));
  assert.equal(reclamoB, true, "el reclamo atascado de A SI se puede volver a reclamar");

  // Entrega A, que seguia viva (p. ej. una llamada de red muy lenta), por fin intenta LIBERAR su
  // reclamo VIEJO (con el `reclamadoEn` de las 10:00) — esto NUNCA debe tocar el reclamo de B.
  await db.runTransaction((tx) => liberarReclamoCorreoTx(tx, pagoRef, "comprador", ahoraA));

  const pago = db.leer("pagosProcesados/pago-1");
  assert.equal(pago?.correoComprador, "reclamado", "el reclamo de B (el dueño actual) debe seguir intacto");
  assert.equal(
    (pago?.correoCompradorReclamadoEn as any).toMillis(),
    ahoraB.getTime(),
    "la fecha del reclamo debe seguir siendo la de B, no la de A"
  );
});

test("marcarCorreoEnviadoTx: un marcar-enviado TARDIO (reclamadoEn viejo) no pisa un reclamo ajeno mas nuevo", async () => {
  const db = new FirestoreFalso();
  const pagoRef = db.doc("pagosProcesados/pago-1");
  const ahoraA = new Date("2026-10-06T10:00:00.000Z");
  const ahoraB = new Date("2026-10-06T10:20:00.000Z");

  await db.runTransaction((tx) => reclamarEnvioCorreoTx(tx, pagoRef, "comprador", ahoraA));
  await db.runTransaction((tx) => reclamarEnvioCorreoTx(tx, pagoRef, "comprador", ahoraB)); // B toma el reclamo atascado de A.

  // A, tardiamente, cree que SI mando el correo y marca "enviado" con su `reclamadoEn` viejo.
  await db.runTransaction((tx) => marcarCorreoEnviadoTx(tx, pagoRef, "comprador", ahoraA));

  const pago = db.leer("pagosProcesados/pago-1");
  assert.equal(pago?.correoComprador, "reclamado", "A no debe poder marcar 'enviado' sobre el reclamo de B");

  // B, el dueño real, SI puede cerrarlo con su propio `reclamadoEn`.
  await db.runTransaction((tx) => marcarCorreoEnviadoTx(tx, pagoRef, "comprador", ahoraB));
  assert.equal(db.leer("pagosProcesados/pago-1")?.correoComprador, "enviado");
});

// ── avisarReembolsoPaquete: aviso a Leonardo, idempotente por `revertirPago` ───────────────────

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

test("avisarReembolsoPaquete: si enviarCorreo (el aviso a Leonardo) falla, la funcion no lanza — la reversion YA tuvo exito", async () => {
  const { deps } = depsReembolsoFalsas({ enviarCorreo: async () => false });
  await assert.doesNotReject(
    avisarReembolsoPaquete({ uid: "uid-1", paymentId: "pago-1", status: "charged_back" }, deps)
  );
});

// ── M34 (corrige vuelta 27): si `revertirPago` (la REVERSION misma) lanza, la funcion AHORA
// PROPAGA el error — antes lo tragaba, lo que dejaba a server/webhook.ts respondiendo 200 sobre
// una cuenta que nunca se revirtio. `revertirPago` es idempotente, asi que es seguro reintentar.

test("avisarReembolsoPaquete (M34): si revertirPago lanza (Firestore sin red), la funcion AHORA PROPAGA el error (para que el webhook responda 500)", async () => {
  const { deps } = depsReembolsoFalsas({
    revertirPago: async () => {
      throw new Error("red caida");
    },
  });
  await assert.rejects(
    avisarReembolsoPaquete({ uid: "uid-1", paymentId: "pago-1", status: "charged_back" }, deps),
    /red caida/
  );
});
