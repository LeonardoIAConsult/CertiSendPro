#!/usr/bin/env python3
"""
Sentinel_LAP — barrido de SUPERFICIE DE COPIA (clase #34 del vuln-catalog).

Por que existe (decision Leonardo 2026-10-19, tras auditar morluto/rea): las herramientas de
ingenieria inversa con agentes (REA y similares) leen TODO lo que la app le entrega al navegador
(bundles JS, source maps, llamadas a la API) y lo convierten en una copia funcional. No se pueden
bloquear: el cliente es del atacante. La defensa es que lo valioso viva en el servidor y que el
cliente no regale nada. Este script mide exactamente eso sobre lo que se SIRVE.

Dos modos (solo stdlib):
  build : lee un build de produccion. Con la raiz `.next` escanea static/ entero (TODO el JS de
          cliente de todas las rutas, tambien las de sesion iniciada) + server/app/*.html|*.rsc
          (HTML prerenderizado y props serializadas). Con dist/out/build, la carpeta entera.
          NO cubre lo que el servidor arma por peticion con sesion (RSC dinamico, respuestas /api).
          Sin red.
  url   : baja por GET (mismo origen exacto; redirects solo dentro del origen) las paginas indicadas, sus scripts y
          los chunks que estos referencian, recursivo hasta 300. Comprueba si los .map se SIRVEN.
          Sin sesion solo ve el JS de paginas publicas (EH: 26 archivos vs 219 en build): un
          limpio en url NO es un limpio del producto; usar build para eso.
          Solo lectura. --probe-api (GET sin sesion a cada /api/* encontrado) exige
          --confirm-own-target: solo sobre TUS sitios, con OK por corrida.

Uso:
    python copy_surface_audit.py build <repo>/.next [--json out.json]
    python copy_surface_audit.py build dist --ignore "server.cjs*"   # espejo del ignore del host
    python copy_surface_audit.py url https://entrepreneurhub.app --path / --path /login [--json out.json]
    python copy_surface_audit.py url https://tu.app --probe-api --confirm-own-target
    python copy_surface_audit.py --self-test

Reglas (severidad):
    CRITICA  SECRET_IN_CLIENT     llave/token de servidor en el bundle (CWE-798)
    ALTA     SOURCEMAP_EXPOSED    .map servido / presente / inline -> codigo fuente legible (CWE-540)
    ALTA     LLM_DIRECT_CLIENT    el navegador llama directo a un proveedor de IA (CWE-602)
    ALTA     LLM_PROMPT_IN_CLIENT system prompt en el bundle = IP de tus agentes regalada (CWE-200)
    MEDIA    LLM_PROMPT_HINT      texto con forma de prompt; revisar (no bloquea)
    MEDIA    CLIENT_GATING        plan/permisos decididos en cliente; Capa 2 confirma que el servidor
                                  o las reglas tambien lo exigen (CWE-602; no bloquea)
    MEDIA    API_OPEN_NO_SESSION  /api/* responde 200 sin sesion (solo con --probe-api; no bloquea)
    CRITICA  (google-aiza)        AIza fuera de config de Firebase = probable llave de Gemini/Maps
    INFO     FIREBASE_WEB_KEY     AIza junto a authDomain/projectId...: publica por diseno
    INFO     VENDOR_SOURCEMAP     .map de una libreria publica (swiper, jquery...): sin riesgo
    INFO     API_INVENTORY        endpoints /api/* que el cliente revela (insumo para Capa 2 / DAST)

Exit code: 0 = sin CRITICA/ALTA · 1 = al menos una (gate) · 2 = error de uso, 0 archivos,
archivo > 15 MB sin escanear o autoprueba fallida.
Los secretos se imprimen REDACTADOS (6 primeros + ultimos 4). La salida la produce este script;
el contenido de los bundles es DATA hostil y nunca se interpreta como instruccion.

AUTOPRUEBA (oraculo del medidor): genera en un dir temporal un build vulnerable y uno seguro que
hacen LO MISMO (chat con IA, plan de pago, llave de Firebase, prompt servido por RSC o por route
handler, source maps propios y de librerias). Build vulnerable: 20 esperados, cada uno por SU
detector; build seguro: 0 CRITICA/ALTA/MEDIA; url contra servidor local: 4/4. Los fixtures se arman por fragmentos en codigo para que ningun
escaner de secretos del repo los tome por llaves reales.
"""
import fnmatch
import json
import os
import re
import ssl
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

