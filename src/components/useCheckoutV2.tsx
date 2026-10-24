import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Loader2, X } from "lucide-react";
import { translations } from "../utils/translations";
import { getIdToken } from "../firebaseAuth";
import {
  puedePagar,
  interpretarRespuestaCobro,
  textoTerminos,
  textoRetracto,
  textoRetractoPorUso,
  esInitPointMercadoPagoValido,
  cantidadPorUsoValida,
  clampCantidadPorUso,
  calcularTotalPorUso,
  PORUSO_PASO_BOTONES,
} from "../utils/checkout";

/**
 * Checkout de la landing V2 (copia AISLADA del de LandingPage.tsx, decision de Leonardo
 * 2026-10-24: la original no se toca). La logica y los textos son los mismos que la original —
 * mismas funciones de src/utils/checkout.ts, mismos endpoints (GET /api/precios y POST
 * /api/mercadopago/create-preference), mismo orden de validaciones (R8: si el precio cambia, se
 * muestra el nuevo y se exigen las dos casillas de nuevo). Cuando V2 reemplace a la original, este
 * archivo es el unico checkout y el de LandingPage.tsx se borra. No cambiar uno sin el otro.
 */
export interface PreciosDelDia {
  paquete: { usd: number; cop: number };
  porUso: { usdUnidad: number; minimo: number; maximo: number; copPorUnidadReferencia: number };
  trm: number;
  fechaDesde: string;
  pagosActivos: boolean;
}

interface Opts {
  language: "es" | "en";
  theme: "light" | "dark";
  onStart: () => void;
  /** Las dos casillas de la portada (T11 + Terminos) estan marcadas. */
  puedeEntrar: boolean;
  /** Sin sesion y sin casillas: lleva al usuario a marcarlas (scroll + resaltado). */
  onNeedConsent: () => void;
}

