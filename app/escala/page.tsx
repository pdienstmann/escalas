import type { Metadata } from "next";
import { LiveSchedule } from "../live-schedule";

export const metadata: Metadata = {
  title: "Escala diária · GMNH",
  description: "Edição da escala operacional diária da Guarda Municipal de Novo Hamburgo.",
};

export default function Escala() {
  return <LiveSchedule />;
}