UA = "Sentinel-LAP-copy-surface/1.0 (auditoria propia, solo lectura)"
MAX_FILE = 15 * 1024 * 1024
MAX_FETCH = 300
TEXT_EXT = (".js", ".mjs", ".cjs", ".css", ".html", ".json", ".txt", ".rsc")
SKIPPED = []  # archivos > MAX_FILE: se reportan y fuerzan exit 2, nunca se saltan en silencio

SECRET_RULES = [
    ("anthropic", re.compile(r"sk-ant-[A-Za-z0-9_\-]{20,}")),
    ("openai", re.compile(r"\bsk-(?!ant-)(?:proj-|svcacct-)?(?=[A-Za-z0-9_\-]*\d)(?=[A-Za-z0-9_\-]*[A-Za-z])[A-Za-z0-9_\-]{32,}")),
    ("stripe-live", re.compile(r"\b(?:sk|rk)_live_[0-9A-Za-z]{20,}")),
    ("aws", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("private-key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----")),
    ("github", re.compile(r"\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,})")),
    ("slack", re.compile(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}")),
    ("meta-token", re.compile(r"\bEAA[A-Za-z0-9]{80,}")),
    ("mercadopago-access", re.compile(r"\bAPP_USR-\d{10,20}-\d{6}-[a-f0-9]{32}-\d{6,12}\b")),
    ("gcp-service-account", re.compile(r"[\"']type[\"']\s*:\s*[\"']service_account[\"']|[\"']private_key_id[\"']\s*:")),
]
FIREBASE_KEY = re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b")
# Firebase y Gemini comparten formato AIza. Solo es la de Firebase la que es VALOR de `apiKey:`
# (asi la emite initializeApp, tambien minificado); cualquier otra AIza = llave de servidor. La
# ventana de "vecinos a 300 chars" dejaba pasar una llave de Gemini declarada junto al config
# (REVISOR 2026-10-19, vueltas 1 y 2: el diseño se cambio, no se amplio la lista).
FIREBASE_APIKEY = re.compile(r"apiKey[\"']?\s*[:=]\s*[\"'`]$")
# Vite/Rollup sacan los valores del config a constantes (`SD="1:52:web:5fc6",_D="AIza..."`) y el
# `apiKey:` desaparece (FP en CertiSend 2026-10-19). Segunda via: firma de appId de Firebase a <200
# chars, salvo que el nombre pegado a la llave delate otro uso (GEMINI_KEY junto al config = CRITICA).
FIREBASE_APPID = re.compile(r"\d+:\d{6,}:web:[0-9a-f]{6,}")
AI_KEY_NAME = re.compile(r"(?i)(gemini|genai|generative|google_?ai|vertex|maps|places|youtube|translate)[\w$]*[\"']?\s*[:=]\s*[\"'`]$")
# Exige esquema: una llamada real lleva https:// (fetch, SDK, constante). Sin esquema es texto, como
# la landing de Guardian que explica "conecta con api.anthropic.com" (FP 2026-10-19).
LLM_HOSTS = re.compile(
    r"(?:https?|wss?):/+(api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|"
    r"aiplatform\.googleapis\.com|firebasevertexai\.googleapis\.com|api\.groq\.com|"
    r"api\.mistral\.ai|openrouter\.ai/api|api\.deepseek\.com|api\.x\.ai)"
)
PROMPT_STRONG = re.compile(
    # Claves con o sin comillas: en JS minificado van sueltas, en el payload RSC van en JSON.
    r"(?:role[\"']?\s*:\s*[\"']system[\"']\s*,\s*[\"']?(?:content|parts)[\"']?\s*:\s*[\"'`\[{]|"
    r"systemInstruction[\"']?\s*:\s*[\"'`{]|system_?[Pp]rompt[\"']?\s*[:=]\s*[\"'`])"
    r"[^\"'`]{0,20}[^\"'`\n]{60,}"
)
PROMPT_HINT = re.compile(
    r"[\"'`](?:You are an? |Eres una? |Act[uú]a como |Act as an? )[^\"'`\n]{70,}[\"'`]|"
    r"(?:Responde|Devuelve|Respond|Return)\s+(?:solo|[uú]nicamente|only)\s+(?:en|in|con|with)?\s*(?:formato\s+)?JSON"
)
# isSubscribed fuera: lo usan jsPDF y react-redux (FP medido en EntrepreneurHub 2026-10-19).
GATING_FLAG = re.compile(
    r"\b(?:isPremium|isPro|isPaid|hasActiveSubscription|subscriptionStatus|"
    r"currentPlan|planId|isAdmin|isSuperAdmin)\b"
)
# Forma real en EH: `plan === "Free"` / `p.tier === "Enterprise"`; minificado sobrevive igual.
GATING_CMP = re.compile(
    r"\b(?:plan|tier|subscriptionPlan|planName|role)\s*[!=]==?\s*[\"'][A-Za-z_][A-Za-z0-9_ ]{1,30}[\"']"
)
API_PATH = re.compile(r"[\"'`](/api/[A-Za-z0-9_\-/\[\]\.]{2,80})[\"'`]")
SOURCEMAP_REF = re.compile(r"[#@]\s*sourceMappingURL=([^\s'\"*]+)")
# Vendor = por CONTENIDO del map (todas las sources en node_modules) o basename que EMPIEZA con
# el nombre de una libreria. Antes era subcadena sobre la ruta: /dashboard/charts/ pasaba por
# vendor y un map propio salia INFO (REVISOR 2026-10-19, grave 3).
VENDOR_BASENAME = re.compile(r"^(?:swiper|jquery|bootstrap|intl-?tel-?input|gsap|lodash|lottie|popper|splide)(?:[.\-_]|$)", re.I)
CHUNK_REF = re.compile(r"[\"'`]((?:/_next/)?static/(?:chunks|[A-Za-z0-9_\-]+)/[A-Za-z0-9_\-./~]+?\.js)[\"'`]")
SEV_ORDER = {"CRITICA": 0, "ALTA": 1, "MEDIA": 2, "INFO": 3}
CWE = {
    "SECRET_IN_CLIENT": "CWE-798", "SOURCEMAP_EXPOSED": "CWE-540", "LLM_DIRECT_CLIENT": "CWE-602",
    "LLM_PROMPT_IN_CLIENT": "CWE-200", "LLM_PROMPT_HINT": "CWE-200", "CLIENT_GATING": "CWE-602",
    "API_OPEN_NO_SESSION": "CWE-306", "FIREBASE_WEB_KEY": "CWE-798", "VENDOR_SOURCEMAP": "CWE-540",
    "API_INVENTORY": "CWE-200",
}


def is_vendor_map(name, body):
    try:
        sources = json.loads(body).get("sources") or []
    except (ValueError, AttributeError):
        sources = []
    # Si el map trae sources, decide SOLO el contenido: un map propio llamado gsap-hero.js.map
    # salia vendor por el nombre (REVISOR 2026-10-19, vuelta 2). El nombre solo desempata cuando
    # el map no se pudo leer o viene sin sources. Costo aceptado: el map de una libreria
    # auto-alojada con sources sin node_modules sale ALTA (FP que la Capa 2 descarta en un minuto;
    # el falso negativo contrario expone codigo propio).
    if sources:
        return all("node_modules/" in str(s) for s in sources)
    return bool(VENDOR_BASENAME.search(os.path.basename(name.split("?")[0])))


def redact(s):
    s = s.strip()
    return s[:6] + "..." + s[-4:] if len(s) > 12 else "****"


def where(text, idx):
    line = text.count("\n", 0, idx) + 1
    col = idx - (text.rfind("\n", 0, idx) + 1) + 1
    return line, col


def snippet(text, m, secret=False):
    if secret:
        return redact(m.group(0))
    s = text[max(0, m.start() - 20): m.end() + 40].replace("\n", " ")
    return s[:120]


class Report:
    def __init__(self):
        self.items = []

    def add(self, sev, rule, target, line, detail):
        self.items.append({"severity": sev, "rule": rule, "target": target, "line": line, "detail": detail})

    def blocking(self):
        return [i for i in self.items if i["severity"] in ("CRITICA", "ALTA")]

    def print(self):
        for i in sorted(self.items, key=lambda x: (SEV_ORDER[x["severity"]], x["rule"], x["target"])):
            print(f"{i['target']}:{i['line']}: {i['severity']}: {i['rule']}: {i['detail']}")
        counts = {k: sum(1 for i in self.items if i["severity"] == k) for k in SEV_ORDER}
        print(f"\nresumen: CRITICA={counts['CRITICA']} ALTA={counts['ALTA']} MEDIA={counts['MEDIA']} INFO={counts['INFO']}")

    def to_findings(self):
        out = []
        for n, i in enumerate(self.items, 1):
            if i["severity"] == "INFO":
                continue
            objective = i["rule"] in ("SECRET_IN_CLIENT", "SOURCEMAP_EXPOSED", "LLM_DIRECT_CLIENT")
            out.append({
                "id": f"CS-{n:03d}", "file": i["target"], "line": i["line"], "cls": CWE[i["rule"]],
                "title": f"{i['rule']}: {i['detail']}",
                "severity": {"CRITICA": "critical", "ALTA": "high", "MEDIA": "medium"}[i["severity"]],
                "verdict": "confirmed" if objective else "needs_validation",
                "found_by": "copy_surface_audit", "unit": "class:34",
            })
        return out


def scan_text(rep, target, text, api_paths):
    for name, rx in SECRET_RULES:
        for m in rx.finditer(text):
            line, _ = where(text, m.start())
            rep.add("CRITICA", "SECRET_IN_CLIENT", target, line, f"{name} {snippet(text, m, True)}")
    seen_keys = set()
    for m in FIREBASE_KEY.finditer(text):
        k = m.group(0)
        if k in seen_keys:
            continue
        seen_keys.add(k)
        line = where(text, m.start())[0]
        before = text[max(0, m.start() - 40): m.start()]
        firebase = FIREBASE_APIKEY.search(before[-20:]) or (
            not AI_KEY_NAME.search(before) and FIREBASE_APPID.search(text[max(0, m.start() - 200): m.end() + 200]))
        if firebase:
            rep.add("INFO", "FIREBASE_WEB_KEY", target, line,
                    f"{redact(k)} dentro de config de Firebase: publica por diseno (protege App Check + reglas)")
        else:
            rep.add("CRITICA", "SECRET_IN_CLIENT", target, line,
                    f"google-aiza {redact(k)} fuera de config de Firebase: probable llave de Gemini/Maps de servidor")
    hosts = sorted({m.group(1) for m in LLM_HOSTS.finditer(text)})
    for h in hosts:
        rep.add("ALTA", "LLM_DIRECT_CLIENT", target, where(text, text.find(h))[0],
                f"el navegador habla con {h}: llave o prompt viven en el cliente; pasar por /api propia")
    for m in PROMPT_STRONG.finditer(text):
        rep.add("ALTA", "LLM_PROMPT_IN_CLIENT", target, where(text, m.start())[0], snippet(text, m))
    for m in PROMPT_HINT.finditer(text):
        rep.add("MEDIA", "LLM_PROMPT_HINT", target, where(text, m.start())[0], snippet(text, m))
    for kind, rx in (("comparacion", GATING_CMP), ("bandera", GATING_FLAG)):
        gates = rx.findall(text)
        if gates:
            uniq = sorted(set(re.sub(r"\s+", "", g) for g in gates))[:6]
            m = rx.search(text)
            rep.add("MEDIA", "CLIENT_GATING", target, where(text, m.start())[0],
                    f"{kind}: {len(gates)} decisiones de plan/rol en cliente ({', '.join(uniq)}); confirmar que servidor/reglas tambien lo exigen")
    for m in SOURCEMAP_REF.finditer(text):
        ref = m.group(1)
        if ref.startswith("data:"):
            rep.add("ALTA", "SOURCEMAP_EXPOSED", target, where(text, m.start())[0], "source map INLINE (base64) dentro del bundle")
    for m in API_PATH.finditer(text):
        api_paths.add(m.group(1))


def read_text(path):
    if os.path.getsize(path) > MAX_FILE:
        return None
    with open(path, "rb") as f:
        return f.read().decode("utf-8", errors="ignore")


def run_build(root, rep, ignore=()):
    if not os.path.isdir(root):
        print(f"no existe el directorio: {root}", file=sys.stderr)
        return None
    # Raiz .next: static/ entero (JS de cliente) + server/app solo *.html|*.rsc (HTML prerenderizado
    # y props serializadas que el servidor manda al navegador). Los .js de server/ NO se sirven: un
    # prompt en un route handler es correcto y no se marca (REVISOR 2026-10-19, grave 2).
    next_root = os.path.isdir(os.path.join(root, "static")) and os.path.isdir(os.path.join(root, "server", "app"))
    walks = [(os.path.join(root, "static"), None), (os.path.join(root, "server", "app"), (".html", ".rsc"))] if next_root else [(root, None)]
    api_paths, n = set(), 0
    for base, only in walks:
        for dirpath, _, files in os.walk(base):
            for fn in files:
                p = os.path.join(dirpath, fn)
                rel = os.path.relpath(p, root).replace("\\", "/")
                if only and not fn.lower().endswith(only):
                    continue
                # --ignore = espejo del `ignore` del host (Firebase Hosting no sirve server.cjs*).
                if any(fnmatch.fnmatch(rel, g) or fnmatch.fnmatch(fn, g) for g in ignore):
                    continue
                if fn.endswith(".map"):
                    body = read_text(p) or ""
                    vendor = is_vendor_map(fn, body)
                    rep.add("INFO" if vendor else "ALTA", "VENDOR_SOURCEMAP" if vendor else "SOURCEMAP_EXPOSED", rel, 0,
                            "archivo .map dentro de los assets publicos: tu codigo fuente original queda legible")
                    continue
                if not fn.lower().endswith(TEXT_EXT):
                    continue
                text = read_text(p)
                if text is None:
                    SKIPPED.append(rel)
                    continue
                n += 1
                scan_text(rep, rel, text, api_paths)
    return api_paths, n


def ctx():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    # Solo redirects dentro del mismo origen (/ -> /es): un 30x a otro host atribuia contenido
    # ajeno al sitio propio. Ese se corta y la pagina queda "no escaneada", nunca "limpia".
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if same_origin(newurl, req.full_url):
            return super().redirect_request(req, fp, code, msg, headers, newurl)
        return None


def same_origin(u, origin):
    a, b = urllib.parse.urlparse(u), urllib.parse.urlparse(origin)
    return (a.scheme, a.hostname, a.port) == (b.scheme, b.hostname, b.port)


def get(url, c, accept_status=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=c), NoRedirect)
    try:
        with opener.open(req, timeout=20) as r:
            data = r.read(MAX_FILE + 1)
            if len(data) > MAX_FILE:
                SKIPPED.append(url)
                return -2, ""
            return r.status, data.decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except (urllib.error.URLError, TimeoutError, ssl.SSLError) as e:
        if accept_status:
            return -1, str(e)
        raise


