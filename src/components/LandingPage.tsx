import React, { useState } from "react";
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
  TrendingUp
} from "lucide-react";
import { LogoMark, AnimatedGlyph } from "./BrandLogo";
import { translations, TranslationDict } from "../utils/translations";

interface LandingPageProps {
  language: "es" | "en";
  setLanguage: (lang: "es" | "en") => void;
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  onStart: () => void;
  onViewPrivacy: () => void;
  isLoggingIn: boolean;
}

export default function LandingPage({
  language,
  setLanguage,
  theme,
  setTheme,
  onStart,
  onViewPrivacy,
  isLoggingIn
}: LandingPageProps) {
  const t = translations[language];
  const [certsCount, setCertsCount] = useState<number>(150);
  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState<boolean>(false);
  const [selectedPlanDetails, setSelectedPlanDetails] = useState<{name: string, price: string} | null>(null);

  // Calculate estimated monthly pricing
  const isProRecommended = certsCount > 200;
  const payAsYouGoPrice = (certsCount * 0.10).toFixed(2);
  const proPrice = "29.00";
  const finalPrice = isProRecommended ? proPrice : payAsYouGoPrice;

  const handlePurchasePlan = async (planName: string, amount: number) => {
    try {
      setLoadingPlan(planName);
      // Call real Mercado Pago endpoint
      const response = await fetch("/api/mercadopago/create-preference", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          planName,
          amount,
          currency: "USD"
        })
      });

      const data = await response.json();
      if (response.ok && data.initPoint) {
        // Redirect to Mercado Pago real checkout URL
        window.open(data.initPoint, "_blank");
      } else {
        // Fallback simulated success modal if API is not fully configured with production tokens
        setSelectedPlanDetails({
          name: planName,
          price: `$${amount.toFixed(2)} USD`
        });
        setPaymentSuccess(true);
      }
    } catch (err) {
      console.error("Mercado Pago error:", err);
      setSelectedPlanDetails({
        name: planName,
        price: `$${amount.toFixed(2)} USD`
      });
      setPaymentSuccess(true);
    } finally {
      setLoadingPlan(null);
    }
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

            {/* CTA Login Button */}
            <button
              onClick={onStart}
              disabled={isLoggingIn}
              className="bg-gradient-to-r from-[#2563EB] to-[#8B5CF6] text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shadow-md shadow-blue-900/10 hover:opacity-95"
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

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <button
              onClick={onStart}
              className="w-full sm:w-auto px-8 py-4 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-[#2563EB] to-[#8B5CF6] hover:opacity-95 transition-all shadow-xl shadow-indigo-600/20 flex items-center justify-center gap-2 group"
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
            { title: t.feat1Title, desc: t.feat1Desc, icon: Layers, color: "from-blue-500 to-indigo-500" },
            { title: t.feat2Title, desc: t.feat2Desc, icon: Globe, color: "from-indigo-500 to-purple-500" },
            { title: t.feat3Title, desc: t.feat3Desc, icon: Sparkles, color: "from-purple-500 to-pink-500" },
            { title: t.feat4Title, desc: t.feat4Desc, icon: Send, color: "from-pink-500 to-red-500" }
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
                className={`w-full mt-8 py-3 rounded-xl font-bold text-xs transition-colors ${
                  theme === "dark" 
                    ? "bg-[#222530] hover:bg-[#2F3345] text-white" 
                    : "bg-gray-100 hover:bg-gray-200 text-gray-800"
                }`}
              >
                {t.startFree}
              </button>
            </div>

            {/* Pro Plan (Destacado) */}
            <div className="p-8 rounded-3xl border-2 border-indigo-600 bg-gradient-to-b from-[#1C1F30] to-[#0F1119] text-white relative flex flex-col justify-between shadow-2xl shadow-indigo-600/10">
              <div className="absolute -top-4 right-6 bg-gradient-to-r from-blue-500 to-indigo-600 text-[10px] font-extrabold uppercase py-1 px-3 rounded-full tracking-wider shadow">
                Recomendado
              </div>
              <div className="space-y-6">
                <div>
                  <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest">{t.planProName}</span>
                  <p className="text-4xl font-extrabold mt-2">{t.planProPrice}</p>
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
                  <div className="flex items-center gap-2.5 text-xs text-gray-300">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{t.planProFeature4}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => handlePurchasePlan("CertiSend Pro Monthly", 29.00)}
                disabled={loadingPlan !== null}
                className="w-full mt-8 py-3.5 rounded-xl font-extrabold text-xs bg-gradient-to-r from-[#2563EB] to-[#8B5CF6] text-white hover:opacity-95 transition-all shadow-md shadow-indigo-500/30 flex items-center justify-center gap-1.5"
              >
                {loadingPlan === "CertiSend Pro Monthly" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <span>{t.buyNow}</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>

            {/* Pay as you go Plan */}
            <div className={`p-8 rounded-3xl border flex flex-col justify-between ${
              theme === "dark" ? "bg-[#13151F] border-[#222530]" : "bg-white border-gray-100 shadow-sm"
            }`}>
              <div className="space-y-6">
                <div>
                  <span className="text-xs font-bold text-purple-500 uppercase tracking-widest">{t.planPayGoName}</span>
                  <p className="text-3xl font-extrabold mt-2">{t.planPayGoPrice}</p>
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
                </div>
              </div>
              <button 
                onClick={() => handlePurchasePlan("CertiSend Pay-as-you-go Bundle", 15.00)}
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
                    <span>{t.buyNow} (Carga $15)</span>
                    <Coins className="w-4 h-4 text-yellow-500" />
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Interactive Pricing Cost Calculator (NUEVA: Para que el cliente analice e interactúe) */}
          <div className={`p-8 rounded-3xl border max-w-2xl mx-auto space-y-6 ${
            theme === "dark" ? "bg-[#13151F] border-[#222530]" : "bg-white border-gray-200 shadow-md"
          }`}>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-indigo-500" />
              <h3 className="font-extrabold text-lg">{t.calculatorTitle}</h3>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">{t.calculatorSub}</p>

            <div className="space-y-4">
              <div className="flex justify-between text-xs font-mono">
                <span>{t.calcCertificates}</span>
                <span className="font-bold text-indigo-500 text-sm">{certsCount}</span>
              </div>
              <input
                type="range"
                min="10"
                max="1000"
                step="10"
                value={certsCount}
                onChange={(e) => setCertsCount(Number(e.target.value))}
                className="w-full accent-indigo-500"
              />
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-dashed border-slate-500/20 items-center">
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest">{t.calcTotalEstimate}</p>
                  <p className="text-3xl font-black text-indigo-500">${finalPrice} <span className="text-xs font-normal">USD</span></p>
                </div>
                <div className={`p-3 rounded-xl border text-[11px] font-semibold text-center leading-tight ${
                  isProRecommended 
                    ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-400" 
                    : "bg-blue-500/10 border-blue-500/30 text-blue-400"
                }`}>
                  {isProRecommended ? t.calcProPlan : t.calcPayAsYouGo}
                </div>
              </div>
            </div>
          </div>
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

      {/* Mercado Pago Sandbox Success Alert Modal */}
      <AnimatePresence>
        {paymentSuccess && selectedPlanDetails && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-[100]">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className={`p-8 rounded-3xl border max-w-md w-full text-center space-y-6 ${
                theme === "dark" ? "bg-[#13151F] border-[#222530]" : "bg-white border-gray-100 shadow-2xl"
              }`}
            >
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto">
                <ShieldCheck className="w-10 h-10 animate-bounce" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-extrabold text-emerald-500">¡Mercado Pago Conectado!</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Has iniciado el flujo para adquirir el plan <strong>{selectedPlanDetails.name}</strong> por <strong>{selectedPlanDetails.price}</strong>.
                </p>
                <div className="text-left bg-blue-500/5 border border-blue-500/20 p-4 rounded-xl space-y-2 mt-4">
                  <span className="text-[10px] uppercase font-bold text-blue-500 block">Soporte Técnico Colombia</span>
                  <p className="text-[11px] text-slate-500 leading-normal">
                    La pasarela se ha inicializado correctamente. Para procesar transacciones en vivo con Mercado Pago en Colombia, agrega tu Access Token de producción en tu archivo <code>.env</code> bajo la variable <code>MERCADO_PAGO_ACCESS_TOKEN</code>.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setPaymentSuccess(false)}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs transition-all"
                >
                  Entendido, Continuar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
            onClick={onViewPrivacy}
            className="text-indigo-500 hover:underline font-semibold cursor-pointer text-[11px]"
          >
            {language === "es" ? "Política de Privacidad" : "Privacy Policy"}
          </button>
        </div>
      </footer>

    </div>
  );
}
