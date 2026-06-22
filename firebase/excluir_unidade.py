#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Excluir uma unidade inteira (doc + subcoleções). DESTRUTIVO.
Recusa excluir 'reitoria-sel'. Dry-run por padrão.

Uso:
  python excluir_unidade.py --key serviceAccount.json --id sao-cristovao-i
  python excluir_unidade.py --key serviceAccount.json --id sao-cristovao-i --apply
"""
import argparse, sys

SUBCOLS = ["processos","etapas","cargas","calendario","config","emails","historico","dispositivos","resumo"]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", required=True)
    ap.add_argument("--id", required=True)
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    if a.id == "reitoria-sel":
        print("ERRO: nao excluo a unidade reitoria-sel (producao).", file=sys.stderr); sys.exit(2)
    dry = not a.apply
    print(f"== Excluir unidade '{a.id}' ({'DRY-RUN' if dry else 'APLICANDO'}) ==")
    import firebase_admin
    from firebase_admin import credentials, firestore
    firebase_admin.initialize_app(credentials.Certificate(a.key))
    db = firestore.client()
    U = db.collection("unidades").document(a.id)
    if not U.get().exists:
        print(f"  unidades/{a.id} nao existe."); return
    total = 0
    for col in SUBCOLS:
        docs = list(U.collection(col).stream()); total += len(docs)
        print(f"  {col}: {len(docs)} docs")
        if not dry:
            for d in docs: d.reference.delete()
    print(f"  unidades/{a.id} (doc)")
    if dry:
        print(f"\nDRY-RUN: {total} docs seriam apagados + o doc. Rode --apply para excluir."); return
    U.delete()
    print(f"\nUnidade '{a.id}' excluida ({total} docs + doc).")

if __name__ == "__main__":
    main()
