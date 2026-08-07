"use client";

import type { AnchorHTMLAttributes, ReactNode } from "react";

type FullPageLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  children: ReactNode;
};

export function FullPageLink({ href, children, ...props }: FullPageLinkProps) {
  return <a href={href} {...props} onClick={(event) => {
    props.onClick?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    window.location.assign(href);
  }}>{children}</a>;
}
