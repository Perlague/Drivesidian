# Desplegar el servidor

Todo el servidor —API, panel web, base de datos y TLS— vive en una sola
instancia EC2 y se levanta con Docker Compose.

## Requisitos

- Una instancia con Docker y el plugin de Compose.
- Un dominio apuntando a la IP pública de la instancia. Let's Encrypt lo valida
  por HTTP, así que tiene que resolver **antes** de levantar el stack.
- Un repositorio de GitHub **privado** para las notas, y un Personal Access
  Token con permiso de escritura sobre él.

## Puesta en marcha

```bash
git clone https://github.com/Perlague/Drivesidian.git
cd Drivesidian
cp .env.example .env
nano .env          # ver la tabla de abajo
docker compose up -d
```

Eso es todo. El contenedor del servidor aplica las migraciones antes de
arrancar, y Caddy saca el certificado solo.

```bash
docker compose ps          # los tres deben estar "healthy"
docker compose logs -f     # seguir el arranque
```

## Variables de entorno

Los tres secretos se generan igual:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Variable | Qué es |
|---|---|
| `DOMAIN` | Dominio público. En local: `localhost` (Caddy usa su CA interna). |
| `ACME_EMAIL` | Correo al que Let's Encrypt avisa si un certificado va a caducar. |
| `POSTGRES_PASSWORD` | Contraseña de la base. No se expone fuera de la red de Compose. |
| `JWT_SECRET` | Firma las sesiones web y los accesos de los agentes. |
| `TOTP_ENCRYPTION_KEY` | Cifra los secretos de 2FA en reposo. |
| `NTFY_SECRET` | Deriva el canal de notificaciones de cada usuario. |
| `GITHUB_TOKEN` · `GITHUB_OWNER` · `GITHUB_REPO` | Dónde y con qué credencial se suben las notas. |
| `GITHUB_BRANCH` | Rama destino. Por defecto `main`. |
| `SYNC_INTERVAL_MS` | Cada cuánto corre el worker. Por defecto 5 minutos. |
| `SECURITY_EVENT_RETENTION_DAYS` | Días que se conservan los eventos. Por defecto 90. |

**Cuidado con dos de ellas.** Si pierdes `TOTP_ENCRYPTION_KEY`, nadie puede
volver a validar un código de 2FA y todas las cuentas tienen que reenrolarse.
Si cambias `NTFY_SECRET`, el canal de notificaciones de **todos** los usuarios
cambia y tienen que volver a suscribirse desde el panel.

## Security Group

| Puerto | Origen | Para qué |
|---|---|---|
| 443 | `0.0.0.0/0` | HTTPS. |
| 80 | `0.0.0.0/0` | Validación y renovación del certificado. **No quitarlo** o el certificado deja de renovarse. |
| 22 | Tu IP **+** la prefix list `com.amazonaws.us-east-1.ec2-instance-connect` | SSH. |
| 5432 | — | **No se expone.** Postgres solo existe dentro de la red de Compose. |

La segunda regla del puerto 22 no es opcional: el botón "Connect" del navegador
de EC2 no origina la conexión desde tu IP, sino desde ese rango fijo de AWS.

## Migrar desde el despliegue con systemd

La instancia corrió antes con `drivesidian.service` y un Postgres instalado en
el host. Para pasar a Docker:

```bash
# 1. Respaldar la base del host, si tiene datos que te importen
sudo -u postgres pg_dump drivesidian > ~/respaldo.sql

# 2. Apagar el servicio viejo para que no compita por el puerto
sudo systemctl stop drivesidian
sudo systemctl disable drivesidian

# 3. Liberar el 5432 del host: el contenedor no lo publica, pero un Postgres
#    del sistema escuchando ahí solo consume RAM que hace falta
sudo systemctl stop postgresql
sudo systemctl disable postgresql

# 4. Levantar el stack
docker compose up -d

# 5. Restaurar, si hiciste respaldo
cat ~/respaldo.sql | docker compose exec -T postgres psql -U drivesidian drivesidian
```

El paso 3 importa más de lo que parece: la instancia es una `t3.small` de 2 GB
compartida con OpenClaw, y dos Postgres a la vez no caben cómodos.

## Operación

```bash
docker compose logs -f server        # incluye el feed de seguridad
docker compose restart server        # reiniciar solo la API
docker compose pull && docker compose up -d   # actualizar imágenes base
git pull && docker compose up -d --build      # desplegar código nuevo
```

Las migraciones se aplican solas en cada arranque. `node-pg-migrate` lleva su
propio registro, así que correrlas de más es inofensivo.

### Respaldos

```bash
docker compose exec -T postgres pg_dump -U drivesidian drivesidian \
  | gzip > respaldo-$(date +%F).sql.gz
```

Vale la pena automatizarlo: GitHub tiene el contenido de las notas, pero **no**
las cuentas, los secretos de 2FA ni los accesos de los agentes.

## Consumo esperado

Medido en reposo con el stack completo levantado:

| Servicio | Uso | Límite configurado |
|---|---|---|
| postgres | 56 MB | 512 MB |
| server | 38 MB | 384 MB |
| caddy | 15 MB | 128 MB |

Los límites son holgura deliberada. Ajústalos con `docker stats` y `free -h`
sobre la instancia real si hace falta apretar.

## Si algo falla

**Caddy no saca el certificado.** El dominio tiene que resolver a la IP de la
instancia y el puerto 80 tiene que estar abierto. Revisa con
`docker compose logs caddy`.

**El servidor reinicia en bucle.** Casi siempre es una variable de entorno
faltante: Compose falla con un mensaje explícito diciendo cuál. Si no,
`docker compose logs server`.

**Un agente no sincroniza.** Mira si su acceso sigue activo en el panel. Un
`401` hace que el agente se detenga y olvide su token; basta con reiniciarlo en
esa máquina para que se vuelva a vincular.

## Desarrollo local sin Docker

```bash
cd server
cp .env.example .env    # este .env es solo para desarrollo
pnpm install
pnpm migrate:up
pnpm seed               # crea una cuenta de administrador
pnpm dev
```

Siempre `pnpm`, nunca `npm` ni `yarn`.
