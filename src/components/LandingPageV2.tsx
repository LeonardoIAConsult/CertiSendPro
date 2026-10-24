import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  motion,
  AnimatePresence,
  useScroll,
  useSpring,
  useTransform,
  useInView,
  useReducedMotion,
  MotionConfig,
  useMotionValue,
  useMotionValueEvent,
  animate,
  type MotionValue,
} from "motion/react";
import Matter from "matter-js";
import {
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  FileText,
  Globe,
  GraduationCap,
  Heart,
  HeartHandshake,
  Loader2,
  Lock,
  Mail,
  Moon,
  Send,
  ShieldCheck,
  Sparkles,
  Sun,
  Table2,
  Zap,
} from "lucide-react";
import { LogoMark, CertiSendGlyph } from "./BrandLogo";
import { translations } from "../utils/translations";
import { puedeEntrarConGoogle } from "../utils/autorizacionDatos";
import { formatearFechaCortaDesdeISO } from "../utils/checkout";
import { useCheckoutV2 } from "./useCheckoutV2";

/**
 * Landing V2 (version B). NO reemplaza a LandingPage.tsx: se monta solo con `?landing=2`
 * (ver App.tsx). Mantiene el mismo contrato de props — las dos casillas legales (T11 + Terminos)
 * siguen ANTES de cualquier boton de login, y los botones quedan deshabilitados hasta marcarlas.
 * El checkout es una copia aislada del de la original (useCheckoutV2.tsx): mismos textos legales,
 * mismas funciones y mismos endpoints. Si cambia uno, cambia el otro.
 */
interface Props {
  language: "es" | "en";
  setLanguage: (lang: "es" | "en") => void;
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  onStart: () => void;
  onViewPrivacy: () => void;
  onViewTerminos: () => void;
  isLoggingIn: boolean;
  textoAutorizacionDatos: string;
  aceptaAutorizacionDatos: boolean;
  onToggleAceptaAutorizacionDatos: (valor: boolean) => void;
  textoAceptacionTerminosUso: string;
  aceptaTerminosUso: boolean;
  onToggleAceptaTerminosUso: (valor: boolean) => void;
}

const COPY = {
  es: {
    navDemo: "Pruébalo",
    navFeatures: "Cómo funciona",
    navPricing: "Precios",
    heroA: "Un PDF.",
    heroB: "Una lista.",
    heroC: "Cientos de correos únicos.",
    stepPdf: "1 PDF con todos los certificados",
    stepSheet: "Tu Google Sheet",
    stepSent: "enviados desde tu Gmail",
    useCases: ["Diplomas", "Certificados", "Invitaciones de boda", "Cumpleaños", "Constancias", "Reconocimientos", "Save the date", "Credenciales"],
    navAudience: "Para quién",
    audTitle: "Hecho para quien necesita enviar bien, a muchos",
    audSub: "Empresas, organizaciones, institutos y también personas: el mismo flujo, distinto motivo.",
    aud: [
      { id: "empresas", label: "Empresas", cert: "Certificado de capacitación", who: "Ana Gómez", line: "Por completar el programa de liderazgo", subject: "Tu certificado de capacitación", uses: ["Certificados de capacitación", "Constancias laborales", "Reconocimientos al equipo", "Credenciales de eventos"] },
      { id: "organizaciones", label: "Organizaciones", cert: "Certificado de voluntariado", who: "Luis Pérez", line: "Gracias por tu servicio a la comunidad", subject: "Gracias por ser parte", uses: ["Certificados de voluntariado", "Cartas de agradecimiento a donantes", "Constancias de membresía", "Invitaciones a asambleas"] },
      { id: "institutos", label: "Institutos", cert: "Diploma de curso", who: "Marta Ríos", line: "Por aprobar el curso con honores", subject: "Tu diploma ya está listo", uses: ["Diplomas y grados", "Certificados de cursos y talleres", "Constancias de asistencia", "Reconocimientos académicos"] },
      { id: "personas", label: "Personas", cert: "Invitación de boda", who: "Familia Soto", line: "Te esperamos para celebrar nuestro día", subject: "Estás invitado a nuestra boda", uses: ["Invitaciones de boda", "Tarjetas de cumpleaños", "Save the date", "Agradecimientos después del evento"] },
    ],
    ctaFinal: "Tu próximo envío empieza aquí.",
    exampleBadge: "Ejemplo ilustrativo",
    stepVisual: ["Un PDF → muchos", "Nombre ↔ correo", "De tu Gmail"],
    demoTitle: "Escribe un nombre y míralo cobrar vida",
    demoSub: "Simulación local: lo que escribas aquí no sale de tu navegador.",
    demoPlaceholder: "Tu nombre aquí",
    demoCert: "Certificado de participación",
    demoCertLine: "Se otorga a",
    demoSubject: "Asunto",
    demoSubjectVal: "Tu certificado está listo",
    demoTo: "Para",
    demoBody: "Hola {n}, adjuntamos tu certificado. ¡Felicitaciones!",
    demoAttach: "certificado.pdf",
    flowTitle: "Del PDF a la bandeja de entrada, sin tocar nada a mano",
    flowSteps: [
      { t: "Divide", d: "Subes un PDF masivo y lo partimos en un PDF por persona." },
      { t: "Empareja", d: "La IA lee cada nombre y lo cruza con tu Google Sheet. Tú revisas antes de enviar." },
      { t: "Envía", d: "Cada correo sale de tu propio Gmail, con su certificado adjunto." },
    ],
    statSends: "horas aprox. y tus PDFs se borran solos",
    statFree: "envíos gratis por cuenta",
    statZero: "listas guardadas en nuestros servidores",
    bentoTitle: "Hecho para que no te equivoques",
    bentoSub: "Tú revisas cada certificado junto a su destinatario antes de que salga.",
    feats: [
      { t: "Un PDF, cientos de documentos", d: "Sube el archivo con todos los diplomas o invitaciones. Lo dividimos en un PDF por persona, sin que cortes nada a mano." },
      { t: "Tu Google Sheet, como lo tienes", d: "Conecta la hoja con nombres y correos. Leemos los datos de forma directa y segura." },
      { t: "La IA lee, tú decides", d: "La IA lee el nombre de cada página y lo empareja con tu lista. Antes de enviar ves cada certificado junto a su destinatario y corriges lo que haga falta." },
      { t: "Sale de tu Gmail, con tu nombre", d: "Cada correo viaja desde tu propia cuenta, con el certificado adjunto. Quien lo recibe ve tu dirección, no la de un desconocido." },
    ],
    ctaSub: "Empieza gratis: 15 envíos por correo, en total. Después, Paquete o Pago por uso.",
    trustTitle: "Tus datos, bajo tu control",
    trustSub: "Sabes qué pasa con cada archivo, de principio a fin.",
    trustSteps: [
      { t: "Tú subes", d: "Tu PDF y tu lista, solo dentro de tu sesión." },
      { t: "Se procesa", d: "Ningún otro usuario los ve." },
      { t: "Sale de tu Gmail", d: "Con permisos temporales de Google." },
      { t: "Se borra", d: "Tus PDFs desaparecen solos en unas 2 horas." },
    ],
    trustNoTitle: "No guardamos",
    trustNo: ["Tu lista de destinatarios", "Tus PDFs, pasadas unas 2 horas"],
    trustYesTitle: "Sí guardamos",
    trustYes: ["Tu cuenta y tu plan", "Tus pagos", "La prueba de lo que aceptaste y confirmaste"],
    trustMore: "Todo el detalle está en la Política de Privacidad.",
    accessTitle: "Empieza gratis",
    accessSub: "Antes de entrar, confirma las dos autorizaciones.",
    consentHint: "Marca las dos casillas para continuar.",
    popular: "El más flexible",
    faqSub: "Lo que más nos preguntan.",
    privacy: "Política de Privacidad",
    terms: "Términos y Condiciones",
  },
  en: {
    navDemo: "Try it",
    navFeatures: "How it works",
    navPricing: "Pricing",
    heroA: "One PDF.",
    heroB: "One list.",
    heroC: "Hundreds of unique emails.",
    stepPdf: "1 PDF with every certificate",
    stepSheet: "Your Google Sheet",
    stepSent: "sent from your Gmail",
    useCases: ["Diplomas", "Certificates", "Wedding invitations", "Birthdays", "Attendance proofs", "Awards", "Save the date", "Badges"],
    navAudience: "Who it's for",
    audTitle: "Made for anyone who needs to send well, to many",
    audSub: "Companies, organizations, institutes and individuals too: same flow, different reason.",
    aud: [
      { id: "empresas", label: "Companies", cert: "Training certificate", who: "Ana Gómez", line: "For completing the leadership program", subject: "Your training certificate", uses: ["Training certificates", "Employment letters", "Team recognitions", "Event credentials"] },
      { id: "organizaciones", label: "Organizations", cert: "Volunteer certificate", who: "Luis Pérez", line: "Thank you for serving the community", subject: "Thank you for being part", uses: ["Volunteer certificates", "Donor thank-you letters", "Membership proofs", "Assembly invitations"] },
      { id: "institutos", label: "Institutes", cert: "Course diploma", who: "Marta Ríos", line: "For passing the course with honors", subject: "Your diploma is ready", uses: ["Diplomas and degrees", "Course and workshop certificates", "Attendance proofs", "Academic awards"] },
      { id: "personas", label: "Individuals", cert: "Wedding invitation", who: "Soto Family", line: "We can't wait to celebrate our day with you", subject: "You're invited to our wedding", uses: ["Wedding invitations", "Birthday cards", "Save the date", "Thank-you notes after the event"] },
    ],
    ctaFinal: "Your next send starts here.",
    exampleBadge: "Illustrative example",
    stepVisual: ["One PDF → many", "Name ↔ email", "From your Gmail"],
    demoTitle: "Type a name and watch it come alive",
    demoSub: "Local simulation: what you type here never leaves your browser.",
    demoPlaceholder: "Your name here",
    demoCert: "Certificate of participation",
    demoCertLine: "Awarded to",
    demoSubject: "Subject",
    demoSubjectVal: "Your certificate is ready",
    demoTo: "To",
    demoBody: "Hi {n}, your certificate is attached. Congratulations!",
    demoAttach: "certificate.pdf",
    flowTitle: "From PDF to inbox, with nothing done by hand",
    flowSteps: [
      { t: "Split", d: "Upload one bulk PDF and we cut it into one PDF per person." },
      { t: "Match", d: "AI reads each name and matches it against your Google Sheet. You review before sending." },
      { t: "Send", d: "Every email leaves your own Gmail with its certificate attached." },
    ],
    statSends: "hours approx. and your PDFs delete themselves",
    statFree: "free sends per account",
    statZero: "lists stored on our servers",
    bentoTitle: "Built so you don't get it wrong",
    bentoSub: "You review each certificate next to its recipient before it goes out.",
    feats: [
      { t: "One PDF, hundreds of documents", d: "Upload the file with all your diplomas or invitations. We split it into one PDF per person, with no manual cutting." },
      { t: "Your Google Sheet, as it is", d: "Connect the sheet with names and emails. We read the data directly and securely." },
      { t: "AI reads, you decide", d: "AI reads the name on each page and matches it with your list. Before sending you see every certificate next to its recipient and fix whatever needs fixing." },
      { t: "Sent from your Gmail, under your name", d: "Every email goes out from your own account, with the certificate attached. Recipients see your address, not a stranger's." },
    ],
    ctaSub: "Start free: 15 sends per email, in total. After that, Bundle or Pay-as-you-go.",
    trustTitle: "Your data, under your control",
    trustSub: "You know what happens to every file, from start to finish.",
    trustSteps: [
      { t: "You upload", d: "Your PDF and your list, only inside your session." },
      { t: "It's processed", d: "No other user ever sees them." },
      { t: "Sent from your Gmail", d: "With temporary Google permissions." },
      { t: "It's deleted", d: "Your PDFs delete themselves in about 2 hours." },
    ],
    trustNoTitle: "We don't store",
    trustNo: ["Your recipient list", "Your PDFs, after about 2 hours"],
    trustYesTitle: "We do store",
    trustYes: ["Your account and plan", "Your payments", "Proof of what you accepted and confirmed"],
    trustMore: "Every detail is in the Privacy Policy.",
    accessTitle: "Start for free",
    accessSub: "Before you sign in, confirm the two authorizations.",
    consentHint: "Check both boxes to continue.",
    popular: "Most flexible",
    faqSub: "What people ask us most.",
    privacy: "Privacy Policy",
    terms: "Terms and Conditions",
  },
} as const;

