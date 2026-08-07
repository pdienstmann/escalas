"use client";

import { useCallback, useEffect, useState } from "react";
import {
  readScheduleDateFromSearch,
  resolveScheduleDate,
  storeScheduleDate,
  withScheduleDate,
} from "../lib/schedule-date";

export function useScheduleDate(initial?: string | null) {
  const [date, setDateState] = useState(() =>
    resolveScheduleDate(initial ?? readScheduleDateFromSearch()),
  );

  const setDate = useCallback((next: string) => {
    const resolved = resolveScheduleDate(next);
    setDateState(resolved);
    storeScheduleDate(resolved);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("date", resolved);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    const fromUrl = readScheduleDateFromSearch();
    const resolved = resolveScheduleDate(fromUrl || initial);
    setDateState(resolved);
    storeScheduleDate(resolved);
    if (!fromUrl && typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("date", resolved);
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [initial]);

  const hrefFor = useCallback((href: string) => withScheduleDate(href, date), [date]);

  return { date, setDate, hrefFor };
}
