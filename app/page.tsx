import type { Metadata } from "next";
import { EscalaApp } from "./escala-app";

export const metadata: Metadata = {
  title: "Escala GMNH",
  description: "Gestão diária de efetivo, viaturas, afastamentos e horas extras.",
};

export default function Home() {
  return <EscalaApp />;
}
