"""Converte os PDFs de padrão (ímpar e par) da escala no formato de dados do sistema.

Uso:  python3 padroes_pdf.py padrao_impar.pdf padrao_par.pdf saida.json [AAAA-MM-01]

Regras:
- GM que aparece nos dois padrões = regime semanal (seg a sex); só em um = 12x36 da equipe daquele padrão
  (dia ou noite conforme o horário de início).
- "NHE" no horário = as últimas N horas do serviço são hora extra fixa.
- "MOT."/"PAT." = função na viatura; "VTR/RONDAS FREQUENTES" = posto em rondas.
- Textos sem horário válido (sobras da planilha) são ignorados e listados no relatório.
Nenhum dado pessoal fica neste arquivo: os nomes vêm só dos PDFs.
"""
import json, re, sys, unicodedata
from difflib import SequenceMatcher
import pdfplumber

HORA = re.compile(r"\((\d{1,2}):(\d{2})\s*/\s*(\d{1,2}):(\d{2})\)\s*(?:(\d+(?:,\d+)?)\s*HE)?\s*(HE\+)?", re.I)
TURNOS = ["t2", "t3", "t4", "t1"]
FIM_BLOCOS = ("CURSO", "BANCO DE HORAS", "FOLGAS", "ATESTADO", "FERIAS")


def norm(s):
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9 ]", " ", s.upper())).strip()


def parecido(a, b, lim=0.82):
    return SequenceMatcher(None, norm(a), norm(b)).ratio() >= lim


def limpa_rotulo(s):
    s = re.sub(r"\s*/\s*█", "", (s or "").replace("\n", " / ")).strip()
    s = re.sub(r"\s*/\s*\((SEG ?A? ?SEX|SEGASEX)\)\s*$", " (SEG A SEX)", s, flags=re.I)
    return re.sub(r"\s+", " ", re.sub(r"\s*/\s*$", "", s))


def minutos(h, m):
    return int(h) * 60 + int(m)


def ler_padrao(caminho, avisos):
    """Retorna lista de linhas: {secao, rotulo, sub, celulas:[(turno, nome, funcao, ini, fim, he_horas, he_mais)], rondas}."""
    linhas, secao, posto, sub = [], None, None, None
    with pdfplumber.open(caminho) as pdf:
        tabela = [r for pg in pdf.pages for t in pg.extract_tables() for r in t]
    for r in tabela:
        c = [(x or "").replace("\n", " / ").strip() for x in r] + [""] * 9
        c0 = limpa_rotulo(c[0])
        cab = c[2].upper() == "TURNO" and re.match(r"^[1-4]", c[1] or "")
        if cab or (c0.upper().startswith("RESERVA TECNICA")) or norm(c0).startswith(FIM_BLOCOS):
            nome = re.sub(r"\s*-\s*ZA LIVRE", " · ZA LIVRE", c0) if c0 else secao
            if norm(nome).startswith(FIM_BLOCOS):
                break
            secao, posto, sub = nome or secao, None, None
            continue
        if secao is None:
            continue
        celulas, rondas, inspetor = [], False, False
        for i, tur in enumerate(TURNOS):
            nome, hora = c[1 + 2 * i].strip(), c[2 + 2 * i].strip()
            if norm(nome) == "VTR RONDAS":
                rondas = True
                continue
            if norm(nome) == "INSPETOR":
                inspetor = True
                continue
            m = HORA.search(hora)
            if norm(secao).startswith("RESERVA") and nome and norm(nome) not in ("X", "") and re.search(r"[A-Za-zÀ-ú]{3}", nome):
                celulas.append((tur, nome, "", None, None, 0, False))
                continue
            if not m:
                if nome and norm(nome) not in ("X", "GM", "") and not re.fullmatch(r"[.\s]*", nome):
                    avisos.append(f"ignorado (sem horário): '{nome}' em {c0 or posto}")
                continue
            funcao = ""
            mm = re.match(r"^(MOT|PAT)\.\s*", nome, re.I)
            if mm:
                funcao = "Motorista" if mm.group(1).upper() == "MOT" else "Patrulheiro"
                nome = nome[mm.end():]
            he_mais = bool(m.group(6)) or nome.upper().endswith("HE+")
            nome = re.sub(r"\s*HE\+$", "", nome, flags=re.I).strip()
            he = float((m.group(5) or "0").replace(",", "."))
            celulas.append((tur, nome, funcao, minutos(m.group(1), m.group(2)), minutos(m.group(3), m.group(4)), he, he_mais))
        if not celulas and not rondas and not inspetor:
            if c0 and re.search(r"[A-Z]{3}", c0) and not re.search(r"\d{6,}", c0):
                avisos.append(f"linha sem GM ignorada: '{c0}'")
            continue
        eh_viatura = norm(secao) in ("VTR", "VTR NOITE") or "EQUIPE" in norm(secao)
        rot = re.sub(r"^\(SEG ?A? ?SEX\)\s*/\s*", "", c0, flags=re.I) if c0 else ""
        if rot.upper().startswith("NOITE VTR") and secao != "VTR NOITE":
            secao = "VTR NOITE"
            eh_viatura = True
        if rot:
            if eh_viatura and not re.match(r"^(NOITE )?VTR|^DIA MT|^MT ", rot, re.I):
                sub = rot if not sub else sub
                if inspetor:
                    sub = f"{rot} · INSPETOR DE SERVIÇO"
            elif re.fullmatch(r"\(SEG ?A? ?SEX\)", rot, re.I):
                pass
            else:
                posto, sub = rot, None
        if posto is None and norm(secao).startswith("RESERVA"):
            posto = "RESERVA TÉCNICA"
        if posto is None:
            continue
        linhas.append({"secao": secao, "rotulo": posto, "sub": sub, "celulas": celulas, "rondas": rondas})
    return linhas


