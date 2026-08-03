#!/bin/bash
# ════════════════════════════════════════════════════════════════════════
# Publica o backend no projeto do Apps Script da DECOF.
#
# POR QUE ESTE SCRIPT EXISTE (não use `clasp push` direto):
#
#   1. Os NOMES DOS ARQUIVOS diferem entre o repositório e o projeto remoto.
#      Aqui é `apps-script/Code.gs`; lá é `Código.js`, na raiz do projeto.
#      Um push da pasta do repo criaria arquivos novos (`apps-script/Code`) e
#      deixaria os originais para trás.
#
#   2. O `clasp push` ESPELHA a pasta local no projeto remoto — o que não
#      está na pasta é APAGADO lá. O projeto tem 4 arquivos (incluindo o
#      manifesto `appsscript.json` e uma cópia do `index.html`); um push de
#      uma pasta com menos que isso destrói o resto.
#
#   3. A implantação de produção fica PRESA a uma versão fixa. `clasp push`
#      atualiza só o @HEAD — sem criar uma versão nova e reapontar a
#      implantação, a URL /exec continua servindo o código antigo.
#
# Por isso não há `.clasp.json` na raiz do repositório: ele tornaria um
# `clasp push` acidental (e destrutivo) fácil demais de disparar.
#
# USO:
#   scripts/deploy-apps-script.sh            # confere divergências, não escreve
#   scripts/deploy-apps-script.sh push       # envia o código (atualiza só o @HEAD)
#   scripts/deploy-apps-script.sh release    # envia + versiona + publica em produção
#
# Requer `clasp` autenticado na conta institucional (`clasp login`).
# ════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_ID='1BQg36hK_9XES9U1LcQ_NVWy1vgNWCbPMQxOVYZV_Udokqv3cYYf5PmkC'
# Implantação "Producao AppSEL" — é a URL /exec que está em config.js.
# Atualizamos ESTA implantação (em vez de criar outra) para a URL não mudar.
PROD_DEPLOYMENT_ID='AKfycbysFfbpofy4bf0qODi429gKX0dd621Si08_P9_e4nBajeuth1UV8cD4gu8JKtR2_TWcYw'

# "caminho no repositório : nome do arquivo no projeto do Apps Script"
ARQUIVOS=(
  'apps-script/Code.gs:Código.js'
  'apps-script/FirestoreSync.gs:FirestoreSync.js'
  'apps-script/appsscript.json:appsscript.json'
  'index.html:index.html'
)

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODO="${1:-check}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

msg() { printf '%s\n' "$*"; }
erro() { printf 'ERRO: %s\n' "$*" >&2; exit 1; }

command -v clasp >/dev/null 2>&1 || erro 'clasp não encontrado. Instale com: npm install -g @google/clasp'
case "$MODO" in check|push|release) ;; *) erro "modo inválido: '$MODO' (use check, push ou release)" ;; esac

conta="$(clasp show-authorized-user 2>&1 | head -1)" || erro 'clasp não está autenticado. Rode: clasp login'
msg "$conta"
msg ''

# ── Monta a pasta de envio com os nomes que o projeto remoto usa ────────────
ENVIO="$TMP/envio"
mkdir -p "$ENVIO"
cat > "$ENVIO/.clasp.json" <<JSON
{
  "scriptId": "$SCRIPT_ID",
  "rootDir": "",
  "scriptExtensions": [".js", ".gs"],
  "htmlExtensions": [".html"],
  "jsonExtensions": [".json"],
  "filePushOrder": [],
  "skipSubdirectories": false
}
JSON
for par in "${ARQUIVOS[@]}"; do
  local_f="${par%%:*}"; remoto_f="${par#*:}"
  [ -f "$RAIZ/$local_f" ] || erro "arquivo do repositório não encontrado: $local_f"
  cp "$RAIZ/$local_f" "$ENVIO/$remoto_f"
done

