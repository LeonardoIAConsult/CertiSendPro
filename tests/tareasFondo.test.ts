// Pruebas de server/tareasFondo.ts — simplificado 2026-10-06 (decision del Brain tras el NO-GO de
// la revision externa, vuelta 32 sobre b93fbed): el UNICO mecanismo de reintento del acuse de
// compra es `POST /api/tareas/barrido-acuses` (Cloud Scheduler cada 30 min, OIDC ya implementado).
// Se quitan por completo: el fire-and-forget/tope de tiempo (`conTope`) que necesitaban el
// reintento desde GET /api/cuenta y el barrido disparado por el propio webhook (los dos tambien
// se quitan, redundantes con el barrido programado), y el tope de intentos con backoff
// exponencial (`MAX_INTENTOS_ACUSE`) — la decision de reintentar/alertar/abandonar ahora vive en
// `reintentarAcusePendiente` (server/notificaciones.ts) segun la ANTIGUEDAD del pago, probada en
// tests/reintentoAcuse.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import express from "express";
import {
  esCandidatoBarridoAcuse,
  barrerTodosLosPagosPendientes,
  manejarBarridoAcusesTarea,
  datosReintentoDesdePago,
  registrarRutasTareas,
  verificarRutaTareasRegistrada,
  RUTA_BARRIDO_ACUSES,
  type PaginaPagos,
  type AppConRutasTareas,
} from "../server/tareasFondo";
import type { PagoProcesadoAcuse } from "../server/cuentas";

/** Captura console.error durante `fn` y lo restaura siempre, incluso si `fn` lanza. */
async function capturarConsoleError(fn: () => Promise<void> | void): Promise<string[]> {
  const logs: string[] = [];
  const original = console.error;
  console.error = (...args: any[]) => logs.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return logs;
}

// ── esCandidatoBarridoAcuse (PURA): filtro de seleccion del barrido ─────────────────────────────

test("esCandidatoBarridoAcuse: un pago pendiente normal SI es candidato", () => {
  assert.equal(esCandidatoBarridoAcuse({ correoComprador: null, revertido: false }), true);
});

test("esCandidatoBarridoAcuse: excluye correoComprador='enviado'", () => {
  assert.equal(esCandidatoBarridoAcuse({ correoComprador: "enviado" }), false);
});

test("esCandidatoBarridoAcuse: excluye un pago revertido aunque correoComprador sea null", () => {
  assert.equal(esCandidatoBarridoAcuse({ correoComprador: null, revertido: true }), false);
});

test("esCandidatoBarridoAcuse: un pago con correoComprador='reclamado' (reintento en curso) SI es candidato", () => {
  assert.equal(esCandidatoBarridoAcuse({ correoComprador: "reclamado", revertido: false }), true);
});

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
    avisoAcuse20h: null,
    avisoAcuse48h: null,
    ...overrides,
  };
}

test("datosReintentoDesdePago: usa uidRespaldo si el pago no trae uid propio", () => {
  const d = datosReintentoDesdePago(pagoFalso({ uid: null }), "uid-respaldo");
  assert.equal(d.uid, "uid-respaldo");
});

test("datosReintentoDesdePago: propaga 'revertido'", () => {
  const d = datosReintentoDesdePago(pagoFalso({ revertido: true }));
  assert.equal(d.revertido, true);
});

// ── barrerTodosLosPagosPendientes (barrido completo paginado para el endpoint de tareas) ───────

function docCrudo(id: string, overrides: Record<string, any> = {}) {
  return {
    id,
    data: {
      uid: "uid-1",
      referenciaId: "ref-1",
      cop: 49102,
      trm: 3273.49,
      fechaTrm: "2026-10-03",
      fecha: Timestamp.now(),
      vence: Timestamp.now(),
      correoComprador: null,
      ...overrides,
    },
  };
}

