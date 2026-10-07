// Pruebas de src/utils/translations.ts (Paso 16B, 2026-10-07): "Pro" desaparece de todo lo
// vendible (decision de Leonardo 2026-10-06) y por lo tanto de la UI — esta prueba falla si
// alguien vuelve a introducir una clave o un texto visible de "Plan Pro" (aunque sea sin querer,
// p. ej. copiando y pegando una tarjeta vieja). node:test, sin React ni red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { translations, type Lang } from "../src/utils/translations";

const IDIOMAS: Lang[] = ["es", "en"];

test('Pro ya no existe como CLAVE en ningun idioma (planPro*, miPlanPro, proContactar, proximamenteBadge)', () => {
  for (const lang of IDIOMAS) {
    const dict = translations[lang] as unknown as Record<string, unknown>;
    for (const key of Object.keys(dict)) {
      assert.doesNotMatch(key, /planPro\b|miPlanPro\b|^proContactar$|^proximamenteBadge$/i, `${lang}: clave viva de Pro encontrada: ${key}`);
    }
  }
});

test('Pro ya no aparece como TEXTO VISIBLE ("Plan Pro"/"Pro Plan") en ningun idioma', () => {
  for (const lang of IDIOMAS) {
    const dict = translations[lang] as unknown as Record<string, string>;
    for (const [key, value] of Object.entries(dict)) {
      if (typeof value !== "string") continue;
      assert.doesNotMatch(value, /\bplan pro\b/i, `${lang}.${key} todavia menciona "Plan Pro": "${value}"`);
      assert.doesNotMatch(value, /\bpro plan\b/i, `${lang}.${key} todavia menciona "Pro Plan": "${value}"`);
    }
  }
});

test("Pago por uso SI existe como clave, en los dos idiomas, con texto no vacio", () => {
  for (const lang of IDIOMAS) {
    const dict = translations[lang];
    assert.ok(dict.planPagoPorUsoName && dict.planPagoPorUsoName.length > 0);
    assert.ok(dict.planPagoPorUsoUsdGrande && dict.planPagoPorUsoUsdGrande.length > 0);
    assert.ok(dict.miPlanSaldoPorUso && dict.miPlanSaldoPorUso.includes("{saldo}"));
  }
});

test("batchLimitSaldo menciona las dos fuentes de saldo (Paquete y Pago por uso), en los dos idiomas", () => {
  assert.match(translations.es.batchLimitSaldo, /\{paquete\}/);
  assert.match(translations.es.batchLimitSaldo, /\{porUso\}/);
  assert.match(translations.es.batchLimitSaldo, /\{total\}/);
  assert.match(translations.en.batchLimitSaldo, /\{paquete\}/);
  assert.match(translations.en.batchLimitSaldo, /\{porUso\}/);
  assert.match(translations.en.batchLimitSaldo, /\{total\}/);
});
