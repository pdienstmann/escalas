import type { Metadata } from "next";
import { LiveSchedule } from "./live-schedule";

export const metadata: Metadata = {
  title: "Escala GMNH",
  description: "Gestão diária de efetivo, viaturas, afastamentos e horas extras.",
};

export default function Home() {
  return <><LiveSchedule /><a className="validation-shortcut" href="/validacao?date=2026-08-12">Validar</a><a className="pdf-shortcut" href="/impressao?date=2026-08-12">PDF / impressão</a></>;
}
