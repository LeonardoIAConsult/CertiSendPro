// Pruebas de server/tareasFondo.ts (correccion NO-GO vuelta 30, 2026-10-05): la orquestacion
// extraida del webhook y de /api/cuenta (M1 "handler extraido", sin Express ni supertest — no
// esta instalado en este proyecto, ver package.json), el tope de tiempo de G1, el throttle de B1,
// el barrido completo paginado de M3, y el handler del endpoint protegido de G2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import {
  conTope,
  debeCorrerBarridoWebhook,
  ejecutarBarridoWebhookConTope,
  ejecutarReintentoCuentaConTope,
  reintentarAcusesDeUid,
  barrerAcusesPendientesGlobal,
  barrerTodosLosPagosPendientes,
  manejarBarridoAcusesTarea,
  datosReintentoDesdePago,
  type PaginaPagos,
} from "../server/tareasFondo";
import type { PagoProcesadoAcuse } from "../server/cuentas";

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Temporizador FALSO que nunca dispara su callback — fuerza a que `Promise.race` dentro de
 * `conTope` SOLO pueda resolver por el lado del trabajo real, nunca por el "tope". Determinista:
 * sin esto, probar "la promesa rapida gana la carrera" dependeria del reloj real (flaky bajo
 * carga de CPU, p. ej. al correr la suite completa con muchos archivos a la vez). */
function temporizadorQueNuncaDispara(): void {
  // Deliberadamente vacio: no llama a `cb`.
}

/** Temporizador FALSO que dispara su callback EN EL ACTO (sincronico, via microtask) — simula
 * "el tope ya se agoto" sin esperar tiempo real. */
function temporizadorInmediato(cb: () => void): void {
  queueMicrotask(cb);
}

// ── conTope (G1): nunca deja esperando mas de `ms`, nunca deja un rechazo sin manejar ───────────
// Las tres pruebas de abajo inyectan el temporizador (5to parametro de `conTope`, SOLO PARA
// PRUEBAS) para ser deterministas: nunca dependen de tiempo real ni de `setTimeout`, asi que no
// son sensibles a la carga de CPU de correr muchos archivos de prueba a la vez (evita el falso
// flaky que SI aparecia con la version anterior de estas pruebas, basada en reloj real).

test("conTope: si la promesa resuelve, conTope regresa sin necesitar que el temporizador dispare", async () => {
  let trabajoHecho = false;
  const promesaRapida = Promise.resolve().then(() => {
    trabajoHecho = true;
  });
  await conTope(promesaRapida, 500, "PRUEBA", undefined, temporizadorQueNuncaDispara);
  assert.equal(trabajoHecho, true, "la promesa rapida debe haber corrido antes de que conTope regrese");
});

test("conTope: si el temporizador dispara PRIMERO, conTope regresa sin esperar a que el trabajo termine", async () => {
  let trabajoTerminado = false;
  let liberarTrabajo: () => void = () => {};
  const promesaLenta = new Promise<void>((resolve) => {
    liberarTrabajo = () => {
      trabajoTerminado = true;
      resolve();
    };
  });
  await conTope(promesaLenta, 20, "PRUEBA", undefined, temporizadorInmediato);
  assert.equal(trabajoTerminado, false, "conTope no debe esperar al trabajo si el tope ya disparo");
  liberarTrabajo(); // limpieza: nunca deja la promesa colgada entre pruebas.
});

test("conTope: una promesa que RECHAZA despues de que el tope ya disparo nunca queda como rechazo sin manejar (se loggea)", async () => {
  const logs: string[] = [];
  let rechazarTrabajo: (error: Error) => void = () => {};
  const promesaQueFallaTarde = new Promise<void>((_resolve, reject) => {
    rechazarTrabajo = reject;
  });
  await conTope(promesaQueFallaTarde, 5, "PRUEBA", (l) => logs.push(l), temporizadorInmediato);
  rechazarTrabajo(new Error("fallo simulado despues del tope"));
  await Promise.resolve();
  await Promise.resolve(); // deja correr el microtask del `.catch()` interno de conTope.
  assert.ok(logs.some((l) => l.includes("PRUEBA") && l.includes("fallo simulado")), "el fallo tardio debe quedar loggeado, no perdido");
});

// ── debeCorrerBarridoWebhook (B1) ────────────────────────────────────────────────────────────────

test("B1: httpStatus distinto de 200 nunca corre el barrido", () => {
  const r = debeCorrerBarridoWebhook(500, Date.now(), null);
  assert.equal(r.correr, false);
  assert.equal(r.nuevoEstado, null);
});

test("B1: httpStatus=200 sin estado previo SI corre y guarda el estado", () => {
  const ahora = Date.now();
  const r = debeCorrerBarridoWebhook(200, ahora, null);
  assert.equal(r.correr, true);
  assert.deepEqual(r.nuevoEstado, { ultimoEnMs: ahora });
});