/** Visible en pantalla (con margen): los fondos infinitos se pausan cuando no se ven. */
function useVisible<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const vis = useInView(ref, { margin: "120px 0px" });
  return [ref, vis] as const;
}

/** Titulos de seccion terminan en punto (decision de Leonardo). */
const dot = (x: string) => (/[.!?]$/.test(x) ? x : `${x}.`);

const FLOW_PEOPLE = [
  { n: "Sofía Mora", m: "sofia@correo.com" },
  { n: "Ana Gómez", m: "ana@correo.com" },
  { n: "Luis Pérez", m: "luis@correo.com" },
  { n: "Marta Ríos", m: "marta@correo.com" },
  { n: "Diego Soto", m: "diego@correo.com" },
];

/** Cuenta animada hasta `to` cuando entra en pantalla (o directo si hay reduced-motion). */
function CountUp({ to, className }: { to: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const reduce = useReducedMotion();
  const [v, setV] = useState(reduce ? to : 0);
  useEffect(() => {
    if (!inView || reduce) return;
    const c = animate(0, to, { duration: 1.6, ease: "easeOut", onUpdate: (x) => setV(Math.round(x)) });
    return () => c.stop();
  }, [inView, to, reduce]);
  return <span ref={ref} className={className}>{v}</span>;
}

/** Escena hero: PDF -> filas del Sheet -> sobres volando. Bucle de 4 fases. */
function PipelineScene({ dark, labels }: { dark: boolean; labels: { pdf: string; sheet: string; sent: string } }) {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState(reduce ? 3 : 0);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setPhase((p) => (p + 1) % 4), 2200);
    return () => clearInterval(id);
  }, [reduce]);
  const card = dark ? "bg-[#12141C]/90 border-white/10" : "bg-white/90 border-slate-200 shadow-lg shadow-indigo-900/5";
  const muted = dark ? "text-slate-400" : "text-slate-500";
  return (
    <div className="relative w-full max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-[1fr_auto_1.2fr_auto_1fr] items-center gap-4 md:gap-2">
      {/* PDF */}
      <div className="relative h-44 flex items-center justify-center">
        {[2, 1, 0].map((i) => (
          <motion.div
            key={i}
            animate={
              phase === 0
                ? { x: i * 4, y: -i * 4, rotate: 0, opacity: 1 }
                : { x: phase >= 1 ? -i * 10 : 0, y: phase >= 1 ? i * 8 - 8 : 0, rotate: phase >= 1 ? (i - 1) * 6 : 0, opacity: 1 }
            }
            transition={{ type: "spring", stiffness: 120, damping: 14 }}
            className={`absolute w-28 h-36 rounded-lg border ${card} p-3 flex flex-col gap-2`}
          >
            <FileText className="w-4 h-4 text-indigo-400" />
            <div className={`h-1.5 rounded ${dark ? "bg-white/15" : "bg-slate-200"} w-3/4`} />
            <div className="h-2 rounded bg-gradient-to-r from-[#2563EB] to-[#8B5CF6] w-1/2" />
            <div className={`h-1.5 rounded ${dark ? "bg-white/10" : "bg-slate-100"} w-2/3`} />
          </motion.div>
        ))}
        <span className={`absolute -bottom-2 text-[11px] font-semibold ${muted}`}>{labels.pdf}</span>
      </div>
      <Arrow active={phase >= 1} />
      {/* Sheet */}
      <div className={`rounded-2xl border ${card} overflow-hidden`}>
        <div className={`flex items-center gap-2 px-3 py-2 text-[11px] font-semibold border-b ${dark ? "border-white/10" : "border-slate-200"}`}>
          <Table2 className="w-3.5 h-3.5 text-emerald-500" /> {labels.sheet}
        </div>
        {FLOW_PEOPLE.slice(0, 4).map((p, i) => (
          <motion.div
            key={p.m}
            animate={{ backgroundColor: phase >= 2 ? (dark ? "rgba(16,185,129,0.10)" : "rgba(16,185,129,0.08)") : "rgba(0,0,0,0)" }}
            transition={{ delay: phase === 2 ? i * 0.18 : 0 }}
            className={`flex items-center justify-between gap-2 px-3 py-2 text-[11px] ${i ? (dark ? "border-t border-white/5" : "border-t border-slate-100") : ""}`}
          >
            <span className="font-semibold truncate">{p.n}</span>
            <span className={`${muted} truncate hidden sm:inline`}>{p.m}</span>
            <motion.span
              animate={{ scale: phase >= 2 ? 1 : 0, opacity: phase >= 2 ? 1 : 0 }}
              transition={{ delay: phase === 2 ? 0.1 + i * 0.18 : 0, type: "spring", stiffness: 300 }}
              className="text-emerald-500 shrink-0"
            >
              <Check className="w-3.5 h-3.5" />
            </motion.span>
          </motion.div>
        ))}
      </div>
      <Arrow active={phase >= 3} />
      {/* Gmail / sobres */}
      <div className="relative h-44 flex items-center justify-center">
        <div className={`w-24 h-24 rounded-2xl border ${card} flex items-center justify-center`}>
          <Mail className="w-9 h-9 text-rose-400" />
        </div>
        {FLOW_PEOPLE.slice(0, 4).map((_, i) => (
          <motion.div
            key={i}
            initial={false}
            animate={
              phase === 3
                ? { x: [-80, 0], y: [-30 + i * 16, 0], opacity: [0, 1, 0], scale: [1, 0.6] }
                : { opacity: 0 }
            }
            transition={{ duration: 0.9, delay: phase === 3 ? i * 0.22 : 0, ease: "easeIn" }}
            className="absolute"
          >
            <Send className="w-5 h-5 text-indigo-400 -rotate-12" />
          </motion.div>
        ))}
        <span className={`absolute -bottom-2 text-[11px] font-semibold ${muted} flex items-center gap-1`}>
          <b className="text-indigo-400 text-sm"><CountUp to={4} /></b> {labels.sent}
        </span>
      </div>
    </div>
  );
}

function Arrow({ active }: { active: boolean }) {
  return (
    <motion.div animate={{ opacity: active ? 1 : 0.25, x: active ? [0, 4, 0] : 0 }} transition={{ duration: 0.8 }} className="hidden md:flex justify-center text-indigo-400">
      <ArrowRight className="w-5 h-5" />
    </motion.div>
  );
}

