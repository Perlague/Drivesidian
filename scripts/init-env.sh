#!/bin/sh
#
# Prepara el .env antes del primer `docker compose up -d`.
#
#   ./scripts/init-env.sh
#
# Genera los secretos que ningún humano necesita ver nunca y deja marcadas las
# credenciales que sí tienes que pegar a mano. Es idempotente: si una variable
# ya tiene valor, no la toca. Se puede volver a correr sin miedo.
#
# **Solo necesita `sh` y `openssl`**, los dos presentes en cualquier Ubuntu. No
# hace falta Node en la instancia: vive dentro de la imagen del servidor, que es
# justamente el punto de containerizar.
set -eu

cd "$(dirname "$0")/.."

# Los cuatro secretos de máquina. Nadie los teclea, nadie los lee: los genera
# esto y se quedan en el .env. Se distinguen de NGROK_AUTHTOKEN y de los de
# GitHub, que vienen de una cuenta de otro servicio y no se pueden inventar.
SECRETOS="POSTGRES_PASSWORD JWT_SECRET TOTP_ENCRYPTION_KEY NTFY_SECRET"

# Las que hay que pegar a mano. Se comprueban al final para avisar, no se tocan.
MANUALES="NGROK_AUTHTOKEN GITHUB_TOKEN GITHUB_OWNER GITHUB_REPO"

# 32 bytes en hex. **Hex y no base64 a propósito**: TOTP_ENCRYPTION_KEY se lee
# con Buffer.from(valor, 'hex') para AES-256-GCM (ver utils/secretCrypto.js), así
# que tiene que ser hex de 64 caracteres o el cifrado del 2FA falla —y falla al
# enrolar, no al arrancar, que es peor—. Los otros tres aceptan cualquier cosa,
# pero usar el mismo formato evita tener dos comandos y equivocarse de uno.
generar() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    # Respaldo sin openssl, solo con coreutils.
    od -An -tx1 -N32 /dev/urandom | tr -d ' \n'
  fi
}

# Un valor cuenta como "sin poner" si está vacío o si sigue siendo el
# marcador del .env.example. Así el script se puede repetir sin regenerar nada.
sin_poner() {
  case "$1" in
    '' | changeme*) return 0 ;;
    *) return 1 ;;
  esac
}

valor_de() {
  sed -n "s/^$1=//p" .env | head -n1
}

if [ ! -f .env ]; then
  cp .env.example .env
  echo "  .env creado a partir de .env.example"
fi

generados=''
for var in $SECRETOS; do
  if sin_poner "$(valor_de "$var")"; then
    # El valor es hex, así que no lleva ningún carácter especial para sed.
    sed -i "s|^$var=.*|$var=$(generar)|" .env
    generados="$generados $var"
  fi
done

if [ -n "$generados" ]; then
  echo "  generados:$generados"
else
  echo "  los secretos ya estaban puestos, no se tocó ninguno"
fi

# El archivo tiene credenciales: que no lo lea cualquier cuenta de la máquina.
chmod 600 .env

# No se imprime ningún valor a propósito: esta salida acaba en el historial de
# la terminal, y en un despliegue asistido, en el registro de quien lo corre.
faltan=''
for var in $MANUALES; do
  if sin_poner "$(valor_de "$var")"; then
    faltan="$faltan $var"
  fi
done

echo
if [ -n "$faltan" ]; then
  echo "  FALTA ponerlas a mano en el .env:$faltan"
  echo
  echo "    NGROK_AUTHTOKEN  -> https://dashboard.ngrok.com/get-started/your-authtoken"
  echo "    GITHUB_*         -> un repo PRIVADO y un token con permiso de escritura"
  echo
  echo "  Edita el archivo y vuelve a correr esto para comprobar:"
  echo "    nano .env && ./scripts/init-env.sh"
else
  echo "  .env completo. Siguiente paso:"
  echo "    docker compose up -d && docker compose logs server"
fi

# TOTP_ENCRYPTION_KEY es la única irrecuperable: cifra los secretos de 2FA en
# reposo, y sin ella nadie puede volver a validar un código. Perderla obliga a
# que TODAS las cuentas reenrolen su segundo factor. Un script que la genera en
# silencio hace muy fácil no respaldarla nunca, así que lo dice cada vez.
echo
echo "  Respalda el .env fuera de la instancia. Si pierdes TOTP_ENCRYPTION_KEY,"
echo "  todas las cuentas tienen que volver a enrolar su 2FA."