test("B1: httpStatus=200 a menos de 1 minuto del ultimo barrido NO corre (maximo 1/min global)", () => {
  const previo = { ultimoEnMs: 1000 };
  const r = debeCorrerBarridoWebhook(200, 1000 + 59_000, previo);
  assert.equal(r.correr, false);
  assert.equal(r.nuevoEstado, previo, "el estado no cambia si no corrio");
});

test("B1: httpStatus=200 a 1 minuto EXACTO o mas del ultimo barrido SI corre de nuevo", () => {
  const previo = { ultimoEnMs: 1000 };
  const r = debeCorrerBarridoWebhook(200, 1000 + 60_000, previo);
  assert.equal(r.correr, true);
  assert.deepEqual(r.nuevoEstado, { ultimoEnMs: 1000 + 60_000 });
});

// ── ejecutarBarridoWebhookConTope (G1+B1, lo que llama server.ts en la ruta del webhook) ────────

test("G1/M1: ejecutarBarridoWebhookConTope SI llama a deps.barrer cuando corresponde (httpStatus=200, sin throttle)", async () => {
  let llamado = false;
  const r = await ejecutarBarridoWebhookConTope(200, Date.now(), null, {
    barrer: async () => {
      llamado = true;
    },
  });
  assert.equal(llamado, true, "la ruta real del webhook SI debe llamar al barrido");
  assert.equal(r.ejecutado, true);
});

test("B1: ejecutarBarridoWebhookConTope NO llama a deps.barrer si httpStatus != 200", async () => {
  let llamado = false;
  const r = await ejecutarBarridoWebhookConTope(500, Date.now(), null, {
    barrer: async () => {
      llamado = true;
    },
  });
  assert.equal(llamado, false);
  assert.equal(r.ejecutado, false);
});

test("G1: ejecutarBarridoWebhookConTope ESPERA (await) el barrido antes de devolver el control (no fire-and-forget)", async () => {
  let efectoAplicado = false;
  await ejecutarBarridoWebhookConTope(200, Date.now(), null, {
    barrer: async () => {
      await esperar(5);
      efectoAplicado = true;
    },
  });
  // Si esto fuera fire-and-forget (.catch() sin await, como antes de la vuelta 30), aqui
  // `efectoAplicado` todavia seria false porque el control habria vuelto de inmediato.
  assert.equal(efectoAplicado, true, "el barrido debe haber corrido de verdad ANTES de que la funcion regrese");
});

// (La mecanica "no espera mas del tope" ya queda probada de forma determinista arriba, en las
// pruebas de `conTope` con temporizador inyectado — `ejecutarBarridoWebhookConTope` solo le pasa
// el tope a `conTope`, sin logica propia que probar de nuevo con reloj real aqui.)

// ── ejecutarReintentoCuentaConTope (G1, lo que llama server.ts en /api/cuenta) ──────────────────

test("G1/M1: ejecutarReintentoCuentaConTope SI llama a deps.reintentar con el uid", async () => {
  let uidRecibido: string | null = null;
  await ejecutarReintentoCuentaConTope("uid-123", {
    reintentar: async (uid) => {
      uidRecibido = uid;
    },
  });
  assert.equal(uidRecibido, "uid-123");
});

test("G1: ejecutarReintentoCuentaConTope espera de verdad (await) antes de regresar", async () => {
  let efectoAplicado = false;
  await ejecutarReintentoCuentaConTope("uid-1", {
    reintentar: async () => {
      await esperar(5);
      efectoAplicado = true;
    },
  });
  assert.equal(efectoAplicado, true);
});

// (Mismo caso que arriba: "no espera mas del tope" ya se prueba de forma determinista sobre
// `conTope` directamente; `ejecutarReintentoCuentaConTope` no agrega logica propia ahi.)

// ── reintentarAcusesDeUid / barrerAcusesPendientesGlobal (movidas de server.ts, M1) ─────────────

function pagoFalso(overrides: Partial<PagoProcesadoAcuse> = {}): PagoProcesadoAcuse {
  return {
    paymentId: "pago-1",
    uid: "uid-1",
    referenciaId: "ref-1",
    cop: 49102,
    trm: 3273.49,
    fechaTrm: "2026-10-03",
    fecha: Timestamp.now(),
    vence: Timestamp.now(),
    correoComprador: null,
    revertido: false,
    ...overrides,
  };
}

