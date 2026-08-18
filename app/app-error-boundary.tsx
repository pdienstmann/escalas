"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type State = { error: Error | null; incident: string };

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, incident: "" };

  static getDerivedStateFromError(error: Error): State {
    return { error, incident: `GMNH-${Date.now().toString(36).toUpperCase()}` };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Falha protegida pela barreira global", { error, info, incident: this.state.incident });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const retry = () => { this.setState({ error: null, incident: "" }); window.location.reload(); };
    return <main className="app-error-state" role="alert">
      <section>
        <span aria-hidden="true">!</span>
        <small>ERRO CONTROLADO · {this.state.incident}</small>
        <h1>Esta tela encontrou um problema</h1>
        <p>A escala e os dados salvos não foram apagados. Tente carregar novamente; se o erro continuar, copie o código abaixo.</p>
        <details><summary>Detalhes técnicos</summary><code>{this.state.error.message}</code></details>
        <div><button type="button" onClick={retry}>Tentar novamente</button><a href="/">Ir ao início</a><button type="button" className="secondary" onClick={()=>void navigator.clipboard?.writeText(`${this.state.incident}: ${this.state.error?.message}`)}>Copiar código</button></div>
      </section>
    </main>;
  }
}
