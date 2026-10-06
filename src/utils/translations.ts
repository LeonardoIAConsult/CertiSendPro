export interface TranslationDict {
  // Common
  appName: string;
  loginWithGoogle: string;
  logout: string;
  workspace: string;
  tagline: string;
  english: string;
  spanish: string;
  lightMode: string;
  darkMode: string;
  
  // Landing Page
  heroTitle: string;
  heroSub: string;
  startFree: string;
  seeDemo: string;
  featuresTitle: string;
  featuresSub: string;
  feat1Title: string;
  feat1Desc: string;
  feat2Title: string;
  feat2Desc: string;
  feat3Title: string;
  feat3Desc: string;
  feat4Title: string;
  feat4Desc: string;
  
  // Security Section
  securityTitle: string;
  securitySub: string;
  sec1Title: string;
  sec1Desc: string;
  sec2Title: string;
  sec2Desc: string;
  sec3Title: string;
  sec3Desc: string;

  // Pricing Section
  pricingTitle: string;
  pricingSub: string;
  buyNow: string;

  // Plans
  planFreeName: string;
  planFreePrice: string;
  planFreeFeature1: string;
  planFreeFeature2: string;
  planFreeFeature3: string;

  // Pro no se vende en v1 (decision de Leonardo, 2026-10-05): planProPrice reemplaza el precio
  // falso ("$29 USD / mes", nunca cobrado — Tarea 8 del plan no existe todavia) por el estado
  // real: "Próximamente · escríbenos". proContactar es el texto del boton de ese plan (mailto,
  // igual que siempre funciono este boton; solo cambia la etiqueta).
  planProName: string;
  planProPrice: string;
  planProFeature1: string;
  planProFeature2: string;
  planProFeature3: string;
  proContactar: string;

  // Paquete (Tarea 11, cobro real con planes, 2026-10-05): planPayGoPrice se retira — el precio
  // real en COP del dia se calcula en LandingPage.tsx con /api/precios (nunca un "$0,10 USD por
  // envio" fijo, H5); planPayGoPriceCargando es el texto mientras ese precio no ha llegado.
  planPayGoName: string;
  planPayGoPriceCargando: string;
  planPayGoPriceError: string;
  planPayGoFeature1: string;
  planPayGoFeature2: string;
  planPayGoFeature3: string;
  planPayGoFeature4: string;
  planPayGoFeature5: string;

  // FAQ Section
  faqTitle: string;
  faqSub: string;
  faq1Q: string;
  faq1A: string;
  faq2Q: string;
  faq2A: string;
  faq3Q: string;
  faq3A: string;
  faq4Q: string;
  faq4A: string;

  // Footer
  footerText: string;
  footerRights: string;

  // Limites de plan al enviar un lote (Tarea 3, cobro real con planes, 2026-10-05).
  // batchLimitSaldo usa los marcadores {restantes} y {lote}, reemplazados en App.tsx.
  batchLimitFree: string;
  batchLimitSaldo: string;
  // Opciones cuando se rechaza un lote (Tarea 10): dividirlo o ver los planes disponibles.
  batchLimitOpciones: string;

  // Vista "Mi plan" (Tarea 10, cobro real con planes, 2026-10-05). miPlanPaquete usa {restantes}
  // y {fecha}; miPlanPro usa {fecha} (reemplazados en src/utils/plan.ts).
  miPlanGratis: string;
  miPlanPaquete: string;
  miPlanPaqueteNota: string;
  miPlanPro: string;

  // Volver de Mercado Pago (Tarea 10): estados del sondeo contra /api/cuenta.
  pagoConfirmando: string;
  pagoActivo: string;
  pagoRevision: string;
  pagoRechazado: string;
  // G5 (NO-GO del REVISOR_EXTERNO_LAP sobre la Tarea 10, 2026-10-05): sin sesion real de
  // Firebase no se sondea nada (se mentiria con "confirmando"/"en revision"); se pide iniciar
  // sesion.
  pagoSinSesion: string;

  // Panel de checkout del Paquete (M30, cobro real con planes, corrige vuelta 24). Solo se
  // muestra con PAGOS_ACTIVOS encendido (ver `/api/precios` -> `pagosActivos`); con pagos
  // apagados el boton del Paquete sigue mandando a `buyNow` (mailto). Textos citados de
  // `docs/legal/textos-checkout.md` v1.2 (T1/T4/T5); `checkoutReferencia`/`checkoutTrmNota` usan
  // {usd}/{trm}/{fecha}, `checkoutPrecioCambio` usa {anterior}/{nuevo} (reemplazados en
  // LandingPage.tsx).
  buyPaquete: string;
  checkoutPaqueteTitle: string;
  checkoutReferencia: string;
  checkoutTrmNota: string;
  checkoutVerTerminos: string;
  checkoutPrecioCambio: string;
  checkoutPagar: string;
  checkoutCerrar: string;
  checkoutErrorGenerico: string;
  checkoutSinPrecios: string;
}

