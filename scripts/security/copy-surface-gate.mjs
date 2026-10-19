#!/usr/bin/env node
// Candado de SUPERFICIE DE COPIA (Sentinel_LAP clase #34) para pipelines Node.
// Fuente unica: Brain_Master_Business/TEMPLATES/skills/Sentinel_LAP/assets/. En cada repo vive una
// COPIA en scripts/security/ junto a copy_surface_audit.py; TOOLS/higiene/sync_copy_surface.py las
// mantiene iguales a la fuente (--check = oraculo de deriva).
//
// Uso (al final del build, para que bloquee el deploy):
//   "build": "next build && node scripts/security/copy-surface-gate.mjs .next"
//   firebase.json hosting.predeploy: "node scripts/security/copy-surface-gate.mjs dist --ignore server.cjs*"
//
// Falla CERRADO: sin Python, error del auditor o hallazgo CRITICA/ALTA -> exit != 0 -> el build y el
// deploy se caen. No hay bypass por variable de entorno a proposito: un falso positivo se arregla en
// el auditor (fuente), no se apaga el candado en un repo.
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const target = process.argv[2]
const extra = process.argv.slice(3) // ej: --ignore "server.cjs*" (espejo del ignore del host)
if (!target) {
    console.error("[copy-surface] falta el directorio del build (ej: .next, dist, out)")
    process.exit(2)
}
const auditor = join(dirname(fileURLToPath(import.meta.url)), "copy_surface_audit.py")
const candidates = [["python3"], ["python"], ["py", "-3"]]

for (const [cmd, ...pre] of candidates) {
    const probe = spawnSync(cmd, [...pre, "--version"], { encoding: "utf8" })
    if (probe.error || probe.status !== 0) continue
    console.log(`[copy-surface] auditando ${target} con ${cmd} ${pre.join(" ")}`.trim())
    const run = spawnSync(cmd, [...pre, "-I", auditor, "build", target, ...extra], { stdio: "inherit" })
    if (run.status === 0) {
        console.log("[copy-surface] OK: el cliente no regala secretos, source maps, prompts ni llamadas directas a IA")
        process.exit(0)
    }
    console.error(`[copy-surface] BLOQUEADO (exit ${run.status}). Ver hallazgos arriba; Sentinel vuln-catalog #34.`)
    process.exit(run.status || 1)
}
console.error("[copy-surface] BLOQUEADO: no hay Python (python3/python/py) en este entorno de build. Falla cerrado.")
process.exit(1)
