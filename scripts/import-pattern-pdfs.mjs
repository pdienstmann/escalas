/**
 * Rebuilds the operational catalog from the two scanned pattern sheets.
 *
 * This script only generates SQL. It deliberately does not call Wrangler so
 * that the operator can inspect the generated file before running it against
 * D1. The remote backup must exist before applying the file.
 */
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "tmp/d1-import/pattern-pdf-rebuild.sql";
mkdirSync("tmp/d1-import", { recursive: true });

const posts = [];
const vehicles = [];
const rows = [];

function addPost(name, group, sortOrder) {
  if (!posts.some((post) => post.name === name && post.group === group)) {
    posts.push({ name, group, sortOrder });
  }
}

function addVehicle(prefix, type, zone) {
  if (!vehicles.some((vehicle) => vehicle.prefix === prefix)) {
    vehicles.push({ prefix, type, zone });
  }
}

function post(pattern, group, resource, names, shift = null) {
  addPost(resource, group, 0);
  for (const name of names) rows.push({ pattern, kind: "post", group, resource, name, shift, role: "guard" });
}

function vtr(pattern, prefix, names, shift = null) {
  for (const [index, name] of names.entries()) {
    rows.push({
      pattern,
      kind: "vehicle",
      resource: prefix,
      name,
      shift,
      role: index === 0 ? "driver" : index === 1 ? "patrol" : "third",
    });
  }
}

const SEDE = "SEDE DA GM";
const ADMIN = "CENTRO ADMINISTRATIVO";
const PARKS = "PRAÇAS E PARQUES";
const DIVERSE = "POSTOS DIVERSOS";
const FLEET = "VIATURAS E ZONAS";
const ZA = "ZA PATRULHAMENTO";

