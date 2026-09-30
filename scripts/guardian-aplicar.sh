#!/usr/bin/env bash
#
# Deja a Guardian funcionando bien, de una vez. Se corre en la EC2, como ubuntu,
# después de `git pull`:
#
#   ./scripts/guardian-aplicar.sh
#
# Es idempotente: se puede volver a correr sin romper nada. Lo que hace:
#
#   1. Respalda los archivos del espacio de trabajo de OpenClaw.
#   2. Sustituye USER.md, SOUL.md y MEMORY.md por versiones coherentes con el
#      prompt (los heredados pedían confirmar antes de bloquear una IP).
#   3. Reemplaza la sección «Al arrancar» de AGENTS.md por una que usa una sola
#      llamada (guardian-estado.sh) en vez de cinco o seis.
#   4. Cambia el modelo (por defecto Claude Haiku 4.5).
#   5. Reinicia el gateway de OpenClaw.
#   6. Instala el vigilante que despierta a Guardian cuando hay warn o critical.
#
# Variables opcionales:
#   GUARDIAN_MODEL=anthropic/claude-sonnet-5-5   usar otro modelo
#   GUARDIAN_SIN_MODELO=1                        no tocar el modelo
#   GUARDIAN_SIN_VIGILANTE=1                     no instalar el vigilante
set -euo pipefail
shopt -s nullglob

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
WS="${OPENCLAW_WORKSPACE:-$HOME/.openclaw/workspace}"
PLANTILLAS="$RAIZ/scripts/guardian-workspace"
MODELO="${GUARDIAN_MODEL:-anthropic/claude-haiku-4-5-20251001}"
RESPALDO="$HOME/guardian-respaldos/workspace-$(date +%F-%H%M%S)"

paso() { printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }
ok()   { printf '   ✔ %s\n' "$1"; }
aviso(){ printf '   ! %s\n' "$1"; }

[ -d "$WS" ] || { echo "No existe $WS. ¿Está instalado OpenClaw para este usuario?" >&2; exit 1; }
for f in USER.md SOUL.md MEMORY.md al-arrancar.md; do
  [ -f "$PLANTILLAS/$f" ] || { echo "Falta $PLANTILLAS/$f. ¿Hiciste git pull?" >&2; exit 1; }
done
command -v python3 >/dev/null || { echo "Falta python3." >&2; exit 1; }

paso "1/6 Respaldo en $RESPALDO"
mkdir -p "$RESPALDO"
for f in AGENTS.md USER.md SOUL.md MEMORY.md IDENTITY.md; do
  [ -f "$WS/$f" ] && cp -p "$WS/$f" "$RESPALDO/" && ok "$f"
done
# Los .bak dentro del espacio de trabajo los puede leer el agente y traen
# reglas viejas: se sacan de ahí.
for b in "$WS"/AGENTS.md.bak*; do mv "$b" "$RESPALDO/" && ok "$(basename "$b") movido fuera del espacio de trabajo"; done

paso "2/6 USER.md, SOUL.md y MEMORY.md coherentes con el prompt"
for f in USER.md SOUL.md MEMORY.md; do
  cp "$PLANTILLAS/$f" "$WS/$f" && ok "$f"
done
aviso "Revisa MEMORY.md ($WS/MEMORY.md): describe el servidor según la documentación."

paso "3/6 Sección «Al arrancar» de AGENTS.md"
if grep -q 'guardian-estado.sh' "$WS/AGENTS.md" 2>/dev/null; then
  ok "ya estaba actualizada"
else
  python3 - "$WS/AGENTS.md" "$PLANTILLAS/al-arrancar.md" <<'PY'
import re, sys
ruta, plantilla = sys.argv[1], sys.argv[2]
nuevo = open(plantilla, encoding="utf-8").read().rstrip() + "\n"
try:
    texto = open(ruta, encoding="utf-8").read()
except FileNotFoundError:
    sys.exit("No existe AGENTS.md: instala primero el prompt (docs/GUARDIAN-DESPLIEGUE.md, parte 5).")
# De «## Al arrancar» hasta el siguiente «## » o el final del archivo.
patron = re.compile(r"^## Al arrancar\s*$.*?(?=^## |\Z)", re.S | re.M)
if patron.search(texto):
    texto = patron.sub(lambda _m: nuevo + "\n", texto, count=1)
    print("   ✔ sección reemplazada")
else:
    texto = texto.rstrip() + "\n\n" + nuevo
    print("   ✔ sección añadida al final (no existía «## Al arrancar»)")
open(ruta, "w", encoding="utf-8").write(texto)
PY
fi

paso "4/6 Modelo"
if [ "${GUARDIAN_SIN_MODELO:-0}" = "1" ]; then
  aviso "omitido (GUARDIAN_SIN_MODELO=1)"
elif ! command -v openclaw >/dev/null; then
  aviso "no encuentro 'openclaw' en el PATH; omito el cambio de modelo"
else
  antes="$(openclaw config get agents.defaults.model 2>&1 | tr '\n' ' ' || true)"
  echo "   antes:   $antes"
  if openclaw config set agents.defaults.model.primary "$MODELO" >/dev/null 2>&1; then
    ok "modelo: $MODELO"
  else
    aviso "OpenClaw rechazó '$MODELO'. Prueba: GUARDIAN_MODEL=anthropic/claude-haiku-4-5 $0"
  fi
  echo "   ahora:   $(openclaw config get agents.defaults.model 2>&1 | tr '\n' ' ' || true)"
fi

paso "5/6 Reinicio del gateway"
if systemctl --user restart openclaw-gateway.service 2>/dev/null; then
  sleep 2
  systemctl --user is-active openclaw-gateway.service >/dev/null && ok "openclaw-gateway activo" || aviso "el gateway no quedó activo: journalctl --user -u openclaw-gateway.service -n 30"
else
  aviso "no pude reiniciar openclaw-gateway.service"
fi

paso "6/6 Vigilante"
if [ "${GUARDIAN_SIN_VIGILANTE:-0}" = "1" ]; then
  aviso "omitido (GUARDIAN_SIN_VIGILANTE=1)"
else
  "$RAIZ/scripts/guardian-watch-install.sh" instalar && ok "vigilante instalado"
fi

cat <<TXT

────────────────────────────────────────────────────────────────────
 Listo. Respaldos en: $RESPALDO

 Falta lo que no puedo hacer por ti (necesita la terminal interactiva):

   1. openclaw tui
      /new          (sesión limpia)
      /status       (anota los tokens de contexto)

   2. Prueba del vigilante, sin atacar: en tu panel haz un login con la
      contraseña equivocada y, en menos de 2 minutos:
        tail -f ~/security-audits/watch.log

   Estado del vigilante:  ./scripts/guardian-watch-install.sh estado
────────────────────────────────────────────────────────────────────
TXT
