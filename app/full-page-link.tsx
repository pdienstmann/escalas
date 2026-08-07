"use client";

import type { AnchorHTMLAttributes, ReactNode } from "react";

type FullPageLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  children: ReactNode;
};

export function FullPageLink({ href, children, ...props }: FullPageLinkProps) {
  const prefetch=()=>{if(document.querySelector(`link[data-prefetch="${href}"]`))return;const link=document.createElement("link");link.rel="prefetch";link.href=href;link.dataset.prefetch=href;document.head.appendChild(link)};
  return <a href={href} {...props} onClick={(event) => {
    props.onClick?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    const overlay=document.createElement("div");overlay.className="route-transition";overlay.textContent="Abrindo módulo…";document.body.appendChild(overlay);
    window.location.assign(href);
  }} onPointerEnter={(event)=>{props.onPointerEnter?.(event);prefetch()}} onFocus={(event)=>{props.onFocus?.(event);prefetch()}}>{children}</a>;
}
