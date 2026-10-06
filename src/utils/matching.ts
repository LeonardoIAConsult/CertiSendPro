import { Recipient } from "../types";

// Standard normalization (lowercases, strips accents/diacritics, cleans spacing)
export function normalizeString(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Strip diacritics
    .replace(/\xa0/g, " ") // Convert non-breaking spaces to standard spaces
    .replace(/[^a-z0-9\s]/g, "") // Strip special characters
    .trim()
    .replace(/\s+/g, " "); // Collapse whitespace
}

// Levenshtein distance based similarity ratio [0, 1] plus extreme subset/token Spanish matching
export function calculateSimilarity(s1: string, s2: string): number {
  const norm1 = normalizeString(s1);
  const norm2 = normalizeString(s2);

  if (norm1 === norm2) return 1.0;
  if (!norm1 || !norm2) return 0.0;

  // Stop words and connector particles commonly seen in Spanish names
  const noiseWords = new Set(["de", "del", "la", "las", "los", "y", "el", "da", "do"]);

  const words1Raw = norm1.split(" ");
  const words2Raw = norm2.split(" ");

  // Filter out noisy connectors and single letters to focus on strong name anchors
  const words1 = words1Raw.filter(w => w.length > 1 && !noiseWords.has(w));
  const words2 = words2Raw.filter(w => w.length > 1 && !noiseWords.has(w));

  if (words1.length === 0 || words2.length === 0) {
    return 0.1; // Minimal similarity if names contain only noise
  }

  // Calculate intersection
  const intersection = words1.filter(w => words2.includes(w));
  
  // Token/subset match calculations
  const shorterSet = words1.length < words2.length ? words1 : words2;
  const longerSet = words1.length < words2.length ? words2 : words1;

  const containedWordsCount = shorterSet.filter(w => longerSet.includes(w)).length;
  const isSubset = containedWordsCount === shorterSet.length;

  const subsetScore = intersection.length / Math.max(words1.length, words2.length);

  // If one name is a subset of the other Name (e.g. "Juan Salcedo" inside "Juan Daniel Salcedo Villarreal")
  // and has at least two strong words, boost confidence to make it a safe match!
  let subsetWeight = subsetScore;
  if (isSubset && shorterSet.length >= 2) {
    subsetWeight = Math.max(subsetWeight, 0.85);
  }

  // Classic Levenshtein distance for fuzzy typo tolerance
  const m = norm1.length;
  const n = norm2.length;
  const d: number[][] = [];

  for (let i = 0; i <= m; i++) {
    d[i] = [i];
  }
  for (let j = 0; j <= n; j++) {
    d[0][j] = j;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = norm1[i - 1] === norm2[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1, // deletion
        d[i][j - 1] + 1, // insertion
        d[i - 1][j - 1] + cost // substitution
      );
    }
  }

  const levScore = 1 - d[m][n] / Math.max(m, n);

  // Return the best of either structural token-subset matching or raw spelling likeness
  return Math.max(subsetWeight, levScore);
}

// ── Homonimos y asignacion uno-a-uno (Tarea 15, requisito A.1, 2026-10-06) ──────────────────────
// `findBestRecipient` (abajo) se llamaba independientemente por pagina en varios sitios de
// App.tsx: nunca hacia asignacion uno-a-uno (un destinatario podia quedar emparejado con DOS
// paginas) y nunca detectaba homonimos (dos filas con el mismo nombre normalizado) — con dos
// "Juan Perez" en la hoja, cualquiera de los dos podia terminar con el certificado del otro sin
// ningun aviso. Las dos funciones de abajo arreglan eso usando `originalRowIndex` (id estable de
// cada fila) en vez de comparar por nombre.

/** Devuelve el `originalRowIndex` de TODAS las filas cuyo nombre normalizado se repite en la
 * lista de destinatarios (2 o mas filas con el mismo nombre). Vacio si no hay homonimos. */
export function findHomonymRowIndexes(recipients: Recipient[]): Set<number> {
  const filasPorNombre = new Map<string, number[]>();
  for (const recipient of recipients) {
    const clave = normalizeString(recipient.name);
    const filas = filasPorNombre.get(clave) ?? [];
    filas.push(recipient.originalRowIndex);
    filasPorNombre.set(clave, filas);
  }

  const homonimos = new Set<number>();
  for (const filas of filasPorNombre.values()) {
    if (filas.length > 1) {
      for (const fila of filas) homonimos.add(fila);
    }
  }
  return homonimos;
}