// Every named row in the PDFs is represented below. Cells containing
// VTR/RONDAS FREQUENTES, X/XXX, HE+ or INSPEÇÃO DE SERVIÇO are placeholders,
// not guards, and are intentionally left without an assignment.
for (const [index, [name, group]] of [
  ["SALA DE OPERAÇÕES", SEDE],
  ["DALSEG (SEG A SEX)", SEDE],
  ["DALSEG (12X36)", SEDE],
  ["DESEG (12X36)", SEDE],
  ["RESERVA DE ARMAMENTO", SEDE],
  ["ACESSO OPERACIONAL (GUARITA)", SEDE],
  ["DTSEG (12X36)", SEDE],
  ["DEGESP (12X36)", SEDE],
  ["ACESSO PRINCIPAL", ADMIN],
  ["PORTARIA 2º PISO", ADMIN],
  ["PORTARIA 1º PISO", ADMIN],
  ["9º ANDAR", ADMIN],
  ["ESTACIONAMENTO", ADMIN],
  ["PRAÇA DA JUVENTUDE", PARKS],
  ["PRAÇA CÉU", PARKS],
  ["PARQUE FLORESTA IMPERIAL (SEG A SEX)", PARKS],
  ["PARQUE TRABALHADOR", PARKS],
  ["SEDEC LOMBA GRANDE", PARKS],
  ["PARCÃO HENRIQUE ROESLER", PARKS],
  ["RECEPTIVO", DIVERSE],
  ["CENTRO POP", DIVERSE],
  ["FAIXA NOBRE", DIVERSE],
  ["SDS/CASA DA CIDADANIA (SEG A SEX)", DIVERSE],
  ["CIT (CENTRO INTEGRADO DE TEC.) (SEG A SEX)", DIVERSE],
  ["RODOVIÁRIA", DIVERSE],
  ["CER (R. BAHIA LADO USF)", DIVERSE],
  ["LAR DA MENINA", DIVERSE],
  ["PRONASCI S. AFONSO", DIVERSE],
  ["CENTRO DE CULTURA", DIVERSE],
  ["SUB. S. AFONSO", DIVERSE],
  ["SUB. RINCÃO", DIVERSE],
  ["UBS SANTO AFONSO", DIVERSE],
  ["USF KEPHAS", DIVERSE],
  ["UBS CANUDOS", DIVERSE],
  ["HOSPITAL MUNICIPAL", DIVERSE],
  ["UPA CENTRO", DIVERSE],
  ["UPA CANUDOS", DIVERSE],
  ["EMEF SEN. SALGADO Fº EJA", DIVERSE],
  ["EMEB TANCREDO NEVES", DIVERSE],
  ["BACI KEPHAS", DIVERSE],
  ["EMEF BOA SAÚDE EJA", DIVERSE],
  ["EMEF EUGENIO N. RITZEL EJA", DIVERSE],
  ["EMEF ELVIRA B. GRIN EJA", DIVERSE],
  ["EMEF JOÃO B. JAEGER EJA", DIVERSE],
  ["EMEB MARIA QUITÉRIA EJA", DIVERSE],
  ["EMEF FRANCISCO XAV. KUNST", DIVERSE],
  ["EMEF ARNALDO GRIN", DIVERSE],
  ["EMEF MONTEIRO LOBATO", DIVERSE],
  ["EMEF MARTHA WARTEN", DIVERSE],
  ["EMEF ADOLFINA DIEFENTHALER", DIVERSE],
  ["EMEI BELA ADORMECIDA", DIVERSE],
  ["EMEI IRMÃ VALÉRIA", DIVERSE],
  ["CENTRO 2", FLEET],
  ["NOITE CANUDOS", FLEET],
  ["VOLANTES NOITE", ZA],
  ["1 - AV. PEDRO ADAMS FILHO / R. MARCÍLIO DIAS / R. LIMA E SILVA", ZA],
  ["2 - AV. PEDRO ADAMS FILHO / R. LIMA E SILVA / AV. NICOLAU BECKER", ZA],
  ["3 - AV. PRIMEIRO DE MARÇO / R. LIMA E SILVA / R. MAGALHÃES CALVET / AV. NICOLAU BECKER", ZA],
  ["4 - R. BENTO GONÇALVES / R. MARCÍLIO DIAS / R. DAVID CANABARRO", ZA],
  ["5 - AV. NAÇÕES UNIDAS / SHOPPING / R. JOAQUIM NABUCO / R. BORGES DE MEDEIROS / R. VINTE E CINCO DE JULHO", ZA],
].entries()) {
  addPost(name, group, index + 1);
}

// Fleet catalog present in the sheets. Types/zones are inferred from the
// labels and can still be edited in the VTRs area.
[
  ["VTR 1337", "sedan", "B3"],
  ["VTR 1302", "pickup", "Lomba Grande"],
  ["VTR 522", "van", "Pontos Base"],
  ["VTR 1332", "suv", "Escola Mais Segura São José / São Jorge"],
  ["VTR 1273", "suv", "Escola Mais Segura B. Saúde / Petrópolis / Rose."],
  ["VTR 1333", "suv", "Escola Mais Segura Canudos"],
  ["VTR 1335", "suv", "Escola Mais Segura S. Afonso / Rondônia / Ind. / Lib."],
  ["VTR 1334", "sedan", "Santo Afonso / Radar"],
  ["VTR 1338", "sedan", "Centro 1"],
  ["VTR 1336", "sedan", "Centro"],
  ["VTR 1317", "sedan", "Santo Afonso 1"],
  ["VTR 1296", "pickup", "Canudos"],
  ["VTR 1280", "pickup", "Canudos"],
  ["VTR A DEFINIR", "other", "Centro 2"],
  ["DIA MT 638", "moto", "ZA Centro"],
  ["DIA MT 646", "moto", "ZA Centro"],
  ["DIA MT 637", "moto", "ZA Centro"],
  ["DIA MT 643", "moto", "ZA Centro"],
  ["DIA MT 644", "moto", "ZA Centro"],
  ["DIA MT 640", "moto", "ZA Centro"],
  ["DIA MT 641", "moto", "ZA Centro"],
  ["DIA MT 639", "moto", "ZA Centro"],
].forEach(([prefix, type, zone]) => addVehicle(prefix, type, zone));

