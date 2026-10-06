import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Sparkles,
  ShieldCheck,
  Zap,
  ArrowRight,
  HelpCircle,
  DollarSign,
  Check,
  Layers,
  ChevronDown,
  Lock,
  Globe,
  Sun,
  Moon,
  Coins,
  Send,
  Loader2,
  X
} from "lucide-react";
import { LogoMark, AnimatedGlyph } from "./BrandLogo";
import { translations, TranslationDict } from "../utils/translations";
import { getIdToken } from "../firebaseAuth";
import {
  puedePagar,
  interpretarRespuestaCobro,
  textoTerminos,
  textoRetracto,
  esInitPointMercadoPagoValido,
} from "../utils/checkout";

/** Lo que necesita el panel de checkout del Paquete, de GET /api/precios (M30, corrige vuelta
 * 24): `pagosActivos` es lo UNICO que le dice al cliente si create-preference esta encendido —
 * `PAGOS_ACTIVOS` es una variable de SERVIDOR, nunca llega al bundle de Vite. */
interface PreciosDelDia {
  cop: number;
  usd: number;
  trm: number;
  fechaDesde: string;
  pagosActivos: boolean;
}

interface LandingPageProps {
  language: "es" | "en";
  setLanguage: (lang: "es" | "en") => void;
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  onStart: () => void;
  onViewPrivacy: () => void;
  onViewTerminos: () => void;
  isLoggingIn: boolean;
  /** GRAVE 3(c) (correccion vuelta 31, 2026-10-06): texto T11 (autorizacion de tratamiento de
   * datos, Ley 1581) y el estado de su casilla, ANTES del boton de login — vive en App.tsx (la
   * misma casilla sirve despues para el POST inmediato a /api/autorizacion-datos tras un login
   * exitoso, ver `handleLogin`). Todos los botones que llaman a `onStart` quedan deshabilitados
   * hasta marcarla. */
  textoAutorizacionDatos: string;
  aceptaAutorizacionDatos: boolean;
  onToggleAceptaAutorizacionDatos: (valor: boolean) => void;
}