test("barrerTodosLosPagosPendientes recorre varias paginas hasta que una sale vacia", async () => {
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
  });

  assert.deepEqual(cursoresPedidos, [null, "cursor-1", "cursor-2"]);
  assert.deepEqual(reintentados, ["p1", "p2", "p3"]);
  assert.equal(resultado.paginas, 3);
  assert.equal(resultado.revisados, 3);
  assert.equal(resultado.reintentados, 3);
});

test("barrerTodosLosPagosPendientes se detiene si no hay cursorSiguiente aunque la pagina no este vacia", async () => {
  let llamadas = 0;
  const resultado = await barrerTodosLosPagosPendientes({
    obtenerPagina: async () => {
      llamadas++;
      return { docs: [docCrudo("p1")], cursorSiguiente: null };
    },
    reintentar: async () => {},
  });
  assert.equal(llamadas, 1, "sin cursorSiguiente, no debe pedir una segunda pagina");
  assert.equal(resultado.paginas, 1);
});

test("barrerTodosLosPagosPendientes respeta maxPaginas aunque el cursor siga disponible", async () => {
  let llamadas = 0;
  const resultado = await barrerTodosLosPagosPendientes(
    {
      obtenerPagina: async () => {
        llamadas++;
        return { docs: [docCrudo(`p${llamadas}`)], cursorSiguiente: `cursor-${llamadas}` };
      },
      reintentar: async () => {},
    },
    100,
    3 // maxPaginas de prueba
  );
  assert.equal(llamadas, 3, "nunca debe pedir mas paginas que maxPaginas");
  assert.equal(resultado.paginas, 3);
});

test("barrerTodosLosPagosPendientes salta un pago revertido con correoComprador null (no se reintenta)", async () => {
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
  });
  assert.deepEqual(reintentados, ["normal"], "el pago revertido no debe reintentarse");
  assert.equal(resultado.revisados, 2, "pero SI se cuenta como revisado");
});

test("barrerTodosLosPagosPendientes salta correoComprador='enviado' y candidatos sin uid guardado", async () => {
  const reintentados: string[] = [];
  const resultado = await barrerTodosLosPagosPendientes({
    obtenerPagina: async (cursor) => {
      if (cursor) return { docs: [], cursorSiguiente: null };
      return {
        docs: [
          docCrudo("ya-enviado", { correoComprador: "enviado" }),
          docCrudo("sin-uid", { uid: null }),
          docCrudo("elegible"),
        ],
        cursorSiguiente: "c1",
      };
    },
    reintentar: async (datos) => {
      reintentados.push(datos.paymentId);
    },
  });
  assert.deepEqual(reintentados, ["elegible"]);
  assert.equal(resultado.revisados, 3);
});

test("barrerTodosLosPagosPendientes: la decision de reintentar/alertar/abandonar por antiguedad NO vive aqui — reintentar siempre se llama (incluso a las 48h)", async () => {
  // Este modulo no mira la antiguedad del pago en absoluto: la decision de 20h/48h vive dentro de
  // `reintentar` (reintentarAcusePendiente real, server/notificaciones.ts). Aqui solo se prueba
  // que el candidato (ni revertido ni enviado) SIEMPRE se le pasa a `reintentar`, sin filtro de
  // tiempo propio.
  const reintentados: string[] = [];
  await barrerTodosLosPagosPendientes({
    obtenerPagina: async (cursor) => {
      if (cursor) return { docs: [], cursorSiguiente: null };
      const haceCienHoras = Timestamp.fromMillis(Date.now() - 100 * 3600_000);
      return { docs: [docCrudo("viejo", { fecha: haceCienHoras })], cursorSiguiente: null };
    },
    reintentar: async (datos) => {
      reintentados.push(datos.paymentId);
    },
  });
  assert.deepEqual(reintentados, ["viejo"], "se le pasa a reintentar sin importar su antiguedad");
});

// ── manejarBarridoAcusesTarea (el handler del endpoint protegido) ───────────────────────────────
// Oraculo de la orden: sin token -> 401; token de otra SA -> 403; token valido -> ejecuta; si
// `barrer()` lanza -> 500 con log estructurado, nunca un rechazo sin manejar.