// Padrão PAR -> D1 (diurno) and N1 (noturno).
post("D1", SEDE, "SALA DE OPERAÇÕES", ["EDERSON", "NATAN"]);
post("D1", SEDE, "DALSEG (SEG A SEX)", ["VIGANON", "NUNES"]);
post("D1", SEDE, "DALSEG (12X36)", ["AZAMBUJA"]);
post("D1", SEDE, "DESEG (12X36)", ["VARGAS"]);
post("D1", SEDE, "RESERVA DE ARMAMENTO", ["CAVALHEIRO"]);
post("D1", SEDE, "ACESSO OPERACIONAL (GUARITA)", ["OTACILIO"]);
post("D1", SEDE, "DTSEG (12X36)", ["RAUL", "VIEGAS"]);
post("D1", ADMIN, "ACESSO PRINCIPAL", ["PASQUALI"]);
post("D1", ADMIN, "PORTARIA 2º PISO", ["MACHADO"]);
post("D1", ADMIN, "PORTARIA 1º PISO", ["SONIA"]);
post("D1", ADMIN, "9º ANDAR", ["MANASSES"]);
post("D1", PARKS, "PRAÇA DA JUVENTUDE", ["ALEX"]);
post("D1", PARKS, "PRAÇA CÉU", ["ANDRADE"]);
post("D1", PARKS, "PARQUE FLORESTA IMPERIAL (SEG A SEX)", ["EVERTON"]);
post("D1", PARKS, "PARQUE TRABALHADOR", ["FABIANO"]);
post("D1", PARKS, "PARCÃO HENRIQUE ROESLER", ["LAURO", "BITTENCOURT", "DORNELLES"]);
post("D1", DIVERSE, "RECEPTIVO", ["MICHELE"]);
post("D1", DIVERSE, "CENTRO POP", ["TALES"]);
post("D1", DIVERSE, "FAIXA NOBRE", ["BERNARDI"]);
post("D1", DIVERSE, "SDS/CASA DA CIDADANIA (SEG A SEX)", ["CARLOS"]);
post("D1", DIVERSE, "CIT (CENTRO INTEGRADO DE TEC.) (SEG A SEX)", ["ALBA"]);
post("D1", DIVERSE, "RODOVIÁRIA", ["EDINEI"], "2");
post("D1", DIVERSE, "RODOVIÁRIA", ["UBIRAJARA"], "3");
post("D1", DIVERSE, "LAR DA MENINA", ["LUIS"]);
post("D1", DIVERSE, "PRONASCI S. AFONSO", ["SEVERO"]);
post("D1", DIVERSE, "USF KEPHAS", ["SALAZAR"]);
post("D1", DIVERSE, "UBS CANUDOS", ["MARCELO"]);
post("D1", DIVERSE, "HOSPITAL MUNICIPAL", ["ROCHA"]);
post("D1", DIVERSE, "UPA CENTRO", ["GIOVANI"]);
post("D1", DIVERSE, "UPA CANUDOS", ["MAURO"]);
post("D1", DIVERSE, "EMEF FRANCISCO XAV. KUNST", ["NEUSA"]);
post("D1", DIVERSE, "EMEF ARNALDO GRIN", ["RODRIGO", "DARTAGNAN"]);
post("D1", DIVERSE, "EMEF MONTEIRO LOBATO", ["VOGES"]);
post("D1", DIVERSE, "EMEF ADOLFINA DIEFENTHALER", ["ANTONIO"]);
post("D1", DIVERSE, "EMEI IRMÃ VALÉRIA", ["CLOVEMIR"]);
vtr("D1", "VTR 1337", ["BOSSE"]);
vtr("D1", "VTR 1302", ["ROMANA", "C. ALEXANDRE"]);
vtr("D1", "VTR 522", ["ALECIO"]);
vtr("D1", "VTR 1332", ["EDMUNDO", "MOISES"]);
vtr("D1", "VTR 1273", ["SCHUQUEL", "FEIJO"]);
vtr("D1", "VTR 1333", ["JONATAS", "CAMARGO"]);
vtr("D1", "VTR 1335", ["JAIR", "JONATHAN"]);
vtr("D1", "VTR 1334", ["ARTHUR", "LENCINA"]);
vtr("D1", "VTR 1338", ["LEITE", "BERTOTTI"]);
vtr("D1", "VTR 1336", ["MICHAEL", "FLORES"]);
vtr("D1", "VTR 1317", ["LEVI"]);
vtr("D1", "VTR 1296", ["GIAN", "MICHELS"]);
vtr("D1", "DIA MT 638", ["REINHEIMER"]);
vtr("D1", "DIA MT 646", ["CUNHA"]);
vtr("D1", "DIA MT 637", ["FABRICIO"]);
vtr("D1", "DIA MT 643", ["ADNER"]);

