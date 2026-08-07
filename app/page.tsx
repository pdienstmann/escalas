import type { Metadata } from "next";
import { LiveSchedule } from "./live-schedule";

export const metadata: Metadata = {
  title: "Escala GMNH",
  description: "Gestão diária de efetivo, viaturas, afastamentos e horas extras.",
};

export default function Home() {
  return <><LiveSchedule /><a className="pattern-shortcut" href="/padroes">Padrões 12x36</a></>;
}