export function useCheckoutV2({ language, theme, onStart, puedeEntrar, onNeedConsent }: Opts) {
  const t = translations[language];
  const loc = language === "en" ? "en-US" : "es-CO";

  const [precios, setPrecios] = useState<PreciosDelDia | null>(null);
  const [preciosFallo, setPreciosFallo] = useState(false);
  useEffect(() => {
    let cancelado = false;
    fetch("/api/precios")
      .then(async (res) => {
        if (cancelado) return;
        if (!res.ok) {
          setPreciosFallo(true);
          return;
        }
        const data = await res.json();
        if (cancelado) return;
        // Respuesta mal formada: no mostrar montos con NaN/undefined (el servidor igual revalida el cobro).
        const nums = [data?.paquete?.usd, data?.paquete?.cop, data?.porUso?.usdUnidad, data?.porUso?.minimo, data?.porUso?.maximo, data?.porUso?.copPorUnidadReferencia, data?.trm];
        if (!nums.every((n) => typeof n === "number" && Number.isFinite(n)) || typeof data.fechaDesde !== "string") {
          setPreciosFallo(true);
          return;
        }
        setPrecios({
          paquete: { usd: data.paquete.usd, cop: data.paquete.cop },
          porUso: {
            usdUnidad: data.porUso.usdUnidad,
            minimo: data.porUso.minimo,
            maximo: data.porUso.maximo,
            copPorUnidadReferencia: data.porUso.copPorUnidadReferencia,
          },
          trm: data.trm,
          fechaDesde: data.fechaDesde,
          pagosActivos: data.pagosActivos === true,
        });
      })
      .catch(() => {
        if (!cancelado) setPreciosFallo(true);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  // ── Paquete ──────────────────────────────────────────────────────────────────────────────
  const [panelAbierto, setPanelAbierto] = useState(false);
  const [copActual, setCopActual] = useState<number | null>(null);
  const [aceptaTerminos, setAceptaTerminos] = useState(false);
  const [aceptaRetracto, setAceptaRetracto] = useState(false);
  const [pagando, setPagando] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [precioCambio, setPrecioCambio] = useState<{ anterior: number; nuevo: number } | null>(null);

  const abrirPanelPaquete = () => {
    if (!precios) return;
    setCopActual(precios.paquete.cop);
    setAceptaTerminos(false);
    setAceptaRetracto(false);
    setPanelError(null);
    setPrecioCambio(null);
    setPanelAbierto(true);
  };

  const handlePagarPaquete = async () => {
    if (!precios || copActual === null || !puedePagar(aceptaTerminos, aceptaRetracto)) return;
    setPagando(true);
    setPanelError(null);
    try {
      const idToken = await getIdToken();
      if (!idToken) {
        setPagando(false);
        if (!puedeEntrar) {
          setPanelAbierto(false);
          onNeedConsent();
          return;
        }
        onStart();
        return;
      }
      const res = await fetch("/api/mercadopago/create-preference", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          plan: "paquete",
          aceptaTerminos: true,
          aceptaRetracto: true,
          copMostrado: copActual,
          idioma: language,
          modalidad: "unico",
        }),
      });
      const body = await res.json().catch(() => ({}));
      const resultado = interpretarRespuestaCobro(res.status, body);
      if (resultado.tipo === "ok") {
        if (!esInitPointMercadoPagoValido(resultado.initPoint)) {
          console.error("[CHECKOUT] initPoint fuera de dominio, no se redirige:", resultado.initPoint);
          setPanelError(t.checkoutErrorGenerico);
          setPagando(false);
          return;
        }
        window.location.href = resultado.initPoint;
        return;
      }
      if (resultado.tipo === "precio_cambio") {
        setPrecioCambio({ anterior: copActual, nuevo: resultado.copNuevo });
        setCopActual(resultado.copNuevo);
        setAceptaTerminos(false);
        setAceptaRetracto(false);
        setPagando(false);
        return;
      }
      setPanelError(resultado.mensaje);
      setPagando(false);
    } catch (err: any) {
      setPanelError(err?.message || t.checkoutErrorGenerico);
      setPagando(false);
    }
  };

  // Compra por contacto (cuando PAGOS_ACTIVOS esta apagado en el servidor).
  const contactarPlan = (planName: string, precioMostrado: number) => {
    const asunto = `CertiSend: ${planName}`;
    const cuerpo = language === "en"
      ? `Hi, I'm interested in ${planName} (US$${precioMostrado}). `
      : `Hola, me interesa ${planName} (US$${precioMostrado}). `;
    window.location.href = `mailto:contacto@leonardoantolinez.com?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
  };

  // ── Pago por uso ─────────────────────────────────────────────────────────────────────────
  const [panelPorUsoAbierto, setPanelPorUsoAbierto] = useState(false);
  const [cantidadPorUso, setCantidadPorUso] = useState(50);
  const [copPorUsoOverride, setCopPorUsoOverride] = useState<number | null>(null);
  const [aceptaTerminosPorUso, setAceptaTerminosPorUso] = useState(false);
  const [aceptaRetractoPorUso, setAceptaRetractoPorUso] = useState(false);
  const [pagandoPorUso, setPagandoPorUso] = useState(false);
  const [panelPorUsoError, setPanelPorUsoError] = useState<string | null>(null);
  const [precioCambioPorUso, setPrecioCambioPorUso] = useState<{ anterior: number; nuevo: number } | null>(null);

  const totalPorUsoVivo = precios ? calcularTotalPorUso(cantidadPorUso, precios.trm, precios.porUso.usdUnidad) : null;
  const copPorUsoMostrado = copPorUsoOverride ?? totalPorUsoVivo?.cop ?? null;
  const cantidadPorUsoOk = precios ? cantidadPorUsoValida(cantidadPorUso, precios.porUso.minimo, precios.porUso.maximo) : false;

  const abrirPanelPorUso = () => {
    if (!precios) return;
    setCantidadPorUso(precios.porUso.minimo);
    setCopPorUsoOverride(null);
    setAceptaTerminosPorUso(false);
    setAceptaRetractoPorUso(false);
    setPanelPorUsoError(null);
    setPrecioCambioPorUso(null);
    setPanelPorUsoAbierto(true);
  };

  const cambiarCantidadPorUso = (nueva: number) => {
    if (!precios) return;
    setCantidadPorUso(clampCantidadPorUso(nueva, precios.porUso.minimo, precios.porUso.maximo));
    setCopPorUsoOverride(null);
  };

  const handlePagarPorUso = async () => {
    if (!precios || copPorUsoMostrado === null || !cantidadPorUsoOk || !puedePagar(aceptaTerminosPorUso, aceptaRetractoPorUso)) {
      return;
    }
    setPagandoPorUso(true);
    setPanelPorUsoError(null);
    try {
      const idToken = await getIdToken();
      if (!idToken) {
        setPagandoPorUso(false);
        if (!puedeEntrar) {
          setPanelPorUsoAbierto(false);
          onNeedConsent();
          return;
        }
        onStart();
        return;
      }
      const res = await fetch("/api/mercadopago/create-preference", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          plan: "porUso",
          cantidad: cantidadPorUso,
          aceptaTerminos: true,
          aceptaRetracto: true,
          copMostrado: copPorUsoMostrado,
          idioma: language,
          modalidad: "unico",
        }),
      });
      const body = await res.json().catch(() => ({}));
      const resultado = interpretarRespuestaCobro(res.status, body);
      if (resultado.tipo === "ok") {
        if (!esInitPointMercadoPagoValido(resultado.initPoint)) {
          console.error("[CHECKOUT] initPoint fuera de dominio, no se redirige:", resultado.initPoint);
          setPanelPorUsoError(t.checkoutErrorGenerico);
          setPagandoPorUso(false);
          return;
        }
        window.location.href = resultado.initPoint;
        return;
      }
      if (resultado.tipo === "precio_cambio") {
        setPrecioCambioPorUso({ anterior: copPorUsoMostrado, nuevo: resultado.copNuevo });
        setCopPorUsoOverride(resultado.copNuevo);
        setAceptaTerminosPorUso(false);
        setAceptaRetractoPorUso(false);
        setPagandoPorUso(false);
        return;
      }
      setPanelPorUsoError(resultado.mensaje);
      setPagandoPorUso(false);
    } catch (err: any) {
      setPanelPorUsoError(err?.message || t.checkoutErrorGenerico);
      setPagandoPorUso(false);
    }
  };

  // Modales: foco al abrir (y se devuelve al cerrar) y Esc para cerrar (no mientras se paga).
  const dlgRef = useRef<HTMLDivElement>(null);
  const abierto = panelAbierto || panelPorUsoAbierto;
  useEffect(() => {
    if (!abierto) return;
    const prev = document.activeElement as HTMLElement | null;
    const id = setTimeout(() => dlgRef.current?.focus(), 0);
    return () => { clearTimeout(id); prev?.focus?.({ preventScroll: true }); };
  }, [abierto]);
  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (panelAbierto && !pagando) setPanelAbierto(false);
      if (panelPorUsoAbierto && !pagandoPorUso) setPanelPorUsoAbierto(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abierto, panelAbierto, panelPorUsoAbierto, pagando, pagandoPorUso]);

  const dark = theme === "dark";
  const modalCls = `outline-none w-full max-w-md rounded-2xl p-6 space-y-5 border ${dark ? "bg-[#13151F] border-[#222530] text-white" : "bg-white border-gray-200 text-gray-900"}`;
  const stepBtn = `w-9 h-9 rounded-lg font-bold text-sm shrink-0 ${dark ? "bg-[#222530] hover:bg-[#2F3345] text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-800"}`;

  const panels = (
    <>
      <AnimatePresence>
        {panelAbierto && precios && copActual !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => !pagando && setPanelAbierto(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              onClick={(e) => e.stopPropagation()}
              className={modalCls}
              role="dialog"
              aria-modal="true"
              aria-labelledby="ck-title"
              tabIndex={-1}
              ref={dlgRef}
            >
              <div className="flex items-center justify-between">
                <h3 id="ck-title" className="font-extrabold text-lg">{t.checkoutPaqueteTitle}</h3>
                <button onClick={() => !pagando && setPanelAbierto(false)} className="text-slate-400 hover:text-rose-400 p-1" aria-label={t.checkoutCerrar}>
                  <X className="w-4 h-4" />
                </button>
              </div>

              {precioCambio && (
                <div className="text-xs rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-500 p-3 leading-relaxed">
                  {t.checkoutPrecioCambio
                    .replace("{anterior}", precioCambio.anterior.toLocaleString(loc))
                    .replace("{nuevo}", precioCambio.nuevo.toLocaleString(loc))}
                </div>
              )}

              <div className="space-y-1">
                <p className="text-3xl font-black text-indigo-500">
                  {language === "en" ? "COP " : "$"}
                  {copActual.toLocaleString(loc)}
                  {language === "es" ? " COP" : ""}
                </p>
                <p className="text-[11px] text-slate-500">
                  {t.checkoutReferencia.replace("{usd}", String(precios.paquete.usd))} ·{" "}
                  {t.checkoutTrmNota.replace("{trm}", String(precios.trm)).replace("{fecha}", precios.fechaDesde)}
                </p>
              </div>

              <div className="space-y-1.5 text-[11px] leading-relaxed">
                <p className="font-semibold text-emerald-600 dark:text-emerald-400">{t.checkoutPrecioTotalSinCargos}</p>
                <p className="text-slate-500">{t.checkoutPagoUnicoNota}</p>
                <p className="text-amber-600 dark:text-amber-400">{t.checkoutVencimientoNota}</p>
                <p className="text-slate-500">{t.checkoutMercadoPagoNota}</p>
              </div>

              <label className="flex items-start gap-2.5 text-[11px] leading-relaxed cursor-pointer">
                <input type="checkbox" checked={aceptaTerminos} onChange={(e) => setAceptaTerminos(e.target.checked)} className="mt-0.5 accent-indigo-500 shrink-0" />
                <span>
                  {textoTerminos(copActual, language)}{" "}
                  <a href="/terminos" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline font-semibold" onClick={(e) => e.stopPropagation()}>
                    {t.checkoutVerTerminos}
                  </a>
                </span>
              </label>

              <label className="flex items-start gap-2.5 text-[11px] leading-relaxed cursor-pointer">
                <input type="checkbox" checked={aceptaRetracto} onChange={(e) => setAceptaRetracto(e.target.checked)} className="mt-0.5 accent-indigo-500 shrink-0" />
                <span>{textoRetracto(language)}</span>
              </label>

              {panelError && <p className="text-xs text-rose-400 font-semibold">{panelError}</p>}

              <button
                onClick={handlePagarPaquete}
                disabled={!puedePagar(aceptaTerminos, aceptaRetracto) || pagando}
                className="w-full py-3 rounded-xl font-extrabold text-xs bg-gradient-to-r from-[#2563EB] to-[#8B5CF6] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-95 transition-all shadow-md shadow-indigo-500/30 flex items-center justify-center gap-2"
              >
                {pagando ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>{t.checkoutPagar}</span>}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {panelPorUsoAbierto && precios && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => !pagandoPorUso && setPanelPorUsoAbierto(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96 }}
              onClick={(e) => e.stopPropagation()}
              className={modalCls}
              role="dialog"
              aria-modal="true"
              aria-labelledby="ck-title"
              tabIndex={-1}
              ref={dlgRef}
            >
              <div className="flex items-center justify-between">
                <h3 id="ck-title" className="font-extrabold text-lg">{t.checkoutPorUsoTitle}</h3>
                <button onClick={() => !pagandoPorUso && setPanelPorUsoAbierto(false)} className="text-slate-400 hover:text-rose-400 p-1" aria-label={t.checkoutCerrar}>
                  <X className="w-4 h-4" />
                </button>
              </div>

              {precioCambioPorUso && (
                <div className="text-xs rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-500 p-3 leading-relaxed">
                  {t.checkoutPrecioCambio
                    .replace("{anterior}", precioCambioPorUso.anterior.toLocaleString(loc))
                    .replace("{nuevo}", precioCambioPorUso.nuevo.toLocaleString(loc))}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-500">{t.checkoutCantidadLabel}</label>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => cambiarCantidadPorUso(cantidadPorUso - PORUSO_PASO_BOTONES)} disabled={pagandoPorUso} aria-label="-10" className={stepBtn}>
                    −10
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={precios.porUso.minimo}
                    max={precios.porUso.maximo}
                    step={1}
                    value={cantidadPorUso}
                    disabled={pagandoPorUso}
                    onChange={(e) => {
                      const valor = Number(e.target.value);
                      setCantidadPorUso(Number.isFinite(valor) ? valor : precios.porUso.minimo);
                      setCopPorUsoOverride(null);
                    }}
                    className={`flex-1 text-center font-bold text-sm rounded-lg px-3 py-2 border ${dark ? "bg-[#0B0C10] border-[#222530] text-white" : "bg-white border-gray-200 text-gray-900"}`}
                  />
                  <button type="button" onClick={() => cambiarCantidadPorUso(cantidadPorUso + PORUSO_PASO_BOTONES)} disabled={pagandoPorUso} aria-label="+10" className={stepBtn}>
                    +10
                  </button>
                </div>
                {!cantidadPorUsoOk && (
                  <p className="text-xs text-rose-400 font-semibold">
                    {t.checkoutCantidadInvalida.replace("{minimo}", String(precios.porUso.minimo)).replace("{maximo}", String(precios.porUso.maximo))}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <p className="text-3xl font-black text-indigo-500">
                  {copPorUsoMostrado !== null
                    ? language === "en"
                      ? `COP ${copPorUsoMostrado.toLocaleString("en-US")}`
                      : `$${copPorUsoMostrado.toLocaleString("es-CO")} COP`
                    : "—"}
                </p>
                <p className="text-[11px] text-slate-500">
                  {totalPorUsoVivo && t.checkoutPorUsoTotalUsd.replace("{usd}", totalPorUsoVivo.usd.toFixed(2))} ·{" "}
                  {t.checkoutTrmNota.replace("{trm}", String(precios.trm)).replace("{fecha}", precios.fechaDesde)}
                </p>
              </div>

              <div className="space-y-1.5 text-[11px] leading-relaxed">
                <p className="font-semibold text-emerald-600 dark:text-emerald-400">{t.checkoutPrecioTotalSinCargos}</p>
                <p className="text-slate-500">{t.checkoutPagoUnicoNota}</p>
                <p className="text-amber-600 dark:text-amber-400">{t.checkoutSaldoNoVenceNota}</p>
                <p className="text-slate-500">{t.checkoutMercadoPagoNota}</p>
              </div>

              <label className="flex items-start gap-2.5 text-[11px] leading-relaxed cursor-pointer">
                <input type="checkbox" checked={aceptaTerminosPorUso} onChange={(e) => setAceptaTerminosPorUso(e.target.checked)} className="mt-0.5 accent-indigo-500 shrink-0" />
                <span>
                  {copPorUsoMostrado !== null ? textoTerminos(copPorUsoMostrado, language) : ""}{" "}
                  <a href="/terminos" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline font-semibold" onClick={(e) => e.stopPropagation()}>
                    {t.checkoutVerTerminos}
                  </a>
                </span>
              </label>

              <label className="flex items-start gap-2.5 text-[11px] leading-relaxed cursor-pointer">
                <input type="checkbox" checked={aceptaRetractoPorUso} onChange={(e) => setAceptaRetractoPorUso(e.target.checked)} className="mt-0.5 accent-indigo-500 shrink-0" />
                <span>{textoRetractoPorUso(language)}</span>
              </label>

              {panelPorUsoError && <p className="text-xs text-rose-400 font-semibold">{panelPorUsoError}</p>}

              <button
                onClick={handlePagarPorUso}
                disabled={!cantidadPorUsoOk || !puedePagar(aceptaTerminosPorUso, aceptaRetractoPorUso) || pagandoPorUso}
                className="w-full py-3 rounded-xl font-extrabold text-xs bg-gradient-to-r from-[#2563EB] to-[#8B5CF6] text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-95 transition-all shadow-md shadow-indigo-500/30 flex items-center justify-center gap-2"
              >
                {pagandoPorUso ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>{t.checkoutPagar}</span>}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  return { precios, preciosFallo, abrirPanelPaquete, abrirPanelPorUso, contactarPlan, panels };
}