post("N1", SEDE, "SALA DE OPERAÇÕES", ["VILSON", "MARIEL"]);
post("N1", SEDE, "RESERVA DE ARMAMENTO", ["MATHEUS"]);
post("N1", SEDE, "ACESSO OPERACIONAL (GUARITA)", ["SOBUCKI"]);
post("N1", ADMIN, "ACESSO PRINCIPAL", ["NEI"]);
post("N1", ADMIN, "PORTARIA 1º PISO", ["MELO"]);
post("N1", ADMIN, "ESTACIONAMENTO", ["IURI"]);
post("N1", PARKS, "PRAÇA DA JUVENTUDE", ["RIVERO"]);
post("N1", PARKS, "PRAÇA CÉU", ["NELSON"]);
post("N1", PARKS, "PARQUE TRABALHADOR", ["OLIVEIRA"]);
post("N1", PARKS, "PARCÃO HENRIQUE ROESLER", ["PALINI", "BORGES"]);
post("N1", DIVERSE, "CIT (CENTRO INTEGRADO DE TEC.) (SEG A SEX)", ["SALTIEL"]);
post("N1", DIVERSE, "RODOVIÁRIA", ["UBIRAJARA"], "4");
post("N1", DIVERSE, "CER (R. BAHIA LADO USF)", ["XAVIER"]);
post("N1", DIVERSE, "LAR DA MENINA", ["EDSON"]);
post("N1", DIVERSE, "CENTRO DE CULTURA", ["SIQUEIRA"]);
post("N1", DIVERSE, "SUB. RINCÃO", ["JOEL"]);
post("N1", DIVERSE, "HOSPITAL MUNICIPAL", ["TRIDENTE"]);
post("N1", DIVERSE, "UPA CENTRO", ["FERREIRA"]);
post("N1", DIVERSE, "UPA CANUDOS", ["VEGA"]);
post("N1", DIVERSE, "EMEF SEN. SALGADO Fº EJA", ["VIRKOSKI"], "4");
post("N1", DIVERSE, "EMEF EUGENIO N. RITZEL EJA", ["A. LUCAS"]);
post("N1", DIVERSE, "EMEI BELA ADORMECIDA", ["EMANUEL"]);
post("N1", FLEET, "NOITE CANUDOS", ["ARAUJO"]);
post("N1", ZA, "VOLANTES NOITE", ["HENRIQUE", "LUCAS"]);
vtr("N1", "VTR 1337", ["DA CRUZ"]);
vtr("N1", "VTR 1317", ["PITTER", "DE SOUZA"]);
vtr("N1", "VTR 1296", ["AMARAL", "MEDEIROS"]);
vtr("N1", "VTR 1338", ["DEIVISON"]);
vtr("N1", "VTR 1335", ["THOMAS", "MAURENTE"]);

