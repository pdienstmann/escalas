"use client";

import { FullPageLink as Link } from "./full-page-link";
import { withScheduleDate } from "../lib/schedule-date";
import { useSessionProfile } from "./use-session-profile";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

type NavItem = {
  href: string;
  label: string;
  exact?: boolean;
  icon?: string;
  description?: string;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const primaryItems: NavItem[] = [
  { href: "/", label: "Início", exact: true },
  { href: "/escala", label: "Escala" },
  { href: "/planejamento", label: "Planejamento" },
  { href: "/operacoes", label: "Operações" },
  { href: "/movimentacoes", label: "Pendências" },
  { href: "/horas-extras", label: "Horas extras" },
];
const moreGroups: NavGroup[] = [
  {
    label: "Gestão do efetivo",
    items: [
      { href: "/bancos", label: "BH / trocas", description: "Compensações e trocas de serviço" },
      { href: "/alteracoes", label: "Alterações diversas", description: "Lembretes vinculados às datas" },
      { href: "/folgas", label: "Folgas mensais", description: "Importação e panorama de folgas" },
    ],
  },
  {
    label: "Preparação da escala",
    items: [
      { href: "/padroes", label: "Padrões e semanal", description: "Equipes-base e expediente semanal" },
      { href: "/viaturas", label: "Viaturas", description: "Disponibilidade, tipo e situação FA" },
      { href: "/cadastros", label: "Cadastros", description: "GMs, postos e seções" },
    ],
  },
  {
    label: "Conferência",
    items: [
      { href: "/validacao", label: "Validar / publicar", description: "Conferir furos e liberar a escala" },
      { href: "/historico", label: "Histórico", description: "Alterações, responsáveis e desfazer" },
    ],
  },
] ;
const moreItems = moreGroups.flatMap((group) => group.items);

const mobileItems: NavItem[] = [
  { href: "/", label: "Início", icon: "⌂", exact: true },
  { href: "/escala", label: "Escala", icon: "▦" },
  { href: "/planejamento", label: "Planejar", icon: "□" },
  { href: "/movimentacoes", label: "Pendências", icon: "!" },
];

export function ScheduleNav({
  date,
  active = "/",
}: {
  date: string;
  active?: string;
}) {
  const session = useSessionProfile();
  const router = useRouter();
  const activeMoreItem = moreItems.find((item) => active.startsWith(item.href));
  useEffect(() => {
    const likelyDestination = active === "/" ? "/escala" : active.startsWith("/escala") ? "/planejamento" : "/escala";
    const href = withScheduleDate(likelyDestination, date);
    const warm = () => { try { router.prefetch(href); } catch { /* prefetch is optional */ } };
    const timer = window.setTimeout(warm, 900);
    return () => window.clearTimeout(timer);
  }, [active, date, router]);
  return <>
    <nav className="tabs operational-tabs" aria-label="Módulos da escala">
      {primaryItems.map((item) => {
        const href = withScheduleDate(item.href, date);
        const isActive =
          item.exact ? active === item.href : active.startsWith(item.href);
        return isActive ? (
          <b key={item.href}>{item.label}</b>
        ) : (
          <Link key={item.href} href={href}>
            {item.label}
          </Link>
        );
      })}
      <details className={`nav-more${activeMoreItem ? " has-active" : ""}`}>
        <summary aria-label={activeMoreItem ? `Mais módulos. Atual: ${activeMoreItem.label}` : "Mais módulos"}>
          <span>Mais</span>{activeMoreItem && <small aria-hidden="true">· {activeMoreItem.label}</small>}
        </summary>
        <div className="nav-more-groups">{moreGroups.map((group)=><section key={group.label}>
          <small>{group.label}</small>
          {group.items.map((item)=>{
            const href=withScheduleDate(item.href,date),isActive=active.startsWith(item.href);
            const content=<><span>{item.label}</span><small>{item.description}</small></>;
            return isActive?<b className="nav-module-item" key={item.href}>{content}</b>:<Link className="nav-module-item" key={item.href} href={href}>{content}</Link>;
          })}
        </section>)}</div>
      </details>
      {session&&<span className={`session-role role-${session.role||"viewer"}`} title={session.source==="compatibility"?"Modo compatível; perfis ficam prontos ao ativar Cloudflare Access":String(session.name||"")}><i aria-hidden="true">●</i>{session.role==="admin"?"Administrador":session.role==="editor"?"Escalante":"Consulta"}</span>}
    </nav>
    <nav className="mobile-module-nav" aria-label="Navegação principal">
      {mobileItems.map((item) => {
        const href = withScheduleDate(item.href, date);
        const isActive = item.exact ? active === item.href : active.startsWith(item.href);
        return isActive ? <b key={item.href} aria-current="page"><i aria-hidden="true">{item.icon}</i><span>{item.label}</span></b> : <Link key={item.href} href={href}><i aria-hidden="true">{item.icon}</i><span>{item.label}</span></Link>;
      })}
      <details className={`mobile-nav-more${moreItems.some((item)=>active.startsWith(item.href)) || active.startsWith("/operacoes") || active.startsWith("/horas-extras") ? " has-active" : ""}`}>
        <summary><i aria-hidden="true">•••</i><span>Mais</span></summary>
        <div>
          <section><small>Acesso rápido</small>
            {[primaryItems[3], primaryItems[5]].map((item)=>{
              const href=withScheduleDate(item.href,date),isActive=active.startsWith(item.href);
              return isActive?<b key={item.href}>{item.label}</b>:<Link key={item.href} href={href}>{item.label}</Link>;
            })}
          </section>
          {moreGroups.map((group)=><section key={group.label}><small>{group.label}</small>{group.items.map((item)=>{
            const href=withScheduleDate(item.href,date),isActive=active.startsWith(item.href);
            return isActive?<b key={item.href}>{item.label}</b>:<Link key={item.href} href={href}>{item.label}</Link>;
          })}</section>)}
        </div>
      </details>
    </nav>
  </>;
}

export function BackToSchedule({ date, label = "← Voltar à escala" }: { date: string; label?: string }) {
  return <Link href={withScheduleDate("/escala", date)}>{label}</Link>;
}
