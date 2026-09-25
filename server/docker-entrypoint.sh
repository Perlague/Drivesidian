#!/bin/sh
set -e

# Las migraciones corren aquí y no a mano: cada despliegue con un esquema nuevo
# (security_events, pairing_codes, notify_enabled…) debe aplicarse antes de que
# el servidor acepte una sola petición, o los controllers fallarían contra
# tablas que no existen.
#
# node-pg-migrate es idempotente: lleva su propio registro en la tabla
# pgmigrations y no vuelve a aplicar lo ya aplicado, así que correr esto en cada
# arranque es seguro.
#
# Se invoca el binario directamente en vez de `pnpm migrate:up`: pnpm solo hace
# falta para instalar, y no está en la imagen final.
echo "[entrypoint] aplicando migraciones…"
node_modules/.bin/node-pg-migrate up

echo "[entrypoint] arrancando el servidor"
exec "$@"
