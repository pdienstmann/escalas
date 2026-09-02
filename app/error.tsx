"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("Falha de rota", error); }, [error]);
  return <main className="app-error-state" role="alert"><section><span aria-hidden="true">!</span><small>FALHA AO ABRIR O MÓDULO</small><h1>Não foi possível mostrar esta área</h1><p>Os dados já salvos permanecem protegidos. Tente novamente sem precisar voltar para a escala inicial.</p><details><summary>Detalhes técnicos</summary><code>{error.digest || error.message}</code></details><div><button type="button" onClick={reset}>Tentar novamente</button><Link href="/">Ir ao início</Link></div></section></main>;
}
