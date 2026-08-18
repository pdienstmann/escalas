"use client";

import { useEffect, useState } from "react";

type Session = { name?: string; role?: "admin" | "editor" | "viewer" | "guard"; source?: string };
let cached: Session | null = null;

export function useSessionProfile() {
  const [session, setSession] = useState<Session | null>(cached);
  useEffect(() => {
    if (cached) return;
    let active = true;
    fetch("/api/session").then((response)=>response.ok?response.json():null).then((value)=>{if(active&&value){cached=value;setSession(value)}}).catch(()=>{});
    return () => { active = false; };
  }, []);
  return session;
}
