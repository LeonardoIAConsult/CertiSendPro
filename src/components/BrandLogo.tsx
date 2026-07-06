import React from "react";
import { motion } from "motion/react";

// CertiSend Pro — isotipo oficial (Manual de Marca v1.0)
// Medalla (certificado) + flecha de envío saliendo del anillo abierto.
const GLYPH = {
  arc: "M 61.9 37.5 A 19 19 0 1 1 50.5 26.1",
  line: "M 50 38 L 66.8 21.2",
  head: "M 76 12 L 71.4 25.8 L 62.2 16.6 Z",
  ribbon: "M 37 60.5 L 32.5 83 L 44 76 L 55.5 83 L 51 60.5"
};

export function CertiSendGlyph({
  className = "",
  stroke = "currentColor"
}: {
  className?: string;
  stroke?: string;
}) {
  return (
    <svg viewBox="0 0 96 96" fill="none" className={className} aria-hidden="true">
      <path d={GLYPH.arc} stroke={stroke} strokeWidth={6.5} strokeLinecap="round" />
      <path d={GLYPH.line} stroke={stroke} strokeWidth={6.5} strokeLinecap="round" />
      <path d={GLYPH.head} fill={stroke} />
      <path d={GLYPH.ribbon} stroke={stroke} strokeWidth={6.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Isotipo sobre cuadrado degradado (icono de app / headers)
export function LogoMark({ className = "w-10 h-10" }: { className?: string }) {
  return (
    <div
      className={`${className} rounded-xl bg-gradient-to-tr from-[#2563EB] to-[#8B5CF6] flex items-center justify-center shadow-md shadow-indigo-600/20`}
    >
      <CertiSendGlyph stroke="#FFFFFF" className="w-[72%] h-[72%]" />
    </div>
  );
}

// Isotipo animado para el Hero: se dibuja a sí mismo y la flecha "despega";
// luego flota suavemente en loop.
export function AnimatedGlyph({ className = "" }: { className?: string }) {
  return (
    <motion.div
      className={className}
      animate={{ y: [0, -7, 0] }}
      transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut", delay: 1.8 }}
    >
      <svg viewBox="0 0 96 96" fill="none" className="w-full h-full">
        <defs>
          <linearGradient id="csHeroGrad" x1="0" y1="96" x2="96" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#2563EB" />
            <stop offset="1" stopColor="#8B5CF6" />
          </linearGradient>
        </defs>
        <motion.path
          d={GLYPH.arc}
          stroke="url(#csHeroGrad)"
          strokeWidth={6.5}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, ease: "easeInOut" }}
        />
        <motion.path
          d={GLYPH.ribbon}
          stroke="url(#csHeroGrad)"
          strokeWidth={6.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.6, delay: 0.5, ease: "easeInOut" }}
        />
        <motion.path
          d={GLYPH.line}
          stroke="url(#csHeroGrad)"
          strokeWidth={6.5}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.35, delay: 0.95 }}
        />
        <motion.path
          d={GLYPH.head}
          fill="url(#csHeroGrad)"
          initial={{ opacity: 0, x: -10, y: 10, scale: 0.6 }}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          transition={{ duration: 0.45, delay: 1.2, ease: "easeOut" }}
        />
      </svg>
    </motion.div>
  );
}

export default LogoMark;
