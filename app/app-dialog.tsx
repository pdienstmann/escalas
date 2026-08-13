"use client";

import { ReactNode, useEffect, useRef } from "react";

type AppDialogProps = {
  children: ReactNode;
  className?: string;
  onClose: () => void;
  closeOnBackdrop?: boolean;
};

/**
 * Shared behavior for the application's existing dialog bodies.
 *
 * The visual/card markup stays inside each module while this shell guarantees
 * Escape, focus, scroll lock and the mobile-safe backdrop behavior everywhere.
 */
export function AppDialog({ children, className = "", onClose, closeOnBackdrop = true }: AppDialogProps) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const target = root.current?.querySelector<HTMLElement>("[role='dialog']") || root.current;
    const timer = window.setTimeout(() => target?.focus(), 0);
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", closeWithEscape);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", closeWithEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return <div
    ref={root}
    className={`app-dialog-backdrop ${className}`.trim()}
    role="presentation"
    onMouseDown={(event) => {
      if (closeOnBackdrop && event.target === event.currentTarget) onClose();
    }}
  >{children}</div>;
}
