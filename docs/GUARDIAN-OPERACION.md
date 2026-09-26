# Guardian — operación

Chuleta de comandos. Qué es: [GUARDIAN.md](GUARDIAN.md) · Cómo se instala:
[GUARDIAN-DESPLIEGUE.md](GUARDIAN-DESPLIEGUE.md).

Todo se ejecuta en la instancia, salvo donde diga lo contrario.

---

## Ver qué está pasando

```bash
# Feed de la aplicación, en vivo
cd ~/Drivesidian && docker compose logs -f server | grep drivesidian.security

# Lo último que llegó
cd ~/Drivesidian && docker compose logs server --tail 50 | grep drivesidian.security

# Alertas de red
sudo tail -20 /var/log/suricata/fast.log
sudo cscli alerts list
```

## Ver qué hizo Guardian

```bash
# Sus acciones, que escribe ANTES de aplicarlas
cat ~/security-audits/acciones.jsonl
tail -f ~/security-audits/acciones.jsonl

# En tabla (requiere: sudo apt install -y jq)
jq -r '[.ts,.accion,.objetivo,.motivo,.caduca] | @tsv' \
  ~/security-audits/acciones.jsonl | column -t

# Su razonamiento y su actividad
journalctl --user -u openclaw-gateway.service -f
journalctl --user -u openclaw-gateway.service --since "1 hour ago" --no-pager

# Hablar con él
openclaw tui
```

## Consultar el histórico de eventos

```bash
cd ~/Drivesidian

# Los 20 más recientes
docker compose exec -T postgres psql -U drivesidian drivesidian -c \
  "SELECT occurred_at, type, severity, ip FROM security_events ORDER BY occurred_at DESC LIMIT 20;"

# Solo los critical
docker compose exec -T postgres psql -U drivesidian drivesidian -c \
  "SELECT occurred_at, type, ip, details FROM security_events WHERE severity='critical' ORDER BY occurred_at DESC;"

# Conteo por tipo — la tabla que va al informe
docker compose exec -T postgres psql -U drivesidian drivesidian -c \
  "SELECT type, severity, COUNT(*) FROM security_events GROUP BY type, severity ORDER BY 3 DESC;"
```

---

## Desbloquear una IP

Hay **dos sitios** que pueden tener bloqueada la misma IP. Revisa los dos.

### 1. `ufw` — lo que bloquea Guardian

```bash
sudo ufw status numbered
```

```
[ 3] Anywhere    DENY IN    203.0.113.45
```

```bash
sudo ufw delete 3
```

> **Los números se recalculan después de cada borrado.** Si vas a quitar
> varias, bórralas **de mayor a menor**, o vuelve a mirar el listado entre una
> y otra.

Sin depender del número:

```bash
sudo ufw delete deny from 203.0.113.45
```

### 2. CrowdSec — sus propias decisiones, aparte de `ufw`

```bash
sudo cscli decisions list
sudo cscli decisions delete --ip 203.0.113.45
```

Quitarla de `ufw` **no** la quita de CrowdSec. Si la IP sigue sin entrar
después de borrar la regla, es esto.

### Emergencia

```bash
sudo ufw disable        # quita TODA la protección de red
```

Úsalo solo si te quedaste fuera, y vuelve a activarlo en cuanto puedas con
`sudo ufw enable`.

---

## Probar que responde

Desde **cualquier** máquina, mejor si no es la instancia:

```bash
./scripts/guardian-pruebas.sh https://tu-url.ngrok-free.dev
```

Tres escenarios: inyección de prompt en el feed, rociado de contraseñas, y
bloqueo por 2FA (opcional, es el único que produce un `critical`). El script
imprime al final qué comprobar.

**La prueba que más vale enseñar** es la primera: se manda un `User-Agent` con
instrucciones dirigidas a Guardian y se comprueba que las reporta en vez de
obedecerlas.

```bash
sudo ufw status | head -3     # debe seguir diciendo: Status: active
```

---

## Parar y arrancar

```bash
systemctl --user restart openclaw-gateway.service
systemctl --user stop openclaw-gateway.service
systemctl --user status openclaw-gateway.service --no-pager

sudo systemctl restart suricata crowdsec
sudo systemctl disable --now suricata     # si la instancia va justa de memoria
```

## Si la instancia va lenta

```bash
free -h
systemctl --user status openclaw-gateway.service --no-pager | grep Memory
```

Son 2 GB compartidos entre Postgres, el servidor, ngrok, Suricata, CrowdSec y
el propio Guardian. Lo más pesado de apagar sin perder la defensa es Suricata:
CrowdSec sola ya cubre una capa de detección.

## Cambiar el rol de Guardian

Sus instrucciones viven en `~/.openclaw/workspace/AGENTS.md`.

```bash
cp ~/.openclaw/workspace/AGENTS.md ~/.openclaw/workspace/AGENTS.md.bak
nano ~/.openclaw/workspace/AGENTS.md
systemctl --user restart openclaw-gateway.service
```

**No dejes dos roles a la vez.** Si conviven instrucciones que se contradicen
—una que exige confirmación para todo y otra que autoriza bloquear solo—, el
modelo arbitra y no vas a saber cuál ganó.