/** Tarjeta con halo que sigue el cursor (CSS vars). */
function SpotCard({ dark, className = "", children }: { dark: boolean; className?: string; children: React.ReactNode; key?: React.Key }) {
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.55 }}
      onMouseMove={onMove}
      className={`group relative overflow-hidden rounded-3xl border p-6 ${dark ? "bg-[#10121A] border-white/10" : "bg-white border-slate-200 shadow-sm"} ${className}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{ background: `radial-gradient(260px circle at var(--mx,50%) var(--my,50%), ${dark ? "rgba(139,92,246,0.18)" : "rgba(99,102,241,0.12)"}, transparent 70%)` }}
      />
      <div className="relative">{children}</div>
    </motion.div>
  );
}

/** Fondo "aurora": manchas de luz (radial-gradient, sin filtro blur = barato) que derivan solo con
 * transform. `active` hace crossfade por opacidad: cambiar de segmento no repinta nada pesado. */
function Aurora({ colors, dark, active = true, className = "" }: { colors: [string, string, string]; dark: boolean; active?: boolean; className?: string; key?: React.Key }) {
  const reduce = useReducedMotion();
  const [ref, vis] = useVisible<HTMLDivElement>();
  const spots = [
    { pos: "-top-32 -left-24 w-[34rem] h-[34rem]", mv: { x: [0, 60, 0], y: [0, 40, 0] }, d: 18 },
    { pos: "top-1/4 -right-32 w-[38rem] h-[38rem]", mv: { x: [0, -50, 0], y: [0, 60, 0] }, d: 22 },
    { pos: "-bottom-36 left-1/3 w-[32rem] h-[32rem]", mv: { x: [0, 70, 0], y: [0, -40, 0] }, d: 26 },
  ];
  return (
    <div ref={ref} aria-hidden className={`absolute inset-0 overflow-hidden pointer-events-none transition-opacity duration-700 ${className}`} style={{ opacity: active ? 1 : 0 }}>
      {spots.map((sp, k) => (
        <motion.div
          key={k}
          animate={active && vis && !reduce ? sp.mv : undefined}
          transition={{ duration: sp.d, repeat: Infinity, ease: "easeInOut" }}
          className={`absolute rounded-full ${sp.pos}`}
          style={{ background: `radial-gradient(circle, ${colors[k]} 0%, transparent 68%)`, opacity: dark ? 0.34 : 0.42 }}
        />
      ))}
    </div>
  );
}

function DotGrid({ dark }: { dark: boolean }) {
  return (
    <div
      aria-hidden
      className={`absolute inset-0 pointer-events-none ${dark ? "opacity-[0.18]" : "opacity-[0.35]"}`}
      style={{
        backgroundImage: `radial-gradient(${dark ? "#8B9BD0" : "#A5B0D6"} 1px, transparent 1px)`,
        backgroundSize: "26px 26px",
        maskImage: "radial-gradient(ellipse at 50% 40%, black, transparent 75%)",
        WebkitMaskImage: "radial-gradient(ellipse at 50% 40%, black, transparent 75%)",
      }}
    />
  );
}

/** Lineas de datos que fluyen entre las tarjetas del flujo (SVG, dash animado). */
function DataStream({ dark }: { dark: boolean }) {
  const reduce = useReducedMotion();
  return (
    <svg aria-hidden className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 1200 400">
      {[90, 200, 310].map((y, i) => (
        <motion.path
          key={y}
          d={`M -20 ${y} C 300 ${y - 70}, 500 ${y + 80}, 800 ${y - 20} S 1100 ${y + 30}, 1240 ${y}`}
          fill="none"
          stroke={dark ? "rgba(139,92,246,0.35)" : "rgba(99,102,241,0.30)"}
          strokeWidth={1.5}
          strokeDasharray="6 14"
          vectorEffect="non-scaling-stroke"
          animate={reduce ? undefined : { strokeDashoffset: [0, -200] }}
          transition={{ duration: 7 + i * 2, repeat: Infinity, ease: "linear" }}
        />
      ))}
    </svg>
  );
}

/** Red de particulas en <canvas>: puntos que derivan y se unen con lineas; huyen del cursor.
 * Solo corre mientras la seccion es visible (IntersectionObserver). Con reduced-motion: un cuadro. */
function ParticleField({ dark }: { dark: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rgb = dark ? "139,155,230" : "99,102,241";
    let w = 0, h = 0, raf = 0, running = false;
    const mouse = { x: -999, y: -999 };
    type P = { x: number; y: number; vx: number; vy: number };
    let ps: P[] = [];
    const resize = () => {
      const r = cv.getBoundingClientRect();
      w = r.width; h = r.height;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(80, Math.max(26, (w * h) / 20000)));
      ps = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35 }));
    };
    const frame = (move: boolean) => {
      ctx.clearRect(0, 0, w, h);
      for (const p of ps) {
        if (move) {
          p.x += p.vx; p.y += p.vy;
          if (p.x < 0 || p.x > w) p.vx *= -1;
          if (p.y < 0 || p.y > h) p.vy *= -1;
          const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
          if (d2 < 130 * 130 && d2 > 1) { const d = Math.sqrt(d2), f = (130 - d) / 130; p.x += (dx / d) * f * 2.2; p.y += (dy / d) * f * 2.2; }
        }
        ctx.fillStyle = `rgba(${rgb},0.65)`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2); ctx.fill();
      }
      for (let a = 0; a < ps.length; a++) for (let b = a + 1; b < ps.length; b++) {
        const dx = ps[a].x - ps[b].x, dy = ps[a].y - ps[b].y, d2 = dx * dx + dy * dy;
        if (d2 < 130 * 130) { ctx.strokeStyle = `rgba(${rgb},${0.28 * (1 - Math.sqrt(d2) / 130)})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ps[a].x, ps[a].y); ctx.lineTo(ps[b].x, ps[b].y); ctx.stroke(); }
      }
    };
    const loop = () => { frame(true); raf = running ? requestAnimationFrame(loop) : 0; };
    const onMove = (e: MouseEvent) => { const r = cv.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; };
    resize();
    frame(false);
    const ro = new ResizeObserver(() => { resize(); frame(false); });
    ro.observe(cv);
    let io: IntersectionObserver | undefined;
    if (!reduce) {
      window.addEventListener("mousemove", onMove, { passive: true });
      io = new IntersectionObserver((entries) => {
        const en = entries[entries.length - 1];
        if (en.isIntersecting && !running) { running = true; raf = requestAnimationFrame(loop); }
        else if (!en.isIntersecting) { running = false; cancelAnimationFrame(raf); }
      });
      io.observe(cv);
    }
    return () => { running = false; cancelAnimationFrame(raf); ro.disconnect(); io?.disconnect(); window.removeEventListener("mousemove", onMove); };
  }, [dark, reduce]);
  return <canvas ref={ref} aria-hidden className="absolute inset-0 w-full h-full pointer-events-none" />;
}

/** Anillos que laten hacia afuera desde el centro (solo scale + opacity). */
function PulseRings({ dark }: { dark: boolean }) {
  const reduce = useReducedMotion();
  const [ref, vis] = useVisible<HTMLDivElement>();
  return (
    <div ref={ref} aria-hidden className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
      {[0, 1, 2, 3].map((k) => (
        <motion.span
          key={k}
          initial={{ scale: 0.25, opacity: 0 }}
          animate={reduce ? { scale: 0.6 + k * 0.3, opacity: 0.2 } : vis ? { scale: [0.25, 1.7], opacity: [0.45, 0] } : { scale: 0.25, opacity: 0 }}
          transition={{ duration: 8, repeat: Infinity, delay: k * 2, ease: "easeOut" }}
          className={`absolute w-[44rem] h-[44rem] rounded-full border ${dark ? "border-indigo-400/40" : "border-indigo-500/30"}`}
        />
      ))}
    </div>
  );
}

/** Iconos de la marca (sobres, PDFs, enviados) que suben despacio por la seccion. */
function FloatingGlyphs({ dark }: { dark: boolean }) {
  const reduce = useReducedMotion();
  const [ref, vis] = useVisible<HTMLDivElement>();
  const Icons = [Mail, FileText, Send, Check, Mail, FileText, Send];
  if (reduce) return null;
  return (
    <div ref={ref} aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
      {Icons.map((Ic, k) => (
        <motion.div
          key={k}
          initial={{ y: 0, opacity: 0 }}
          animate={vis ? { y: ["0vh", "-120vh"], opacity: [0, 0.9, 0.9, 0], rotate: [0, k % 2 ? 25 : -25] } : { opacity: 0 }}
          transition={{ duration: 16 + k * 2, repeat: Infinity, delay: k * 2.3, ease: "linear" }}
          className="absolute -bottom-12"
          style={{ left: `${6 + k * 14}%` }}
        >
          <Ic className={`${k % 3 === 0 ? "w-9 h-9" : "w-6 h-6"} ${dark ? "text-indigo-300/25" : "text-indigo-500/25"}`} />
        </motion.div>
      ))}
    </div>
  );
}

/** Cuadricula que se desplaza sin fin (solo transform: una celda y reinicia). */
function GridDrift({ dark }: { dark: boolean }) {
  const reduce = useReducedMotion();
  const [ref, vis] = useVisible<HTMLDivElement>();
  return (
    <div ref={ref} aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none" style={{ maskImage: "radial-gradient(ellipse at 50% 50%, black, transparent 75%)", WebkitMaskImage: "radial-gradient(ellipse at 50% 50%, black, transparent 75%)" }}>
      <motion.div
        animate={reduce || !vis ? undefined : { x: [0, 56], y: [0, 56] }}
        transition={{ duration: 7, repeat: Infinity, ease: "linear" }}
        className="absolute -inset-14 opacity-[0.22]"
        style={{ backgroundImage: `linear-gradient(${dark ? "#6B7BB8" : "#B4BEDD"} 1px, transparent 1px), linear-gradient(90deg, ${dark ? "#6B7BB8" : "#B4BEDD"} 1px, transparent 1px)`, backgroundSize: "56px 56px" }}
      />
    </div>
  );
}

/** Sobres que despegan hacia arriba-derecha, en bucle (llamada final). */
function LaunchTrail() {
  const reduce = useReducedMotion();
  const [ref, vis] = useVisible<HTMLDivElement>();
  if (reduce) return null;
  return (
    <div ref={ref} aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
      {[0, 1, 2, 3, 4].map((k) => (
        <motion.div
          key={k}
          initial={{ opacity: 0 }}
          animate={vis ? { x: [0, 360], y: [0, -220], opacity: [0, 1, 0], scale: [0.7, 1.1] } : { opacity: 0 }}
          transition={{ duration: 3.6, repeat: Infinity, delay: k * 0.72, ease: "easeIn" }}
          className="absolute"
          style={{ left: `${4 + k * 9}%`, bottom: `${6 + (k % 3) * 14}%` }}
        >
          <Send className="w-6 h-6 text-white/40 -rotate-12" />
        </motion.div>
      ))}
    </div>
  );
}

/** Micro-animacion de cada tarjeta del bento (solo transform/opacity, bucles suaves). */
function MiniViz({ kind, dark }: { kind: 0 | 1 | 2 | 3; dark: boolean }) {
  const reduce = useReducedMotion();
  const loop = (extra: object = {}) => (reduce ? {} : { repeat: Infinity, ease: "easeInOut" as const, ...extra });
  const base = dark ? "bg-white/10" : "bg-slate-200";
  const wrap = `relative h-24 mb-5 rounded-2xl overflow-hidden flex items-center justify-center ${dark ? "bg-white/[0.03]" : "bg-slate-50"}`;
  if (kind === 0)
    return (
      <div className={wrap} aria-hidden>
        {[0, 1, 2].map((k) => (
          <motion.div
            key={k}
            animate={reduce ? { x: (k - 1) * 34 } : { x: [0, (k - 1) * 40, 0], rotate: [0, (k - 1) * 8, 0] }}
            transition={{ duration: 4, delay: 0.1 * k, ...loop() }}
            className={`absolute w-12 h-16 rounded-md border ${dark ? "border-white/15 bg-[#171A28]" : "border-slate-200 bg-white shadow-sm"} p-1.5 space-y-1`}
          >
            <i className="block h-1 w-3/4 rounded bg-gradient-to-r from-[#2563EB] to-[#8B5CF6]" />
            <i className={`block h-1 w-full rounded ${base}`} />
            <i className={`block h-1 w-2/3 rounded ${base}`} />
          </motion.div>
        ))}
      </div>
    );
  if (kind === 1)
    return (
      <div className={`${wrap} flex-col gap-1.5 px-4`} aria-hidden>
        {[0, 1, 2].map((k) => (
          <motion.div
            key={k}
            animate={reduce ? undefined : { backgroundColor: ["rgba(16,185,129,0)", "rgba(16,185,129,0.22)", "rgba(16,185,129,0)"] }}
            transition={{ duration: 3.6, delay: k * 1.2, ...loop() }}
            className="w-full h-5 rounded-md flex items-center gap-2 px-2"
          >
            <i className={`h-1.5 w-1/4 rounded ${base}`} />
            <i className={`h-1.5 w-1/3 rounded ${base}`} />
            <Check className="w-3 h-3 ml-auto text-emerald-500" />
          </motion.div>
        ))}
      </div>
    );
  if (kind === 2)
    return (
      <div className={`${wrap} gap-3`} aria-hidden>
        <ThinkingOrb size={84} />
        <div className="relative px-2">
          <span className="relative text-lg font-extrabold font-display tracking-tight">Ana Gómez</span>
          <motion.span
            animate={reduce ? undefined : { x: ["-6px", "92px"] }}
            transition={{ duration: 2.6, ...loop({ repeatType: "reverse" }) }}
            className="absolute -inset-y-1 left-0 w-0.5 rounded bg-gradient-to-b from-transparent via-[#8B5CF6] to-transparent shadow-[0_0_14px_3px_rgba(139,92,246,0.55)]"
          />
        </div>
      </div>
    );
  return (
    <div className={wrap} aria-hidden>
      <Mail className="w-9 h-9 text-rose-400" />
      <motion.span
        animate={reduce ? undefined : { x: [-90, 60], y: [26, -26], opacity: [0, 1, 0], scale: [0.7, 1.15] }}
        transition={{ duration: 2.8, ...loop({ ease: "easeIn" }) }}
        className="absolute"
      >
        <Send className="w-5 h-5 text-indigo-400 -rotate-12" />
      </motion.span>
    </div>
  );
}

