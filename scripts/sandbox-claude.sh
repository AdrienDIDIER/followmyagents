#!/usr/bin/env bash
# Lance une session `claude -p` dans ./sandbox avec un environnement propre :
# toutes les variables CLAUDE*/ANTHROPIC_* héritées de la session parente sont
# retirées (sinon la session de test pourrait se rattacher à la session parente).
#
# Usage : scripts/sandbox-claude.sh "prompt" [args claude supplémentaires…]
# Variable CLAUDE_BIN pour forcer le binaire.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
bin="${CLAUDE_BIN:-}"
if [ -z "$bin" ]; then
  if command -v claude >/dev/null 2>&1; then bin="$(command -v claude)"; else
    bin="$(ls -d "$HOME"/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude* 2>/dev/null | sort | tail -1)"
  fi
fi
unset_args=()
for v in $(env | sed -n 's/^\(CLAUDE[A-Z_]*\|CLAUDECODE\)=.*/\1/p'); do unset_args+=("-u" "$v"); done
cd "$here/sandbox"
exec env "${unset_args[@]}" "$bin" -p "$@" < /dev/null