export type Lang = "es" | "en";

export const translations: Record<Lang, TranslationDict> = {
  es: {
    appName: "CertiSend Pro",
    loginWithGoogle: "Ingresar con Google",
    logout: "Cerrar sesión",
    workspace: "Consola de Trabajo",
    // R6 ampliada de docs/legal/textos-checkout.md v1.2 (N2, Tarea 11, 2026-10-05): textos
    // revisados para que ninguno prometa algo que la app no hace de verdad.
    tagline: "Certificados personalizados, enviados desde tu propio Gmail",
    english: "English",
    spanish: "Español",
    lightMode: "Modo Claro",
    darkMode: "Modo Oscuro",

    heroTitle: "Envía cientos de certificados personalizados desde tu propio Gmail",
    heroSub: "Sube un solo PDF con todos los diplomas, tarjetas, invitaciones, certificados o lo que quieras enviar, conecta tu Google Sheet donde está la lista de personas a quien le quieres enviar el documento personalizado, y CertiSend Pro empareja cada certificado con su destinatario, tú lo revisas y se envía desde tu Gmail.",
    startFree: "Comenzar Gratis",
    seeDemo: "Ver Planes y Precios",

    featuresTitle: "Características Premium",
    featuresSub: "CertiSend Pro es una herramienta diseñada para automatizar el envío de tu flujo de PDF´s sin esfuerzo.",
    feat1Title: "Segmentación Inteligente",
    feat1Desc: "Sube un PDF masivo. Nuestro sistema divide el archivo en Los PDF´s individuales de forma instantánea.",
    feat2Title: "Lectura de Google Sheets",
    feat2Desc: "Conéctate de forma directa y segura con tus hojas de cálculo (sheet) online, para leer nombres y correos.",
    feat3Title: "Escaneo con IA",
    feat3Desc: "CertiSend lee el nombre con IA y te deja revisarlo antes de enviar.",
    feat4Title: "Envío desde tu Gmail",
    feat4Desc: "Envía correos personalizados directamente desde tu cuenta de Gmail con el certificado adjunto.",

    securityTitle: "Cómo cuidamos tus datos",
    securitySub: "Lo que guardamos, lo que no y quién más los procesa, sin letra pequeña.",
    sec1Title: "Tus listas y certificados no se guardan",
    sec1Desc: "Tu lista de destinatarios no se guarda en nuestros servidores y tus PDF se borran solos en unas 2 horas. Guardamos solo tu cuenta, tu plan y tus pagos, como explica la Política de Privacidad.",
    sec2Title: "Conexión Directa de API",
    sec2Desc: "La aplicación utiliza tokens de acceso temporales directos de Google OAuth 2.0. Los correos se envían desde tu propia bandeja de salida de Gmail.",
    sec3Title: "Tu sesión es tuya",
    sec3Desc: "Tus archivos y tu lista se procesan solo en tu sesión; no los mostramos a otros usuarios.",

    pricingTitle: "Planes Sencillos y Transparentes",
    pricingSub: "Sin permanencia: cancelas cuando quieres y conservas lo pagado hasta su fecha.",
    buyNow: "Hablemos de este plan",

    planFreeName: "Plan Gratuito",
    planFreePrice: "$0",
    planFreeFeature1: "Hasta 15 certificados por lote",
    planFreeFeature2: "Asunto y cuerpo del correo personalizados",
    planFreeFeature3: "Lectura de nombres con IA",

    // Pro no se vende en v1 (decision de Leonardo, 2026-10-05): sin precio ni "escaneo
    // prioritario"/"24/7" (no existen); el boton manda un correo, igual que siempre.
    planProName: "Plan Pro Ilimitado",
    planProPrice: "Próximamente · escríbenos",
    planProFeature1: "Certificados ilimitados por lote",
    planProFeature2: "Asunto y cuerpo del correo personalizados",
    planProFeature3: "Soporte prioritario por correo",
    proContactar: "Escríbenos",

    planPayGoName: "Paquete",
    planPayGoPriceCargando: "Calculando el precio de hoy…",
    planPayGoPriceError: "Escríbenos para el precio de hoy",
    planPayGoFeature1: "150 envíos con éxito para lotes de más de 15",
    planPayGoFeature2: "Los lotes de 15 o menos siguen siendo gratis y no gastan el Paquete",
    planPayGoFeature3: "Válidos 1 mes o hasta gastarlos; no se acumulan",
    planPayGoFeature4: "Pago único",
    planPayGoFeature5: "Los envíos que fallan no se descuentan",

    faqTitle: "Preguntas Frecuentes",
    faqSub: "Resolvemos tus dudas sobre el funcionamiento y la seguridad de la plataforma.",
    faq1Q: "¿Cómo reconoce el sistema los nombres en los diplomas?",
    faq1A: "Usamos IA (Gemini, de Google) para leer el nombre en cada página y compararlo con tu lista. Puede equivocarse: por eso te mostramos cada certificado con el nombre y el correo de su destinatario para que lo revises antes de enviar.",
    faq2Q: "¿Mis contactos o PDFs se guardan en sus servidores?",
    faq2A: "Tus PDF se borran solos en unas 2 horas y tu lista no se guarda en nuestros servidores. Tu cuenta y tus pagos se guardan según la Política de Privacidad.",
    faq3Q: "¿Cómo funciona el envío masivo?",
    faq3A: "Se envía con la API oficial de Gmail: el correo sale desde tu propia cuenta de Gmail, con tu dirección.",
    faq4Q: "¿Cuáles son los métodos de pago aceptados?",
    faq4A: "Pagos en pesos colombianos con Mercado Pago, con los medios que Mercado Pago muestre al pagar.",

    footerText: "CertiSend Pro es un servicio de Leonardo Antolinez P. para enviar certificados desde tu propio Gmail.",
    footerRights: "Todos los derechos reservados.",

    batchLimitFree: "El plan Gratis permite hasta 15 certificados por lote. Puedes dividirlo o escribirnos.",
    batchLimitSaldo: "Tienes {restantes} envíos y el lote es de {lote}.",
    batchLimitOpciones: "Puedes dividir el lote en partes de 15 o menos, o escribirnos a contacto@leonardoantolinez.com para ver los planes.",

    miPlanGratis: "Plan Gratis · hasta 15 certificados por lote",
    miPlanPaquete: "Paquete · te quedan {restantes} envíos · vencen el {fecha}",
    miPlanPaqueteNota: "Los lotes de 15 certificados o menos no gastan tu saldo.",
    miPlanPro: "Pro · envíos ilimitados · hasta {fecha}",

    pagoConfirmando: "Estamos confirmando tu pago…",
    pagoActivo: "¡Pago confirmado! Tu plan ya está activo.",
    // M32 (corrige vuelta 26): mientras no haya relay de avisos configurado en produccion (Tarea
    // 5, docs/relay/README.md), este texto NO puede prometer un correo que todavia no sale.
    pagoRevision: "Si ya pagaste, tu plan se activará en unos minutos; recarga o escríbenos a contacto@leonardoantolinez.com.",
    pagoRechazado: "No se realizó ningún cobro.",
    pagoSinSesion: "Inicia sesión para ver el estado de tu pago.",

    buyPaquete: "Comprar paquete",
    checkoutPaqueteTitle: "Paquete · 150 envíos",
    checkoutReferencia: "Referencia US${usd}",
    checkoutTrmNota: "TRM {trm} COP, vigente el {fecha}",
    checkoutVerTerminos: "Ver Términos y Condiciones",
    checkoutPrecioCambio: "El precio cambió: antes ${anterior} COP, ahora ${nuevo} COP. Revisa y vuelve a marcar las casillas.",
    checkoutPagar: "Pagar",
    checkoutCerrar: "Cerrar",
    checkoutErrorGenerico: "No se pudo iniciar el pago con Mercado Pago.",
    checkoutSinPrecios: "No podemos calcular el precio de hoy; intenta más tarde.",
  },
  en: {
    appName: "CertiSend Pro",
    loginWithGoogle: "Login with Google",
    logout: "Log out",
    workspace: "Workspace Console",
    // R6 ampliada de docs/legal/textos-checkout.md v1.2 (N2, Tarea 11, 2026-10-05): courtesy
    // translation, same corrections as the ES block above.
    tagline: "Personalized certificates, sent from your own Gmail",
    english: "English",
    spanish: "Español",
    lightMode: "Light Mode",
    darkMode: "Dark Mode",

    heroTitle: "Send hundreds of personalized certificates from your own Gmail",
    heroSub: "Upload a single PDF containing all diplomas, cards, invitations, certificates, or whatever you want to send, connect your Google Sheet where the list of people you want to send the personalized document to is located, and CertiSend Pro matches each certificate to its recipient, you review it, and it is sent from your Gmail.",
    startFree: "Start for Free",
    seeDemo: "See Plans & Pricing",

    featuresTitle: "Premium Features",
    featuresSub: "CertiSend Pro is a tool designed to automate your PDF delivery workflow completely hassle-free.",
    feat1Title: "Smart PDF Splitting",
    feat1Desc: "Upload a bulk PDF file. Our system immediately splits it into individual PDFs.",
    feat2Title: "Google Sheets Integration",
    feat2Desc: "Connect directly and securely to your online spreadsheets (sheets) to fetch recipient names and emails instantly.",
    feat3Title: "AI Scanning",
    feat3Desc: "CertiSend reads the name with AI and lets you review it before sending.",
    feat4Title: "Sent from your Gmail",
    feat4Desc: "Send personalized emails directly from your own Gmail account with the certificate attached.",

    securityTitle: "How we look after your data",
    securitySub: "What we keep, what we don't, and who else processes it, no fine print.",
    sec1Title: "Your lists and certificates are not stored",
    sec1Desc: "Your recipient list is not stored on our servers and your PDFs are deleted automatically within about 2 hours. We only keep your account, plan and payments, as explained in the Privacy Policy.",
    sec2Title: "Direct API Integration",
    sec2Desc: "The app relies on temporary secure access tokens from Google OAuth 2.0. Emails are dispatched directly from your own Gmail outbox.",
    sec3Title: "Your session is yours",
    sec3Desc: "Your files and list are processed only in your session; we don't show them to other users.",

    pricingTitle: "Simple and Transparent Pricing",
    pricingSub: "No minimum term: cancel anytime and keep what you paid until its end date.",
    buyNow: "Let's talk about this plan",

    planFreeName: "Free Plan",
    planFreePrice: "$0",
    planFreeFeature1: "Up to 15 certificates per batch",
    planFreeFeature2: "Custom subject and body",
    planFreeFeature3: "AI name reading",

    // Pro is not for sale in v1 (Leonardo's decision, 2026-10-05): no price, and no "priority
    // scanning"/"24/7" (they don't exist); the button emails us, same as it always did.
    planProName: "Unlimited Pro Plan",
    planProPrice: "Coming soon · email us",
    planProFeature1: "Unlimited certificates per batch",
    planProFeature2: "Custom subject and body",
    planProFeature3: "Priority email support",
    proContactar: "Email us",

    planPayGoName: "Bundle",
    planPayGoPriceCargando: "Calculating today's price…",
    planPayGoPriceError: "Write to us for today's price",
    planPayGoFeature1: "150 successful sends for batches over 15",
    planPayGoFeature2: "Batches of 15 or fewer stay free and never spend the Bundle",
    planPayGoFeature3: "Valid for 1 month or until used up; unused sends do not roll over",
    planPayGoFeature4: "One-time payment",
    planPayGoFeature5: "Failed sends are never deducted",

    faqTitle: "Frequently Asked Questions",
    faqSub: "Answering your common questions about how the platform works and its security.",
    faq1Q: "How does the system recognize names on certificates?",
    faq1A: "We use AI (Google's Gemini) to read the name on each page and compare it with your list. It can make mistakes, so we show you each certificate with its recipient's name and email for you to review before sending.",
    faq2Q: "Are my contacts or PDFs saved on your servers?",
    faq2A: "Your PDFs are deleted automatically within about 2 hours and your list is not stored on our servers. Your account and payments are kept as described in the Privacy Policy.",
    faq3Q: "How does the bulk emailing work?",
    faq3A: "It is sent through the official Gmail API: the email goes out from your own Gmail account, with your address.",
    faq4Q: "What payment methods are supported?",
    faq4A: "Payments in Colombian pesos through Mercado Pago, with the methods Mercado Pago shows at checkout.",

    footerText: "CertiSend Pro is a service by Leonardo Antolinez P. to send certificates from your own Gmail.",
    footerRights: "All rights reserved.",

    batchLimitFree: "The Free plan allows up to 15 certificates per batch. You can split it or email us.",
    batchLimitSaldo: "You have {restantes} sends left and this batch has {lote}.",
    batchLimitOpciones: "You can split the batch into parts of 15 or fewer, or email us at contacto@leonardoantolinez.com to see the plans.",

    miPlanGratis: "Free plan · up to 15 certificates per batch",
    miPlanPaquete: "Bundle · {restantes} sends left · expires {fecha}",
    miPlanPaqueteNota: "Batches of 15 or fewer never spend your balance.",
    miPlanPro: "Pro · unlimited sends · until {fecha}",

    pagoConfirmando: "We're confirming your payment…",
    pagoActivo: "Payment confirmed! Your plan is now active.",
    // M32 (corrige vuelta 26): same reason as the ES string above.
    pagoRevision: "If you already paid, your plan will activate in a few minutes; refresh or email us at contacto@leonardoantolinez.com.",
    pagoRechazado: "No charge was made.",
    pagoSinSesion: "Sign in to see your payment status.",

    buyPaquete: "Buy bundle",
    checkoutPaqueteTitle: "Bundle · 150 sends",
    checkoutReferencia: "Reference US${usd}",
    checkoutTrmNota: "TRM {trm} COP, effective {fecha}",
    checkoutVerTerminos: "View Terms and Conditions",
    checkoutPrecioCambio: "The price changed: before COP ${anterior}, now COP ${nuevo}. Please review and tick the boxes again.",
    checkoutPagar: "Pay",
    checkoutCerrar: "Close",
    checkoutErrorGenerico: "We couldn't start the payment with Mercado Pago.",
    checkoutSinPrecios: "We couldn't get today's price; please try again later.",
  }
};