/** Orbe punteado "IA pensando": puntos en una esfera que gira y late. Canvas, solo corre visible. */
function ThinkingOrb({ size = 84 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const inView = useInView(ref);
  const reduce = useReducedMotion();
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx || (!inView && !reduce)) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = size * dpr; cv.height = size * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const N = 160;
    const pts = Array.from({ length: N }, (_, i) => {
      const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963;
      return { x: Math.cos(th) * r, y, z: Math.sin(th) * r };
    });
    let raf = 0;
    const draw = (t: number) => {
      ctx.clearRect(0, 0, size, size);
      const rot = t * 0.0007, tilt = 0.4, pulse = 1 + 0.07 * Math.sin(t * 0.003);
      const R = size * 0.4 * pulse;
      for (const q of pts) {
        const x1 = q.x * Math.cos(rot) + q.z * Math.sin(rot), z1 = -q.x * Math.sin(rot) + q.z * Math.cos(rot);
        const y2 = q.y * Math.cos(tilt) - z1 * Math.sin(tilt), z2 = q.y * Math.sin(tilt) + z1 * Math.cos(tilt);
        const depth = (z2 + 1) / 2, mix = (q.y + 1) / 2;
        const rr = Math.round(37 + (167 - 37) * mix), gg = Math.round(99 + (139 - 99) * mix), bb = Math.round(235 + (250 - 235) * mix);
        ctx.fillStyle = `rgba(${rr},${gg},${bb},${0.2 + 0.8 * depth})`;
        ctx.beginPath(); ctx.arc(size / 2 + x1 * R, size / 2 + y2 * R, 0.7 + depth * 1.2, 0, Math.PI * 2); ctx.fill();
      }
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduce, size]);
  return <canvas ref={ref} aria-hidden style={{ width: size, height: size }} />;
}

/** Pila de certificados con fisica real (Matter.js): caen, rebotan y se pueden arrastrar con el
 * mouse. Sin mouse fino (tactil) no captura el gesto, asi la pagina sigue scrolleando. */
function CertificatePile() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const visible = useInView(wrapRef, { margin: "-10% 0px" });
  const reduce = useReducedMotion();
  const live = useRef<{ stop: () => void; start: () => void } | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current, cv = cvRef.current;
    const ctx = cv?.getContext("2d");
    if (!wrap || !cv || !ctx) return;
    const { Engine, Bodies, Composite, Mouse, MouseConstraint } = Matter;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth, h = wrap.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const engine = Engine.create({ gravity: { x: 0, y: 1 } });
    const CW = 76, CH = 52;
    const count = w < 520 ? 10 : 16;
    const walls = [
      Bodies.rectangle(w / 2, h + 30, w * 2, 60, { isStatic: true }),
      Bodies.rectangle(-30, h / 2, 60, h * 4, { isStatic: true }),
      Bodies.rectangle(w + 30, h / 2, 60, h * 4, { isStatic: true }),
    ];
    const certs = Array.from({ length: count }, (_, i) =>
      Bodies.rectangle(w * (0.12 + Math.random() * 0.76), reduce ? h - 30 - i * 6 : -40 - i * 70, CW, CH, {
        chamfer: { radius: 7 }, restitution: 0.35, friction: 0.5, frictionAir: 0.01, angle: (Math.random() - 0.5) * 1.2,
      })
    );
    Composite.add(engine.world, [...walls, ...certs]);

    let mc: Matter.MouseConstraint | null = null;
    if (!reduce && window.matchMedia("(pointer: fine)").matches) {
      const mouse = Mouse.create(cv);
      mouse.pixelRatio = dpr;
      // no secuestrar la rueda del mouse: la pagina debe seguir scrolleando
      cv.removeEventListener("wheel", (mouse as any).mousewheel);
      cv.removeEventListener("mousewheel", (mouse as any).mousewheel);
      cv.removeEventListener("DOMMouseScroll", (mouse as any).mousewheel);
      mc = MouseConstraint.create(engine, { mouse, constraint: { stiffness: 0.2, render: { visible: false } } });
      Composite.add(engine.world, mc);
    } else {
      cv.style.pointerEvents = "none";
    }

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const b of certs) {
        ctx.save();
        ctx.translate(b.position.x, b.position.y);
        ctx.rotate(b.angle);
        ctx.shadowColor = "rgba(15,23,42,0.35)"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath(); ctx.roundRect(-CW / 2, -CH / 2, CW, CH, 7); ctx.fill();
        ctx.shadowColor = "transparent";
        const g = ctx.createLinearGradient(-CW / 2, 0, CW / 2, 0);
        g.addColorStop(0, "#2563EB"); g.addColorStop(1, "#8B5CF6");
        ctx.fillStyle = g; ctx.fillRect(-CW / 2 + 8, -CH / 2 + 9, CW * 0.45, 5);
        ctx.fillStyle = "#CBD5E1";
        ctx.fillRect(-CW / 2 + 8, -CH / 2 + 20, CW - 16, 3);
        ctx.fillRect(-CW / 2 + 8, -CH / 2 + 28, CW * 0.6, 3);
        ctx.restore();
      }
    };

    if (reduce) {
      for (let i = 0; i < 400; i++) Engine.update(engine, 1000 / 60);
      draw();
      live.current = null;
      return () => { Composite.clear(engine.world, false); Engine.clear(engine); };
    }

    let raf = 0, running = false, last = performance.now();
    const loop = (now: number) => {
      Engine.update(engine, Math.min(32, now - last)); last = now;
      draw();
      raf = running ? requestAnimationFrame(loop) : 0;
    };
    live.current = {
      start: () => { if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(loop); } },
      stop: () => { running = false; cancelAnimationFrame(raf); },
    };
    return () => {
      live.current?.stop(); live.current = null;
      if (mc) Composite.remove(engine.world, mc);
      Composite.clear(engine.world, false); Engine.clear(engine);
    };
  }, [reduce]);

  useEffect(() => { if (visible) live.current?.start(); else live.current?.stop(); }, [visible]);

  return (
    <div ref={wrapRef} aria-hidden className="relative -mx-10 sm:-mx-16 mt-8 h-48">
      <canvas ref={cvRef} className="absolute inset-0 w-full h-full touch-pan-y" />
    </div>
  );
}

/** Pagina del PDF en la historia de scroll: su posicion se calcula del progreso 0..1. */
function StoryPage({ i, p, dark }: { i: number; p: MotionValue<number>; dark: boolean; key?: React.Key }) {
  const listY = (i - 2) * 66;
  const out = 0.72 + i * 0.045;
  const x = useTransform(p, [0, 0.3, out, 0.97], [-210 + i * 5, -210, -210, 205]);
  const y = useTransform(p, [0, 0.3, out, 0.97], [-i * 5, listY, listY, 0]);
  const scale = useTransform(p, [out, 0.97], [1, 0.3]);
  const opacity = useTransform(p, [out, 0.97, 1], [1, 0.9, 0]);
  return (
    <motion.div style={{ x, y, scale, opacity }} className={`absolute left-1/2 top-1/2 -ml-11 -mt-8 w-22 h-16 rounded-lg border p-2 space-y-1.5 ${dark ? "bg-[#14172A] border-white/15" : "bg-white border-slate-200 shadow-md"}`}>
      <i className="block h-1.5 w-3/4 rounded bg-gradient-to-r from-[#2563EB] to-[#8B5CF6]" />
      <i className={`block h-1 w-full rounded ${dark ? "bg-white/15" : "bg-slate-200"}`} />
      <i className={`block h-1 w-2/3 rounded ${dark ? "bg-white/10" : "bg-slate-100"}`} />
    </motion.div>
  );
}

function StoryRow({ i, p, dark, name, mail }: { i: number; p: MotionValue<number>; dark: boolean; name: string; mail: string; key?: React.Key }) {
  const on = useTransform(p, [0.42 + i * 0.05, 0.47 + i * 0.05], [0, 1]);
  const bg = useTransform(on, [0, 1], ["rgba(16,185,129,0)", dark ? "rgba(16,185,129,0.14)" : "rgba(16,185,129,0.10)"]);
  return (
    <motion.div style={{ backgroundColor: bg }} className={`flex items-center justify-between gap-2 px-3 h-[66px] text-xs ${i ? (dark ? "border-t border-white/5" : "border-t border-slate-100") : ""}`}>
      <div className="min-w-0"><p className="font-semibold truncate">{name}</p><p className="text-slate-500 truncate">{mail}</p></div>
      <motion.span style={{ opacity: on, scale: on }} className="text-emerald-500 shrink-0"><Check className="w-4 h-4" /></motion.span>
    </motion.div>
  );
}

/** Historia de scroll: la seccion queda fija y el avance del scroll "reproduce" el flujo
 * PDF -> Sheet -> Gmail. Solo escritorio (md+). Con reduced-motion muestra el estado final. */
