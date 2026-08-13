"use client";

type CacheEnvelope<T> = {
  savedAt: number;
  data: T;
};

/**
 * Cache opcional de sessão para abrir módulos rapidamente.
 * A API continua sendo a fonte de verdade; o cache só evita uma tela vazia
 * enquanto a sincronização em segundo plano acontece.
 */
export function readClientCache<T>(key: string, ttlMs: number): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as CacheEnvelope<T>;
    if (!envelope || typeof envelope.savedAt !== "number") return null;
    if (Date.now() - envelope.savedAt > ttlMs) return null;
    return envelope.data;
  } catch {
    return null;
  }
}

export function writeClientCache<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data } satisfies CacheEnvelope<T>));
  } catch {
    // Cache é opcional; limites do navegador nunca podem interromper o fluxo.
  }
}
