import type { AnchorHTMLAttributes, ReactNode } from "react";

type FullPageLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  children: ReactNode;
};

export function FullPageLink({ href, children, ...props }: FullPageLinkProps) {
  return <a href={href} {...props}>{children}</a>;
}