// Padrão ÍMPAR -> D2 (diurno) and N2 (noturno).
post("D2", SEDE, "SALA DE OPERAÇÕES", ["MAIQUEL", "WAGNER", "GOETHEL"]);
post("D2", SEDE, "DALSEG (SEG A SEX)", ["VIGANON", "NUNES"]);
post("D2", SEDE, "RESERVA DE ARMAMENTO", ["SCHWINN"]);
post("D2", SEDE, "ACESSO OPERACIONAL (GUARITA)", ["VANDERLEIA"]);
post("D2", SEDE, "DTSEG (12X36)", ["JOHANN", "MARTINELLI", "MARINES"]);
post("D2", ADMIN, "ACESSO PRINCIPAL", ["ROBERTA"]);
post("D2", ADMIN, "PORTARIA 2º PISO", ["FONTOURA"]);
post("D2", ADMIN, "PORTARIA 1º PISO", ["GARCIA"]);
post("D2", ADMIN, "9º ANDAR", ["SANTOS"]);
post("D2", PARKS, "PRAÇA DA JUVENTUDE", ["SANTIAGO"]);
post("D2", PARKS, "PRAÇA CÉU", ["LEMES"]);
post("D2", PARKS, "PARQUE FLORESTA IMPERIAL (SEG A SEX)", ["EVERTON"]);
post("D2", PARKS, "PARQUE TRABALHADOR", ["KIRSCH"]);
post("D2", PARKS, "PARCÃO HENRIQUE ROESLER", ["ROCKEMBACH", "ULISSES"]);
post("D2", DIVERSE, "RECEPTIVO", ["PEDROSA"]);
post("D2", DIVERSE, "CENTRO POP", ["DOUGLAS"]);
post("D2", DIVERSE, "FAIXA NOBRE", ["EDUARDO"]);
post("D2", DIVERSE, "SDS/CASA DA CIDADANIA (SEG A SEX)", ["CARLOS"]);
post("D2", DIVERSE, "CIT (CENTRO INTEGRADO DE TEC.) (SEG A SEX)", ["ALBA"]);
post("D2", DIVERSE, "RODOVIÁRIA", ["EDINEI"], "2");
post("D2", DIVERSE, "RODOVIÁRIA", ["UBIRAJARA"], "3");
post("D2", DIVERSE, "LAR DA MENINA", ["LUIS"]);
post("D2", DIVERSE, "HOSPITAL MUNICIPAL", ["DE ALMEIDA"]);
post("D2", DIVERSE, "UPA CENTRO", ["GIOVANI"]);
post("D2", DIVERSE, "UPA CANUDOS", ["BATISTA"]);
post("D2", DIVERSE, "EMEF EUGENIO N. RITZEL EJA", ["M. MACHADO"]);
post("D2", DIVERSE, "EMEF FRANCISCO XAV. KUNST", ["MISAEL"]);
post("D2", DIVERSE, "EMEF ARNALDO GRIN", ["RODRIGO", "VALENTE"]);
post("D2", DIVERSE, "EMEF MONTEIRO LOBATO", ["MORAIS"]);
post("D2", DIVERSE, "EMEF ADOLFINA DIEFENTHALER", ["WILLERS"]);
post("D2", DIVERSE, "EMEI IRMÃ VALÉRIA", ["POHLMANN"]);
post("D2", FLEET, "CENTRO 2", ["FIUZA"]);
vtr("D2", "VTR 1337", ["MARQUES"]);
vtr("D2", "VTR 1302", ["ROMANA", "C. ALEXANDRE"]);
vtr("D2", "VTR 522", ["ALECIO"]);
vtr("D2", "VTR 1332", ["MOISES"]);
vtr("D2", "VTR 1273", ["SCHUQUEL", "PIERIM"]);
vtr("D2", "VTR 1333", ["JONATAS", "CAMARGO"]);
vtr("D2", "VTR 1335", ["JAIR", "JONATHAN"]);
vtr("D2", "VTR A DEFINIR", ["CIECHORSKI"]);
vtr("D2", "VTR 1336", ["VIEIRA", "GUILHERME"]);
vtr("D2", "VTR 1280", ["GABRIELA", "GRENDENE"]);
vtr("D2", "VTR 1334", ["BRUNO", "WILLYAM"]);
vtr("D2", "DIA MT 644", ["RANIEL"]);
vtr("D2", "DIA MT 640", ["GABRIEL"]);
vtr("D2", "DIA MT 641", ["ROGERIO"]);

