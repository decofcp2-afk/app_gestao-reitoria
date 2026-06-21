#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Migração da planilha CronogramaContratacoes_CPII -> Firestore (Fase 2).

Uso:
  # 1) Valida a leitura/parsing SEM precisar do Firebase (faça isso primeiro):
  python migrar_para_firestore.py --xlsx "CronogramaContratacoes_CPII.xlsx" --dry-run

  # 2) Migra de verdade (precisa da chave da conta de serviço do projeto Firebase):
  python migrar_para_firestore.py --xlsx "CronogramaContratacoes_CPII.xlsx" \
      --key serviceAccount.json

Dependências:
  pip install openpyxl
  pip install firebase-admin   # só necessário para a migração real (não no --dry-run)

Observações:
  - Idempotente: usa IDs determinísticos (set), então rodar de novo sobrescreve.
  - A aba Capacidade NÃO é migrada: é calculada a partir de Etapas no app.
    (O único dado manual, "Outros (fixo)" por servidor, pode ser adicionado depois.)
  - A aba Instruções é ignorada (texto de UI).
"""
import argparse, re, sys, unicodedata
from datetime import datetime

import openpyxl

# Nomes das abas (podem variar com emojis/acentos): casamos por "contém".
SHEET_KEYS = {
    "processos":   ["processos"],
    "etapas":      ["etapas"],
    "servidores":  ["configsel"],
    "calendario":  ["calendario", "calendário"],
    "matriz":      ["matriz"],
    "historico":   ["historico_motivos", "histórico"],
    "dispositivos":["pwa_dispositivos"],
    "capacidade":  ["capacidade"],
}

def norm(s):
    if s is None:
        return ""
    s = str(s)
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return s.strip().lower()

def find_sheet(wb, keys):
    for ws in wb.worksheets:
        t = norm(ws.title)
        if any(k in t for k in keys):
            return ws
    return None

def rows_of(ws):
    return [[c.value for c in r] for r in ws.iter_rows()]

def s(v):
    return "" if v is None else str(v).strip()

def to_int(v):
    if v is None or s(v) == "":
        return None
    try:
        return int(float(v))
    except (ValueError, TypeError):
        return None

def to_num(v):
    if v is None or s(v) == "":
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None

def to_bool(v):
    return norm(v) in ("sim", "true", "1", "x", "verdadeiro")

def to_dt(v):
    if isinstance(v, datetime):
        return v
    txt = s(v)
    if not txt:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(txt, fmt)
        except ValueError:
            pass
    return None

def matricula_id(v):
    """3419547.0 -> '3419547'."""
    n = to_int(v)
    return str(n) if n is not None else None

# ---------- Parsers por aba ----------

def parse_processos(ws):
    out = []
    for r in rows_of(ws):
        pid = s(r[0])
        if not re.match(r"^SEL-\d", pid):
            continue
        out.append((pid, {
            "id": pid,
            "suap": s(r[1]).replace("\n", "").strip(),
            "objeto": s(r[2]),
            "modalidade": s(r[3]),
            "d0": to_dt(r[4]),
            "linkSuap": s(r[5]),
            "temIrp": to_bool(r[6]),
            "status": s(r[7]),
            "setorRequisitante": s(r[8]),
            "emailRequisitante": s(r[9]),
            "ordemFila": to_int(r[10]),
        }))
    return out

def parse_etapas(ws):
    out = []
    for r in rows_of(ws):
        pid = s(r[0])
        if not re.match(r"^SEL-\d", pid):
            continue
        ordem = to_int(r[1])
        doc_id = f"{pid}_{ordem:02d}" if ordem is not None else pid
        out.append((doc_id, {
            "processoId": pid,
            "ordem": ordem,
            "etapa": s(r[2]),
            "fase": s(r[3]),
            "agente": s(r[4]),
            "prazoDias": to_int(r[5]),
            "dataRealizacao": to_dt(r[6]),
            "motivoAtraso": s(r[7]),
            "status": s(r[8]),
        }))
    return out

def parse_servidores(ws):
    """Devolve (servidores_publicos, emails_privados)."""
    serv, emails = [], []
    rows = rows_of(ws)
    for r in rows[1:]:  # pula cabeçalho (linha 1)
        mid = matricula_id(r[1])
        nome = s(r[0])
        if not mid or not nome:
            continue
        serv.append((mid, {
            "matricula": mid,
            "nome": nome,
            "cor": s(r[2]),
            "chefe": to_bool(r[3]),
        }))
        email = s(r[4])
        if email:
            emails.append((mid, {"matricula": mid, "nome": nome, "email": email}))
    return serv, emails

def parse_calendario(ws):
    out = []
    rows = rows_of(ws)
    for i, r in enumerate(rows[1:]):
        dt = to_dt(r[0])
        nome = s(r[1])
        if not dt and not nome:
            continue
        doc_id = dt.strftime("%Y-%m-%d") if dt else f"row{i}"
        out.append((doc_id, {
            "data": dt,
            "nome": nome,
            "tipo": s(r[2]),
            "municipio": s(r[3]),
            "afetaPrazo": to_bool(r[4]),
            "fonte": s(r[5]),
            "observacao": s(r[6]) if len(r) > 6 else "",
        }))
    return out

def parse_matriz(ws):
    rows = rows_of(ws)
    # cabeçalho em torno da linha 3: Fator | Pontos | Fundamentação | Observação
    itens = []
    for r in rows:
        fator = s(r[0])
        if not fator or norm(fator) in ("fator", "matriz de pontuacao"):
            continue
        itens.append({
            "fator": fator,
            "pontos": to_num(r[1]) if len(r) > 1 else None,
            "fundamentacao": s(r[2]) if len(r) > 2 else "",
            "observacao": s(r[3]) if len(r) > 3 else "",
        })
    return [("matrizPontuacao", {"itens": itens})]

def parse_historico(ws):
    out = []
    rows = rows_of(ws)
    for i, r in enumerate(rows[1:]):
        ts = to_dt(r[0])
        if not ts and not s(r[1]):
            continue
        out.append((f"h{i:04d}", {
            "timestamp": ts,
            "processoId": s(r[1]),
            "etapa": s(r[2]),
            "servidor": s(r[3]),
            "motivo": s(r[4]),
            "diasAtraso": to_num(r[5]),
            "dataRealizacao": to_dt(r[6]) if len(r) > 6 else None,
        }))
    return out

def parse_cargas(ws):
    """Registro de atribuições (quem é responsável por cada processo/fase + pontos).
    Cabeçalho: Servidor | Objeto | ProcessoID | Ativo | Modalidade | Fase da Carga | p1 | p2 | p3 | Total"""
    rows = rows_of(ws)
    hdr = -1
    for i, r in enumerate(rows):
        a = s(r[0]); c = s(r[2]) if len(r) > 2 else ""
        if a.startswith("Servidor") and c == "ProcessoID":
            hdr = i
            break
    if hdr < 0:
        return []
    out = []
    seq = 0
    for r in rows[hdr + 1:]:
        pid = s(r[2]) if len(r) > 2 else ""
        serv = s(r[0])
        if not re.match(r"^SEL-\d", pid) or not serv:
            continue
        seq += 1
        fase = s(r[5]) if len(r) > 5 else ""
        doc_id = f"{pid}_{'ext' if 'ext' in norm(fase) else 'int'}_{seq:02d}"
        out.append((doc_id, {
            "servidor": serv,
            "objeto": s(r[1]) if len(r) > 1 else "",
            "processoId": pid,
            "ativo": to_bool(r[3]) if len(r) > 3 else False,
            "modalidade": s(r[4]) if len(r) > 4 else "",
            "fase": fase,
            "p1": to_num(r[6]) if len(r) > 6 else None,
            "p2": to_num(r[7]) if len(r) > 7 else None,
            "p3": to_num(r[8]) if len(r) > 8 else None,
            "total": to_num(r[9]) if len(r) > 9 else None,
        }))
    return out

def parse_outros_fixo(ws):
    """'Outros (fixo)' por servidor (único dado manual do resumo de capacidade).
    Devolve dict {NOME_UPPER: valor}."""
    rows = rows_of(ws)
    hdr = -1
    for i, r in enumerate(rows):
        a = s(r[0]); b = s(r[1]) if len(r) > 1 else ""
        if a == "Servidor" and b.startswith("Outros"):
            hdr = i
            break
    res = {}
    if hdr < 0:
        return res
    for r in rows[hdr + 1:]:
        nome = s(r[0])
        if not nome or norm(nome).startswith("total") or "ocupac" in norm(nome):
            if norm(nome).startswith("total"):
                break
            continue
        res[nome.upper()] = to_num(r[1]) if len(r) > 1 else 0
    return res

def parse_dispositivos(ws):
    out = []
    rows = rows_of(ws)
    hdr = [s(c) for c in rows[0]]
    for r in rows[1:]:
        dev = s(r[5]) if len(r) > 5 else ""
        if not dev:
            continue
        d = {}
        for k, v in zip(hdr, r):
            if not k:
                continue
            key = norm(k).replace(" ", "")
            d[key] = to_dt(v) if isinstance(v, datetime) else s(v)
        out.append((dev, d))
    return out

# ---------- Migração ----------

def build_all(xlsx_path):
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    data = {}
    ws = find_sheet(wb, SHEET_KEYS["processos"]);   data["processos"] = parse_processos(ws) if ws else []
    ws = find_sheet(wb, SHEET_KEYS["etapas"]);      data["etapas"]    = parse_etapas(ws) if ws else []
    ws = find_sheet(wb, SHEET_KEYS["servidores"])
    serv, emails = parse_servidores(ws) if ws else ([], [])
    data["emails"] = emails
    # Capacidade: registro de cargas (atribuições) + "Outros (fixo)" por servidor.
    wsCap = find_sheet(wb, SHEET_KEYS["capacidade"])
    data["cargas"] = parse_cargas(wsCap) if wsCap else []
    outros = parse_outros_fixo(wsCap) if wsCap else {}
    for _id, payload in serv:
        payload["outrosFixo"] = outros.get(payload["nome"].upper(), 0)
    data["servidores"] = serv
    ws = find_sheet(wb, SHEET_KEYS["calendario"]);  data["calendario"]   = parse_calendario(ws) if ws else []
    ws = find_sheet(wb, SHEET_KEYS["matriz"]);      data["config"]       = parse_matriz(ws) if ws else []
    ws = find_sheet(wb, SHEET_KEYS["historico"]);   data["historico"]    = parse_historico(ws) if ws else []
    ws = find_sheet(wb, SHEET_KEYS["dispositivos"]);data["dispositivos"] = parse_dispositivos(ws) if ws else []
    return data

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--key", help="serviceAccount.json (migração real)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    data = build_all(args.xlsx)

    print("Resumo da leitura:")
    for col, docs in data.items():
        print(f"  {col:14s}: {len(docs)} documentos")

    if args.dry_run or not args.key:
        if not args.key and not args.dry_run:
            print("\n[aviso] Sem --key: rodando apenas leitura. Use --dry-run ou passe --key.")
        # amostra
        if data["processos"]:
            print("\nExemplo processos[0]:", data["processos"][0])
        if data["etapas"]:
            print("Exemplo etapas[0]:", data["etapas"][0])
        return

    import firebase_admin
    from firebase_admin import credentials, firestore
    cred = credentials.Certificate(args.key)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    total = 0
    for col, docs in data.items():
        batch = db.batch()
        n = 0
        for doc_id, payload in docs:
            batch.set(db.collection(col).document(str(doc_id)), payload)
            n += 1
            if n % 400 == 0:           # limite de 500 ops por batch
                batch.commit(); batch = db.batch()
        batch.commit()
        total += n
        print(f"  gravado {col}: {n}")
    print(f"\nConcluído. {total} documentos gravados no Firestore.")

if __name__ == "__main__":
    main()