test("sin encabezado Authorization -> 401, nunca llama a verificarToken ni a barrer", async () => {
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

test("encabezado Authorization sin 'Bearer ' -> 401", async () => {
  const r = await manejarBarridoAcusesTarea("TokenSinBearer", {
    verificarToken: async () => true,
    barrer: async () => ({ paginas: 0, revisados: 0, reintentados: 0 }),
  });
  assert.equal(r.status, 401);
});

test("token de otra cuenta de servicio (verificarToken->false) -> 403, nunca ejecuta el barrido", async () => {
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

test("token valido (mock del verificador) -> ejecuta el barrido y responde 200 con las estadisticas", async () => {
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

test("si barrer() lanza (p. ej. Firestore sin red a mitad del barrido), responde 500 con log estructurado y nunca deja un rechazo sin manejar", async () => {
  const logs: string[] = [];
  const logOriginal = console.error;
  console.error = (...args: any[]) => logs.push(args.map(String).join(" "));
  try {
    const r = await manejarBarridoAcusesTarea("Bearer token-valido", {
      verificarToken: async () => true,
      barrer: async () => {
        throw new Error("Firestore sin red");
      },
    });
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { error: "Fallo el barrido de acuses pendientes." });
  } finally {
    console.error = logOriginal;
  }
  assert.ok(
    logs.some((l) => l.includes("BARRIDO_ACUSES_FALLO") && l.includes("Firestore sin red")),
    "debe quedar un log estructurado grepable"
  );
});

// ── M-1/M-2 (corrige vuelta 34 del REVISOR_EXTERNO): los logs de alerta son JSON ESTRUCTURADO ──
// con severity="ERROR", message FIJO y sin uid/email/ningun valor con "@" — oraculo explicito de
// la orden: capturar el console.error de cada alerta, hacer JSON.parse y verificar los tres.

function assertLogEstructurado(linea: string, mensajeEsperado: string): Record<string, any> {
  const json = JSON.parse(linea);
  assert.equal(json.severity, "ERROR");
  assert.equal(json.message, mensajeEsperado);
  for (const [clave, valor] of Object.entries(json)) {
    assert.notEqual(clave, "uid", `el log de ${mensajeEsperado} nunca debe llevar uid`);
    assert.notEqual(clave, "email", `el log de ${mensajeEsperado} nunca debe llevar email`);
    if (typeof valor === "string") {
      assert.ok(!valor.includes("@"), `el log de ${mensajeEsperado} tiene un valor con '@' (campo ${clave}: ${valor})`);
    }
  }
  return json;
}

test("BARRIDO_ACUSES_FALLO: log JSON estructurado, severity ERROR, message exacto, sin uid/email/@", async () => {
  const logs = await capturarConsoleError(async () => {
    const r = await manejarBarridoAcusesTarea("Bearer token-valido", {
      verificarToken: async () => true,
      barrer: async () => {
        throw new Error("Firestore sin red");
      },
    });
    assert.equal(r.status, 500);
  });
  const linea = logs.find((l) => l.includes("BARRIDO_ACUSES_FALLO"));
  assert.ok(linea, "debe existir un log de BARRIDO_ACUSES_FALLO");
  assertLogEstructurado(linea!, "BARRIDO_ACUSES_FALLO");
});

test("TAREA_BARRIDO_RECHAZADA (sin token): log JSON estructurado, severity ERROR, message exacto, sin uid/email/@", async () => {
  const logs = await capturarConsoleError(async () => {
    const r = await manejarBarridoAcusesTarea(undefined, {
      verificarToken: async () => true,
      barrer: async () => ({ paginas: 0, revisados: 0, reintentados: 0 }),
    });
    assert.equal(r.status, 401);
  });
  assert.equal(logs.length, 1);
  const json = assertLogEstructurado(logs[0], "TAREA_BARRIDO_RECHAZADA");
  assert.equal(json.motivo, "sin_token");
});

test("TAREA_BARRIDO_RECHAZADA (token invalido): log JSON estructurado, severity ERROR, message exacto, sin uid/email/@", async () => {
  const logs = await capturarConsoleError(async () => {
    const r = await manejarBarridoAcusesTarea("Bearer token-de-otra-sa", {
      verificarToken: async () => false,
      barrer: async () => ({ paginas: 0, revisados: 0, reintentados: 0 }),
    });
    assert.equal(r.status, 403);
  });
  assert.equal(logs.length, 1);
  const json = assertLogEstructurado(logs[0], "TAREA_BARRIDO_RECHAZADA");
  assert.equal(json.motivo, "token_invalido");
});

// ── M-4 (corrige vuelta 34): `registrarRutasTareas` + chequeo de arranque ─────────────────────

test("registrarRutasTareas (app falso): registra POST /api/tareas/barrido-acuses y delega en manejarBarridoAcusesTarea", async () => {
  const rutasRegistradas: Array<{ metodo: string; path: string; handler: Function }> = [];
  const appFalso: AppConRutasTareas = {
    post(path, handler) {
      rutasRegistradas.push({ metodo: "post", path, handler });
    },
  };
  let verificarLlamado = false;
  let barrerLlamado = false;
  registrarRutasTareas(appFalso, {
    verificarToken: async () => {
      verificarLlamado = true;
      return true;
    },
    barrer: async () => {
      barrerLlamado = true;
      return { paginas: 1, revisados: 5, reintentados: 2 };
    },
  });

  assert.equal(rutasRegistradas.length, 1);
  assert.equal(rutasRegistradas[0].path, RUTA_BARRIDO_ACUSES);

  let statusRecibido = 0;
  let bodyRecibido: any = null;
  const resFalso = {
    status(s: number) {
      statusRecibido = s;
      return this;
    },
    json(b: any) {
      bodyRecibido = b;
    },
  };
  await rutasRegistradas[0].handler({ headers: { authorization: "Bearer token-valido" } }, resFalso);

  assert.equal(verificarLlamado, true, "el handler registrado SI debe delegar en manejarBarridoAcusesTarea (verificarToken)");
  assert.equal(barrerLlamado, true, "y en el barrido real al validar el token");
  assert.equal(statusRecibido, 200);
  assert.deepEqual(bodyRecibido, { ok: true, paginas: 1, revisados: 5, reintentados: 2 });
});

test("registrarRutasTareas + verificarRutaTareasRegistrada sobre un Express REAL (sin listen, sin red): la ruta SI queda registrada", () => {
  const app = express();
  registrarRutasTareas(app);
  const logs: string[] = [];
  const registrada = verificarRutaTareasRegistrada(app, (l) => logs.push(l));
  assert.equal(registrada, true);
  assert.equal(logs.length, 0, "si SI quedo registrada, no debe loguear nada");
});

test("verificarRutaTareasRegistrada sobre un Express REAL que NUNCA llamo a registrarRutasTareas: false + log estructurado RUTA_TAREAS_NO_REGISTRADA", () => {
  const app = express(); // deliberadamente sin registrarRutasTareas(app) — simula el mutante "server.ts deja de llamarla".
  const logs: string[] = [];
  const registrada = verificarRutaTareasRegistrada(app, (l) => logs.push(l));
  assert.equal(registrada, false);
  assert.equal(logs.length, 1);
  const json = JSON.parse(logs[0]);
  assert.equal(json.severity, "ERROR");
  assert.equal(json.message, "RUTA_TAREAS_NO_REGISTRADA");
  assert.equal(json.ruta, RUTA_BARRIDO_ACUSES);
});

test("verificarRutaTareasRegistrada: nunca lanza ante un app malformado (defensa, de mejor esfuerzo)", () => {
  const logs: string[] = [];
  const registrada = verificarRutaTareasRegistrada({ _router: "no-es-un-router" }, (l) => logs.push(l));
  assert.equal(registrada, false);
  assert.equal(logs.length, 1);
  assert.equal(JSON.parse(logs[0]).message, "RUTA_TAREAS_NO_REGISTRADA");
});
