#!/bin/sh
#
# Estado y restablecimiento de la base de Postgres del servidor.
#
#   ./scripts/db.sh estado          Cuenta lo que hay guardado (usuarios, notas, accesos)
#   ./scripts/db.sh notas           Borra SOLO las notas; conserva cuentas y 2FA
#   ./scripts/db.sh accesos         Revoca todos los accesos de agentes (fuerza a revincular)
#   ./scripts/db.sh reset           Borra TODA la base y el volumen, y la recrea vacía
#
# Las de borrado piden escribir «si». Con -y (p. ej. `./scripts/db.sh reset -y`)
# no preguntan.
#
# Por qué existe: `docker compose down` NO borra la base, porque vive en el
# volumen `postgres-data`. Reconstruir la imagen tampoco. Solo `down -v` o
# `reset` la vacían. Y aunque la base quede vacía, el agente de una PC con
# notas en su vault las vuelve a subir al arrancar: ver docs/AGENTE.md
# («Empezar de cero»).
set -eu

cd "$(dirname "$0")/.."

CMD="${1:-estado}"
SI="${2:-}"

psql_() { docker compose exec -T postgres psql -U drivesidian -d drivesidian "$@"; }

confirmar() {
  [ "$SI" = "-y" ] && return 0
  printf '%s\nEscribe «si» para continuar: ' "$1"
  read -r r
  [ "$r" = "si" ] || { echo "Cancelado."; exit 1; }
}

estado() {
  psql_ -c "
    SELECT
      (SELECT count(*) FROM users)                                    AS usuarios,
      (SELECT count(*) FROM notes)                                    AS notas,
      (SELECT count(*) FROM notes WHERE sync_status = 'pending')      AS notas_pendientes,
      (SELECT count(*) FROM agent_tokens WHERE revoked_at IS NULL)    AS accesos_activos,
      (SELECT count(*) FROM agent_tokens WHERE revoked_at IS NOT NULL) AS accesos_revocados;"
  psql_ -c "SELECT u.email, count(n.id) AS notas
            FROM users u LEFT JOIN notes n ON n.user_id = u.id
            GROUP BY u.email ORDER BY u.email;"
}

case "$CMD" in
  estado)
    estado
    ;;
  notas)
    confirmar "Se borrarán TODAS las notas de la base (no las de GitHub ni las de las PC)."
    psql_ -c "TRUNCATE notes RESTART IDENTITY;"
    estado
    ;;
  accesos)
    confirmar "Se revocarán todos los accesos de agentes; cada PC tendrá que volver a vincularse."
    psql_ -c "UPDATE agent_tokens SET revoked_at = now() WHERE revoked_at IS NULL;
              DELETE FROM pairing_codes;"
    estado
    ;;
  reset)
    confirmar "Se borrará TODA la base: cuentas, 2FA, notas y accesos. Tendrás que registrarte de nuevo."
    # -v elimina el volumen postgres-data; sin él la base sobrevive al down.
    docker compose down -v
    docker compose up -d
    echo "Esperando a que el servidor migre la base…"
    i=0
    until psql_ -c "SELECT 1 FROM users LIMIT 1;" >/dev/null 2>&1; do
      i=$((i + 1))
      [ "$i" -gt 60 ] && { echo "La base no respondió en 2 minutos: revisa docker compose logs server"; exit 1; }
      sleep 2
    done
    estado
    ;;
  *)
    echo "Uso: $0 {estado|notas|accesos|reset} [-y]" >&2
    exit 2
    ;;
esac