post("N2", SEDE, "SALA DE OPERAÇÕES", ["JOCINARA", "GUIMARÃES"]);
post("N2", SEDE, "RESERVA DE ARMAMENTO", ["ALEXANDRE"]);
post("N2", SEDE, "ACESSO OPERACIONAL (GUARITA)", ["BELICO"]);
post("N2", ADMIN, "ACESSO PRINCIPAL", ["ROBERTO"]);
post("N2", ADMIN, "PORTARIA 2º PISO", ["BORTOLI"]);
post("N2", ADMIN, "ESTACIONAMENTO", ["SIDNEI"]);
post("N2", PARKS, "PRAÇA DA JUVENTUDE", ["JOSE"]);
post("N2", PARKS, "PRAÇA CÉU", ["VALNES"]);
post("N2", PARKS, "PARQUE TRABALHADOR", ["MILBRADT"]);
post("N2", PARKS, "PARCÃO HENRIQUE ROESLER", ["MARCOS", "ZILDO"]);
post("N2", DIVERSE, "CIT (CENTRO INTEGRADO DE TEC.) (SEG A SEX)", ["SALTIEL"]);
post("N2", DIVERSE, "RODOVIÁRIA", ["UBIRAJARA"], "4");
post("N2", DIVERSE, "CER (R. BAHIA LADO USF)", ["XAVIER"]);
post("N2", DIVERSE, "LAR DA MENINA", ["BOTEGA"]);
post("N2", DIVERSE, "CENTRO DE CULTURA", ["JUNIOR"]);
post("N2", DIVERSE, "SUB. S. AFONSO", ["DA SILVA"]);
post("N2", DIVERSE, "HOSPITAL MUNICIPAL", ["APARECIDA"]);
post("N2", DIVERSE, "UPA CENTRO", ["BRUM"]);
post("N2", DIVERSE, "UPA CANUDOS", ["LIMA"]);
post("N2", DIVERSE, "EMEF EUGENIO N. RITZEL EJA", ["VALNEI"]);
post("N2", DIVERSE, "EMEI BELA ADORMECIDA", ["DA ROSA"]);
post("N2", ZA, "VOLANTES NOITE", ["CRISTIANO", "GILMAR"]);
vtr("N2", "VTR 1337", ["DIEGO"]);
vtr("N2", "VTR 1338", ["MINOZZO", "ELISIO"]);
vtr("N2", "VTR 1336", ["KULMAN", "JEFERSON"]);
vtr("N2", "VTR 1296", ["STACHLER", "POERSCH"]);
vtr("N2", "VTR 1335", ["SILVA", "MIRANDA"]);

const patternNames = { D1: "Diurno · Padrão Par", D2: "Diurno · Padrão Ímpar", N1: "Noturno · Padrão Par", N2: "Noturno · Padrão Ímpar" };
const guardNames = [...new Set(rows.map((row) => row.name))].sort((a, b) => a.localeCompare(b, "pt-BR"));
const firstPattern = new Map();
for (const row of rows) if (!firstPattern.has(row.name)) firstPattern.set(row.name, row.pattern);

const seen = new Set();
for (const row of rows) {
  const key = `${row.pattern}|${row.name}`;
  if (seen.has(key)) throw new Error(`GM duplicado no mesmo padrão: ${row.pattern} / ${row.name}`);
  seen.add(key);
}

