"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState, type AnchorHTMLAttributes, type ReactNode } from "react";

type FullPageLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  children: ReactNode;
};

const prefetchedPages = new Set<string>();
const routeNames: Record<string, string> = {
  "/": "Início",
  "/escala": "Escala",
  "/planejamento": "Planejamento",
  "/operacoes": "Operações",
  "/movimentacoes": "Pendências",
  "/horas-extras": "Horas extras",
  "/bancos": "BH e trocas",
  "/padroes": "Padrões 12x36",
  "/alteracoes": "Alterações diversas",
  "/folgas": "Folgas mensais",
  "/viaturas": "Viaturas",
  "/cadastros": "Cadastros",
  "/historico": "Histórico",
  "/validacao": "Validação",
};

function prefetchPage(href: string, prefetch: (href: string) => void) {
  if (prefetchedPages.has(href)) return;
  prefetchedPages.add(href);
  try { prefetch(href); } catch { prefetchedPages.delete(href); }
}

function destinationName(href: string) {
  const pathname = href.split("?")[0].replace(/\/$/, "") || "/";
  return routeNames[pathname] || "módulo";
}

export function FullPageLink({ href, children, ...props }: FullPageLinkProps) {
  const router = useRouter();
  const [showFeedback, setShowFeedback] = useState(false);
  const feedbackTimer = useRef<number | null>(null);
  const fallbackTimer = useRef<number | null>(null);
  useEffect(() => {
    const schedule = () => prefetchPage(href, router.prefetch);
    const idle = "requestIdleCallback" in window
      ? window.requestIdleCallback(schedule, { timeout: 1800 })
      : window.setTimeout(schedule, 700);
    return () => {
      if ("cancelIdleCallback" in window) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
      if (fallbackTimer.current !== null) window.clearTimeout(fallbackTimer.current);
    };
  }, [href, router]);

  const prefetch = () => prefetchPage(href, router.prefetch);
  return <>
    <a href={href} {...props} onClick={(event) => {
      props.onClick?.(event);
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target === "_blank" || props.download) return;
      event.preventDefault();
      feedbackTimer.current = window.setTimeout(() => setShowFeedback(true), 180);
      fallbackTimer.current = window.setTimeout(() => window.location.assign(href), 8000);
      startTransition(() => router.push(href));
    }} onPointerEnter={(event) => { props.onPointerEnter?.(event); prefetch(); }} onFocus={(event) => { props.onFocus?.(event); prefetch(); }}>{children}</a>
    {showFeedback && <div className="route-transition" role="status" aria-live="polite"><span className="route-transition-spinner" aria-hidden="true"/><b>{`Abrindo ${destinationName(href)}…`}</b></div>}
  </>;
}
