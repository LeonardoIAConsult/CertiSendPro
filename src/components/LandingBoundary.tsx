import React from "react";

/**
 * Red de seguridad de la landing V2: si la V2 lanza un error al renderizar, se muestra la landing
 * original (`fallback`) en vez de dejar la pagina en blanco. Los errores de carga del chunk se
 * cubren aparte en App.tsx (`React.lazy(...).catch(...)`).
 */
type Props = { fallback: React.ReactNode; children: React.ReactNode };

export default class LandingBoundary extends React.Component<Props, { failed: boolean }> {
  declare props: Props;
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[LANDING_V2] fallo al renderizar, se muestra la landing original:", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
