import type { Metadata } from "next";
import "./globals.css";
import "./management.css";

export const metadata: Metadata = { title:"Escala GMNH", description:"Gestão integrada de escalas da Guarda Municipal", icons:{icon:"/favicon.svg"}, openGraph:{title:"Escala GMNH",description:"Gestão integrada de efetivo",images:["/og.png"]} };
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>}
