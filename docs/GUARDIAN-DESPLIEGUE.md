# Desplegar Guardian

Guía corta. Qué es y por qué está diseñado así: [GUARDIAN.md](GUARDIAN.md).

Instala las dos capas de detección —**Suricata** (IDS de red) y **CrowdSec**
(reputación y comportamiento)— y deja la instancia lista para que Guardian
trabaje.

> Requiere que Drivesidian ya esté desplegado y con swap activa
> (ver [PRIMER-DESPLIEGUE.md](PRIMER-DESPLIEGUE.md)).

---

## Parte 1 — Entrar a la instancia

1. **https://console.aws.amazon.com**
2. Región **N. Virginia (us-east-1)** (selector arriba a la derecha)
3. Busca `EC2` → menú izquierdo **Instances**
4. Marca **DrivesidianVM** → botón **Connect** → pestaña **EC2 Instance Connect** → **Connect**

---

## Parte 2 — Crear el script

Pega este bloque **completo** en la terminal y dale Enter. No instala nada
todavía: solo escribe el archivo.

```bash
cat > ~/guardian-setup.sh <<'SCRIPT'
#!/bin/sh
set -eu

AUDIT_DIR="$HOME/security-audits"
ACCIONES="$AUDIT_DIR/acciones.jsonl"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
ok()  { printf '    \033[32mOK\033[0m  %s\n' "$1"; }
warn(){ printf '    \033[33m!!\033[0m  %s\n' "$1"; }

if [ "$(id -u)" = "0" ]; then
  echo "No lo corras como root ni con sudo." >&2
  exit 1
fi

say "0/5  Comprobando memoria"
free -h
DISPONIBLE_MB=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
SWAP_KB=$(awk '/SwapTotal/ {print $2}' /proc/meminfo)

if [ "$SWAP_KB" -eq 0 ]; then
  warn "No hay swap. Créala antes de seguir:"
  echo "      sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile"
  echo "      sudo mkswap /swapfile && sudo swapon /swapfile"
  exit 1
fi
ok "swap activa"

if [ "$DISPONIBLE_MB" -lt 400 ]; then
  warn "Solo ${DISPONIBLE_MB} MB disponibles. Suricata va a ir muy justo."
fi

say "1/5  Detectando la interfaz de red"
IFACE=$(ip route | awk '/^default/ {print $5; exit}')
if [ -z "$IFACE" ]; then
  echo "No se pudo detectar la interfaz de red." >&2
  exit 1
fi
ok "interfaz: $IFACE"

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

say "3/5  Instalando CrowdSec"
if command -v cscli >/dev/null 2>&1; then
  ok "ya estaba instalado"
else
  INSTALADOR=/tmp/crowdsec-install.sh
  curl -fsSL https://install.crowdsec.net -o "$INSTALADOR"
  printf '    script guardado en %s (%s bytes)\n' "$INSTALADOR" "$(wc -c < "$INSTALADOR")"
  sudo sh "$INSTALADOR"
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq crowdsec crowdsec-firewall-bouncer-iptables
  ok "instalado"
fi

sudo systemctl enable --now crowdsec
ok "crowdsec activo"

say "4/5  Carpeta de auditoría"
mkdir -p "$AUDIT_DIR"
[ -f "$ACCIONES" ] || : > "$ACCIONES"
chmod 640 "$ACCIONES"
ok "$ACCIONES"

say "5/5  Comprobación"

estado() {
  if systemctl is-active --quiet "$1"; then
    ok "$1 corriendo"
  else
    warn "$1 NO corre  ->  sudo systemctl status $1"
  fi
}

estado suricata
estado crowdsec

if sudo test -s /var/log/suricata/fast.log; then
  ok "suricata ya escribió alertas"
else
  warn "suricata todavía sin alertas (normal recién arrancado)"
fi

sudo cscli metrics 2>/dev/null | head -12 || warn "cscli metrics aún sin datos"

echo
echo "  ────────────────────────────────────────────────"
echo "  Capas de detección listas."
echo "  Falta instalar OpenClaw y darle su system prompt."
echo "  ────────────────────────────────────────────────"
SCRIPT
chmod +x ~/guardian-setup.sh
```

> Si ya clonaste el repo, el mismo script está versionado y te saltas esta
> parte: `cd ~/Drivesidian && git pull && ./scripts/guardian-setup.sh`

---

## Parte 3 — Ejecutarlo

```bash
~/guardian-setup.sh
```

**Sin `sudo`.** El script lo pide donde hace falta; lanzarlo elevado dejaría la
carpeta de auditoría a nombre de root y Guardian no podría escribir en ella.

Tarda unos minutos, casi todo descargando las reglas de Suricata. Al terminar
debe decir `OK suricata corriendo` y `OK crowdsec corriendo`.

---

## Parte 4 — Comprobar que detectan

```bash
sudo systemctl status suricata crowdsec --no-pager
sudo tail -5 /var/log/suricata/fast.log
sudo cscli alerts list
```

Para provocar una alerta a propósito, desde **tu** computadora:

```bash
curl "https://lawless-trudy-unspurious.ngrok-free.dev/../../etc/passwd"
```

---

## Parte 5 — Levantar Guardian

Esto el script no lo hace: instala **OpenClaw** en la instancia y dale como
*system prompt* las cinco reglas de la sección 2 y los límites duros de la
sección 4 de [GUARDIAN.md](GUARDIAN.md).

Las tres fuentes que tiene que leer:

```bash
cd ~/Drivesidian && docker compose logs -f server | grep drivesidian.security
sudo tail -f /var/log/suricata/fast.log
sudo cscli alerts list
```

---

## Si algo falla

| Síntoma | Qué hacer |
|---|---|
| El script sale en el paso 0 pidiendo swap | Corre los dos comandos que imprime y vuelve a lanzarlo |
| `suricata` no arranca | `sudo suricata -T -c /etc/suricata/suricata.yaml -v` valida la configuración |
| Suricata corre pero nunca alerta | Comprueba la interfaz: `grep -n "interface:" /etc/suricata/suricata.yaml` debe coincidir con `ip route \| grep default` |
| La instancia se pone lenta | `free -h`. Suricata es lo más pesado; reduce reglas con `sudo suricata-update --no-test` o déjalo apagado y usa solo CrowdSec |
| `cscli` no existe tras instalar | `sudo apt install -y crowdsec` y revisa `/tmp/crowdsec-install.sh` |

Apagar una capa sin desinstalarla:

```bash
sudo systemctl disable --now suricata
```
