#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fase A (multiunidade) — Reorganização NÃO-DESTRUTIVA do Firestore.

Copia as coleções de NÍVEL RAIZ atuais (usadas hoje pela Reitoria/SEL) para a
subárvore da 1ª unidade:  unidades/reitoria-sel/<colecao>/<docId>

⚠️ SEGURANÇA / PRODUÇÃO:
  - Este script é ADITIVO: ele só ESCREVE em `unidades/reitoria-sel/...`.
  - Ele NUNCA lê para apagar, NUNCA toca nem remove as coleções de raiz que o
    app em produção usa hoje. Logo, rodar isto NÃO derruba o sistema atual.
  - O CORTE (fazer o app ler/escrever na subárvore) é da Fase B, não deste script.
  - Idempotente: usa os MESMOS doc ids; rodar de novo sobrescreve a cópia.

Uso:
  # 1) DRY-RUN (padrão): conecta, conta o que COPIARIA, não escreve nada.
  python reorganizar_multiunidade.py --key serviceAccount.json

  # 2) Executa a cópia aditiva (continua sem mexer na raiz):
  python reorganizar_multiunidade.py --key serviceAccount.json --apply

Opções:
  --unidade-id   id da unidade destino (default: reitoria-sel)
  --unidade-nome nome amigável (default: Reitoria / SEL)
  --unidade-sigla sigla (default: SEL)
  --unidade-email e-mail institucional da unidade (default: vazio; preencher depois)

Dependências:
  pip install firebase-admin
"""
import argparse, sys

# Coleções de raiz a copiar para a subárvore da unidade (mesmos nomes).
COLECOES = [
    "processos", "etapas", "servidores", "cargas",
    "calendario", "config", "emails", "historico", "dispositivos",
]

def main():
    ap = argparse.ArgumentParser(description="Fase A — reorganização multiunidade (aditiva, dry-run por padrão).")
    ap.add_argument("--key", required=True, help="Caminho da chave da conta de serviço (serviceAccount.json).")
    ap.add_argument("--apply", action="store_true", help="Escreve de verdade. Sem isto, é só DRY-RUN.")
    ap.add_argument("--unidade-id", default="reitoria-sel")
    ap.add_argument("--unidade-nome", default="Reitoria / SEL")
    ap.add_argument("--unidade-sigla", default="SEL")
    ap.add_argument("--unidade-email", default="")
    args = ap.parse_args()

    dry = not args.apply
    modo = "DRY-RUN (nada será escrito)" if dry else "APLICANDO (cópia aditiva)"
    print(f"== Fase A — reorganização multiunidade ==")
    print(f"   destino: unidades/{args.unidade_id}/<colecao>")
    print(f"   modo:    {modo}")
    print(f"   AVISO:   as coleções de raiz NÃO são tocadas (produção intacta).\n")

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        print("ERRO: instale a dependência -> pip install firebase-admin", file=sys.stderr)
        sys.exit(1)

    cred = credentials.Certificate(args.key)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    base = db.collection("unidades").document(args.unidade_id)

    # 1) Documento da unidade (metadados). Aditivo.
    uni_doc = {
        "nome": args.unidade_nome,
        "sigla": args.unidade_sigla,
        "emailInstitucional": args.unidade_email,
        "ativo": True,
    }
    print(f"unidades/{args.unidade_id} (doc): {uni_doc}")
    if not dry:
        base.set(uni_doc, merge=True)

    # 2) Copia cada coleção de raiz -> subcoleção da unidade.
    total = 0
    for col in COLECOES:
        docs = list(db.collection(col).stream())
        n = len(docs)
        total += n
        print(f"  {col:13s}: {n:4d} docs -> unidades/{args.unidade_id}/{col}")
        if not dry:
            # Lotes de até 400 (limite de batch é 500).
            destino = base.collection(col)
            batch = db.batch()
            cont = 0
            for d in docs:
                batch.set(destino.document(d.id), d.to_dict())
                cont += 1
                if cont % 400 == 0:
                    batch.commit()
                    batch = db.batch()
            if cont % 400 != 0:
                batch.commit()

    print(f"\nTotal de documentos {'que seriam copiados' if dry else 'copiados'}: {total}")
    if dry:
        print("DRY-RUN concluído. Nada foi escrito. Rode com --apply quando quiser copiar.")
    else:
        print("Cópia aditiva concluída. As coleções de raiz seguem intactas (produção OK).")
        print("O CORTE para a subárvore é a Fase B (repontar frontend + Apps Script).")

if __name__ == "__main__":
    main()