def run_url(base, paths, rep, probe):
    c = ctx()
    origin = "{0.scheme}://{0.netloc}".format(urllib.parse.urlparse(base))
    seen, queue, api_paths = set(), [], set()

    def enqueue(u):
        u = urllib.parse.urljoin(origin + "/", u).split("#")[0]
        if same_origin(u, origin) and u not in seen and len(seen) < MAX_FETCH:
            seen.add(u)
            queue.append(u)

    for p in paths or ["/"]:
        page = urllib.parse.urljoin(origin, p)
        if not same_origin(page, origin):
            rep.add("INFO", "API_INVENTORY", p, 0, "fuera del origen auditado; no se pidio")
            continue
        status, html = get(page, c, accept_status=True)
        if status != 200:
            rep.add("INFO", "API_INVENTORY", p, 0, f"pagina devolvio {status}; no se escaneo")
            continue
        scan_text(rep, p, html, api_paths)
        for m in re.finditer(r"(?:src|href)=[\"']([^\"']+\.m?js(?:\?[^\"']*)?)[\"']", html):
            enqueue(m.group(1))
    n = 0
    while queue:
        u = queue.pop(0)
        status, body = get(u, c, accept_status=True)
        if status != 200:
            continue
        n += 1
        rel = urllib.parse.urlparse(u).path
        scan_text(rep, rel, body, api_paths)
        for m in CHUNK_REF.finditer(body):
            ref = m.group(1)
            enqueue(ref if ref.startswith("/") else "/_next/" + ref if ref.startswith("static/") else ref)
        refs = [r for r in SOURCEMAP_REF.findall(body) if not r.startswith("data:")]
        map_url = urllib.parse.urljoin(u, refs[-1]) if refs else u.split("?")[0] + ".map"
        ms, mbody = get(map_url, c, accept_status=True)
        if ms == 200 and '"mappings"' in mbody:
            vendor = is_vendor_map(map_url, mbody)
            rep.add("INFO" if vendor else "ALTA", "VENDOR_SOURCEMAP" if vendor else "SOURCEMAP_EXPOSED", rel, 0,
                    f"se sirve {urllib.parse.urlparse(map_url).path} (200): codigo fuente original descargable")
    if probe:
        for ap in sorted(api_paths)[:60]:
            if "[" in ap:
                continue
            status, body = get(origin + ap, c, accept_status=True)
            if status == 200:
                rep.add("MEDIA", "API_OPEN_NO_SESSION", ap, 0, f"GET sin sesion -> 200 ({len(body)} bytes); confirmar que es publico a proposito")
            time.sleep(0.3)
    return api_paths, n


