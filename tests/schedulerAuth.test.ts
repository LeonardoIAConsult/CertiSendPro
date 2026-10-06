// Pruebas de la verificacion de tokens OIDC de Cloud Scheduler (G2, correccion NO-GO vuelta 30,
// 2026-10-05). `fetchLike` inyectado, sin red real: simula la respuesta de
// `https://oauth2.googleapis.com/tokeninfo`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { verificarTokenScheduler, type FetchLike } from "../server/schedulerAuth";

const SA_EMAIL = "scheduler@mi-proyecto.iam.gserviceaccount.com";
const AUDIENCE = "https://certisend-xxxx-uc.a.run.app/api/tareas/barrido-acuses";

function fetchOk(cuerpo: Record<string, any>): FetchLike {
  return async () => ({ ok: true, status: 200, text: async () => JSON.stringify(cuerpo) });
}

function fetchError(status: number): FetchLike {
  return async () => ({ ok: false, status, text: async () => "" });
}

const logsCapturados: string[] = [];
function logMudo(linea: string) {
  logsCapturados.push(linea);
}

test("sin SCHEDULER_SA_EMAIL/SCHEDULER_AUDIENCE configurados, rechaza cualquier token", async () => {
  const ok = await verificarTokenScheduler("cualquier-token", {
    schedulerSaEmail: undefined,
    schedulerAudience: undefined,
    log: logMudo,
  });
  assert.equal(ok, false);
});

test("token con email y audiencia correctos -> true", async () => {
  const ok = await verificarTokenScheduler("token-valido", {
    schedulerSaEmail: SA_EMAIL,
    schedulerAudience: AUDIENCE,
    fetchLike: fetchOk({ email: SA_EMAIL, email_verified: "true", aud: AUDIENCE }),
    log: logMudo,
  });
  assert.equal(ok, true);
});

test("token de OTRA cuenta de servicio -> false (403 en el handler)", async () => {
  const ok = await verificarTokenScheduler("token-otra-sa", {
    schedulerSaEmail: SA_EMAIL,
    schedulerAudience: AUDIENCE,
    fetchLike: fetchOk({ email: "otra-cuenta@otro-proyecto.iam.gserviceaccount.com", email_verified: "true", aud: AUDIENCE }),
    log: logMudo,
  });
  assert.equal(ok, false);
});

test("token con audiencia DISTINTA (otro servicio) -> false", async () => {
  const ok = await verificarTokenScheduler("token-otra-audiencia", {
    schedulerSaEmail: SA_EMAIL,
    schedulerAudience: AUDIENCE,
    fetchLike: fetchOk({ email: SA_EMAIL, email_verified: "true", aud: "https://otro-servicio.a.run.app" }),
    log: logMudo,
  });
  assert.equal(ok, false);
});

test("email_verified !== 'true' (string) -> false", async () => {
  const ok = await verificarTokenScheduler("token-sin-verificar", {
    schedulerSaEmail: SA_EMAIL,
    schedulerAudience: AUDIENCE,
    fetchLike: fetchOk({ email: SA_EMAIL, email_verified: false, aud: AUDIENCE }),
    log: logMudo,
  });
  assert.equal(ok, false);
});

test("tokeninfo responde no-ok (token invalido/expirado) -> false", async () => {
  const ok = await verificarTokenScheduler("token-expirado", {
    schedulerSaEmail: SA_EMAIL,
    schedulerAudience: AUDIENCE,
    fetchLike: fetchError(400),
    log: logMudo,
  });
  assert.equal(ok, false);
});

test("fetch lanza (red caida/timeout) -> false, nunca lanza", async () => {
  const ok = await verificarTokenScheduler("token-cualquiera", {
    schedulerSaEmail: SA_EMAIL,
    schedulerAudience: AUDIENCE,
    fetchLike: async () => {
      throw new Error("red caida");
    },
    log: logMudo,
  });
  assert.equal(ok, false);
});

test("idToken vacio -> false sin llamar a fetch", async () => {
  let llamado = false;
  const ok = await verificarTokenScheduler("", {
    schedulerSaEmail: SA_EMAIL,
    schedulerAudience: AUDIENCE,
    fetchLike: async () => {
      llamado = true;
      return { ok: true, status: 200, text: async () => "{}" };
    },
    log: logMudo,
  });
  assert.equal(ok, false);
  assert.equal(llamado, false);
});

test("el log nunca incluye el token completo", async () => {
  logsCapturados.length = 0;
  await verificarTokenScheduler("token-secreto-xyz", {
    schedulerSaEmail: SA_EMAIL,
    schedulerAudience: AUDIENCE,
    fetchLike: fetchError(401),
    log: logMudo,
  });
  for (const l of logsCapturados) {
    assert.ok(!l.includes("token-secreto-xyz"), "el log nunca debe incluir el token");
  }
});
