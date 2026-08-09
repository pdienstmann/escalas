"use client";

import { useEffect, type AnchorHTMLAttributes, type ReactNode } from "react";

type FullPageLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  children: ReactNode;
};

const prefetchedPages = new Set<string>();

function prefetchPage(href: string) {
  if (prefetchedPages.has(href)) return;
  prefetchedPages.add(href);
  const link=document.createElement("link");
  link.rel="prefetch";
  link.href=href;
  link.dataset.prefetch=href;
  document.head.appendChild(link);
}

export function FullPageLink({ href, children, ...props }: FullPageLinkProps) {
  useEffect(()=>{
    const schedule=()=>prefetchPage(href);
    const idle="requestIdleCallback" in window
      ? window.requestIdleCallback(schedule,{timeout:1800})
      : window.setTimeout(schedule,700);
    return()=>{if("cancelIdleCallback" in window)window.cancelIdleCallback(idle);else window.clearTimeout(idle)};
  },[href]);
  const prefetch=()=>prefetchPage(href);
  return <a href={href} {...props} onClick={(event) => {
    props.onClick?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    const overlay=document.createElement("div");overlay.className="route-transition";overlay.textContent="Abrindo módulo…";document.body.appendChild(overlay);
    requestAnimationFrame(()=>window.location.assign(href));
  }} onPointerEnter={(event)=>{props.onPointerEnter?.(event);prefetch()}} onFocus={(event)=>{props.onFocus?.(event);prefetch()}}>{children}</a>;
}
