#!/usr/bin/env bash
#
# Deja la EC2 limpia y lista para presentar. Se corre en la instancia, como
# ubuntu, después de `git pull`:
#
#   ./scripts/preparar-presentacion.sh           pregunta antes de borrar
#   ./scripts/preparar-presentacion.sh -y        sin preguntar
#
# Qué hace:
#   1. Baja el intervalo del worker de sincronización a 3 s (SYNC_INTERVAL_MS en
#      el .env) para que una nota llegue a GitHub casi al momento. Solo el
#      servidor; el agente sigue preguntando por cambios cada 60 s.
#   2. Borra TODA la base (cuentas, notas, accesos) y la recrea vacía.
#   3. Archiva el estado de Guardian (acciones, watch.log, corridas) en
#      ~/guardian-respaldos/ y lo deja en blanco. No se borra: se mueve.
#   4. Quita los bloqueos DENY de ufw que dejaron los ensayos.
#   5. Vuelve a aplicar la configuración de Guardian y el vigilante.
#
# Para volver al intervalo normal después de presentar:
#   INTERVALO_MS=300000 ./scripts/preparar-presentacion.sh --solo-intervalo
set -euo pipefail
cd "$(dirname "$0")/.."

SI=0; SOLO_INTERVALO=0
for a in "$@"; do
  case "$a" in
    -y) SI=1 ;;
    --solo-intervalo) SOLO_INTERVALO=1 ;;
    *) echo "Opción desconocida: $a" >&2; exit 2 ;;
  esac
done
INTERVALO_MS="${INTERVALO_MS:-3000}"
DIR="${GUARDIAN_STATE_DIR:-$HOME/security-audits}"
RESP="$HOME/guardian-respaldos/presentacion-$(date +%F-%H%M%S)"

paso() { printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }

[ -f .env ] || { echo "No hay .env en $(pwd)." >&2; exit 1; }

paso "Intervalo del worker de sincronización: ${INTERVALO_MS} ms"
if grep -q '^SYNC_INTERVAL_MS=' .env; then
  sed -i "s/^SYNC_INTERVAL_MS=.*/SYNC_INTERVAL_MS=${INTERVALO_MS}/" .env
else
  printf '\nSYNC_INTERVAL_MS=%s\n' "$INTERVALO_MS" >> .env
fi
grep '^SYNC_INTERVAL_MS=' .env

if [ "$SOLO_INTERVALO" = 1 ]; then
  docker compose up -d
  echo "Listo: el servidor se recreó con el intervalo nuevo. La base no se tocó."
  exit 0
fi

if [ "$SI" != 1 ]; then
  printf '\nSe borrará TODA la base (cuentas, 2FA, notas, accesos), se archivará el estado\nde Guardian y se quitarán los bloqueos DENY de ufw.\nEscribe «si» para continuar: '
  read -r r
  [ "$r" = "si" ] || { echo "Cancelado."; exit 1; }
fi

paso "Base de datos: se borra y se recrea (también recrea los contenedores con el .env nuevo)"
./scripts/db.sh reset -y

paso "Estado de Guardian: se archiva en $RESP"
mkdir -p "$RESP"
for f in acciones.jsonl watch.log corridas .watch-ultima-revision .watch-ultimo-despertar .watch-despertares .watch-tope-avisado; do
  if [ -e "$DIR/$f" ]; then mv "$DIR/$f" "$RESP/" && echo "   archivado: $f"; fi
done
touch "$DIR/acciones.jsonl"

paso "Bloqueos DENY de ufw de los ensayos"
# Se borran de mayor a menor: al borrar una regla, las siguientes se renumeran.
mapfile -t NUMS < <(sudo ufw status numbered | grep -i 'DENY IN' | sed -n 's/^\[ *\([0-9]\+\)\].*/\1/p' | sort -rn)
if [ "${#NUMS[@]}" -eq 0 ]; then
  echo "   ninguno"
else
  for n in "${NUMS[@]}"; do sudo ufw --force delete "$n" >/dev/null && echo "   quitada la regla $n"; done
fi
sudo ufw status | head -1

paso "Guardian y vigilante"
./scripts/guardian-aplicar.sh

cat <<TXT

────────────────────────────────────────────────────────────────────
 Servidor listo. Falta, en este orden:

  1. En el panel web, registra DOS cuentas y activa el 2FA en ambas.
  2. Convierte una en administradora:
       ./scripts/db.sh admin tu-correo@ejemplo.com
     (cierra sesión y vuelve a entrar para ver el menú «Admin»)
  3. Borra en GitHub las carpetas de notas de los ensayos, si quieres
     empezar el repositorio limpio.
  4. En Windows, reinstala el agente y vincúlalo con la cuenta normal.

  Estado:  ./scripts/db.sh estado   ·   ./scripts/guardian-watch-install.sh estado
  Respaldos de Guardian:  $RESP
────────────────────────────────────────────────────────────────────
TXT
