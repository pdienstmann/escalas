"use client";

import { useEffect, type AnchorHTMLAttributes, type ReactNode } from "react";

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

function prefetchPage(href: string) {
  if (prefetchedPages.has(href)) return;
  prefetchedPages.add(href);
  const link = document.createElement("link");
  link.rel = "prefetch";
  link.href = href;
  link.dataset.prefetch = href;
  document.head.appendChild(link);
}

function destinationName(href: string) {
  const pathname = href.split("?")[0].replace(/\/$/, "") || "/";
  return routeNames[pathname] || "módulo";
}

export function FullPageLink({ href, children, ...props }: FullPageLinkProps) {
  useEffect(() => {
    const schedule = () => prefetchPage(href);
    const idle = "requestIdleCallback" in window
      ? window.requestIdleCallback(schedule, { timeout: 1800 })
      : window.setTimeout(schedule, 700);
    return () => {
      if ("cancelIdleCallback" in window) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, [href]);

  const prefetch = () => prefetchPage(href);
  return <a href={href} {...props} onClick={(event) => {
    props.onClick?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    const overlay = document.createElement("div");
    overlay.className = "route-transition";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    const spinner = document.createElement("span");
    spinner.className = "route-transition-spinner";
    spinner.setAttribute("aria-hidden", "true");
    const label = document.createElement("b");
    label.textContent = `Abrindo ${destinationName(href)}…`;
    overlay.append(spinner, label);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => window.location.assign(href));
  }} onPointerEnter={(event) => { props.onPointerEnter?.(event); prefetch(); }} onFocus={(event) => { props.onFocus?.(event); prefetch(); }}>{children}</a>;
}
