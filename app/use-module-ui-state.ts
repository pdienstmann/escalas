"use client";

import { Dispatch, SetStateAction, useEffect, useState } from "react";

/** Stores harmless visual preferences (filters, sorting and page) per module/date. */
export function useModuleUiState<T>(module: string, date: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const key = `gmnh:ui:${module}:${date}`;
  const [value, setValue] = useState<T>(() => read(key, initial));

  useEffect(() => {
    try { window.sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* optional preference */ }
  }, [key, value]);

  return [value, setValue];
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && fallback && typeof fallback === "object") {
      return { ...(fallback as object), ...(parsed as object) } as T;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}
