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
    if (target && !target.hasAttribute("tabindex")) target.tabIndex = -1;
    const timer = window.setTimeout(() => target?.focus(), 0);
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !target) return;
      const focusable = [...target.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.hasAttribute("hidden"));
      if (!focusable.length) { event.preventDefault(); target.focus(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", closeWithEscape);
    window.addEventListener("keydown", keepFocusInside);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", closeWithEscape);
      window.removeEventListener("keydown", keepFocusInside);
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