const quote = (value) => value === null || value === undefined ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const ref = (table, column, value) => `(SELECT id FROM ${table} WHERE ${column}=${quote(value)} LIMIT 1)`;
const lines = [
  "DELETE FROM operation_slot_origins;",
  "DELETE FROM operation_slots;",
  "DELETE FROM operation_vehicles;",
  "DELETE FROM operations;",
  "DELETE FROM overtime_entries;",
  "DELETE FROM assignments;",
  "DELETE FROM schedule_patterns;",
  "DELETE FROM pattern_slots;",
  "DELETE FROM weekly_slots;",
  "DELETE FROM service_adjustments;",
  "DELETE FROM movements;",
  "DELETE FROM leave_choices;",
  "DELETE FROM leave_day_limits;",
  "DELETE FROM leave_campaigns;",
  "DELETE FROM operational_notices;",
  "DELETE FROM vehicle_return_reconciliations;",
  "DELETE FROM vehicle_outages;",
  "DELETE FROM schedule_resource_exclusions;",
  "DELETE FROM schedules;",
  "DELETE FROM schedule_sections;",
  "DELETE FROM operational_group_members;",
  "DELETE FROM audit_events;",
  "DELETE FROM overtime_month_closures;",
  "DELETE FROM pattern_slots;",
  "DELETE FROM shift_patterns;",
  "DELETE FROM vehicles;",
  "DELETE FROM posts;",
  "DELETE FROM guards;",
  "DELETE FROM sqlite_sequence WHERE name IN ('guards','posts','vehicles','schedules','assignments','pattern_slots','shift_patterns','weekly_slots','movements','service_adjustments','operations','operation_vehicles','operation_slots','operation_slot_origins','overtime_entries','audit_events');",
];

for (const [index, postRow] of posts.entries()) {
  lines.push(`INSERT INTO posts (name,group_name,sort_order,active) VALUES (${quote(postRow.name)},${quote(postRow.group)},${index + 1},1);`);
}
for (const vehicle of vehicles) {
  lines.push(`INSERT INTO vehicles (prefix,type,zone,active) VALUES (${quote(vehicle.prefix)},${quote(vehicle.type)},${quote(vehicle.zone)},1);`);
}
for (const [index, name] of guardNames.entries()) {
  const pattern = firstPattern.get(name);
  lines.push(`INSERT INTO guards (registration,name,platoon,base_shift,work_regime,overtime_eligible,active) VALUES (${quote(`PDF-${String(index + 1).padStart(3, "0")}`)},${quote(name)},${quote(pattern)},${quote(pattern.startsWith("N") ? "12x36 noite" : "12x36 dia")},'12x36',1,1);`);
}
for (const code of ["D1", "D2", "N1", "N2"]) {
  const period = code.startsWith("D") ? "day" : "night";
  const parity = code.endsWith("1") ? 0 : 1;
  lines.push(`INSERT INTO shift_patterns (code,name,period,parity,anchor_date,active) VALUES (${quote(code)},${quote(patternNames[code])},${quote(period)},${parity},'2026-08-12',1);`);
}
lines.push("INSERT INTO schedule_sections (section_key,label,sort_order) VALUES ('VEHICLES','VIATURAS E ZONAS',0);");
for (const [index, group] of [SEDE, ADMIN, PARKS, DIVERSE, FLEET, ZA].entries()) {
  lines.push(`INSERT INTO schedule_sections (section_key,label,sort_order) VALUES (${quote(`POST:${group}`)},${quote(group)},${(index + 1) * 10});`);
}
for (const row of rows) {
  const destination = row.kind === "vehicle"
    ? `${ref("vehicles", "prefix", row.resource)},NULL`
    : `NULL,${ref("posts", "name", row.resource)}`;
  lines.push(`INSERT INTO pattern_slots (pattern_id,guard_id,post_id,vehicle_id,shift,role) VALUES (${ref("shift_patterns", "code", row.pattern)},${ref("guards", "name", row.name)},${destination.split(",")[1]},${destination.split(",")[0]},${quote(row.shift)},${quote(row.role)});`);
}
  // Wrangler D1 rejects explicit BEGIN/COMMIT statements. The ordered
  // statements above are executed by D1's command runner in sequence.
writeFileSync(OUT, `${lines.join("\n")}\n`, "utf8");

console.log(JSON.stringify({
  output: OUT,
  posts: posts.length,
  vehicles: vehicles.length,
  guards: guardNames.length,
  rows: rows.length,
  byPattern: Object.fromEntries(["D1", "D2", "N1", "N2"].map((code) => [code, rows.filter((row) => row.pattern === code).length])),
}, null, 2));