export default function LandingPage({
  language,
  setLanguage,
  theme,
  setTheme,
  onStart,
  onViewPrivacy,
  onViewTerminos,
  isLoggingIn,
  textoAutorizacionDatos,
  aceptaAutorizacionDatos,
  onToggleAceptaAutorizacionDatos,
}: LandingPageProps) {
  const t = translations[language];
  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  // ── Checkout del Paquete (M30, cobro real con planes, corrige vuelta 24) ────────────────────
  // El panel vive aqui (no en App.tsx): comprar el Paquete solo exige el ID token de Firebase
  // (exigirAuth en el servidor), independiente del access token de Gmail que decide `needsAuth`
  // en App.tsx — un usuario con sesion de Firebase pero sin Gmail todavia ve esta landing y
  // puede pagar igual. Se lee `pagosActivos` de /api/precios porque `PAGOS_ACTIVOS` es una
  // variable de SERVIDOR: sin este campo, el panel no tendria forma de saber si el boton va a
  // terminar en un 503.
  const [precios, setPrecios] = useState<PreciosDelDia | null>(null);
  // Si /api/precios nunca responde (red caida, 500, etc.), `precios` se queda en null para
  // siempre y sin esta bandera la landing mostraria "Calculando el precio de hoy…" de forma
  // indefinida. `preciosFallo` distingue "todavia cargando" de "no va a llegar" para mostrar
  // planPayGoPriceError en su lugar (el boton ya cae solo al flujo de mailto porque
  // `precios?.pagosActivos` es falso con `precios` en null).
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
        setPrecios({
          cop: data.paquete.cop,
          usd: data.paquete.usd,
          trm: data.trm,
          fechaDesde: data.fechaDesde,
          pagosActivos: data.pagosActivos === true,
        });
      })
      .catch(() => {
        /* Sin precios, el boton del Paquete se queda en el flujo de mailto (ver `pagosActivos`
         * por defecto: `precios` null se trata como pagos apagados mas abajo). */
        if (!cancelado) setPreciosFallo(true);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  const [panelAbierto, setPanelAbierto] = useState(false);
  const [copActual, setCopActual] = useState<number | null>(null);
  const [aceptaTerminos, setAceptaTerminos] = useState(false);
  const [aceptaRetracto, setAceptaRetracto] = useState(false);
  const [pagando, setPagando] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [precioCambio, setPrecioCambio] = useState<{ anterior: number; nuevo: number } | null>(null);

  const abrirPanelPaquete = () => {
    if (!precios) return;
    setCopActual(precios.cop);
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
      // Hace falta sesion de Firebase para pagar (create-preference exige el ID token): si no
      // hay una, se reusa el mismo flujo de "Ingresar con Google" del resto de la landing en vez
      // de mandar una peticion que el servidor rechazaria con 401.
      const idToken = await getIdToken();
      if (!idToken) {
        setPagando(false);
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
        // Bajo (cobro real con planes, 2026-10-05): nunca redirigir el navegador entero a una URL
        // que no sea de verdad de Mercado Pago (produccion o sandbox) — ver el comentario de
        // `esInitPointMercadoPagoValido` en src/utils/checkout.ts.
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
        // R8 de textos-checkout.md v1.2: el monto cambio desde que se abrio el panel (cambio la
        // TRM o paso la medianoche) — se muestra el nuevo y se obliga a volver a marcar las dos
        // casillas sobre ese monto, nunca se reintenta solo con el viejo.
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

  // Compra por contacto (2026-10-05, decision de Leonardo). El cobro esta arreglado en el
  // servidor pero APAGADO (PAGOS_ACTIVOS) hasta definir que recibe quien paga: hoy la app no
  // tiene planes, y la web promete "/mes" con un pago unico. Antes, este boton fallaba y aun asi
  // mostraba "Mercado Pago Conectado" con instrucciones de desarrollador al cliente.
  const handlePurchasePlan = (planName: string, precioMostrado: number) => {
    const asunto = `CertiSend: ${planName}`;
    const cuerpo = language === "en"
      ? `Hi, I'm interested in ${planName} (US$${precioMostrado}). `
      : `Hola, me interesa ${planName} (US$${precioMostrado}). `;
    window.location.href = `mailto:contacto@leonardoantolinez.com?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
  };

  // Pro no se vende en v1 (Tarea 11, cobro real con planes, 2026-10-05): sin precio que mostrar
  // en el correo (Tarea 8, la suscripcion de Pro, todavia no existe).
  const handleContactarPro = () => {
    const asunto = "CertiSend: Plan Pro";
    const cuerpo = language === "en"
      ? "Hi, I'm interested in the CertiSend Pro plan. "
      : "Hola, me interesa el plan Pro de CertiSend. ";
    window.location.href = `mailto:contacto@leonardoantolinez.com?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
  };

  return (
    <div className={`min-h-screen font-sans transition-colors duration-300 ${
      theme === "dark" ? "bg-[#0B0C10] text-[#E0E6ED]" : "bg-[#FAFAFC] text-[#2C3E50]"
    }`}>
      
      {/* Header / Navigation Bar */}
      <header className={`sticky top-0 z-50 backdrop-blur-md border-b transition-colors ${
        theme === "dark" ? "bg-[#0B0C10]/80 border-[#222530]" : "bg-[#FAFAFC]/80 border-gray-200"
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          
          {/* Logo */}
          <div className="flex items-center gap-2">
            <LogoMark className="w-10 h-10" />
            <div>
              <span className="font-extrabold tracking-tight text-lg bg-gradient-to-r from-[#2563EB] to-[#8B5CF6] bg-clip-text text-transparent">
                {t.appName}
              </span>
            </div>
          </div>

          {/* Quick Controls & CTA */}
          <div className="flex items-center gap-4">
            
            {/* Language Selector Toggle */}
            <button
              onClick={() => setLanguage(language === "es" ? "en" : "es")}
              className={`p-2 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition-colors ${
                theme === "dark" ? "hover:bg-[#1D2130] text-gray-300" : "hover:bg-gray-100 text-gray-700"
              }`}
              title="Switch Language"
            >
              <Globe className="w-4 h-4 text-blue-500" />
              <span>{language === "es" ? "EN" : "ES"}</span>
            </button>

            {/* Light/Dark Mode Switcher */}
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className={`p-2 rounded-lg transition-colors ${
                theme === "dark" ? "hover:bg-[#1D2130] text-yellow-400" : "hover:bg-gray-100 text-slate-700"
              }`}
              aria-label="Toggle Theme"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {/* CTA Login Button — GRAVE 3(c): deshabilitado hasta marcar la casilla de
                autorizacion de datos (T11), que vive antes del CTA principal del hero, abajo. */}
            <button
              onClick={onStart}
              disabled={isLoggingIn || !aceptaAutorizacionDatos}
              title={!aceptaAutorizacionDatos ? t.autorizacionDatosRequerida : undefined}
              className="bg-gradient-to-r from-[#2563EB] to-[#8B5CF6] text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shadow-md shadow-blue-900/10 hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isLoggingIn ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <span>{t.loginWithGoogle}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden py-20 lg:py-32">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <motion.div
            animate={{ scale: [1, 1.18, 1], x: [0, -30, 0], y: [0, 20, 0] }}
            transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
            className={`absolute -top-40 -right-40 w-96 h-96 rounded-full blur-3xl opacity-30 ${
            theme === "dark" ? "bg-[#8B5CF6]" : "bg-indigo-200"
          }`}></motion.div>
          <motion.div
            animate={{ scale: [1, 1.12, 1], x: [0, 35, 0], y: [0, -25, 0] }}
            transition={{ duration: 17, repeat: Infinity, ease: "easeInOut" }}
            className={`absolute top-1/2 -left-40 w-96 h-96 rounded-full blur-3xl opacity-20 ${
            theme === "dark" ? "bg-[#2563EB]" : "bg-blue-200"
          }`}></motion.div>
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.5, 0], x: [0, 130], y: [0, -110] }}
              transition={{ duration: 5.5, repeat: Infinity, delay: 1.6 + i * 1.9, ease: "easeOut" }}
              className={`absolute ${["left-[12%] top-[68%]", "left-[78%] top-[74%]", "left-[46%] top-[82%]"][i]}`}
            >
              <Send className={`w-5 h-5 -rotate-12 ${theme === "dark" ? "text-indigo-400/60" : "text-indigo-400/50"}`} />
            </motion.div>
          ))}
        </div>

        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-8 relative">
          <AnimatedGlyph className="w-20 h-20 sm:w-24 sm:h-24 mx-auto" />
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-1.5 bg-blue-500/10 border border-blue-500/30 text-blue-500 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{t.tagline}</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className={`text-4xl sm:text-6xl font-extrabold tracking-tight leading-none ${
              theme === "dark" ? "text-white" : "text-gray-900"
            }`}
          >
            {t.heroTitle}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className={`text-base sm:text-xl max-w-2xl mx-auto leading-relaxed ${
              theme === "dark" ? "text-gray-400" : "text-gray-600"
            }`}
          >
            {t.heroSub}
          </motion.p>

          {/* GRAVE 3(c) (correccion vuelta 31, 2026-10-06): casilla de autorizacion de
              tratamiento de datos (T11, Ley 1581) ANTES del boton de login — el boton queda
              deshabilitado hasta marcarla. Al iniciar sesion, App.tsx registra esta autorizacion
              de inmediato (POST /api/autorizacion-datos), con el idioma y el texto EXACTO que se
              ve aqui. */}
          <motion.label
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.25 }}
            className={`flex items-start gap-2.5 max-w-xl mx-auto text-left text-xs leading-relaxed cursor-pointer px-4 py-3 rounded-xl border ${
              theme === "dark" ? "bg-[#11131A]/70 border-[#222530] text-gray-300" : "bg-white/70 border-gray-200 text-gray-600"
            }`}
          >
            <input
              type="checkbox"
              checked={aceptaAutorizacionDatos}
              onChange={(e) => onToggleAceptaAutorizacionDatos(e.target.checked)}
              className="mt-0.5 shrink-0"
            />
            <span>
              {textoAutorizacionDatos}{" "}
              <button type="button" onClick={onViewPrivacy} className="text-indigo-400 underline font-semibold">
                {language === "en" ? "Privacy Policy" : "Política de Privacidad"}
              </button>
              .
            </span>
          </motion.label>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <button
              onClick={onStart}
              disabled={!aceptaAutorizacionDatos || isLoggingIn}
              title={!aceptaAutorizacionDatos ? t.autorizacionDatosRequerida : undefined}
              className="w-full sm:w-auto px-8 py-4 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-[#2563EB] to-[#8B5CF6] hover:opacity-95 transition-all shadow-xl shadow-indigo-600/20 flex items-center justify-center gap-2 group disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span>{t.loginWithGoogle}</span>
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </button>
            <a
              href="#pricing"
              className={`w-full sm:w-auto px-8 py-4 rounded-xl text-sm font-bold transition-all border flex items-center justify-center gap-2 ${
                theme === "dark"
                  ? "bg-[#161821] hover:bg-[#202330] border-[#222530] text-white"
                  : "bg-white hover:bg-gray-50 border-gray-200 text-gray-700"
              }`}
            >
              <Coins className="w-4 h-4 text-yellow-500" />
              <span>{t.seeDemo}</span>
            </a>
          </motion.div>
        </div>
      </section>

      {/* Security Declaration Bar (NUEVA: Protección de Datos Absoluta) */}
      <section className={`py-12 border-y ${
        theme === "dark" ? "bg-[#11131A]/60 border-[#222530]" : "bg-blue-50/50 border-blue-100"
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-center">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-blue-500/10 text-blue-500 shrink-0">
                <Lock className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold text-sm uppercase tracking-wider">{t.sec1Title}</h4>
                <p className="text-xs text-slate-500 mt-1">{t.sec1Desc}</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-indigo-500/10 text-indigo-500 shrink-0">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold text-sm uppercase tracking-wider">{t.sec2Title}</h4>
                <p className="text-xs text-slate-500 mt-1">{t.sec2Desc}</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-purple-500/10 text-purple-500 shrink-0">
                <Zap className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold text-sm uppercase tracking-wider">{t.sec3Title}</h4>
                <p className="text-xs text-slate-500 mt-1">{t.sec3Desc}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16">
        <div className="text-center space-y-4">
          <h2 className="text-3xl font-extrabold tracking-tight">{t.featuresTitle}</h2>
          <p className="text-slate-500 max-w-2xl mx-auto">{t.featuresSub}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {[
            { title: t.feat1Title, desc: t.feat1Desc, icon: Layers, color: "from-[#2563EB] to-[#4F46E5]" },
            { title: t.feat2Title, desc: t.feat2Desc, icon: Globe, color: "from-[#4F46E5] to-[#6D28D9]" },
            { title: t.feat3Title, desc: t.feat3Desc, icon: Sparkles, color: "from-[#6D28D9] to-[#8B5CF6]" },
            { title: t.feat4Title, desc: t.feat4Desc, icon: Send, color: "from-[#8B5CF6] to-[#A78BFA]" }
          ].map((feat, idx) => (
            <div 
              key={idx} 
              className={`p-6 rounded-2xl border transition-all hover:scale-[1.02] ${
                theme === "dark" 
                  ? "bg-[#13151F] border-[#222530] hover:border-[#303548]" 
                  : "bg-white border-gray-100 hover:border-gray-200 shadow-sm"
              }`}
            >
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-r ${feat.color} text-white flex items-center justify-center mb-4`}>
                <feat.icon className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-lg mb-2">{feat.title}</h3>
              <p className="text-xs text-slate-500 leading-relaxed">{feat.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing & Interactive Calculator Section */}
      <section id="pricing" className={`py-20 border-t ${
        theme === "dark" ? "bg-[#11131A]/30 border-[#222530]" : "bg-gray-50/50 border-gray-100"
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16">
          
          <div className="text-center space-y-4">
            <h2 className="text-3xl font-extrabold tracking-tight">{t.pricingTitle}</h2>
            <p className="text-slate-500 max-w-2xl mx-auto">{t.pricingSub}</p>
          </div>

          {/* Pricing Plans Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
            
            {/* Free Plan */}
            <div className={`p-8 rounded-3xl border flex flex-col justify-between ${
              theme === "dark" ? "bg-[#13151F] border-[#222530]" : "bg-white border-gray-100 shadow-sm"
            }`}>
              <div className="space-y-6">
                <div>
                  <span className="text-xs font-bold text-blue-500 uppercase tracking-widest">{t.planFreeName}</span>
                  <p className="text-3xl font-extrabold mt-2">{t.planFreePrice}</p>
                </div>
                <div className="space-y-3 pt-6 border-t border-dashed border-slate-500/20">
                  <div className="flex items-center gap-2.5 text-xs text-slate-500">
                    <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>{t.planFreeFeature1}</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-xs text-slate-500">
                    <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>{t.planFreeFeature2}</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-xs text-slate-500">
                    <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>{t.planFreeFeature3}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={onStart}
                disabled={!aceptaAutorizacionDatos || isLoggingIn}
                title={!aceptaAutorizacionDatos ? t.autorizacionDatosRequerida : undefined}
                className={`w-full mt-8 py-3 rounded-xl font-bold text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  theme === "dark"
                    ? "bg-[#222530] hover:bg-[#2F3345] text-white"
                    : "bg-gray-100 hover:bg-gray-200 text-gray-800"
                }`}
              >
                {t.startFree}
              </button>
            </div>

            {/* Pro Plan (no se vende en v1, Tarea 11 / cobro real con planes, 2026-10-05: sin
                precio ni "Recomendado" para algo que todavia no se puede comprar — ver
                handleContactarPro, boton de correo igual que siempre). */}
            <div className="p-8 rounded-3xl border-2 border-indigo-600 bg-gradient-to-b from-[#1C1F30] to-[#0F1119] text-white relative flex flex-col justify-between shadow-2xl shadow-indigo-600/10">
              <div className="absolute -top-4 right-6 bg-gradient-to-r from-blue-500 to-indigo-600 text-[10px] font-extrabold uppercase py-1 px-3 rounded-full tracking-wider shadow">
                Próximamente
              </div>
              <div className="space-y-6">
                <div>
                  <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest">{t.planProName}</span>
                  <p className="text-2xl font-extrabold mt-2">{t.planProPrice}</p>
                </div>
                <div className="space-y-3 pt-6 border-t border-dashed border-indigo-500/30">
                  <div className="flex items-center gap-2.5 text-xs text-gray-300">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{t.planProFeature1}</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-xs text-gray-300">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{t.planProFeature2}</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-xs text-gray-300">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{t.planProFeature3}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={handleContactarPro}
                className="w-full mt-8 py-3.5 rounded-xl font-extrabold text-xs bg-gradient-to-r from-[#2563EB] to-[#8B5CF6] text-white hover:opacity-95 transition-all shadow-md shadow-indigo-500/30 flex items-center justify-center gap-1.5"
              >
                <span>{t.proContactar}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Paquete (M30/Tarea 11): el precio grande es el COP real del dia, de /api/precios
                (precios.cop), nunca un "$0,10 USD por envio" fijo (H5, retirado); mientras no
                haya llegado, se muestra planPayGoPriceCargando en vez de un numero inventado. */}
            <div className={`p-8 rounded-3xl border flex flex-col justify-between ${
              theme === "dark" ? "bg-[#13151F] border-[#222530]" : "bg-white border-gray-100 shadow-sm"
            }`}>
              <div className="space-y-6">
                <div>
                  <span className="text-xs font-bold text-purple-500 uppercase tracking-widest">{t.planPayGoName}</span>
                  {precios ? (
                    <>
                      <p className="text-3xl font-extrabold mt-2">
                        {language === "en"
                          ? `COP ${precios.cop.toLocaleString("en-US")}`
                          : `$${precios.cop.toLocaleString("es-CO")} COP`}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {t.checkoutReferencia.replace("{usd}", String(precios.usd))}
                      </p>
                    </>
                  ) : (
                    <p className="text-lg font-bold mt-2 text-slate-500">
                      {preciosFallo ? t.planPayGoPriceError : t.planPayGoPriceCargando}
                    </p>
                  )}
                </div>
                <div className="space-y-3 pt-6 border-t border-dashed border-slate-500/20">
                  <div className="flex items-center gap-2.5 text-xs text-slate-500">
                    <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>{t.planPayGoFeature1}</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-xs text-slate-500">
                    <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>{t.planPayGoFeature2}</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-xs text-slate-500">
                    <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>{t.planPayGoFeature3}</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-xs text-slate-500">
                    <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>{t.planPayGoFeature4}</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-xs text-slate-500">
                    <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span>{t.planPayGoFeature5}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() =>
                  precios?.pagosActivos
                    ? abrirPanelPaquete()
                    : handlePurchasePlan("CertiSend Pay-as-you-go Bundle", 15.00)
                }
                disabled={loadingPlan !== null}
                className={`w-full mt-8 py-3 rounded-xl font-bold text-xs transition-colors border flex items-center justify-center gap-1.5 ${
                  theme === "dark"
                    ? "bg-[#161821] hover:bg-[#202330] border-[#222530] text-white"
                    : "bg-white hover:bg-gray-50 border-gray-200 text-gray-700 shadow-sm"
                }`}
              >
                {loadingPlan === "CertiSend Pay-as-you-go Bundle" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <span>{precios?.pagosActivos ? t.buyPaquete : t.buyNow}</span>
                    <Coins className="w-4 h-4 text-yellow-500" />
                  </>
                )}
              </button>
            </div>
          </div>
          {/* Calculadora de costo por envio RETIRADA (R6 de docs/legal/textos-checkout.md v1.2:
              "$0,10 por envío" no existe como precio — H5). Las tarjetas de arriba ya muestran el
              precio real del Paquete (COP del dia) y que Pro no se vende todavia. */}
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-20 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="text-center space-y-4">
          <h2 className="text-3xl font-extrabold tracking-tight">{t.faqTitle}</h2>
          <p className="text-slate-500 text-sm">{t.faqSub}</p>
        </div>

        <div className="space-y-4">
          {[
            { q: t.faq1Q, a: t.faq1A },
            { q: t.faq2Q, a: t.faq2A },
            { q: t.faq3Q, a: t.faq3A },
            { q: t.faq4Q, a: t.faq4A }
          ].map((faq, idx) => (
            <div 
              key={idx}
              className={`rounded-2xl border overflow-hidden transition-all ${
                theme === "dark" ? "bg-[#13151F] border-[#222530]" : "bg-white border-gray-100 shadow-sm"
              }`}
            >
              <button
                onClick={() => setActiveFaq(activeFaq === idx ? null : idx)}
                className="w-full p-5 flex items-center justify-between text-left font-bold text-sm sm:text-base focus:outline-none"
              >
                <span>{faq.q}</span>
                <ChevronDown className={`w-5 h-5 text-indigo-500 transition-transform duration-300 ${
                  activeFaq === idx ? "rotate-185" : ""
                }`} />
              </button>
              
              <AnimatePresence initial={false}>
                {activeFaq === idx && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <div className="px-5 pb-5 pt-1 text-xs text-slate-500 leading-relaxed border-t border-slate-500/10">
                      {faq.a}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </section>

      {/* Sticky Footer */}
      <footer className={`py-8 text-center text-xs border-t ${
        theme === "dark" ? "bg-[#090A0D] border-[#222530]" : "bg-gray-100 border-gray-200"
      }`}>
        <p className="text-slate-500">
          © 2026 <strong>{t.appName}</strong>. {t.footerRights}
        </p>
        <p className="text-slate-500 text-[10px] mt-1">
          {t.footerText}
        </p>
        <div className="mt-2 flex justify-center gap-4">
          <button
            onClick={onViewTerminos}
            className="text-indigo-500 hover:underline font-semibold cursor-pointer text-[11px]"
          >
            {language === "es" ? "Términos y Condiciones" : "Terms and Conditions"}
          </button>
          <button
            onClick={onViewPrivacy}
            className="text-indigo-500 hover:underline font-semibold cursor-pointer text-[11px]"
          >
            {language === "es" ? "Política de Privacidad" : "Privacy Policy"}
          </button>
        </div>
      </footer>

      {/* Panel de checkout del Paquete (M30, cobro real con planes, corrige vuelta 24). Solo se
          puede abrir con PAGOS_ACTIVOS encendido (`abrirPanelPaquete` exige `precios.pagosActivos`
          antes de montarse, ver el onClick del boton del Paquete arriba). /terminos y /privacidad
          siguen en borrador (falta NIT y revision de abogado colegiado): el enlace apunta ahi
          igual, pero la ruta debe existir en produccion ANTES de encender PAGOS_ACTIVOS. */}
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
              className={`w-full max-w-md rounded-2xl p-6 space-y-5 border ${
                theme === "dark" ? "bg-[#13151F] border-[#222530] text-white" : "bg-white border-gray-200 text-gray-900"
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-extrabold text-lg">{t.checkoutPaqueteTitle}</h3>
                <button
                  onClick={() => !pagando && setPanelAbierto(false)}
                  className="text-slate-400 hover:text-rose-400 p-1"
                  aria-label={t.checkoutCerrar}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {precioCambio && (
                <div className="text-xs rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-500 p-3 leading-relaxed">
                  {t.checkoutPrecioCambio
                    .replace("{anterior}", precioCambio.anterior.toLocaleString(language === "en" ? "en-US" : "es-CO"))
                    .replace("{nuevo}", precioCambio.nuevo.toLocaleString(language === "en" ? "en-US" : "es-CO"))}
                </div>
              )}

              <div className="space-y-1">
                <p className="text-3xl font-black text-indigo-500">
                  {language === "en" ? "COP " : "$"}
                  {copActual.toLocaleString(language === "en" ? "en-US" : "es-CO")}
                  {language === "es" ? " COP" : ""}
                </p>
                <p className="text-[11px] text-slate-500">
                  {t.checkoutReferencia.replace("{usd}", String(precios.usd))} ·{" "}
                  {t.checkoutTrmNota.replace("{trm}", String(precios.trm)).replace("{fecha}", precios.fechaDesde)}
                </p>
              </div>

              <label className="flex items-start gap-2.5 text-[11px] leading-relaxed cursor-pointer">
                <input
                  type="checkbox"
                  checked={aceptaTerminos}
                  onChange={(e) => setAceptaTerminos(e.target.checked)}
                  className="mt-0.5 accent-indigo-500 shrink-0"
                />
                <span>
                  {textoTerminos(copActual, language)}{" "}
                  <a
                    href="/terminos"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-500 hover:underline font-semibold"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t.checkoutVerTerminos}
                  </a>
                </span>
              </label>

              <label className="flex items-start gap-2.5 text-[11px] leading-relaxed cursor-pointer">
                <input
                  type="checkbox"
                  checked={aceptaRetracto}
                  onChange={(e) => setAceptaRetracto(e.target.checked)}
                  className="mt-0.5 accent-indigo-500 shrink-0"
                />
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

    </div>
  );
}
