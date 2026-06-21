#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fase F — Criação/seed de uma nova unidade (autocadastro, lado servidor).

ADITIVO e seguro: só escreve em unidades/{id}/... — não toca em nenhuma outra
unidade nem nos caminhos da Reitoria. Idempotente (sobrescreve a própria unidade).

Cria o doc unidades/{id} e SEMEIA a unidade copiando, de uma unidade-template
(default reitoria-sel), o `calendario` (feriados) e o `config/matrizPontuacao`.
Processos/etapas/cargas/servidores começam VAZIOS — a equipe é cadastrada depois.

Uso:
  # dry-run (padrão): mostra o que faria, sem escrever
  python criar_unidade.py --key serviceAccount.json --id sao-cristovao-i \
      --nome "São Cristóvão I" --sigla "SC1"
  # aplica
  python criar_unidade.py --key serviceAccount.json --id sao-cristovao-i \
      --nome "São Cristóvão I" --sigla "SC1" --email "decof.sc1@cp2.g12.br" --apply

Dependências: pip install firebase-admin
"""
import argparse, sys, re

def slugify(s):
    s = (s or "").strip().lower()
    s = s.replace("ã","a").replace("á","a").replace("â","a").replace("é","e").replace("ê","e")
    s = s.replace("í","i").replace("ó","o").replace("ô","o").replace("õ","o").replace("ú","u").replace("ç","c")
    s = re.sub(r"[^a-z0-9]+","-", s).strip("-")
    return s

def main():
    ap = argparse.ArgumentParser(description="Fase F — criar/seed de unidade (aditivo, dry-run por padrão).")
    ap.add_argument("--key", required=True)
    ap.add_argument("--id", required=True, help="id da unidade (slug). Ex.: sao-cristovao-i")
    ap.add_argument("--nome", required=True)
    ap.add_argument("--sigla", default="")
    ap.add_argument("--email", default="", help="e-mail institucional da unidade")
    ap.add_argument("--template", default="reitoria-sel", help="unidade de onde copiar calendario+matriz")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    uid = slugify(args.id)
    dry = not args.apply
    print(f"== Criar unidade '{uid}' ({'DRY-RUN' if dry else 'APLICANDO'}) ==")
    print(f"   nome={args.nome!r} sigla={args.sigla!r} email={args.email!r} template={args.template}")
    print(f"   AVISO: só escreve em unidades/{uid}/... (outras unidades intactas).\n")

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        print("ERRO: pip install firebase-admin", file=sys.stderr); sys.exit(1)

    firebase_admin.initialize_app(credentials.Certificate(args.key))
    db = firestore.client()
    novo = db.collection("unidades").document(uid)
    tmpl = db.collection("unidades").document(args.template)

    if novo.get().exists:
        print(f"  AVISO: unidades/{uid} já existe — será mesclado (merge).")

    uni_doc = { "nome": args.nome, "sigla": args.sigla, "emailInstitucional": args.email, "ativo": True }
    print(f"  unidades/{uid} (doc): {uni_doc}")

    cal = list(tmpl.collection("calendario").stream())
    mtz = list(tmpl.collection("config").stream())
    print(f"  copiar calendario: {len(cal)} docs (de {args.template})")
    print(f"  copiar config:     {len(mtz)} docs (de {args.template})")
    print(f"  processos/etapas/cargas/servidores/emails: VAZIOS (equipe cadastra depois)")

    if dry:
        print("\nDRY-RUN concluído. Nada escrito. Rode com --apply para criar.")
        return

    novo.set(uni_doc, merge=True)
    for d in cal:
        novo.collection("calendario").document(d.id).set(d.to_dict())
    for d in mtz:
        novo.collection("config").document(d.id).set(d.to_dict())
    print(f"\nUnidade '{uid}' criada e semeada. Outras unidades intactas.")

if __name__ == "__main__":
    main()