function ScrollStory({ steps, dark, muted, sentLabel }: { steps: readonly { t: string; d: string }[]; dark: boolean; muted: string; sentLabel: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const fixed = useMotionValue(1);
  const p = reduce ? fixed : scrollYProgress;
  const [step, setStep] = useState(reduce ? 2 : 0);
  useMotionValueEvent(p, "change", (v) => setStep(v < 0.34 ? 0 : v < 0.7 ? 1 : 2));
  const sheetOp = useTransform(p, [0.24, 0.38], [0, 1]);
  const sheetX = useTransform(p, [0.24, 0.38], [24, 0]);
  const mailOp = useTransform(p, [0.6, 0.74], [0.35, 1]);
  const bar = useTransform(p, [0, 1], ["0%", "100%"]);
  const counter = useTransform(p, (v) => `${Math.round(Math.max(0, Math.min(1, (v - 0.74) / 0.23)) * 5)} / 5`);
  return (
    <div ref={ref} className="hidden md:block relative" style={{ height: reduce ? "auto" : "280vh" }}>
      <div className={`${reduce ? "" : "sticky top-24"} grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)] gap-10 items-center`} style={{ minHeight: reduce ? undefined : "calc(100vh - 8rem)" }}>
        <div className="space-y-4">
          {steps.map((s2, k) => (
            <motion.div key={s2.t} animate={{ opacity: step === k ? 1 : 0.4, x: step === k ? 0 : -6 }} transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }} className={`rounded-2xl border p-5 ${step === k ? (dark ? "bg-[#10121A] border-indigo-400/40" : "bg-white border-indigo-300 shadow-lg shadow-indigo-900/5") : (dark ? "border-white/10" : "border-slate-200")}`}>
              <div className="flex items-center gap-3 mb-1.5">
                <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#2563EB] to-[#8B5CF6] text-white text-sm font-extrabold flex items-center justify-center">{k + 1}</span>
                <h3 className="text-lg font-extrabold">{s2.t}</h3>
              </div>
              <p className={`text-sm leading-relaxed ${muted}`}>{s2.d}</p>
            </motion.div>
          ))}
          <div className={`h-1 rounded-full overflow-hidden ${dark ? "bg-white/10" : "bg-slate-200"}`}><motion.div style={{ width: bar }} className="h-full bg-gradient-to-r from-[#2563EB] to-[#8B5CF6]" /></div>
        </div>
        <div className={`relative h-[420px] rounded-3xl border overflow-hidden ${dark ? "bg-[#0D1020]/80 border-white/10" : "bg-white/70 border-slate-200 shadow-xl shadow-indigo-900/5"}`}>
          <motion.div style={{ opacity: sheetOp, x: sheetX }} className={`absolute left-1/2 top-1/2 -ml-28 w-56 -mt-[165px] rounded-2xl border overflow-hidden ${dark ? "bg-[#12141F] border-white/10" : "bg-white border-slate-200 shadow-lg"}`}>
            {FLOW_PEOPLE.map((q, k) => <StoryRow key={q.m} i={k} p={p} dark={dark} name={q.n} mail={q.m} />)}
          </motion.div>
          {FLOW_PEOPLE.map((q, k) => <StoryPage key={q.m} i={k} p={p} dark={dark} />)}
          <motion.div style={{ opacity: mailOp }} className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col items-center gap-2 w-24">
            <div className={`w-20 h-20 rounded-2xl border flex items-center justify-center ${dark ? "bg-[#12141F] border-white/10" : "bg-white border-slate-200 shadow-md"}`}><Mail className="w-9 h-9 text-rose-400" /></div>
            <motion.b className="text-indigo-400 text-sm tabular-nums">{counter}</motion.b>
            <span className={`text-[10px] text-center leading-tight ${muted}`}>{sentLabel}</span>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

/** Ciclo de vida de tus datos: una linea de tiempo animada (subes -> se procesa -> sale de tu Gmail
 * -> se borra) con una cuenta regresiva que vacia el anillo al final. Todo con transform/opacity y
 * un trazo SVG; con reduced-motion queda todo encendido y quieto. */
function DataLifecycle({ steps, dark, muted }: { steps: readonly { t: string; d: string }[]; dark: boolean; muted: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-15% 0px" });
  const D = 7;
  const loop = reduce || !inView ? undefined : { duration: D, repeat: Infinity, ease: "linear" as const, repeatDelay: 1.2 };
  const icons = [FileText, Lock, Mail, ShieldCheck];
  const R = 20, C = 2 * Math.PI * R;
  return (
    <div ref={ref} className="relative">
      {/* pista (solo escritorio) */}
      <div aria-hidden className={`hidden md:block absolute left-[12.5%] right-[12.5%] top-8 h-0.5 rounded ${dark ? "bg-white/10" : "bg-slate-200"}`}>
        <motion.div
          initial={{ scaleX: reduce ? 1 : 0 }}
          animate={reduce ? { scaleX: 1 } : inView ? { scaleX: [0, 1, 1, 0] } : { scaleX: 0 }}
          transition={loop ? { ...loop, times: [0, 0.7, 0.97, 1] } : undefined}
          className="h-full origin-left bg-gradient-to-r from-[#2563EB] to-[#8B5CF6]"
        />
      </div>
      <div className="grid md:grid-cols-4 gap-8 md:gap-4">
        {steps.map((st, k) => {
          const Ic = icons[k];
          const at = Math.max(k * 0.2333, 0.001);
          const last = k === steps.length - 1;
          return (
            <div key={st.t} className="relative flex md:flex-col items-start md:items-center gap-4 md:gap-3 md:text-center">
              <div className="relative shrink-0 w-16 h-16">
                <div className={`absolute inset-0 rounded-2xl border ${dark ? "bg-[#10121A] border-white/10" : "bg-white border-slate-200 shadow-sm"}`} />
                <motion.div
                  aria-hidden
                  initial={{ opacity: reduce ? 1 : 0 }}
                  animate={reduce ? { opacity: 1 } : inView ? { opacity: [0, 0, 1, 1, 0] } : { opacity: 0 }}
                  transition={loop ? { ...loop, times: [0, at, Math.min(at + 0.06, 0.96), 0.97, 1] } : undefined}
                  className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#2563EB] to-[#8B5CF6] shadow-lg shadow-indigo-600/30"
                />
                <div className="relative w-full h-full flex items-center justify-center">
                  <Ic className={`w-7 h-7 ${dark ? "text-white" : "text-slate-800"} mix-blend-normal`} />
                </div>
                {last && (
                  <svg aria-hidden viewBox="0 0 48 48" className="absolute -left-2 -top-2 md:left-auto md:-right-2 w-9 h-9 -rotate-90">
                    <circle cx="24" cy="24" r={R} fill={dark ? "#0B0D16" : "#FFFFFF"} stroke={dark ? "rgba(255,255,255,0.12)" : "#E2E8F0"} strokeWidth="3" />
                    <motion.circle
                      cx="24" cy="24" r={R} fill="none" stroke="#10B981" strokeWidth="3" strokeLinecap="round" strokeDasharray={C}
                      initial={{ strokeDashoffset: reduce ? C : 0 }}
                      animate={reduce ? { strokeDashoffset: C } : inView ? { strokeDashoffset: [0, 0, C, C] } : { strokeDashoffset: 0 }}
                      transition={loop ? { ...loop, times: [0, 0.68, 0.95, 1] } : undefined}
                    />
                  </svg>
                )}
              </div>
              <div className="md:px-2">
                <h3 className="font-extrabold text-base">{st.t}</h3>
                <p className={`text-xs leading-relaxed mt-1 ${muted}`}>{st.d}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const AUD_STYLE = [
  { icon: Building2, c: ["#2563EB", "#4F46E5", "#0EA5E9"] as [string, string, string], g: "from-[#2563EB] to-[#4F46E5]" },
  { icon: HeartHandshake, c: ["#10B981", "#14B8A6", "#22C55E"] as [string, string, string], g: "from-[#10B981] to-[#14B8A6]" },
  { icon: GraduationCap, c: ["#F59E0B", "#F97316", "#EAB308"] as [string, string, string], g: "from-[#F59E0B] to-[#F97316]" },
  { icon: Heart, c: ["#EC4899", "#F43F5E", "#A855F7"] as [string, string, string], g: "from-[#EC4899] to-[#F43F5E]" },
];

type AudItem = { id: string; label: string; cert: string; who: string; line: string; subject: string; uses: readonly string[] };

/** "Para quien": pestañas con fondo animado que cambia de color e iconos flotantes. */
function AudienceSection({ items, dark, muted, line, title, sub, badge }: { items: readonly AudItem[]; dark: boolean; muted: string; line: string; title: string; sub: string; badge: string }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [manual, setManual] = useState(false);
  const [hold, setHold] = useState(false);
  useEffect(() => {
    if (manual || hold || reduce) return;
    const id = setInterval(() => setI((x) => (x + 1) % items.length), 5200);
    return () => clearInterval(id);
  }, [manual, hold, reduce, items.length]);
  const a = items[i];
  const st = AUD_STYLE[i];
  const Icon = st.icon;
  return (
    <section id="v2-audiencias" onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onFocusCapture={() => setHold(true)} onBlurCapture={() => setHold(false)} className={`relative py-24 border-y ${line} overflow-hidden`}>
      {AUD_STYLE.map((a2, k) => <Aurora key={k} colors={a2.c} dark={dark} active={k === i} />)}
      <DotGrid dark={dark} />
      {/* iconos flotantes del segmento activo */}
      <AnimatePresence mode="wait">
        <motion.div key={a.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-hidden className="absolute inset-0 pointer-events-none">
          {[8, 24, 70, 88, 48].map((left, k) => (
            <motion.div
              key={k}
              animate={reduce ? undefined : { y: [0, -26, 0], rotate: [0, k % 2 ? 12 : -12, 0] }}
              transition={{ duration: 6 + k, repeat: Infinity, ease: "easeInOut", delay: k * 0.6 }}
              className="absolute"
              style={{ left: `${left}%`, top: `${14 + ((k * 23) % 66)}%` }}
            >
              <Icon className={`w-8 h-8 ${dark ? "text-white/10" : "text-slate-900/10"}`} />
            </motion.div>
          ))}
        </motion.div>
      </AnimatePresence>

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 space-y-10">
        <div className="text-center space-y-3">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight max-w-3xl mx-auto">{dot(title)}</h2>
          <p className={`text-sm max-w-2xl mx-auto ${muted}`}>{sub}</p>
        </div>

        <div role="tablist" className="flex flex-wrap justify-center gap-2">
          {items.map((it, k) => {
            const TabIcon = AUD_STYLE[k].icon;
            const on = k === i;
            return (
              <button
                key={it.id}
                role="tab"
                id={`aud-tab-${k}`}
                aria-selected={on}
                aria-controls="aud-panel"
                tabIndex={on ? 0 : -1}
                onClick={() => { setI(k); setManual(true); }}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                  e.preventDefault();
                  const n = (k + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length;
                  setI(n); setManual(true);
                  document.getElementById(`aud-tab-${n}`)?.focus();
                }}
                className={`relative px-4 py-2.5 rounded-full text-xs sm:text-sm font-bold flex items-center gap-2 border transition-colors ${on ? "text-white border-transparent" : dark ? "border-white/10 bg-white/5 hover:bg-white/10" : "border-slate-200 bg-white hover:bg-slate-50"}`}
              >
                {on && <motion.span layoutId="aud-pill" className={`absolute inset-0 rounded-full bg-gradient-to-r ${AUD_STYLE[k].g}`} transition={{ type: "spring", stiffness: 380, damping: 30 }} />}
                <span className="relative flex items-center gap-2"><TabIcon className="w-4 h-4" />{it.label}</span>
              </button>
            );
          })}
        </div>

        <div role="tabpanel" id="aud-panel" aria-labelledby={`aud-tab-${i}`} className="grid md:grid-cols-2 gap-6 items-stretch">
          {/* Usos */}
          <div className={`rounded-3xl border p-7 backdrop-blur ${dark ? "bg-[#10121A]/80 border-white/10" : "bg-white/80 border-slate-200 shadow-sm"}`}>
            <AnimatePresence mode="wait">
              <motion.ul key={a.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.3 }} className="space-y-3">
                {a.uses.map((u, k) => (
                  <motion.li key={u} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.06 * k }} className={`flex items-center gap-3 px-4 py-3 rounded-2xl border text-sm font-semibold ${dark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-slate-50/70"}`}>
                    <span className={`w-8 h-8 rounded-lg bg-gradient-to-br ${st.g} text-white flex items-center justify-center shrink-0`}><Check className="w-4 h-4" /></span>
                    {u}
                  </motion.li>
                ))}
              </motion.ul>
            </AnimatePresence>
          </div>
          {/* Vista previa */}
          <div className="relative flex items-center justify-center min-h-[18rem]">
            <AnimatePresence mode="wait">
              <motion.div
                key={a.id}
                initial={{ opacity: 0, rotateY: -25, scale: 0.92 }}
                animate={{ opacity: 1, rotateY: 0, scale: 1 }}
                exit={{ opacity: 0, rotateY: 25, scale: 0.92 }}
                transition={{ duration: 0.4 }}
                style={{ transformPerspective: 1000 }}
                className={`relative w-full max-w-md rounded-3xl border p-8 text-center space-y-3 ${dark ? "bg-[#12141F]/90 border-white/10" : "bg-white/90 border-slate-200 shadow-2xl shadow-indigo-900/10"}`}
              >
                <div aria-hidden className="absolute inset-3 rounded-2xl border-2 border-dashed" style={{ borderColor: `${st.c[0]}55` }} />
                <span className={`absolute top-5 right-6 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${dark ? "bg-white/10 text-slate-300" : "bg-slate-100 text-slate-600"}`}>{badge}</span>
                <div className={`mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br ${st.g} text-white flex items-center justify-center shadow-lg`}><Icon className="w-7 h-7" /></div>
                <p className="text-[11px] uppercase tracking-[0.25em] font-bold" style={{ color: st.c[0] }}>{a.cert}</p>
                <p className="text-3xl font-extrabold font-display">{a.who}</p>
                <p className={`text-sm ${muted}`}>{a.line}</p>
                <p className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full border ${dark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50"}`}><Mail className="w-3.5 h-3.5 text-rose-400" />{a.subject}</p>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function LandingPageV2(p: Props) {
  const { language, theme, setTheme, setLanguage } = p;
  const t = translations[language];
  const c = COPY[language];
  const dark = theme === "dark";
  const reduce = useReducedMotion();
  const puedeEntrar = puedeEntrarConGoogle(p.aceptaAutorizacionDatos, p.aceptaTerminosUso);
  const [faq, setFaq] = useState<number | null>(null);
  const [nombre, setNombre] = useState("");
  // Checkout (copia aislada de la original): precios del dia, paneles de pago y compra por contacto.
  const [resaltar, setResaltar] = useState(false);
  const onNeedConsent = () => {
    setResaltar(true);
    document.getElementById("v2-acceso")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    setTimeout(() => setResaltar(false), 2500);
  };
  const ck = useCheckoutV2({ language, theme, onStart: p.onStart, puedeEntrar, onNeedConsent });
  const precios = ck.precios;

  // Scroll: barra de progreso + parallax del fondo del hero.
  const { scrollYProgress } = useScroll();
  const bar = useSpring(scrollYProgress, { stiffness: 140, damping: 24 });
  const [mqRef, mqVis] = useVisible<HTMLElement>();
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress: heroP } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const orbY = useTransform(heroP, [0, 1], [0, reduce ? 0 : 160]);
  const orbY2 = useTransform(heroP, [0, 1], [0, reduce ? 0 : -110]);

  const nombreMostrado = nombre.trim() || "Ana Gómez";
  const correoDemo = useMemo(() => {
    const base = nombre.trim().toLowerCase().normalize("NFD").replace(/[^a-z\s]/g, "").trim().split(/\s+/).join(".");
    return `${base || "ana.gomez"}@correo.com`;
  }, [nombre]);

  // Todos los CTA de "empezar": con las 2 casillas marcadas inician sesion; sin ellas llevan a marcarlas.
  // onStart NUNCA se llama sin las dos casillas (T11 + Terminos).
  const startOrConsent = () => (puedeEntrar ? p.onStart() : onNeedConsent());

  const bg = dark ? "bg-[#07080D] text-[#E6E9F2]" : "bg-[#F7F8FC] text-[#1E2433]";
  const muted = dark ? "text-slate-400" : "text-slate-600";
  const line = dark ? "border-white/10" : "border-slate-200";
  const gradBtn = "bg-gradient-to-r from-[#2563EB] to-[#8B5CF6] text-white";

  const loginBtn = (extra = "") => (
    <button
      onClick={startOrConsent}
      disabled={p.isLoggingIn}
      className={`${gradBtn} rounded-xl font-bold text-sm flex items-center justify-center gap-2 group shadow-xl shadow-indigo-600/25 hover:opacity-95 active:scale-[0.98] transition disabled:opacity-60 disabled:cursor-not-allowed ${extra}`}
    >
      {p.isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><span>{t.loginWithGoogle}</span><ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" /></>)}
    </button>
  );


  return (
    <MotionConfig reducedMotion="user">
    <div className={`min-h-screen font-sans antialiased overflow-x-clip transition-colors duration-300 ${bg}`}>
      <motion.div style={{ scaleX: bar }} className="fixed top-0 left-0 right-0 h-0.5 origin-left z-[60] bg-gradient-to-r from-[#2563EB] to-[#8B5CF6]" />

      {/* Header */}
      <header className={`sticky top-0 z-50 backdrop-blur-xl border-b ${line} ${dark ? "bg-[#07080D]/70" : "bg-[#F7F8FC]/75"}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <LogoMark className="w-9 h-9" />
            <span className="font-extrabold tracking-tight text-lg whitespace-nowrap hidden min-[430px]:inline bg-gradient-to-r from-[#2563EB] to-[#8B5CF6] bg-clip-text text-transparent">{t.appName}</span>
          </div>
          <nav className={`hidden md:flex items-center gap-7 text-xs font-semibold ${muted}`}>
            <a href="#v2-demo" className="hover:text-indigo-400 transition-colors">{c.navDemo}</a>
            <a href="#v2-flujo" className="hover:text-indigo-400 transition-colors">{c.navFeatures}</a>
            <a href="#v2-audiencias" className="hover:text-indigo-400 transition-colors">{c.navAudience}</a>
            <a href="#v2-precios" className="hover:text-indigo-400 transition-colors">{c.navPricing}</a>
          </nav>
          <div className="flex items-center gap-1.5 sm:gap-3">
            <button onClick={() => setLanguage(language === "es" ? "en" : "es")} aria-label={language === "es" ? "Switch to English" : "Cambiar a español"} className={`p-2 rounded-lg flex items-center gap-1.5 text-xs font-semibold ${dark ? "hover:bg-white/5" : "hover:bg-slate-100"}`}>
              <Globe className="w-4 h-4 text-blue-500" />{language === "es" ? "EN" : "ES"}
            </button>
            <button onClick={() => setTheme(dark ? "light" : "dark")} aria-label={language === "en" ? "Toggle theme" : "Cambiar tema"} className={`p-2 rounded-lg ${dark ? "hover:bg-white/5 text-yellow-400" : "hover:bg-slate-100 text-slate-700"}`}>
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={startOrConsent} className={`${gradBtn} px-3 sm:px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shadow-md shadow-indigo-900/20 active:scale-[0.97] transition-transform`}>
              <span>{t.startFree}</span><ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section ref={heroRef} className="relative pt-12 pb-20 lg:pt-16 lg:pb-28">
        <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
          <motion.div style={{ y: orbY }} className={`absolute -top-32 -right-24 w-[34rem] h-[34rem] rounded-full blur-3xl ${dark ? "bg-[#8B5CF6]/25" : "bg-indigo-300/40"}`} />
          <motion.div style={{ y: orbY2 }} className={`absolute top-1/3 -left-40 w-[30rem] h-[30rem] rounded-full blur-3xl ${dark ? "bg-[#2563EB]/20" : "bg-blue-300/40"}`} />
          <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)", backgroundSize: "56px 56px", maskImage: "radial-gradient(ellipse at 50% 30%, black, transparent 70%)", WebkitMaskImage: "radial-gradient(ellipse at 50% 30%, black, transparent 70%)" }} />
        </div>

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 text-center space-y-8">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider border border-indigo-400/30 bg-indigo-500/10 text-indigo-400">
            <CertiSendGlyph className="w-3.5 h-3.5" /> {t.tagline}
          </motion.div>

          <h1 className="text-4xl sm:text-5xl lg:text-[3.4rem] font-extrabold tracking-tight leading-[1.08] max-w-4xl mx-auto">
            {t.heroTitle.split(" ").map((w, i, arr) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.05 + i * 0.04, ease: [0.23, 1, 0.32, 1] }}
                className={`inline-block mr-[0.28em] ${i >= arr.length - 3 ? "bg-gradient-to-r from-[#2563EB] via-[#6D5CF6] to-[#A78BFA] bg-clip-text text-transparent" : ""}`}
              >
                {w}
                {i < arr.length - 1 && " "}
              </motion.span>
            ))}
          </h1>

          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 text-sm sm:text-base font-bold">
            {[c.heroA, c.heroB, c.heroC].map((w, i) => (
              <React.Fragment key={w}>
                {i > 0 && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 + i * 0.18 }} className="text-indigo-400"><ArrowRight className="w-4 h-4" /></motion.span>}
                <motion.span
                  initial={{ opacity: 0, scale: 0.94, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ delay: 0.55 + i * 0.18, type: "spring", stiffness: 260, damping: 20 }}
                  className={`px-3.5 py-1.5 rounded-full border ${dark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white shadow-sm"}`}
                >
                  {w}
                </motion.span>
              </React.Fragment>
            ))}
          </div>

          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.95, duration: 0.5 }} className={`max-w-2xl mx-auto text-sm sm:text-base leading-relaxed ${muted}`}>
            {t.heroSub}
          </motion.p>

          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1, duration: 0.6 }} className="pt-4 pb-2">
            <PipelineScene dark={dark} labels={{ pdf: c.stepPdf, sheet: c.stepSheet, sent: c.stepSent }} />
          </motion.div>

          {/* Acceso: casillas legales ANTES del login (T11 + Terminos). */}
          <div id="v2-acceso" className={`max-w-xl mx-auto text-left rounded-3xl border p-5 sm:p-6 space-y-3 backdrop-blur transition-shadow ${resaltar ? "ring-2 ring-amber-400" : ""} ${dark ? "bg-[#10121A]/80 border-white/10" : "bg-white/80 border-slate-200 shadow-xl shadow-indigo-900/5"}`}>
            <div className="text-center space-y-1 pb-1">
              <h2 className="text-lg font-extrabold">{dot(c.accessTitle)}</h2>
              <p className={`text-xs ${muted}`}>{c.accessSub}</p>
            </div>
            <label className={`flex items-start gap-2.5 text-xs leading-relaxed cursor-pointer px-3.5 py-3 rounded-xl border ${dark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-slate-50/70"}`}>
              <input type="checkbox" checked={p.aceptaAutorizacionDatos} onChange={(e) => p.onToggleAceptaAutorizacionDatos(e.target.checked)} className="mt-0.5 shrink-0" />
              <span>{p.textoAutorizacionDatos}{" "}<button type="button" onClick={p.onViewPrivacy} className="text-indigo-400 underline font-semibold">{c.privacy}</button>.</span>
            </label>
            <label className={`flex items-start gap-2.5 text-xs leading-relaxed cursor-pointer px-3.5 py-3 rounded-xl border ${dark ? "border-white/10 bg-white/[0.03]" : "border-slate-200 bg-slate-50/70"}`}>
              <input type="checkbox" checked={p.aceptaTerminosUso} onChange={(e) => p.onToggleAceptaTerminosUso(e.target.checked)} className="mt-0.5 shrink-0" />
              <span>{p.textoAceptacionTerminosUso}{" "}<button type="button" onClick={p.onViewTerminos} className="text-indigo-400 underline font-semibold">{c.terms}</button>.</span>
            </label>
            {loginBtn("w-full py-3.5")}
            {!puedeEntrar && <p role="status" className={`text-center text-xs ${muted}`}>{c.consentHint}</p>}
          </div>
        </div>
      </section>

      {/* Marquee de casos de uso */}
      <section ref={mqRef} aria-hidden className={`border-y ${line} py-5 overflow-hidden`}>
        <motion.div
          animate={reduce || !mqVis ? undefined : { x: ["0%", "-50%"] }}
          transition={{ duration: 28, repeat: Infinity, ease: "linear" }}
          className="flex w-max gap-12 whitespace-nowrap"
        >
          {[...c.useCases, ...c.useCases, ...c.useCases, ...c.useCases].map((u, i) => (
            <span key={i} className={`flex items-center gap-12 text-2xl sm:text-3xl font-extrabold tracking-tight ${dark ? "text-white/20" : "text-slate-300"}`}>
              {u}<Sparkles className="w-5 h-5 text-indigo-400/60" />
            </span>
          ))}
        </motion.div>
      </section>

      {/* Demo interactiva */}
      <section id="v2-demo" className="py-24 max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center space-y-3 mb-12">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">{dot(c.demoTitle)}</h2>
          <p className={`text-sm ${muted}`}>{c.demoSub}</p>
        </div>
        <div className="max-w-md mx-auto mb-10">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value.slice(0, 40))}
            placeholder={c.demoPlaceholder}
            maxLength={40}
            className={`w-full px-5 py-4 rounded-2xl border text-center text-lg font-semibold outline-none focus:ring-2 focus:ring-indigo-500/60 transition ${dark ? "bg-[#10121A] border-white/10 placeholder:text-slate-600" : "bg-white border-slate-200 placeholder:text-slate-400"}`}
          />
        </div>
        <div className="grid md:grid-cols-2 gap-6 items-stretch">
          {/* Certificado */}
          <motion.div whileHover={reduce ? undefined : { rotateX: 3, rotateY: -4, y: -4 }} style={{ transformPerspective: 900 }} className={`relative rounded-3xl border p-8 flex flex-col items-center justify-center text-center gap-3 min-h-[18rem] ${dark ? "bg-gradient-to-br from-[#14172A] to-[#0E1020] border-white/10" : "bg-gradient-to-br from-white to-indigo-50 border-slate-200 shadow-xl shadow-indigo-900/5"}`}>
            <div aria-hidden className="absolute inset-3 rounded-2xl border-2 border-dashed border-indigo-400/30" />
            <CertiSendGlyph className="w-12 h-12 text-indigo-400" />
            <p className="text-[11px] uppercase tracking-[0.25em] text-indigo-400 font-bold">{c.demoCert}</p>
            <p className={`text-xs ${muted}`}>{c.demoCertLine}</p>
            <AnimatePresence mode="wait">
              <motion.p key={nombreMostrado} initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="text-3xl sm:text-4xl font-extrabold font-display bg-gradient-to-r from-[#2563EB] to-[#8B5CF6] bg-clip-text text-transparent break-words max-w-full">
                {nombreMostrado}
              </motion.p>
            </AnimatePresence>
          </motion.div>
          {/* Correo */}
          <div className={`rounded-3xl border overflow-hidden flex flex-col ${dark ? "bg-[#10121A] border-white/10" : "bg-white border-slate-200 shadow-xl shadow-indigo-900/5"}`}>
            <div className={`px-5 py-3 border-b ${line} flex items-center gap-2 text-xs font-semibold`}>
              <span className="flex gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-rose-400" /><i className="w-2.5 h-2.5 rounded-full bg-amber-400" /><i className="w-2.5 h-2.5 rounded-full bg-emerald-400" /></span>
              <Mail className="w-3.5 h-3.5 ml-2 text-rose-400" /> Gmail
            </div>
            <div className="p-5 space-y-3 text-sm flex-1">
              <p className={`text-xs ${muted}`}>{c.demoTo}: <motion.b key={correoDemo} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={dark ? "text-white" : "text-slate-900"}>{correoDemo}</motion.b></p>
              <p className={`text-xs ${muted}`}>{c.demoSubject}: <b className={dark ? "text-white" : "text-slate-900"}>{c.demoSubjectVal}</b></p>
              <hr className={line} />
              <p className="leading-relaxed">{c.demoBody.replace("{n}", nombreMostrado.split(" ")[0])}</p>
              <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold ${dark ? "border-white/10 bg-white/[0.04]" : "border-slate-200 bg-slate-50"}`}>
                <FileText className="w-4 h-4 text-rose-400" /> {nombreMostrado.replace(/\s+/g, "_")}_{c.demoAttach}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Para quien */}
      <AudienceSection items={c.aud} dark={dark} muted={muted} line={line} title={c.audTitle} sub={c.audSub} badge={c.exampleBadge} />

      {/* Flujo en 3 pasos */}
      <section id="v2-flujo" className={`relative py-28 overflow-clip ${dark ? "bg-gradient-to-b from-[#07080D] via-[#0C0F1E] to-[#07080D]" : "bg-gradient-to-b from-[#F7F8FC] via-indigo-50/70 to-[#F7F8FC]"}`}>
        <div className="absolute inset-0 hidden md:block"><DataStream dark={dark} /></div>
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 space-y-16">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-center max-w-3xl mx-auto">{dot(c.flowTitle)}</h2>
          <ScrollStory steps={c.flowSteps} dark={dark} muted={muted} sentLabel={c.stepSent} />
          <div className="grid md:hidden gap-7">
            {c.flowSteps.map((s, i) => (
              <motion.div key={s.t} initial={{ opacity: 0, y: 50 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.6, delay: i * 0.14 }} whileHover={reduce ? undefined : { y: -8 }} className={`relative rounded-3xl border p-7 pt-10 backdrop-blur-md ${dark ? "bg-[#10121A]/80 border-white/10 hover:border-indigo-400/40" : "bg-white/85 border-slate-200 shadow-lg shadow-indigo-900/5 hover:border-indigo-300"} transition-colors`}>
                <span className="absolute -top-5 left-7 w-11 h-11 rounded-2xl rotate-6 bg-gradient-to-br from-[#2563EB] to-[#8B5CF6] text-white font-extrabold flex items-center justify-center shadow-lg shadow-indigo-600/30">{i + 1}</span>
                <p className="text-[11px] font-bold uppercase tracking-widest text-indigo-400 mb-2">{c.stepVisual[i]}</p>
                <h3 className="text-2xl font-extrabold mb-2">{s.t}</h3>
                <p className={`text-sm leading-relaxed ${muted}`}>{s.d}</p>
              </motion.div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            {[{ n: 15, l: c.statFree, suf: "" }, { n: 2, l: c.statSends, suf: "" }, { n: 0, l: c.statZero, suf: "" }].map((st) => (
              <div key={st.l} className={`rounded-2xl border py-5 px-2 backdrop-blur ${dark ? "bg-white/[0.03] border-white/10" : "bg-white/70 border-slate-200"}`}>
                <p className="text-4xl sm:text-5xl font-extrabold bg-gradient-to-r from-[#2563EB] to-[#8B5CF6] bg-clip-text text-transparent"><CountUp to={st.n} />{st.suf}</p>
                <p className={`text-[11px] sm:text-xs mt-1 ${muted}`}>{st.l}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bento */}
      <section className="relative py-28 overflow-hidden">
        <Aurora colors={dark ? ["#2563EB", "#8B5CF6", "#0EA5E9"] : ["#93C5FD", "#C4B5FD", "#A5F3FC"]} dark={dark} />
        <ParticleField dark={dark} />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 space-y-12">
          <div className="text-center space-y-3">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">{dot(c.bentoTitle)}</h2>
            <p className={`${muted} max-w-2xl mx-auto text-sm sm:text-base`}>{c.bentoSub}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {c.feats.map((b, k) => (
              <SpotCard key={b.t} dark={dark} className={k === 0 || k === 3 ? "md:col-span-2" : ""}>
                <MiniViz kind={k as 0 | 1 | 2 | 3} dark={dark} />
                <h3 className="font-bold text-xl mb-2">{dot(b.t)}</h3>
                <p className={`text-sm leading-relaxed ${muted}`}>{b.d}</p>
              </SpotCard>
            ))}
          </div>
        </div>
      </section>

      {/* Confianza */}
      <section className={`relative py-28 border-y ${line} overflow-hidden ${dark ? "bg-[#080A11]" : "bg-slate-50"}`}>
        <PulseRings dark={dark} />
        {!reduce && (
          <motion.div aria-hidden animate={{ x: ["-20%", "120%"] }} transition={{ duration: 6, repeat: Infinity, ease: "linear" }} className="absolute inset-y-0 w-40 bg-gradient-to-r from-transparent via-indigo-500/10 to-transparent pointer-events-none" />
        )}
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 space-y-14">
          <div className="text-center space-y-3">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-[#2563EB] to-[#8B5CF6] text-white flex items-center justify-center shadow-lg shadow-indigo-600/30"><ShieldCheck className="w-7 h-7" /></div>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">{dot(c.trustTitle)}</h2>
            <p className={`${muted} max-w-xl mx-auto text-sm sm:text-base`}>{c.trustSub}</p>
          </div>

          <DataLifecycle steps={c.trustSteps} dark={dark} muted={muted} />

          {/* Transparencia: que NO y que SI se guarda (mismo contenido que el texto legal de abajo) */}
          <div className="grid md:grid-cols-2 gap-5">
            <SpotCard dark={dark}>
              <h3 className="font-extrabold text-lg mb-3 flex items-center gap-2"><span className="w-7 h-7 rounded-lg bg-emerald-500/15 text-emerald-500 flex items-center justify-center"><Check className="w-4 h-4" /></span>{c.trustNoTitle}</h3>
              <ul className="space-y-2">
                {c.trustNo.map((x) => <li key={x} className={`text-sm flex items-start gap-2 ${muted}`}><Check className="w-4 h-4 mt-0.5 text-emerald-500 shrink-0" />{x}</li>)}
              </ul>
            </SpotCard>
            <SpotCard dark={dark}>
              <h3 className="font-extrabold text-lg mb-3 flex items-center gap-2"><span className="w-7 h-7 rounded-lg bg-indigo-500/15 text-indigo-400 flex items-center justify-center"><Lock className="w-4 h-4" /></span>{c.trustYesTitle}</h3>
              <ul className="space-y-2">
                {c.trustYes.map((x) => <li key={x} className={`text-sm flex items-start gap-2 ${muted}`}><Check className="w-4 h-4 mt-0.5 text-indigo-400 shrink-0" />{x}</li>)}
              </ul>
              <button type="button" onClick={p.onViewPrivacy} className="mt-4 text-xs font-semibold text-indigo-400 underline underline-offset-2">{c.trustMore}</button>
            </SpotCard>
          </div>

          {/* Texto legal original, sin reescribir */}
          <div className="grid md:grid-cols-3 gap-5">
            {[
              { i: Lock, t: t.sec1Title, d: t.sec1Desc },
              { i: ShieldCheck, t: t.sec2Title, d: t.sec2Desc },
              { i: Zap, t: t.sec3Title, d: t.sec3Desc },
            ].map((s2) => (
              <SpotCard key={s2.t} dark={dark}>
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mb-3"><s2.i className="w-5 h-5" /></div>
                <h3 className="font-bold text-sm uppercase tracking-wider mb-1.5">{s2.t}</h3>
                <p className={`text-xs leading-relaxed ${muted}`}>{s2.d}</p>
              </SpotCard>
            ))}
          </div>
        </div>
      </section>

      {/* Precios */}
      <section id="v2-precios" className="relative py-28 overflow-hidden">
        <Aurora colors={dark ? ["#8B5CF6", "#2563EB", "#EC4899"] : ["#C4B5FD", "#93C5FD", "#FBCFE8"]} dark={dark} />
        <FloatingGlyphs dark={dark} />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 space-y-12">
          <div className="text-center space-y-3">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">{dot(t.pricingTitle)}</h2>
            <p className={`${muted} text-sm sm:text-base max-w-2xl mx-auto`}>{t.pricingSub}</p>
          </div>
          <div className="grid lg:grid-cols-3 gap-6 items-stretch">
            {[
              { n: t.planFreeName, price: t.planFreePrice, f: [t.planFreeFeature1, t.planFreeFeature2, t.planFreeFeature3], cta: t.startFree, hot: false, act: startOrConsent, notes: [] as { txt: string; ok?: boolean }[] },
              {
                n: t.planPagoPorUsoName, price: t.planPagoPorUsoUsdGrande,
                f: [t.planPagoPorUsoFeature1, t.planPagoPorUsoFeature2, t.planPagoPorUsoFeature3, t.planPagoPorUsoFeature4],
                cta: precios?.pagosActivos ? t.buyPorUso : t.buyNow, hot: true,
                act: () => (precios?.pagosActivos ? ck.abrirPanelPorUso() : ck.contactarPlan("CertiSend Pay-as-you-go", 0.15)),
                notes: [
                  precios
                    ? { txt: t.precioCopPorEnvioNota.replace("{cop}", precios.porUso.copPorUnidadReferencia.toLocaleString(language === "en" ? "en-US" : "es-CO")).replace("{fecha}", formatearFechaCortaDesdeISO(precios.fechaDesde)) }
                    : { txt: ck.preciosFallo ? t.planPayGoPriceError : t.planPayGoPriceCargando },
                  { txt: t.planPagoPorUsoMinimoNota.replace("{minimo}", String(precios?.porUso.minimo ?? 50)), ok: true },
                ],
              },
              {
                n: t.planPayGoName, price: t.planPaqueteUsdGrande,
                f: [t.planPayGoFeature1, t.planPayGoFeature2, t.planPayGoFeature3, t.planPayGoFeature4, t.planPayGoFeature5],
                cta: precios?.pagosActivos ? t.buyPaquete : t.buyNow, hot: false,
                act: () => (precios?.pagosActivos ? ck.abrirPanelPaquete() : ck.contactarPlan("CertiSend Pay-as-you-go Bundle", 15.0)),
                notes: precios
                  ? [
                      { txt: t.precioCopHoyNota.replace("{cop}", precios.paquete.cop.toLocaleString(language === "en" ? "en-US" : "es-CO")).replace("{fecha}", formatearFechaCortaDesdeISO(precios.fechaDesde)) },
                      // O3 (Dictamen Abogado_LAP): la tarjeta tambien dice "precio total, sin cargos adicionales"
                      { txt: precios.pagosActivos ? t.checkoutPrecioTotalSinCargos : t.checkoutPrecioDeHoySinCargos, ok: true },
                    ]
                  : [{ txt: ck.preciosFallo ? t.planPayGoPriceError : t.planPayGoPriceCargando }],
              },
            ].map((pl, idx) => (
              <motion.div key={pl.n} initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.55, delay: idx * 0.1 }} whileHover={reduce ? undefined : { y: -6 }} className={`relative rounded-3xl flex flex-col ${pl.hot ? "p-[2px] overflow-hidden shadow-2xl shadow-indigo-600/25" : ""}`}>
                {pl.hot && (
                  <>
                    <motion.div aria-hidden animate={reduce ? undefined : { rotate: 360 }} transition={{ duration: 7, repeat: Infinity, ease: "linear" }} className="absolute -inset-[60%]" style={{ background: "conic-gradient(from 0deg, #2563EB, #8B5CF6, #EC4899, #2563EB)" }} />
                    <span className="absolute z-10 -top-0 left-1/2 -translate-x-1/2 translate-y-2 px-3 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-gradient-to-r from-[#2563EB] to-[#8B5CF6] text-white">{c.popular}</span>
                  </>
                )}
                <div className={`relative flex-1 flex flex-col justify-between rounded-3xl p-8 pt-12 ${pl.hot ? "bg-gradient-to-b from-[#1A1D33] to-[#0D0F1A] text-white" : `border ${dark ? "bg-[#10121A]/90 border-white/10" : "bg-white/90 border-slate-200 shadow-sm"} backdrop-blur`}`}>
                  <div className="space-y-6">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-widest text-indigo-400">{pl.n}</span>
                      <p className="text-3xl font-extrabold mt-2">{pl.price}</p>
                      {pl.notes.map((n2) => <p key={n2.txt} className={`text-[11px] mt-1 ${n2.ok ? "font-semibold text-emerald-500" : pl.hot ? "text-gray-400" : muted}`}>{n2.txt}</p>)}
                    </div>
                    <ul className="space-y-2.5 pt-5 border-t border-dashed border-slate-500/25">
                      {pl.f.map((x, k) => (
                        <motion.li key={x} initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.25 + k * 0.07 }} className={`flex items-start gap-2.5 text-xs ${pl.hot ? "text-gray-300" : muted}`}><Check className="w-4 h-4 text-emerald-500 shrink-0" />{x}</motion.li>
                      ))}
                    </ul>
                  </div>
                  <button onClick={pl.act} className={`mt-8 w-full py-3 rounded-xl font-bold text-xs transition active:scale-[0.97] ${pl.hot ? gradBtn : dark ? "bg-white/5 hover:bg-white/10" : "bg-slate-100 hover:bg-slate-200"}`}>{pl.cta}</button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className={`relative py-28 border-t ${line} overflow-hidden ${dark ? "bg-[#090B12]" : "bg-white/60"}`}>
        <GridDrift dark={dark} />
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 space-y-8">
          <div className="text-center space-y-2">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">{dot(t.faqTitle)}</h2>
            <p className={`${muted} text-sm sm:text-base`}>{c.faqSub}</p>
          </div>
          {[{ q: t.faq1Q, a: t.faq1A }, { q: t.faq2Q, a: t.faq2A }, { q: t.faq3Q, a: t.faq3A }, { q: t.faq4Q, a: t.faq4A }].map((f, k) => (
            <motion.div key={f.q} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ delay: k * 0.07 }} className={`rounded-2xl border overflow-hidden backdrop-blur transition-colors ${faq === k ? "border-indigo-400/50" : dark ? "border-white/10" : "border-slate-200"} ${dark ? "bg-[#10121A]/85" : "bg-white/85 shadow-sm"}`}>
              <button onClick={() => setFaq(faq === k ? null : k)} aria-expanded={faq === k} className="w-full p-5 flex items-center justify-between gap-3 text-left font-bold text-sm sm:text-base">
                <span>{f.q}</span>
                <ChevronDown className={`w-5 h-5 text-indigo-400 shrink-0 transition-transform duration-300 ${faq === k ? "rotate-180" : ""}`} />
              </button>
              <AnimatePresence initial={false}>
                {faq === k && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
                    <p className={`px-5 pb-5 pt-3 text-sm leading-relaxed border-t ${line} ${muted}`}>{f.a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA final */}
      <section className="py-24 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto rounded-[2rem] p-10 sm:p-16 pb-0 sm:pb-0 text-center space-y-6 bg-gradient-to-br from-[#2563EB] via-[#5B5CF0] to-[#8B5CF6] text-white shadow-2xl shadow-indigo-600/30 relative overflow-hidden">
          <LaunchTrail />
          <motion.div aria-hidden animate={reduce ? undefined : { rotate: [0, 6, 0], y: [0, -10, 0] }} transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }} className="absolute -right-6 -bottom-6 w-48 h-48 text-white/10"><CertiSendGlyph className="w-full h-full" /></motion.div>
          <h2 className="relative text-3xl sm:text-5xl font-extrabold tracking-tight">{c.ctaFinal}</h2>
          <p className="relative text-sm sm:text-base text-white/85 max-w-xl mx-auto">{c.ctaSub}</p>
          <button onClick={startOrConsent} className="relative px-8 py-4 rounded-xl bg-white text-indigo-700 font-extrabold text-sm inline-flex items-center gap-2 hover:scale-[1.03] active:scale-[0.97] transition-transform">
            {t.startFree}<ArrowRight className="w-4 h-4" />
          </button>
          <CertificatePile />
        </div>
      </section>

      <footer className={`py-8 text-center text-xs border-t ${line} ${muted}`}>
        <p>© 2026 <strong>{t.appName}</strong>. {t.footerRights}</p>
        <p className="text-[10px] mt-1">{t.footerText.replace("{proveedor}", import.meta.env.VITE_PROVEEDOR_NOMBRE || "[dato pendiente]")}</p>
        <div className="mt-2 flex justify-center gap-4">
          <button onClick={p.onViewTerminos} className="text-indigo-400 hover:underline font-semibold text-[11px]">{c.terms}</button>
          <button onClick={p.onViewPrivacy} className="text-indigo-400 hover:underline font-semibold text-[11px]">{c.privacy}</button>
        </div>
      </footer>

      {ck.panels}
    </div>
    </MotionConfig>
  );
}
