"use client";

import { Fragment, useMemo, useState } from "react";
import { FullPageLink as Link } from "./full-page-link";

type Status = "normal" | "he" | "bh" | "troca" | "furo";
type Cell = { people: string[]; times: string[]; status?: Status };
type Row = { group: string; kind: "post" | "vehicle"; label: string; detail?: string; vehicleType?: string; cells: Cell[] };

const shifts = ["2º TURNO · 07:00–13:00", "3º TURNO · 13:00–19:00", "4º TURNO · 19:00–01:00", "1º TURNO · 01:00–07:00"];
const rows: Row[] = [
  { group:"COMANDO E OPERAÇÕES", kind:"post", label:"Sala de Operações", cells:[{people:["EDERSON","NATAN"],times:["07:00–13:00","07:00–12:00"],status:"bh"},{people:["EDERSON","NATAN"],times:["13:00–19:00","13:00–19:00"]},{people:["VILSON","MARIEL"],times:["19:00–01:00","19:00–01:00"]},{people:["VILSON","MARIEL"],times:["01:00–07:00","01:00–07:00"]}]},
  { group:"COMANDO E OPERAÇÕES", kind:"post", label:"Reserva de Armamento", cells:[{people:["CAVALHEIRO","OTACÍLIO"],times:["06:00–12:00","06:00–12:00"]},{people:["CAVALHEIRO","OTACÍLIO"],times:["12:00–18:00","12:00–18:00"]},{people:["MATHEUS","SOBUCKI"],times:["18:00–01:00","18:00–01:00"]},{people:["MATHEUS","SOBUCKI"],times:["01:00–06:00","01:00–06:00"]}]},
  { group:"VIATURAS E ZONAS", kind:"vehicle", vehicleType:"sedan", label:"VTR 1337", detail:"Zona B3 Dia", cells:[{people:["MARQUES","INSPETOR DE SERVIÇO"],times:["07:00–13:00","07:00–13:00"]},{people:["MARQUES","INSPETOR"],times:["13:00–19:00","13:00–19:00"]},{people:["MARQUES","INSPETOR"],times:["19:00–01:00","19:00–01:00"]},{people:[],times:[],status:"furo"}]},
  { group:"VIATURAS E ZONAS", kind:"vehicle", vehicleType:"pickup", label:"VTR 1302", detail:"Lomba Grande", cells:[{people:["ROMANA","C. ALEXANDRE"],times:["07:00–12:00","07:00–12:00"]},{people:["ROMANA","C. ALEXANDRE"],times:["13:00–18:00","13:00–18:00"],status:"he"},{people:["ROMANA","C. ALEXANDRE"],times:["19:00–01:00","19:00–01:00"]},{people:["ROMANA","C. ALEXANDRE"],times:["01:00–07:00","01:00–07:00"]}]},
  { group:"VIATURAS E ZONAS", kind:"vehicle", vehicleType:"moto", label:"MOTOS · ZA CENTRO", detail:"Centro", cells:[{people:["RANIEL","GABRIEL"],times:["07:00–13:00","07:00–13:00"]},{people:["RANIEL","GABRIEL"],times:["13:00–19:00","13:00–19:00"]},{people:[],times:[],status:"furo"},{people:[],times:[],status:"furo"}]},
  { group:"PRAÇAS E PARQUES", kind:"post", label:"Praça da Juventude", cells:[{people:["ALEX"],times:["07:00–13:00"]},{people:["ALEX"],times:["13:00–19:00"]},{people:["RIVERO"],times:["19:00–01:00"]},{people:["RIVERO"],times:["01:00–07:00"]}]},
  { group:"POSTOS FIXOS", kind:"post", label:"SDS / Casa da Cidadania", cells:[{people:["CARLOS"],times:["07:00–12:00"]},{people:["CARLOS"],times:["13:00–18:00"],status:"troca"},{people:["VTR/RONDAS FREQUENTES"],times:["19:00–01:00"]},{people:["VTR/RONDAS FREQUENTES"],times:["01:00–07:00"]}]},
];

const movements = [
  ["Reserva técnica","3 GMs","Apresentação 06:45"], ["Folgas","12 GMs","2 folgas mensais"], ["Férias","4 GMs","Períodos ativos"],
  ["Curso","2 GMs","Formação operacional"], ["Atestados / licenças","3 GMs","Documentos vinculados"], ["BH / trocas","5 registros","Requerimentos anexados"]
];

function Badge({status}:{status?:Status}) { if(!status||status==="normal") return null; const labels={he:"HE",bh:"BH",troca:"TROCA",furo:"FURO"}; return <span className={`badge ${status}`}>{labels[status]}</span> }