EXPECTED_VULN = {
    "SECRET_IN_CLIENT:anthropic", "SECRET_IN_CLIENT:mercadopago-access", "SECRET_IN_CLIENT:google-aiza:app-chat.js",
    "SECRET_IN_CLIENT:google-aiza:cfg.js", "SOURCEMAP_EXPOSED:file:gsap-hero.js.map",
    "SECRET_IN_CLIENT:aws", "SECRET_IN_CLIENT:private-key", "SECRET_IN_CLIENT:openai",
    "SOURCEMAP_EXPOSED:file:app-chat.js.map", "SOURCEMAP_EXPOSED:file:page-1a2b.js.map", "SOURCEMAP_EXPOSED:inline",
    "LLM_DIRECT_CLIENT:api.anthropic.com", "LLM_DIRECT_CLIENT:generativelanguage.googleapis.com",
    "LLM_DIRECT_CLIENT:api.mistral.ai", "LLM_PROMPT_IN_CLIENT:rsc",
    "LLM_PROMPT_IN_CLIENT:role-system", "LLM_PROMPT_IN_CLIENT:systemInstruction",
    "LLM_PROMPT_HINT", "CLIENT_GATING:comparacion", "CLIENT_GATING:bandera",
}


def expect_key(i):
    r, d = i["rule"], i["detail"]
    if r == "SECRET_IN_CLIENT":
        name = d.split()[0]
        return f"{r}:{name}:{os.path.basename(i['target'])}" if name == "google-aiza" else f"{r}:{name}"
    if r == "SOURCEMAP_EXPOSED":
        return f"{r}:inline" if "INLINE" in d else f"{r}:file:{os.path.basename(i['target'])}"
    if r == "LLM_DIRECT_CLIENT":
        return f"{r}:{d.split('habla con ')[1].split(':')[0]}"
    if r == "LLM_PROMPT_IN_CLIENT":
        if i["target"].endswith(".rsc"):
            return f"{r}:rsc"
        return f"{r}:{'systemInstruction' if 'systemInstruction' in d else 'role-system'}"
    if r == "CLIENT_GATING":
        return f"{r}:{d.split(':')[0]}"
    return r


