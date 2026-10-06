// Pruebas de src/utils/matching.ts: homonimos y asignacion uno-a-uno (Tarea 15, requisito A.1,
// 2026-10-06). node:test puro, sin DOM ni Vite — mismo patron que tests/legalMarkdown.test.ts
// (matching.ts solo importa el tipo `Recipient`, sin dependencias de React ni del navegador).
import { test } from "node:test";
import assert from "node:assert/strict";
import { findHomonymRowIndexes, assignRecipientsOneToOne } from "../src/utils/matching";
import type { Recipient } from "../src/types";

function recipient(name: string, email: string, originalRowIndex: number): Recipient {
  return { name, email, originalRowIndex };
}

// ── findHomonymRowIndexes ────────────────────────────────────────────────────────────────────

test("findHomonymRowIndexes: sin nombres repetidos, conjunto vacio", () => {
  const recipients = [recipient("Juan Perez", "juan@x.com", 0), recipient("Ana Gomez", "ana@x.com", 1)];
  assert.deepEqual(findHomonymRowIndexes(recipients), new Set());
});

test("findHomonymRowIndexes: dos filas con el mismo nombre -> las dos quedan marcadas", () => {
  const recipients = [
    recipient("Juan Perez", "juan1@x.com", 0),
    recipient("Ana Gomez", "ana@x.com", 1),
    recipient("Juan Perez", "juan2@x.com", 2),
  ];
  assert.deepEqual(findHomonymRowIndexes(recipients), new Set([0, 2]));
});

test("findHomonymRowIndexes: compara el nombre NORMALIZADO (acentos/mayusculas no distinguen)", () => {
  const recipients = [recipient("José Pérez", "a@x.com", 0), recipient("jose perez", "b@x.com", 1)];
  assert.deepEqual(findHomonymRowIndexes(recipients), new Set([0, 1]));
});

test("findHomonymRowIndexes: tres filas con el mismo nombre -> las tres quedan marcadas", () => {
  const recipients = [
    recipient("Juan Perez", "a@x.com", 0),
    recipient("Juan Perez", "b@x.com", 1),
    recipient("Juan Perez", "c@x.com", 2),
  ];
  assert.deepEqual(findHomonymRowIndexes(recipients), new Set([0, 1, 2]));
});

// ── assignRecipientsOneToOne ────────────────────────────────────────────────────────────────

test("assignRecipientsOneToOne: una pagina, un destinatario claro -> se asigna", () => {
  const recipients = [recipient("Juan Perez", "juan@x.com", 0)];
  const { matches, needsReview } = assignRecipientsOneToOne([{ pageIndex: 0, extractedName: "Juan Perez" }], recipients);
  assert.equal(matches.get(0)?.recipient.originalRowIndex, 0);
  assert.equal(needsReview.size, 0);
});

test("assignRecipientsOneToOne: NUNCA asigna el mismo destinatario a dos paginas", () => {
  const recipients = [recipient("Juan Perez", "juan@x.com", 0), recipient("Ana Gomez", "ana@x.com", 1)];
  const pages = [
    { pageIndex: 0, extractedName: "Juan Perez" },
    { pageIndex: 1, extractedName: "Juan Perez" }, // dos paginas "leen" el mismo nombre por error de OCR
  ];
  const { matches } = assignRecipientsOneToOne(pages, recipients);
  const asignados = [matches.get(0)?.recipient.originalRowIndex, matches.get(1)?.recipient.originalRowIndex];
  // Las dos paginas no pueden terminar con originalRowIndex=0 a la vez.
  assert.notEqual(asignados.filter((x) => x === 0).length, 2);
});

test("assignRecipientsOneToOne: destinatario homonimo -> la pagina va a needsReview, nunca se asigna sola", () => {
  const recipients = [recipient("Juan Perez", "juan1@x.com", 0), recipient("Juan Perez", "juan2@x.com", 2)];
  const { matches, needsReview } = assignRecipientsOneToOne([{ pageIndex: 5, extractedName: "Juan Perez" }], recipients);
  assert.equal(needsReview.has(5), true);
  assert.equal(matches.get(5), null);
});

test("assignRecipientsOneToOne: dos paginas con el mismo nombre homonimo -> las DOS van a needsReview", () => {
  const recipients = [recipient("Juan Perez", "juan1@x.com", 0), recipient("Juan Perez", "juan2@x.com", 2)];
  const pages = [
    { pageIndex: 0, extractedName: "Juan Perez" },
    { pageIndex: 1, extractedName: "Juan Perez" },
  ];
  const { matches, needsReview } = assignRecipientsOneToOne(pages, recipients);
  assert.equal(needsReview.has(0), true);
  assert.equal(needsReview.has(1), true);
  assert.equal(matches.get(0), null);
  assert.equal(matches.get(1), null);
});

test("assignRecipientsOneToOne: un homonimo no bloquea a los demas destinatarios no homonimos", () => {
  const recipients = [
    recipient("Juan Perez", "juan1@x.com", 0),
    recipient("Juan Perez", "juan2@x.com", 1),
    recipient("Ana Gomez", "ana@x.com", 2),
  ];
  const pages = [
    { pageIndex: 0, extractedName: "Juan Perez" },
    { pageIndex: 1, extractedName: "Ana Gomez" },
  ];
  const { matches, needsReview } = assignRecipientsOneToOne(pages, recipients);
  assert.equal(needsReview.has(0), true);
  assert.equal(matches.get(1)?.recipient.originalRowIndex, 2);
});

test("assignRecipientsOneToOne: sin candidato sobre el umbral -> null, sin needsReview", () => {
  const recipients = [recipient("Juan Perez", "juan@x.com", 0)];
  const { matches, needsReview } = assignRecipientsOneToOne([{ pageIndex: 0, extractedName: "Zzz Qqq Completamente Distinto" }], recipients);
  assert.equal(matches.get(0), null);
  assert.equal(needsReview.has(0), false);
});

test("assignRecipientsOneToOne: nombre UNKNOWN -> null, nunca intenta emparejar", () => {
  const recipients = [recipient("Juan Perez", "juan@x.com", 0)];
  const { matches } = assignRecipientsOneToOne([{ pageIndex: 0, extractedName: "UNKNOWN" }], recipients);
  assert.equal(matches.get(0), null);
});

test("assignRecipientsOneToOne: si el mejor candidato de una pagina ya fue tomado, intenta con el siguiente mejor disponible", () => {
  // Dos paginas con nombres MUY parecidos a "Juan Perez" (candidato top de ambas), pero solo una
  // fila con ese nombre exacto; la otra pagina debe caer en su segundo mejor candidato real.
  const recipients = [recipient("Juan Perez", "juan@x.com", 0), recipient("Juana Perez", "juana@x.com", 1)];
  const pages = [
    { pageIndex: 0, extractedName: "Juan Perez" }, // match perfecto con la fila 0
    { pageIndex: 1, extractedName: "Juana Perez" }, // match perfecto con la fila 1
  ];
  const { matches } = assignRecipientsOneToOne(pages, recipients);
  assert.equal(matches.get(0)?.recipient.originalRowIndex, 0);
  assert.equal(matches.get(1)?.recipient.originalRowIndex, 1);
});
