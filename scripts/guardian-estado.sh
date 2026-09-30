#!/usr/bin/env bash
#
# Estado de Guardian en UNA sola llamada.
#
# Al arrancar, el prompt le pide a Guardian revisar su registro, los bloqueos, las
# capas de detección y la memoria. Hecho comando por comando son cinco o seis
# llamadas al modelo, y cada una vuelve a enviar todo el contexto. Aquí es una.
# Solo lee; no cambia nada. Salida acotada a propósito (riesgo R10).
set -uo pipefail
DIR="${GUARDIAN_STATE_DIR:-$HOME/security-audits}"

echo "== hora (UTC) =="; date -u +%Y-%m-%dT%H:%M:%SZ
echo "== acciones.jsonl (últimas 20) =="
tail -n 20 "$DIR/acciones.jsonl" 2>/dev/null || echo "(sin registro todavía)"
echo "== ufw: reglas deny =="
sudo ufw status numbered 2>/dev/null | grep -i deny || echo "ninguna"
echo "== CrowdSec: decisiones =="
{ sudo cscli decisions list -o raw 2>/dev/null | head -n 20; } || true
echo "== servicios =="
for s in suricata crowdsec; do printf '%s: ' "$s"; systemctl is-active "$s" 2>/dev/null || true; done
echo "== memoria =="
free -h | head -n 2