def self_test():
    S = lambda *p: "".join(p)
    ant = S("sk-", "ant-", "api03-", "Zx9" * 12)
    mp = S("APP_", "USR-", "1234567890123456", "-101910-", "a" * 16, "b" * 16, "-1234567")
    fb = S("AI", "za", "Sy", "B" * 33)
    prompt = "Eres un consultor de negocios experto. Analiza la idea del usuario y devuelve un plan de tres pasos con riesgos."
    vuln = {
        "static/chunks/app-chat.js": (
            f'const k="{ant}";fetch("https://api.anthropic.com/v1/messages",{{headers:{{"x-api-key":k}}}});'
            f'const msgs=[{{role:"system",content:"{prompt}"}}];'
            f'const mp="{mp}";const fb="{fb}";'
            'if(user.isPremium){show()}if(u.plan==="Free"){lock()}fetch("/api/plan");\n//# sourceMappingURL=app-chat.js.map'),
        "static/chunks/app-chat.js.map": '{"version":3,"sources":["src/app/chat.tsx"]}',
        "static/chunks/inline.js": "x()\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==",
        "static/chunks/gemini.js": (
            f'fetch("https://generativelanguage.googleapis.com/v1beta/models?key="+"{fb}");'
            'const cfg={systemInstruction:"Actua como mentor de mentalidad para emprendedores y responde con empatia y pasos concretos."}'),
        # Mapa PROPIO en una ruta con palabra de libreria: antes salia vendor/INFO (grave 3).
        "static/chunks/app/dashboard/charts/page-1a2b.js.map": '{"version":3,"sources":["src/app/dashboard/charts/page.tsx"],"mappings":"AAAA"}',
        # Map PROPIO con nombre de libreria: decide el contenido, no el nombre (vuelta 2).
        "static/chunks/gsap-hero.js.map": '{"version":3,"sources":["src/components/gsap-hero.tsx"],"mappings":"AAAA"}',
        # Llave de Gemini declarada pegada al config de Firebase: solo la de apiKey es publica.
        "static/chunks/cfg.js": S('const firebaseConfig={apiKey:"', fb, '",authDomain:"demo.firebaseapp.com",projectId:"demo",appId:"1:522374745014:web:5fc64cc0906"};',
                                  'export const GEMINI_KEY="AI', 'za', 'Sy', 'G' * 33, '";'),
        "static/chunks/misc.js": S('a="AK', 'IA', "Q" * 16, '";b="-----BEGIN ', 'PRIVATE KEY-----";c="sk-', 'proj-', "Ab1" * 12,
                                   '";fetch("https://api.mistral.ai/v1/chat/completions")'),
        # Server component que pasa el prompt como prop: viaja serializado en el payload RSC (grave 2).
        "server/app/dashboard.rsc": '1:["$","Chat",null,{"systemPrompt":"Eres Magdalena, guia de mentalidad. Escucha sin juzgar, pregunta antes de aconsejar y cierra con un paso pequeno."}]',
    }
    safe = {
        "static/chunks/app-chat.js": (
            f'const cfg={{apiKey:"{fb}",authDomain:"demo.firebaseapp.com",projectId:"demo"}};fetch("/api/chat",{{method:"POST",body:JSON.stringify({{m:input}})}});'
            'render("You are a Pro member");render("Eres un emprendedor");this.internal.languageSettings.isSubscribed=!1;fetch("/api/plan").then(r=>r.json()).then(p=>show(p.features));'),
        "static/chunks/swiper-bundle.min.js.map": '{"version":3,"sources":["webpack://app/node_modules/swiper/swiper-bundle.js"]}',
        "static/chunks/jquery.min.js.map": '{"version":3}',
        "static/chunks/chunk-9f.js.map": '{"version":3,"sources":["../node_modules/react/index.js","../node_modules/zod/lib.js"]}',
        # El route handler SI puede llevar prompt y hablar con Gemini: server/ .js no se sirve.
        "server/app/api/chat/route.js": 'const r=await fetch("https://generativelanguage.googleapis.com/v1beta");const c={systemInstruction:"Eres el Consultor de EntrepreneurHub, experto en validar ideas de negocio con datos reales."}',
        "server/app/page.html": '<html><body>Bienvenido</body></html>',
        # Config de Firebase con valores sacados a constantes por el minificador (CertiSend real).
        "static/chunks/vite-cfg.js": S('const xD="demo-436820",SD="1:522374745014:web:5fc64cc0906",_D="', fb, '",wD="demo.online";'),
        "static/guardian.html": '<li>Conexiones: el endpoint de uso de tu cuenta en <code>api.anthropic.com</code> y Telegram.</li>',
    }
    ok = True
    for name, files in (("vulnerable", vuln), ("seguro", safe)):
        with tempfile.TemporaryDirectory() as d:
            for rel, content in files.items():
                p = os.path.join(d, rel)
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with open(p, "w", encoding="utf-8") as f:
                    f.write(content)
            rep = Report()
            run_build(d, rep)
            noisy = [i for i in rep.items if i["severity"] in ("CRITICA", "ALTA", "MEDIA")]
            if name == "vulnerable":
                # Cada cosa sembrada debe salir por SU detector: un umbral de conteo deja pasar un
                # detector ciego si otro compensa (mutacion 2026-10-19: cegar anthropic seguia en OK).
                got = {expect_key(i) for i in noisy}
                missing = sorted(EXPECTED_VULN - got)
                passed = not missing
                print(f"[self-test] vulnerable: {len(got & EXPECTED_VULN)}/{len(EXPECTED_VULN)} esperados -> {'OK' if passed else 'FALLA'}")
                for k in missing:
                    print("   falta:", k)
            else:
                passed = not noisy
                print(f"[self-test] seguro: {len(noisy)} CRITICA/ALTA/MEDIA -> {'OK' if passed else 'FALLA'}")
                for i in noisy:
                    print("   ruido:", i)
            ok = ok and passed
    return 0 if ok and self_test_ignore() and self_test_url() else 2


