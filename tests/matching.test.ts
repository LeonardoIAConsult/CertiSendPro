// Pruebas de src/utils/matching.ts: homonimos y asignacion uno-a-uno (Tarea 15, requisito A.1,
// 2026-10-06). node:test puro, sin DOM ni Vite — mismo patron que tests/legalMarkdown.test.ts
// (matching.ts solo importa el tipo `Recipient`, sin dependencias de React ni del navegador).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findHomonymRowIndexes,
  assignRecipientsOneToOne,
  sincronizarEmparejamiento,
  paginaConFilaAsignada,
} from "../src/utils/matching";
import type { Recipient, CertificatePage } from "../src/types";

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

test("assignRecipientsOneToOne: empate EXACTO de score -> gana el originalRowIndex menor (desempate deterministico)", () => {
  // "Juan A" y "Juan B" contra "Juan X": tras filtrar palabras de una sola letra, el unico token
  // fuerte compartido es "juan" en ambos casos -> subsetScore=1.0 para los dos candidatos, empate
  // exacto. El sort de candidatos desempata por `originalRowIndex` ascendente.
  const recipients = [recipient("Juan A", "a@x.com", 5), recipient("Juan B", "b@x.com", 2)];
  const { matches } = assignRecipientsOneToOne([{ pageIndex: 1, extractedName: "Juan X" }], recipients);
  assert.ok(matches.get(1) !== null, "debe haber un candidato asignado (score sobre el umbral)");
  assert.equal(matches.get(1)?.recipient.originalRowIndex, 2, "con empate exacto, debe ganar el menor originalRowIndex (2, no 5)");
});

test("assignRecipientsOneToOne: el homonimo deja la pagina RESUELTA — no cae despues a un candidato mas debil", () => {
  const recipients = [
    recipient("Juan Perez", "juan1@x.com", 0),
    recipient("Juan Perez", "juan2@x.com", 1),
    recipient("Juan Pere", "juanpere@x.com", 9), // candidato valido pero mas debil; NUNCA debe usarse
  ];
  const { matches, needsReview } = assignRecipientsOneToOne([{ pageIndex: 7, extractedName: "Juan Perez" }], recipients);
  assert.equal(needsReview.has(7), true);
  assert.equal(matches.get(7), null, "la pagina queda resuelta en needsReview, nunca cae al candidato mas debil 'Juan Pere'");
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

// ── sincronizarEmparejamiento (Medio 2, correccion vuelta 31, 2026-10-06) ───────────────────────
// Extraida de src/App.tsx como funcion PURA (sin `addLog`, sin React): devuelve `eventos` en vez
// de loguear directamente, para poder probarla con node:test.

function pagina(pageIndex: number, extractedName: string): CertificatePage {
  return { pageIndex, extractedName, base64: "", matchedRecipient: null, status: "idle", errorMessage: null };
}

test("sincronizarEmparejamiento: rama de homonimos -> needsReviewCount+evento 'homonimo', matchedRecipient null", () => {
  const recipients = [
    recipient("Juan Perez", "juan1@x.com", 0),
    recipient("Juan Perez", "juan2@x.com", 1),
  ];
  const paginas = [pagina(1, "Juan Perez")];

  const resultado = sincronizarEmparejamiento(paginas, recipients);

  assert.equal(resultado.needsReviewCount, 1);
  assert.equal(resultado.matchedCount, 0);
  assert.equal(resultado.pages[0].matchedRecipient, null);
  assert.deepEqual(resultado.eventos, [{ tipo: "homonimo", pageIndex: 1, extractedName: "Juan Perez" }]);
});

test("sincronizarEmparejamiento: desempate por mayor similitud -> la pagina con mejor score se queda con el destinatario", () => {
  const recipients = [recipient("Juan Perez", "juan@x.com", 0)];
  const paginas = [
    pagina(1, "Juan Perez"), // match exacto
    pagina(2, "Juana Perez"), // match parcial, menor similitud
  ];

  const resultado = sincronizarEmparejamiento(paginas, recipients);

  assert.equal(resultado.pages.find((p) => p.pageIndex === 1)?.matchedRecipient?.originalRowIndex, 0);
  assert.equal(resultado.pages.find((p) => p.pageIndex === 2)?.matchedRecipient, null);
  const evento2 = resultado.eventos.find((e) => e.pageIndex === 2);
  assert.equal(evento2?.tipo, "sin_coincidencia");
});

test("sincronizarEmparejamiento: invariante -- dos paginas NUNCA quedan con la misma fila", () => {
  const recipients = [recipient("Ana Gomez", "ana@x.com", 7)];
  const paginas = [pagina(1, "Ana Gomez"), pagina(2, "Ana Gomez")]; // dos paginas, el MISMO nombre leido

  const resultado = sincronizarEmparejamiento(paginas, recipients);

  const filasAsignadas = resultado.pages
    .filter((p) => p.matchedRecipient !== null)
    .map((p) => p.matchedRecipient!.originalRowIndex);
  assert.equal(filasAsignadas.length, new Set(filasAsignadas).size, "ninguna fila se repite entre paginas distintas");
  assert.equal(resultado.matchedCount, 1, "solo una de las dos paginas queda emparejada");
});

test("sincronizarEmparejamiento: evento 'coincidencia' trae el nombre del destinatario y el score", () => {
  const recipients = [recipient("Ana Gomez", "ana@x.com", 3)];
  const paginas = [pagina(5, "Ana Gomez")];

  const resultado = sincronizarEmparejamiento(paginas, recipients);

  assert.equal(resultado.matchedCount, 1);
  assert.deepEqual(resultado.eventos, [
    { tipo: "coincidencia", pageIndex: 5, extractedName: "Ana Gomez", recipientName: "Ana Gomez", score: 1 },
  ]);
});

test("sincronizarEmparejamiento: pagina sin nombre extraido (UNKNOWN) -> se deja intacta, sin evento", () => {
  const recipients = [recipient("Ana Gomez", "ana@x.com", 3)];
  const paginas = [pagina(1, "UNKNOWN")];

  const resultado = sincronizarEmparejamiento(paginas, recipients);

  assert.equal(resultado.eventos.length, 0);
  assert.equal(resultado.pages[0].matchedRecipient, null);
});

// ── paginaConFilaAsignada (Medio 2): guardia del emparejamiento MANUAL ──────────────────────────

test("paginaConFilaAsignada: ninguna otra pagina tiene esa fila -> null", () => {
  const pages = [{ ...pagina(1, "Ana"), matchedRecipient: recipient("Ana", "a@x.com", 0) }, pagina(2, "Luis")];
  assert.equal(paginaConFilaAsignada(pages, 2, 9), null);
});

test("paginaConFilaAsignada: OTRA pagina ya tiene esa fila -> la devuelve", () => {
  const pages = [
    { ...pagina(1, "Ana"), matchedRecipient: recipient("Ana", "a@x.com", 5) },
    pagina(2, "Luis"),
  ];
  const otra = paginaConFilaAsignada(pages, 2, 5);
  assert.equal(otra?.pageIndex, 1);
});

test("paginaConFilaAsignada: la MISMA pagina ya tiene esa fila -> null (no es un conflicto consigo misma)", () => {
  const pages = [{ ...pagina(1, "Ana"), matchedRecipient: recipient("Ana", "a@x.com", 5) }];
  assert.equal(paginaConFilaAsignada(pages, 1, 5), null);
});