export function EscalaApp(){
 const [selected,setSelected]=useState<{row:Row;shift:number}|null>({row:rows[2],shift:0});
 const [compact,setCompact]=useState(true);
 const [query,setQuery]=useState("");
 const visible=useMemo(()=>rows.filter(r=>(r.label+" "+r.detail+" "+r.cells.flatMap(c=>c.people).join(" ")).toLowerCase().includes(query.toLowerCase())),[query]);
 return <main className={compact?"app compact":"app"}>
  <header className="topbar"><div className="brand"><span className="crest">GM</span><div><b>Escala diária</b><small>Guarda Municipal de Novo Hamburgo</small></div></div><div className="date"><button>‹</button><b>12 AGO 2026</b><button>›</button></div><div className="stats"><span><b>198</b> escalados</span><span className="warn"><b>7</b> ausências</span><span><b>4</b> vagas</span><span className="danger"><b>2</b> furos</span></div><button className="primary">Validar e publicar</button></header>
  <nav className="tabs"><b>Escala</b><Link href="/movimentacoes">Movimentações</Link><Link href="/movimentacoes">Banco de horas</Link><span>Horas extras</span><Link href="/folgas">Folgas mensais</Link><Link href="/cadastros">Cadastros</Link></nav>
  <section className="toolbar"><div className="seg"><button className="active">Dia inteiro</button><button>Diurno</button><button>Noturno</button></div><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar posto, viatura ou GM…"/><label><input type="checkbox" checked={compact} onChange={e=>setCompact(e.target.checked)}/> Modo compacto</label><button>＋ Posto</button><button>＋ Viatura</button><button>＋ Pessoa</button><button onClick={()=>window.print()}>Gerar PDF</button></section>
  <div className="workspace"><section className="schedule-wrap"><table className="schedule"><thead><tr><th rowSpan={2}>POSTO / RECURSO</th><th colSpan={2}>DIURNO</th><th colSpan={2}>NOTURNO</th></tr><tr>{shifts.map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>{visible.map((r,i)=>{const group=i===0||visible[i-1].group!==r.group;return <Fragment key={r.label}>{group&&<tr className="group"><td colSpan={5}>{r.kind==="vehicle"?"▰":"◆"} {r.group}<button>＋ adicionar</button></td></tr>}<tr><td className="resource"><span className={`vehicle ${r.vehicleType||"post"}`}>{r.kind==="vehicle"?(r.vehicleType==="moto"?"◉":"▱"):""}</span><div><b>{r.label}</b>{r.detail&&<small>⌖ {r.detail}</small>}</div><button className="dots">•••</button></td>{r.cells.map((c,si)=><td key={si} onClick={()=>setSelected({row:r,shift:si})} className={`${c.status||""} ${selected?.row.label===r.label&&selected.shift===si?"selected":""}`}>{c.status==="furo"?<div className="hole"><Badge status="furo"/><b>Vaga não coberta</b><small>Selecionar GM</small></div>:c.people.map((p,pi)=><div className="person" key={p}><div>{r.kind==="vehicle"&&<span className="role">{pi===0?"M":"P"}</span>}<b>{p}</b> <Badge status={pi===0?c.status:undefined}/></div><small>{c.times[pi]}</small></div>)}</td>)}</tr></Fragment>})}</tbody></table>
   <section className="movement-grid"><h2>Efetivo fora da escala</h2><p>Entradas sincronizadas com a escala do dia e incluídas na versão para impressão.</p><div>{movements.map(m=><article key={m[0]}><b>{m[0]}</b><strong>{m[1]}</strong><small>{m[2]}</small><button>Ver lista →</button></article>)}</div></section>
  </section>
  <aside className="editor">{selected?<><div className="editor-head"><div><small>EDIÇÃO RÁPIDA</small><h2>{selected.row.label}</h2><p>{shifts[selected.shift]}</p></div><button onClick={()=>setSelected(null)}>×</button></div>{selected.row.kind==="vehicle"&&<><label>Motorista<select><option>{selected.row.cells[selected.shift].people[0]||"Selecionar"}</option></select></label><label>Patrulheiro<select><option>{selected.row.cells[selected.shift].people[1]||"Selecionar"}</option></select></label></>} {selected.row.kind==="post"&&<label>Guardas neste posto<textarea defaultValue={selected.row.cells[selected.shift].people.join("\n")}/></label>}<div className="two"><label>Entrada<input defaultValue={selected.row.cells[selected.shift].times[0]?.split("–")[0]||""}/></label><label>Saída<input defaultValue={selected.row.cells[selected.shift].times[0]?.split("–")[1]||""}/></label></div><label>Situação<select defaultValue={selected.row.cells[selected.shift].status||"normal"}><option value="normal">Normal</option><option value="he">Hora extra</option><option value="bh">Banco de horas</option><option value="troca">Troca de serviço</option></select></label><label>Requerimento / observação<input placeholder="Nº ou justificativa"/></label><button className="save">Salvar alteração</button><button className="remove">Remover desta escala</button><p className="hint">Alterações criam histórico com autor e horário.</p></>:<div className="empty">Selecione uma célula para editar.</div>}</aside>
  </div>
 </main>
}