def self_test_ignore():
    """--ignore saca lo que el host no sirve; sin --ignore el mismo archivo SI suena."""
    with tempfile.TemporaryDirectory() as d:
        with open(os.path.join(d, "server.cjs"), "w", encoding="utf-8") as f:
            f.write('fetch("https://api.anthropic.com/v1/messages")')
        with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
            f.write("<html></html>")
        con, sin = Report(), Report()
        run_build(d, con, ("server.cjs*",))
        run_build(d, sin)
    passed = not con.blocking() and bool(sin.blocking())
    print(f"[self-test] --ignore: ignorado={not con.blocking()} sin_ignore_suena={bool(sin.blocking())} -> {'OK' if passed else 'FALLA'}")
    return passed


def self_test_url():
    """Modo url contra un servidor local: pagina -> chunk -> chunk referenciado -> .map servido."""
    import functools
    import http.server
    import threading
    site = {
        "index.html": '<html><script src="/_next/static/chunks/main.js"></script>'
                      '<script src="/_next/static/chunks/swiper-bundle.min.js"></script>'
                      '<script src="/_next/static/chunks/app/dashboard/charts/page-1a2b.js"></script></html>',
        "_next/static/chunks/main.js": 'import("static/chunks/lazy.js");\n//# sourceMappingURL=main.js.map',
        "_next/static/chunks/main.js.map": '{"version":3,"sources":["src/app/page.tsx"],"mappings":"AAAA"}',
        "_next/static/chunks/lazy.js": 'fetch("https://api.openai.com/v1/chat/completions")',
        "_next/static/chunks/swiper-bundle.min.js": "/* lib */\n//# sourceMappingURL=swiper-bundle.min.js.map",
        "_next/static/chunks/swiper-bundle.min.js.map": '{"version":3,"sources":["webpack://app/node_modules/swiper/swiper-bundle.js"],"mappings":"AAAA"}',
        "_next/static/chunks/app/dashboard/charts/page-1a2b.js": "render()",
        "_next/static/chunks/app/dashboard/charts/page-1a2b.js.map": '{"version":3,"sources":["src/charts.tsx"],"mappings":"AAAA"}',
    }
    with tempfile.TemporaryDirectory() as d:
        for rel, content in site.items():
            p = os.path.join(d, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as f:
                f.write(content)

        class Quiet(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *a):
                pass

        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=d))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            rep = Report()
            run_url(f"http://127.0.0.1:{srv.server_address[1]}", ["/index.html"], rep, False)
        finally:
            srv.shutdown()
    got = {(i["rule"], i["target"]) for i in rep.items}
    need = {("SOURCEMAP_EXPOSED", "/_next/static/chunks/main.js"),
            ("LLM_DIRECT_CLIENT", "/_next/static/chunks/lazy.js"),
            ("VENDOR_SOURCEMAP", "/_next/static/chunks/swiper-bundle.min.js"),
            ("SOURCEMAP_EXPOSED", "/_next/static/chunks/app/dashboard/charts/page-1a2b.js")}
    wrong = [i for i in rep.items if i["severity"] != "INFO" and "swiper" in i["target"]]
    passed = need <= got and not wrong
    print(f"[self-test] url local: {len(need & got)}/{len(need)} esperados, vendor como INFO={not wrong} -> {'OK' if passed else 'FALLA'}")
    for k in sorted(need - got):
        print("   falta:", k)
    return passed


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 2
    if argv[0] == "--self-test":
        return self_test()
    mode, rest = argv[0], argv[1:]
    json_out, paths, probe, confirm, target, ignore = None, [], False, False, None, []
    i = 0
    while i < len(rest):
        a = rest[i]
        if a == "--json":
            json_out = rest[i + 1]; i += 2; continue
        if a == "--ignore":
            ignore.append(rest[i + 1]); i += 2; continue
        if a == "--path":
            paths.append(rest[i + 1]); i += 2; continue
        if a == "--probe-api":
            probe = True
        elif a == "--confirm-own-target":
            confirm = True
        elif target is None:
            target = a
        else:
            print(f"argumento desconocido: {a}", file=sys.stderr); return 2
        i += 1
    if target is None or mode not in ("build", "url"):
        print(__doc__)
        return 2
    if probe and not confirm:
        print("--probe-api requiere --confirm-own-target (regla: solo TUS sitios, OK por corrida)", file=sys.stderr)
        return 2
    rep = Report()
    try:
        res = run_build(target, rep, ignore) if mode == "build" else run_url(target, paths, rep, probe)
    except (urllib.error.URLError, ssl.SSLError) as e:
        print(f"error de red: {e} (Norton intercepta TLS: pip install pip-system-certs; nunca desactivar verificacion)", file=sys.stderr)
        return 2
    if res is None:
        return 2
    api_paths, n = res
    if n == 0:
        print("0 archivos escaneados: objetivo vacio o mal apuntado. Un cero sin archivos no es 'limpio'.", file=sys.stderr)
        for i in rep.items:
            print(f"  {i['target']}: {i['detail']}", file=sys.stderr)
        print("  (Git Bash convierte '--path /x' en ruta de Windows: anteponer MSYS_NO_PATHCONV=1)", file=sys.stderr)
        return 2
    if api_paths:
        rep.add("INFO", "API_INVENTORY", target, 0, f"{len(api_paths)} endpoints revelados: {', '.join(sorted(api_paths)[:25])}")
    rep.print()
    print(f"archivos escaneados: {n}")
    if json_out:
        with open(json_out, "w", encoding="utf-8") as f:
            json.dump(rep.to_findings(), f, ensure_ascii=False, indent=2)
    if rep.blocking():
        return 1
    if SKIPPED:
        print(f"{len(SKIPPED)} archivos > {MAX_FILE // (1024 * 1024)} MB sin escanear: {', '.join(SKIPPED[:5])}. "
              "Sin ellos no hay 'limpio'.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
