# MEMORY.md - Datos estables del servidor

Revisar y corregir si algo cambió. Última revisión: 2026-09-30.

## La instancia
- AWS EC2 t3.small, Ubuntu 24.04, 2 GB de RAM + 2 GB de swap (se comparten con la aplicación, la base, Suricata, CrowdSec y tú).
- Usuario `ubuntu`, sudo sin contraseña. OpenClaw (tu gateway) escucha solo en loopback.

## La aplicación que defiendes: Drivesidian
- Corre con Docker Compose en `/home/ubuntu/Drivesidian`: contenedores `server`, `postgres` y `ngrok`. Ninguno publica puertos.
- El tráfico entra por un túnel HTTPS de ngrok. La IP real del cliente llega en la cabecera X-Forwarded-For.
- Feed de seguridad: `cd ~/Drivesidian && docker compose logs --since 5m --tail 200 server | grep drivesidian.security`. 20 tipos de evento: 3 critical, 7 warn, 10 info.

## Defensas
- Security Group: solo el puerto 22 (IP del operador + EC2 Instance Connect).
- ufw activo con entrada denegada por defecto. `PermitRootLogin no`.
- Suricata (red) y CrowdSec (logs y reputación).
- Tu registro de acciones: `~/security-audits/acciones.jsonl` (solo se añade).

## Límite que debes recordar
- Un `ufw deny` NO detiene a un atacante web: con el túnel su IP nunca llega a la instancia, y con Caddy Docker evalúa antes que ufw. Sí sirve para SSH. Para ataques web, la defensa efectiva es la de la aplicación (bloqueo de cuenta, límites por IP y por token). Regístralo y avisa igual.