export interface PaginaAEmparejar {
  pageIndex: number;
  extractedName: string;
}

export interface ResultadoAsignacion {
  /** Destinatario asignado a cada pagina (o `null` si ningun candidato llego al umbral). Las
   * paginas que SI estan en `needsReview` tambien aparecen aqui con `null` — nunca con un
   * destinatario a medias. */
  matches: Map<number, { recipient: Recipient; score: number } | null>;
  /** Paginas cuyo mejor candidato disponible es un homonimo: nunca se asignan solas, necesitan
   * revision manual (`handleManualPairing`). */
  needsReview: Set<number>;
}

/**
 * Asigna cada pagina a UN destinatario distinto (uno-a-uno), nunca el mismo destinatario a dos
 * paginas. Algoritmo goloso: genera todos los candidatos pagina×destinatario con similitud >=
 * `threshold`, los ordena de mayor a menor similitud (empate: `originalRowIndex` ascendente para
 * que el resultado sea determinista) y los procesa en ese orden. Para cada candidato, si su
 * pagina o su destinatario ya se resolvieron, se ignora (la pagina ya sigue intentando con su
 * siguiente mejor candidato en una vuelta posterior). Si el destinatario del candidato es un
 * homonimo (ver `findHomonymRowIndexes`), la pagina NUNCA se asigna a ciegas: pasa a
 * `needsReview` y queda resuelta (no vuelve a intentarse con un candidato peor). En cualquier
 * otro caso, se asigna y tanto la pagina como el destinatario quedan consumidos.
 */
export function assignRecipientsOneToOne(
  pages: PaginaAEmparejar[],
  recipients: Recipient[],
  threshold = 0.45
): ResultadoAsignacion {
  const homonimos = findHomonymRowIndexes(recipients);
  const matches = new Map<number, { recipient: Recipient; score: number } | null>();
  for (const page of pages) matches.set(page.pageIndex, null);

  interface Candidato {
    pageIndex: number;
    recipient: Recipient;
    score: number;
  }
  const candidatos: Candidato[] = [];
  for (const page of pages) {
    if (!page.extractedName || page.extractedName === "UNKNOWN") continue;
    for (const recipient of recipients) {
      const score = calculateSimilarity(page.extractedName, recipient.name);
      if (score >= threshold) candidatos.push({ pageIndex: page.pageIndex, recipient, score });
    }
  }
  candidatos.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.recipient.originalRowIndex - b.recipient.originalRowIndex;
  });

  const needsReview = new Set<number>();
  const paginasResueltas = new Set<number>();
  const destinatariosUsados = new Set<number>();

  for (const candidato of candidatos) {
    if (paginasResueltas.has(candidato.pageIndex)) continue;
    if (destinatariosUsados.has(candidato.recipient.originalRowIndex)) continue;

    if (homonimos.has(candidato.recipient.originalRowIndex)) {
      needsReview.add(candidato.pageIndex);
      paginasResueltas.add(candidato.pageIndex);
      continue;
    }

    matches.set(candidato.pageIndex, { recipient: candidato.recipient, score: candidato.score });
    paginasResueltas.add(candidato.pageIndex);
    destinatariosUsados.add(candidato.recipient.originalRowIndex);
  }

  return { matches, needsReview };
}

// Find the absolute best recipient match from list
export function findBestRecipient(
  extractedName: string,
  recipients: Recipient[],
  threshold = 0.45
): { best: Recipient | null; score: number } {
  if (!extractedName || extractedName === "UNKNOWN" || recipients.length === 0) {
    return { best: null, score: 0 };
  }

  let bestMatch: Recipient | null = null;
  let highestScore = 0;

  for (const recipient of recipients) {
    const score = calculateSimilarity(extractedName, recipient.name);
    if (score > highestScore) {
      highestScore = score;
      bestMatch = recipient;
    }
  }

  if (highestScore >= threshold) {
    return { best: bestMatch, score: highestScore };
  }

  return { best: null, score: highestScore };
}

