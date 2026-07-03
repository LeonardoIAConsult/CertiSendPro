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