test("M1: reintentarAcusesDeUid llama a deps.reintentar por cada pendiente de ese uid", async () => {
  const llamadas: any[] = [];
  await reintentarAcusesDeUid("uid-1", {
    listarPendientesDeUid: async () => [pagoFalso(), pagoFalso({ paymentId: "pago-2" })],
    listarBarridoGlobal: async () => [],
    reintentar: async (datos) => {
      llamadas.push(datos);
    },
  });
  assert.equal(llamadas.length, 2);
  assert.deepEqual(llamadas.map((l) => l.paymentId), ["pago-1", "pago-2"]);
});

test("M1/G3: barrerAcusesPendientesGlobal propaga 'revertido' en los datos reconstruidos", async () => {
  const llamadas: any[] = [];
  await barrerAcusesPendientesGlobal({
    listarPendientesDeUid: async () => [],
    listarBarridoGlobal: async () => [pagoFalso({ revertido: true })],
    reintentar: async (datos) => {
      llamadas.push(datos);
    },
  });
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].revertido, true, "datosReintentoDesdePago debe propagar el campo revertido");
});

test("M1: barrerAcusesPendientesGlobal salta candidatos sin uid guardado", async () => {
  let llamado = false;
  await barrerAcusesPendientesGlobal({
    listarPendientesDeUid: async () => [],
    listarBarridoGlobal: async () => [pagoFalso({ uid: null })],
    reintentar: async () => {
      llamado = true;
    },
  });
  assert.equal(llamado, false);
});

test("datosReintentoDesdePago: usa uidRespaldo si el pago no trae uid propio", () => {
  const d = datosReintentoDesdePago(pagoFalso({ uid: null }), "uid-respaldo");
  assert.equal(d.uid, "uid-respaldo");
});

// ── barrerTodosLosPagosPendientes (M3, barrido completo paginado para el endpoint de tareas) ────
// `AHORA_FIJO_M3` reemplaza `Timestamp.now()`/`new Date()` en TODAS las pruebas de abajo: con una
// de ellas exigiendo exactamente 2 minutos de espera (backoff de M2), depender del reloj real
// (dos llamadas a `Date.now()` en instantes de ejecucion distintos) resulto flaky al correr la
// suite completa varias veces seguidas bajo carga de CPU — confirmado reproduciendo el fallo.

const AHORA_FIJO_M3 = new Date("2026-10-05T12:00:00.000Z");

function docCrudo(id: string, overrides: Record<string, any> = {}) {
  return {
    id,
    data: {
      uid: "uid-1",
      referenciaId: "ref-1",
      cop: 49102,
      trm: 3273.49,
      fechaTrm: "2026-10-03",
      fecha: Timestamp.fromDate(AHORA_FIJO_M3),
      vence: Timestamp.fromDate(AHORA_FIJO_M3),
      correoComprador: null,
      procesadoEn: Timestamp.fromDate(AHORA_FIJO_M3),
      ...overrides,
    },
  };
}

test("M3: barrerTodosLosPagosPendientes recorre varias paginas hasta que una sale vacia", async () => {
  const paginas: PaginaPagos[] = [
    { docs: [docCrudo("p1"), docCrudo("p2")], cursorSiguiente: "cursor-1" },
    { docs: [docCrudo("p3")], cursorSiguiente: "cursor-2" },
    { docs: [], cursorSiguiente: null },
  ];
  let indice = 0;
  const cursoresPedidos: unknown[] = [];
  const reintentados: string[] = [];

  const resultado = await barrerTodosLosPagosPendientes({
    obtenerPagina: async (cursor) => {
      cursoresPedidos.push(cursor);
      return paginas[indice++];
    },
    reintentar: async (datos) => {
      reintentados.push(datos.paymentId);
    },
    ahora: () => AHORA_FIJO_M3,
  });

  assert.deepEqual(cursoresPedidos, [null, "cursor-1", "cursor-2"]);
  assert.deepEqual(reintentados, ["p1", "p2", "p3"]);
  assert.equal(resultado.paginas, 3);
  assert.equal(resultado.revisados, 3);
  assert.equal(resultado.reintentados, 3);
});

test("M3: barrerTodosLosPagosPendientes se detiene si no hay cursorSiguiente aunque la pagina no este vacia", async () => {
  let llamadas = 0;
  const resultado = await barrerTodosLosPagosPendientes({
    obtenerPagina: async () => {
      llamadas++;
      return { docs: [docCrudo("p1")], cursorSiguiente: null };
    },
    reintentar: async () => {},
    ahora: () => AHORA_FIJO_M3,
  });
  assert.equal(llamadas, 1, "sin cursorSiguiente, no debe pedir una segunda pagina");
  assert.equal(resultado.paginas, 1);
});

