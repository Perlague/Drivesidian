#!/usr/bin/env bash
#
# Instala (o quita) el temporizador que ejecuta guardian-watch.sh cada 30 segundos.
#
#   ./scripts/guardian-watch-install.sh            instala y arranca
#   ./scripts/guardian-watch-install.sh quitar     lo detiene y lo borra
#   ./scripts/guardian-watch-install.sh estado     muestra el temporizador y el log
#
# Corre como el usuario ubuntu (servicio de USUARIO, igual que
# openclaw-gateway), no como root. Necesita `loginctl enable-linger ubuntu`,
# que la instalación de Guardian ya hace: sin eso el temporizador muere al
# cerrar la consola.
set -euo pipefail

ACCION="${1:-instalar}"
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
UNIDADES="$HOME/.config/systemd/user"

case "$ACCION" in
  instalar)
    OC="$(command -v openclaw || true)"
    if [ -z "$OC" ]; then
      echo "No encuentro 'openclaw' en el PATH. Instálalo antes (docs/GUARDIAN-DESPLIEGUE.md)." >&2
      exit 1
    fi
    command -v flock >/dev/null || { echo "Falta 'flock' (paquete util-linux)." >&2; exit 1; }
    mkdir -p "$UNIDADES"

    # systemd de usuario arranca con un PATH mínimo: se congela el actual para
    # que encuentre openclaw, node y docker.
    cat > "$UNIDADES/guardian-watch.service" <<UNIT
[Unit]
Description=Vigilante de Guardian (despierta al agente si hay eventos warn/critical)

[Service]
Type=oneshot
Environment="PATH=$PATH"
Environment="GUARDIAN_OPENCLAW=$OC"
Environment="GUARDIAN_REPO=$HOME/Drivesidian"
Environment="GUARDIAN_COOLDOWN=${GUARDIAN_COOLDOWN:-30}"
Environment="GUARDIAN_MAX_POR_HORA=${GUARDIAN_MAX_POR_HORA:-60}"
ExecStart=/bin/bash $RAIZ/scripts/guardian-watch.sh
UNIT

    cat > "$UNIDADES/guardian-watch.timer" <<UNIT
[Unit]
Description=Revisa el feed de seguridad cada 30 segundos

[Timer]
OnBootSec=30
OnUnitActiveSec=30
AccuracySec=2s

[Install]
WantedBy=timers.target
UNIT

    systemctl --user daemon-reload
    systemctl --user enable --now guardian-watch.timer
    # Si ya existía con otros valores, hay que reiniciarlo para que los tome.
    systemctl --user restart guardian-watch.timer
    echo "Listo. Se ejecuta cada 30 segundos (enfriamiento ${GUARDIAN_COOLDOWN:-30} s, tope ${GUARDIAN_MAX_POR_HORA:-60} despertares por hora)."
    echo "  Estado:  $0 estado"
    echo "  Log:     tail -f ~/security-audits/watch.log"
    ;;
  quitar)
    systemctl --user disable --now guardian-watch.timer 2>/dev/null || true
    rm -f "$UNIDADES/guardian-watch.service" "$UNIDADES/guardian-watch.timer"
    systemctl --user daemon-reload
    echo "Vigilante quitado."
    ;;
  estado)
    systemctl --user list-timers guardian-watch.timer --no-pager || true
    echo "── últimas líneas del log ──"
    tail -n 15 "$HOME/security-audits/watch.log" 2>/dev/null || echo "(sin despertares todavía)"
    ;;
  *)
    echo "Uso: $0 [instalar|quitar|estado]" >&2
    exit 2
    ;;
esac
