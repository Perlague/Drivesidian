#!/bin/sh
#
# Instala las capas de detección que Guardian necesita para trabajar:
# Suricata (IDS de red) y CrowdSec (reputación y detección por comportamiento).
#
#   ./scripts/guardian-setup.sh
#
# **No lo corras con sudo.** El script pide sudo donde hace falta; lanzarlo
# elevado dejaría la carpeta de auditoría a nombre de root y Guardian no podría
# escribir en ella.
#
# Es idempotente: si algo ya está instalado, lo detecta y sigue.
set -eu

AUDIT_DIR="$HOME/security-audits"
ACCIONES="$AUDIT_DIR/acciones.jsonl"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
ok()  { printf '    \033[32mOK\033[0m  %s\n' "$1"; }
warn(){ printf '    \033[33m!!\033[0m  %s\n' "$1"; }

if [ "$(id -u)" = "0" ]; then
  echo "No lo corras como root ni con sudo. Ejecuta: ./scripts/guardian-setup.sh" >&2
  exit 1
fi

# ---------------------------------------------------------------- 0. Memoria
# La instancia son 2 GB compartidos con la app y con el propio Guardian.
# Suricata es lo más pesado de lo que se instala aquí, así que conviene saber
# con qué se cuenta ANTES y no descubrirlo cuando el OOM killer elija víctima.
say "0/5  Comprobando memoria"
free -h
DISPONIBLE_MB=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
SWAP_KB=$(awk '/SwapTotal/ {print $2}' /proc/meminfo)

if [ "$SWAP_KB" -eq 0 ]; then
  warn "No hay swap. Sin ella, el OOM killer puede matar a Postgres o a Guardian."
  warn "Créala antes de seguir:"
  echo "      sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile"
  echo "      sudo mkswap /swapfile && sudo swapon /swapfile"
  exit 1
fi
ok "swap activa"

if [ "$DISPONIBLE_MB" -lt 400 ]; then
  warn "Solo ${DISPONIBLE_MB} MB disponibles. Suricata va a ir muy justo."
  warn "Considera apagar algo antes, o usar solo CrowdSec."
fi

# ---------------------------------------------------- 1. Interfaz de red real
# El suricata.yaml que viene por defecto escucha en eth0, y en una EC2 con
# Ubuntu moderno la interfaz NO se llama eth0 (suele ser ens5 o enX0). Si no se
# corrige, Suricata arranca, no ve un solo paquete, y no da ningún error obvio:
# parece funcionar y no detecta nada.
say "1/5  Detectando la interfaz de red"
IFACE=$(ip route | awk '/^default/ {print $5; exit}')
if [ -z "$IFACE" ]; then
  echo "No se pudo detectar la interfaz de red por defecto." >&2
  exit 1
fi
ok "interfaz: $IFACE"

# ------------------------------------------------------------- 2. Suricata
say "2/5  Instalando Suricata"
if command -v suricata >/dev/null 2>&1; then
  ok "ya estaba instalado"
else
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq suricata
  ok "instalado"
fi

if [ "$IFACE" != "eth0" ]; then
  sudo sed -i "s/interface: eth0/interface: $IFACE/g" /etc/suricata/suricata.yaml
  ok "suricata.yaml apuntando a $IFACE"
fi

say "      Descargando reglas (tarda un poco)"
sudo suricata-update
sudo systemctl enable --now suricata
ok "suricata activo"

# ------------------------------------------------------------- 3. CrowdSec
# CrowdSec se instala con un script de su web. **Se descarga a un archivo y se
# deja a la vista antes de ejecutarlo**, en vez de canalizarlo directo a sh:
# este proyecto evita a propósito el patrón `curl | sh`, que ejecuta código
# remoto sin que nadie pueda mirarlo primero.
say "3/5  Instalando CrowdSec"
if command -v cscli >/dev/null 2>&1; then
  ok "ya estaba instalado"
else
  INSTALADOR=/tmp/crowdsec-install.sh
  curl -fsSL https://install.crowdsec.net -o "$INSTALADOR"
  printf '    script guardado en %s (%s bytes)\n' "$INSTALADOR" "$(wc -c < "$INSTALADOR")"
  printf '    revísalo con: less %s\n' "$INSTALADOR"
  sudo sh "$INSTALADOR"
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq crowdsec crowdsec-firewall-bouncer-iptables
  ok "instalado"
fi

sudo systemctl enable --now crowdsec
ok "crowdsec activo"

# ------------------------------------------- 4. Carpeta de acciones de Guardian
# Aquí escribe Guardian cada bloqueo ANTES de aplicarlo: qué, a quién, por qué y
# cuándo caduca. Es lo que permite revertir y auditar. Vive en el home del
# operador y no en /var/log a propósito: Guardian no debe poder borrar su propio
# registro con los permisos con los que rota los logs del sistema.
say "4/5  Carpeta de auditoría"
mkdir -p "$AUDIT_DIR"
[ -f "$ACCIONES" ] || : > "$ACCIONES"
chmod 640 "$ACCIONES"
ok "$ACCIONES"

# ------------------------------------------------------------ 5. Comprobación
say "5/5  Comprobación"

estado() {
  if systemctl is-active --quiet "$1"; then
    ok "$1 corriendo"
  else
    warn "$1 NO está corriendo  ->  sudo systemctl status $1"
  fi
}

estado suricata
estado crowdsec

if sudo test -s /var/log/suricata/fast.log; then
  ok "suricata ya escribió alertas"
else
  warn "suricata todavía sin alertas (normal si acaba de arrancar)"
fi

echo
echo "    Reglas de Suricata: $(sudo suricata-update list-sources 2>/dev/null | grep -c Name || echo '?') fuentes"
sudo cscli metrics 2>/dev/null | head -12 || warn "cscli metrics aún sin datos"

cat <<'FIN'

  ────────────────────────────────────────────────────────────
  Capas de detección listas.

  Lo que Guardian tiene que leer:

    cd ~/Drivesidian && docker compose logs -f server | grep drivesidian.security
    sudo tail -f /var/log/suricata/fast.log
    sudo cscli alerts list

  Falta el último paso, que no automatiza este script: instalar OpenClaw y
  darle su system prompt. Ver docs/GUARDIAN.md, secciones 2 y 4.
  ────────────────────────────────────────────────────────────
FIN