test("M3: barrerTodosLosPagosPendientes respeta maxPaginas aunque el cursor siga disponible", async () => {
  let llamadas = 0;
  const resultado = await barrerTodosLosPagosPendientes(
    {
      obtenerPagina: async () => {
        llamadas++;
        return { docs: [docCrudo(`p${llamadas}`)], cursorSiguiente: `cursor-${llamadas}` };
      },
      reintentar: async () => {},
      ahora: () => AHORA_FIJO_M3,
    },
    100,
    3 // maxPaginas de prueba
  );
  assert.equal(llamadas, 3, "nunca debe pedir mas paginas que maxPaginas");
  assert.equal(resultado.paginas, 3);
});

test("M3/G3: barrerTodosLosPagosPendientes salta un pago revertido con correoComprador null (no se reintenta)", async () => {
  const reintentados: string[] = [];
  const resultado = await barrerTodosLosPagosPendientes({
    obtenerPagina: async (cursor) => {
      if (cursor) return { docs: [], cursorSiguiente: null };
      return {
        docs: [docCrudo("revertido", { correoComprador: null, revertido: true }), docCrudo("normal")],
        cursorSiguiente: "c1",
      };
    },
    reintentar: async (datos) => {
      reintentados.push(datos.paymentId);
    },
    ahora: () => AHORA_FIJO_M3,
  });
  assert.deepEqual(reintentados, ["normal"], "el pago revertido no debe reintentarse");
  assert.equal(resultado.revisados, 2, "pero SI se cuenta como revisado");
});

test("M3: barrerTodosLosPagosPendientes salta estados terminales (agotado) y respeta el backoff de M2", async () => {
  const reintentados: string[] = [];
  const resultado = await barrerTodosLosPagosPendientes({
    obtenerPagina: async (cursor) => {
      if (cursor) return { docs: [], cursorSiguiente: null };
      return {
        docs: [
          docCrudo("agotado", { correoComprador: null, estadoAcuse: "agotado" }),
          docCrudo("en-backoff", {
            correoComprador: null,
            intentosAcuse: 1,
            // recien intentado (mismo instante fijo que `ahora`): 2^1=2 min de espera, no ha
            // pasado nada todavia.
            ultimoIntentoAcuseEn: Timestamp.fromDate(AHORA_FIJO_M3),
          }),
          docCrudo("elegible"),
        ],
        cursorSiguiente: "c1",
      };
    },
    reintentar: async (datos) => {
      reintentados.push(datos.paymentId);
    },
    ahora: () => AHORA_FIJO_M3,
  });
  assert.deepEqual(reintentados, ["elegible"]);
  assert.equal(resultado.revisados, 3);
});

// ── manejarBarridoAcusesTarea (G2, el handler del endpoint protegido) ───────────────────────────
// Oraculo de la orden: sin token -> 401; token de otra SA -> 403; token valido (mock) -> ejecuta.

test("G2: sin encabezado Authorization -> 401, nunca llama a verificarToken ni a barrer", async () => {
  let verificarLlamado = false;
  let barrerLlamado = false;
  const r = await manejarBarridoAcusesTarea(undefined, {
    verificarToken: async () => {
      verificarLlamado = true;
      return true;
    },
    barrer: async () => {
      barrerLlamado = true;
      return { paginas: 0, revisados: 0, reintentados: 0 };
    },
  });
  assert.equal(r.status, 401);
  assert.equal(verificarLlamado, false);
  assert.equal(barrerLlamado, false);
});

test("G2: encabezado Authorization sin 'Bearer ' -> 401", async () => {
  const r = await manejarBarridoAcusesTarea("TokenSinBearer", {
    verificarToken: async () => true,
    barrer: async () => ({ paginas: 0, revisados: 0, reintentados: 0 }),
  });
  assert.equal(r.status, 401);
});

test("G2: token de otra cuenta de servicio (verificarToken->false) -> 403, nunca ejecuta el barrido", async () => {
  let barrerLlamado = false;
  const r = await manejarBarridoAcusesTarea("Bearer token-de-otra-sa", {
    verificarToken: async () => false,
    barrer: async () => {
      barrerLlamado = true;
      return { paginas: 0, revisados: 0, reintentados: 0 };
    },
  });
  assert.equal(r.status, 403);
  assert.equal(barrerLlamado, false);
});

test("G2: token valido (mock del verificador) -> ejecuta el barrido y responde 200 con las estadisticas", async () => {
  let barrerLlamado = false;
  const r = await manejarBarridoAcusesTarea("Bearer token-valido-del-scheduler", {
    verificarToken: async (idToken) => {
      assert.equal(idToken, "token-valido-del-scheduler");
      return true;
    },
    barrer: async () => {
      barrerLlamado = true;
      return { paginas: 2, revisados: 150, reintentados: 3 };
    },
  });
  assert.equal(r.status, 200);
  assert.equal(barrerLlamado, true, "el handler SI debe llamar al barrido real al validar el token");
  assert.deepEqual(r.body, { ok: true, paginas: 2, revisados: 150, reintentados: 3 });
});
