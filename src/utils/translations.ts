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
  calculatorTitle: string;
  calculatorSub: string;
  calcCertificates: string;
  calcTotalEstimate: string;
  calcPayAsYouGo: string;
  calcProPlan: string;
  buyNow: string;
  
  // Plans
  planFreeName: string;
  planFreePrice: string;
  planFreeFeature1: string;
  planFreeFeature2: string;
  planFreeFeature3: string;
  
  planProName: string;
  planProPrice: string;
  planProFeature1: string;
  planProFeature2: string;
  planProFeature3: string;
  planProFeature4: string;
  
  planPayGoName: string;
  planPayGoPrice: string;
  planPayGoFeature1: string;
  planPayGoFeature2: string;
  planPayGoFeature3: string;

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
}

export const translations: Record<"es" | "en", TranslationDict> = {
  es: {
    appName: "CertiSend Pro",
    loginWithGoogle: "Ingresar con Google",
    logout: "Cerrar sesión",
    workspace: "Consola de Trabajo",
    tagline: "Automatización premium de PDFs y envío masivo personalizado en segundos",
    english: "English",
    spanish: "Español",
    lightMode: "Modo Claro",
    darkMode: "Modo Oscuro",
    
    heroTitle: "Envía cientos de PDF´s personalizados en 1 solo clic",
    heroSub: "Sube un solo PDF con todos los diplomas, tarjetas, invitaciones, certificados o lo que quieras enviar, conecta tu Google Sheet donde está la lista de personas a quien le quieres enviar el documento personalizado, y CertiSend Pro emparejará y enviará de forma automática y segura cada destinatario.",
    startFree: "Comenzar Gratis",
    seeDemo: "Ver Planes y Precios",
    
    featuresTitle: "Características Premium",
    featuresSub: "CertiSend Pro es una herramienta diseñada para automatizar el envío de tu flujo de PDF´s sin esfuerzo.",
    feat1Title: "Segmentación Inteligente",
    feat1Desc: "Sube un PDF masivo. Nuestro sistema divide el archivo en Los PDF´s individuales de forma instantánea.",
    feat2Title: "Lectura de Google Sheets",
    feat2Desc: "Conéctate de forma directa y segura con tus hojas de cálculo (sheet) online, para leer nombres y correos.",
    feat3Title: "Escaneo con IA",
    feat3Desc: "CertiSend Pro lee visualmente cada PDF para extraer el nombre con precisión humana.",
    feat4Title: "Entrega Certificada",
    feat4Desc: "Envía correos personalizados directamente desde tu cuenta de Gmail con el certificado adjunto.",
    
    securityTitle: "Tus Datos Están 100% Protegidos",
    securitySub: "Privacidad de nivel empresarial. La seguridad de tu información es nuestro estándar principal.",
    sec1Title: "Sin Almacenamiento de Datos",
    sec1Desc: "No guardamos tus listas de contactos, correos electrónicos ni certificados en bases de datos externas. Todo se procesa en tiempo real directamente en tu navegador y servidor de sesión segura.",
    sec2Title: "Conexión Directa de API",
    sec2Desc: "La aplicación utiliza tokens de acceso temporales directos de Google OAuth 2.0. Los correos se envían desde tu propia bandeja de salida de Gmail.",
    sec3Title: "Aislamiento de Clientes",
    sec3Desc: "Cada sesión es completamente privada e independiente. Ningún otro usuario puede acceder a tus archivos ni ver los datos de tus destinatarios.",
    
    pricingTitle: "Planes Sencillos y Transparentes",
    pricingSub: "Elige el plan que mejor se adapte a tu volumen de PDF´s. Sin contratos, cancela cuando quieras.",
    calculatorTitle: "Calculadora de Costos Estimada",
    calculatorSub: "Arrastra para calcular cuántos certificados necesitas enviar este mes y te recomendaremos la mejor opción.",
    calcCertificates: "Certificados a enviar:",
    calcTotalEstimate: "Costo estimado mensual:",
    calcPayAsYouGo: "Te recomendamos el plan Pago por Uso",
    calcProPlan: "Te recomendamos el plan CertiSend Pro",
    buyNow: "Adquirir Plan",
    
    planFreeName: "Plan Gratuito",
    planFreePrice: "$0 USD",
    planFreeFeature1: "Hasta 15 certificados por lote",
    planFreeFeature2: "Escaneo básico de nombres con IA",
    planFreeFeature3: "Conexión estándar con Google Sheets",
    
    planProName: "Plan Pro Ilimitado",
    planProPrice: "$29 USD / mes",
    planProFeature1: "Certificados ilimitados por lote",
    planProFeature2: "Escaneo prioritario de alta velocidad",
    planProFeature3: "Marca de correo personalizada y HTML",
    planProFeature4: "Soporte prioritario 24/7",
    
    planPayGoName: "Pago Por Uso (SaaS)",
    planPayGoPrice: "$0.10 USD / envío",
    planPayGoFeature1: "Sin cuotas mensuales recurrentes",
    planPayGoFeature2: "Solo pagas por los correos enviados con éxito",
    planPayGoFeature3: "Ideal para eventos de temporada u ocasionales",
    
    faqTitle: "Preguntas Frecuentes",
    faqSub: "Resolvemos tus dudas sobre el funcionamiento y la seguridad de la plataforma.",
    faq1Q: "¿Cómo reconoce el sistema los nombres en los diplomas?",
    faq1A: "Utilizamos la tecnología de IA, la cual analiza visualmente el PDF para encontrar el nombre de forma inteligente, evitando firmas y otros textos distractores.",
    faq2Q: "¿Mis contactos o PDFs se guardan en sus servidores?",
    faq2A: "No. Los archivos PDF y datos de Google Sheets se procesan bajo una sesión efímera que expira automáticamente a las 2 horas. Tus datos nunca son persistidos a largo plazo ni compartidos.",
    faq3Q: "¿Cómo funciona el envío masivo?",
    faq3A: "Se realiza a través de la API oficial de Gmail mediante la autenticación segura Google OAuth. El destinatario verá que el correo proviene directamente de tu dirección oficial, garantizando máxima entregabilidad.",
    faq4Q: "¿Cuáles son los métodos de pago aceptados?",
    faq4A: "Para Colombia y Latinoamérica, ofrecemos integraciones de pago seguras mediante Mercado Pago, soportando tarjetas de crédito, PSE y transferencias bancarias locales tanto en COP como en USD.",
    
    footerText: "CertiSend Pro es un servicio independiente de automatización segura de diplomas.",
    footerRights: "Todos los derechos reservados."
  },
  en: {
    appName: "CertiSend Pro",
    loginWithGoogle: "Login with Google",
    logout: "Log out",
    workspace: "Workspace Console",
    tagline: "Premium PDF automation and custom bulk delivery in seconds",
    english: "English",
    spanish: "Español",
    lightMode: "Light Mode",
    darkMode: "Dark Mode",
    
    heroTitle: "Send hundreds of custom PDFs in 1 simple click",
    heroSub: "Upload a single PDF containing all diplomas, cards, invitations, certificates, or whatever you want to send, connect your Google Sheet where the list of people you want to send the personalized document to is located, and CertiSend Pro will automatically and securely match and deliver to each recipient.",
    startFree: "Start for Free",
    seeDemo: "See Plans & Pricing",
    
    featuresTitle: "Premium Features",
    featuresSub: "CertiSend Pro is a tool designed to automate your PDF delivery workflow completely hassle-free.",
    feat1Title: "Smart PDF Splitting",
    feat1Desc: "Upload a bulk PDF file. Our system immediately splits it into individual PDFs.",
    feat2Title: "Google Sheets Integration",
    feat2Desc: "Connect directly and securely to your online spreadsheets (sheets) to fetch recipient names and emails instantly.",
    feat3Title: "AI Scanning",
    feat3Desc: "CertiSend Pro visually reads each PDF to extract the name with human-grade accuracy.",
    feat4Title: "Certified Email Delivery",
    feat4Desc: "Send personalized emails directly from your own Gmail account with the certificate attached.",
    
    securityTitle: "Your Data is 100% Protected",
    securitySub: "Enterprise-grade privacy. Information security is our core standard.",
    sec1Title: "Zero Data Retention",
    sec1Desc: "We never store your contact lists, emails, or certificate files in external databases. Everything is processed in real-time within your browser and secure temporary session.",
    sec2Title: "Direct API Integration",
    sec2Desc: "The app relies on temporary secure access tokens from Google OAuth 2.0. Emails are dispatched directly from your own Gmail outbox.",
    sec3Title: "Total Client Isolation",
    sec3Desc: "Every session is completely private and isolated. No other user can ever access your uploaded files or recipient details.",
    
    pricingTitle: "Simple and Transparent Pricing",
    pricingSub: "Choose the plan that best fits your PDF volume. No lock-ins, cancel anytime.",
    calculatorTitle: "Estimated Cost Calculator",
    calculatorSub: "Drag the slider to calculate how many certificates you need to send this month, and we will recommend the best plan.",
    calcCertificates: "Certificates to send:",
    calcTotalEstimate: "Estimated monthly cost:",
    calcPayAsYouGo: "We recommend the Pay-as-you-go Plan",
    calcProPlan: "We recommend the CertiSend Pro Plan",
    buyNow: "Purchase Plan",
    
    planFreeName: "Free Plan",
    planFreePrice: "$0 USD",
    planFreeFeature1: "Up to 15 certificates per batch",
    planFreeFeature2: "Basic AI name scanning",
    planFreeFeature3: "Standard Google Sheets connection",
    
    planProName: "Unlimited Pro Plan",
    planProPrice: "$29 USD / month",
    planProFeature1: "Unlimited certificates per batch",
    planProFeature2: "Priority high-speed scanning",
    planProFeature3: "Custom email branding and HTML",
    planProFeature4: "24/7 priority support",
    
    planPayGoName: "Pay-As-You-Go",
    planPayGoPrice: "$0.10 USD / delivery",
    planPayGoFeature1: "No recurring monthly fees",
    planPayGoFeature2: "Only pay for successfully delivered emails",
    planPayGoFeature3: "Ideal for seasonal or occasional events",
    
    faqTitle: "Frequently Asked Questions",
    faqSub: "Answering your common questions about how the platform works and its security.",
    faq1Q: "How does the system recognize names on certificates?",
    faq1A: "We use AI technology, which visually analyzes the PDF to intelligently find the name, avoiding signatures and other distracting texts.",
    faq2Q: "Are my contacts or PDFs saved on your servers?",
    faq2A: "No. The PDF files and Google Sheets rows are processed in an ephemeral session that automatically expires after 2 hours. Your files are never stored permanently.",
    faq3Q: "How does the bulk emailing work?",
    faq3A: "Emails are sent via the official Gmail API using secure Google OAuth. Your recipients will see that the email comes directly from your official address, ensuring peak deliverability.",
    faq4Q: "What payment methods are supported?",
    faq4A: "For Colombia and Latin America, we offer secure checkout integrations through Mercado Pago, supporting major credit cards, bank transfers, and local payment methods in USD and COP.",
    
    footerText: "CertiSend Pro is an independent, secure certificate automation utility.",
    footerRights: "All rights reserved."
  }
};
