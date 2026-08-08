"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  readScheduleDateFromSearch,
  resolveScheduleDate,
  storeScheduleDate,
  withScheduleDate,
} from "../lib/schedule-date";

const dateChangeEvent = "gmnh:schedule-date-change";

function subscribeToScheduleDate(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("popstate", onChange);
  window.addEventListener(dateChangeEvent, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(dateChangeEvent, onChange);
  };
}

export function useScheduleDate(initial?: string | null) {
  const urlDate = useSyncExternalStore(
    subscribeToScheduleDate,
    () => readScheduleDateFromSearch() || "",
    () => initial || "",
  );
  const date = resolveScheduleDate(urlDate || initial);

  const setDate = useCallback((next: string) => {
    const resolved = resolveScheduleDate(next);
    storeScheduleDate(resolved);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("date", resolved);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new Event(dateChangeEvent));
  }, []);

  useEffect(() => {
    storeScheduleDate(date);
    if (!readScheduleDateFromSearch() && typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("date", date);
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [date]);

  const hrefFor = useCallback((href: string) => withScheduleDate(href, date), [date]);

  return { date, setDate, hrefFor };
}