def chave_posto(rotulo):
    r = re.sub(r"\((SEG ?A? ?SEX|SEGASEX|12X36)\)", "", rotulo, flags=re.I)
    r = re.sub(r"VTR\s*(\d)", r"VTR \1", r, flags=re.I)
    return norm(r)


def converter(impar, par, mes_ref):
    avisos = []
    padroes = {"impar": ler_padrao(impar, avisos), "par": ler_padrao(par, avisos)}
    secoes, postos = [], {}
    gms = {}  # chave nome -> {nome, por_padrao: {padrao: [(posto, funcao, ini, fim, he, he_mais)]}}

    def achar_posto(secao, rotulo):
        k = chave_posto(rotulo)
        for kk, p in postos.items():
            if p["secao"] == secao and (kk == k or (re.findall(r"\d+", kk) == re.findall(r"\d+", k) and SequenceMatcher(None, kk, k).ratio() >= 0.9)):
                return p
        return None

    for nome_padrao, linhas in padroes.items():
        anterior = None
        for ln in linhas:
            if ln["secao"] not in secoes:
                secoes.insert(secoes.index(anterior) + 1 if anterior in secoes else len(secoes), ln["secao"])
            anterior = ln["secao"]
            p = achar_posto(ln["secao"], ln["rotulo"])
            if not p:
                rot = ln["rotulo"]
                seg = bool(re.search(r"SEG ?A? ?SEX|SEGASEX|SEG SEX", rot, re.I))
                nome = re.sub(r"\s*\((SEG ?A? ?SEX|SEG SEX|SEGASEX|12X36)\)", "", rot, flags=re.I).strip()
                nome = re.sub(r"VTR\s*(\d)", r"VTR \1", nome, flags=re.I)
                tipo = "reserva" if norm(ln["secao"]).startswith("RESERVA") else "moto" if re.search(r"\bMT\b", nome) else "vtr" if re.match(r"^(NOITE )?VTR", nome, re.I) else None
                p = {"id": f"p{len(postos) + 1}", "secao": ln["secao"], "nome": nome.upper(), "tipo": tipo, "sub": None, "seg": seg,
                     "rondas": False, "contagem": {"impar": {t: set() for t in TURNOS}, "par": {t: set() for t in TURNOS}}, "obs": set()}
                postos[chave_posto(rot)] = p
            if ln["sub"] and not p["sub"]:
                p["sub"] = ln["sub"].upper()
            p["rondas"] |= ln["rondas"]
            # agrupa as células da linha por pessoa (o mesmo GM pode estar em 2 a 4 turnos da linha)
            grupos = []
            metade = lambda t: "dia" if t in ("t2", "t3") else "noite"
            for cel in ln["celulas"]:
                for g in grupos:
                    # nome igual junta sempre; grafia parecida só na mesma metade do serviço (quem trabalha de dia e quem trabalha de noite na mesma linha são pessoas diferentes)
                    if norm(g[0][1]) == norm(cel[1]) or (parecido(g[0][1], cel[1]) and any(metade(x[0]) == metade(cel[0]) for x in g)):
                        g.append(cel)
                        break
                else:
                    grupos.append([cel])
            for g in grupos:
                nome = g[0][1]
                if not nome:  # vaga de HE+ sem nome (reforço só de HE)
                    for cel in g:
                        p["obs"].add(f"reforço HE {cel[3] // 60:02d}:{cel[3] % 60:02d}–{cel[4] // 60:02d}:{cel[4] % 60:02d}")
                    continue
                if any(cel[6] for cel in g):  # HE+ recorrente: não é lotação
                    p["obs"].add("HE+ " + " e ".join(f"{cel[3] // 60:02d}:{cel[3] % 60:02d}–{cel[4] // 60:02d}:{cel[4] % 60:02d}" for cel in g) + f" ({nome})")
                    avisos.append(f"HE+ recorrente não importada como lotação: {nome} em {p['nome']}")
                    continue
                k = norm(nome)
                # entre linhas diferentes só junta nomes idênticos (ex.: um nome e o mesmo nome com uma letra a mais são pessoas diferentes); na mesma linha, grafias parecidas
                variantes = {norm(cel[1]) for cel in g} - {k}
                if variantes:
                    avisos.append(f"mesma pessoa na linha, grafias diferentes: {nome} / {', '.join(sorted(variantes))}")
                gm = gms.setdefault(k, {"nome": nome.upper(), "por_padrao": {}})
                funcao = next((cel[2] for cel in g if cel[2]), "")
                for cel in g:
                    gm["por_padrao"].setdefault(nome_padrao, []).append((p["id"], funcao, cel[3], cel[4], cel[5]))
                    p["contagem"][nome_padrao][cel[0]].add(k)

    def segmentos(celulas):
        partes = sorted({(ini, fim if fim > ini else fim + 1440) for _, _, ini, fim, _ in celulas if ini is not None}, key=lambda x: x[0])
        # meia-noite: um trecho 00:00–06:00 depois de 18:00–00:00 vai para o dia seguinte
        if partes and partes[0][0] < 420 and any(a >= 15 * 60 for a, _ in partes):
            partes = sorted([(a + 1440, b + 1440) if a < 420 else (a, b) for a, b in partes], key=lambda x: x[0])
        unidos = []
        for a, b in partes:
            if unidos and a <= unidos[-1][1]:
                unidos[-1] = (unidos[-1][0], max(b, unidos[-1][1]))
            else:
                unidos.append((a, b))
        he = round(max([c[4] for c in celulas] + [0]) * 60)
        segs = [[a, b, "normal"] for a, b in unidos]
        resto = he
        for s in reversed(segs):
            if resto <= 0:
                break
            dur = s[1] - s[0]
            if dur <= resto:
                s[2] = "he"; resto -= dur
            else:
                corte = s[1] - resto
                segs.insert(segs.index(s) + 1, [corte, s[1], "he"])
                s[1] = corte; resto = 0
        f = lambda m: f"{(m % 1440) // 60:02d}:{m % 60:02d}"
        return [{"ini": f(a), "fim": f(b), "tipo": t} for a, b, t in segs]

    lista_gms, n = [], 0
    for k, g in gms.items():
        n += 1
        pp = g["por_padrao"]
        if "impar" in pp and "par" in pp:
            equipe, base = "SEM", pp["impar"]
            if segmentos(pp["impar"]) != segmentos(pp["par"]):
                avisos.append(f"{g['nome']}: horário diferente nos padrões (usei o ímpar)")
        else:
            padrao = "impar" if "impar" in pp else "par"
            base = pp[padrao]
            inicio = min(c[2] for c in base if c[2] is not None) if any(c[2] is not None for c in base) else 420
            noite = inicio >= 15 * 60 or inicio < 5 * 60
            equipe = ("I" if padrao == "impar" else "P") + ("N" if noite else "D")
        postos_gm = {c[0] for c in base}
        if len(postos_gm) > 1:
            avisos.append(f"{g['nome']} aparece em mais de um posto; usei o primeiro")
        posto_id = base[0][0]
        cel = [c for c in base if c[0] == posto_id]
        segs = segmentos(cel) if any(c[2] is not None for c in cel) else [{"ini": "07:00", "fim": "19:00", "tipo": "normal"}]
        lista_gms.append({"id": f"g{n}", "nome": g["nome"], "matricula": "", "equipe": equipe,
                          "lotacao": {"posto": posto_id, "funcao": cel[0][1], "segmentos": segs}})

    semanal = {gm["id"] for gm in lista_gms if gm["equipe"] == "SEM"}
    por_nome = {norm(gm["nome"]): gm for gm in lista_gms}
    saida_postos = []
    for p in postos.values():
        vagas = {}
        for t in TURNOS:
            conta = []
            for pad in ("impar", "par"):
                quem = [por_nome.get(k) for k in p["contagem"][pad][t]]
                conta.append(len([q for q in quem if q and q["id"] not in semanal]))
            sem = len({k for pad in ("impar", "par") for k in p["contagem"][pad][t] if por_nome.get(k) and por_nome[k]["id"] in semanal})
            vagas[t] = (min(conta), sem)
        lotados = [gm for gm in lista_gms if gm["lotacao"]["posto"] == p["id"]]
        so_semanal = bool(lotados) and all(gm["equipe"] == "SEM" for gm in lotados)
        # semanal só vira vaga obrigatória em posto que é só de semanal (senão daria furo em todo fim de semana)
        vagas = {t: (sem if so_semanal else doze) for t, (doze, sem) in vagas.items()}
        item = {"id": p["id"], "secao": f"s{secoes.index(p['secao']) + 1}", "nome": p["nome"]}
        if p["tipo"]: item["tipo"] = p["tipo"]
        if p["sub"]: item["sub"] = p["sub"]
        if p["rondas"]: item["rondas"] = True
        if any(vagas.values()) and p["tipo"] != "reserva": item["vagas"] = vagas
        if p["seg"] or so_semanal:
            item["dias"] = [1, 2, 3, 4, 5]
            item["obs"] = "SEG A SEX"
        if p["obs"]:
            item["obs"] = " · ".join(filter(None, [item.get("obs"), *sorted(p["obs"])]))
        saida_postos.append(item)

    estado = {
        "config": {"tetoHE": 60, "mesInicial": mes_ref[:7], "cabecalho": "PREFEITURA MUNICIPAL DE NOVO HAMBURGO · GUARDA MUNICIPAL · SEÇÃO DE ESCALA",
                   "transporteInicial": {}, "ancora": {"data": mes_ref, "equipes": ["ID", "IN"]}},
        "equipes": [
            {"id": "ID", "nome": "Ímpar · dia", "tipo": "alternado", "paridade": 1, "periodo": "dia", "inspetor": ""},
            {"id": "IN", "nome": "Ímpar · noite", "tipo": "alternado", "paridade": 1, "periodo": "noite", "inspetor": ""},
            {"id": "PD", "nome": "Par · dia", "tipo": "alternado", "paridade": 0, "periodo": "dia", "inspetor": ""},
            {"id": "PN", "nome": "Par · noite", "tipo": "alternado", "paridade": 0, "periodo": "noite", "inspetor": ""},
            {"id": "SEM", "nome": "Semanal (seg a sex)", "tipo": "semanal", "periodo": "dia"},
        ],
        "secoes": [{"id": f"s{i + 1}", "nome": s.upper()} for i, s in enumerate(secoes)],
        "postos": saida_postos, "gms": lista_gms, "ocorrencias": [], "requerimentos": {},
    }
    return estado, avisos


if __name__ == "__main__":
    impar, par, saida = sys.argv[1:4]
    ref = sys.argv[4] if len(sys.argv) > 4 else "2026-11-01"
    estado, avisos = converter(impar, par, ref)
    with open(saida, "w", encoding="utf-8") as f:
        json.dump(estado, f, ensure_ascii=False, indent=1)
    eq = {}
    for g in estado["gms"]: eq[g["equipe"]] = eq.get(g["equipe"], 0) + 1
    print(f"{len(estado['secoes'])} seções, {len(estado['postos'])} postos, {len(estado['gms'])} GMs por equipe: {eq}")
    for a in avisos: print(" -", a)