# ── Baixa o estado atual do projeto e compara ──────────────────────────────
# Pega edições feitas direto no editor do Apps Script que nunca voltaram para o
# repositório. Sem esta conferência, o push as apagaria silenciosamente.
ATUAL="$TMP/atual"
mkdir -p "$ATUAL"
cp "$ENVIO/.clasp.json" "$ATUAL/.clasp.json"
msg 'Baixando o estado atual do projeto remoto...'
( cd "$ATUAL" && clasp pull >/dev/null ) || erro 'não consegui ler o projeto remoto (confira o login e o acesso ao script).'

# Arquivos que existem no remoto mas o script não conhece: o push os apagaria.
orfaos=()
while IFS= read -r remoto_f; do
  conhecido=''
  for par in "${ARQUIVOS[@]}"; do [ "${par#*:}" = "$remoto_f" ] && conhecido=1 && break; done
  [ -n "$conhecido" ] || orfaos+=("$remoto_f")
done < <(cd "$ATUAL" && find . -type f ! -name '.clasp.json' -printf '%P\n' | sort)

divergiu=0
msg ''
msg 'Comparação (repositório × projeto remoto):'
for par in "${ARQUIVOS[@]}"; do
  local_f="${par%%:*}"; remoto_f="${par#*:}"
  if [ ! -f "$ATUAL/$remoto_f" ]; then
    msg "  + $remoto_f — não existe no remoto ainda (será criado)"; divergiu=1
  elif diff -q "$ATUAL/$remoto_f" "$ENVIO/$remoto_f" >/dev/null; then
    msg "  = $remoto_f — igual"
  else
    n="$(diff "$ATUAL/$remoto_f" "$ENVIO/$remoto_f" | grep -c '^[<>]' || true)"
    msg "  ≠ $remoto_f — difere ($n linhas) [repo: $local_f]"; divergiu=1
  fi
done

if [ ${#orfaos[@]} -gt 0 ]; then
  msg ''
  msg 'ATENÇÃO — arquivos no projeto remoto que este script NÃO envia:'
  for f in "${orfaos[@]}"; do msg "  ! $f"; done
  msg ''
  msg 'Um push os APAGARIA. Traga-os para o repositório e adicione ao mapa'
  msg 'ARQUIVOS deste script antes de publicar.'
  erro 'publicação interrompida para não perder arquivos.'
fi

if [ "$MODO" = check ]; then
  msg ''
  [ "$divergiu" -eq 0 ] && msg 'Nada a publicar: o remoto já está igual ao repositório.' \
                        || msg "Há mudanças a publicar. Rode: scripts/deploy-apps-script.sh release"
  exit 0
fi

if [ "$divergiu" -eq 0 ]; then
  msg ''
  msg 'O código remoto já está igual ao repositório — nada para enviar.'
  [ "$MODO" = push ] && exit 0
  msg 'Seguindo assim mesmo para versionar/reapontar a implantação de produção.'
fi

# ── Envia ──────────────────────────────────────────────────────────────────
msg ''
msg 'Enviando o código...'
( cd "$ENVIO" && clasp push --force )

if [ "$MODO" = push ]; then
  msg ''
  msg 'Pronto — mas isto atualizou apenas o @HEAD.'
  msg 'A URL /exec de produção só muda com: scripts/deploy-apps-script.sh release'
  exit 0
fi

# ── Versiona e publica em produção (mesma URL) ─────────────────────────────
descricao="${2:-$(cd "$RAIZ" && git log -1 --pretty='%h %s' 2>/dev/null || echo 'publicacao manual')}"
msg ''
msg "Criando versão: $descricao"
saida="$( cd "$ENVIO" && clasp create-version "$descricao" )"
msg "$saida"
versao="$(printf '%s' "$saida" | grep -oE '[0-9]+' | tail -1)"
[ -n "$versao" ] || erro 'não consegui identificar o número da versão criada.'

msg "Apontando a implantação de produção para a versão $versao..."
( cd "$ENVIO" && clasp redeploy "$PROD_DEPLOYMENT_ID" -V "$versao" -d 'Producao AppSEL' )

msg ''
msg 'Implantações agora:'
( cd "$ENVIO" && clasp list-deployments )
msg ''
msg "Publicado. A URL /exec do config.js não mudou — serve a versão $versao."
