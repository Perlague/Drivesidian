# Desplegar el servidor

Todo el servidor —API, panel web y base de datos— vive en una sola instancia
EC2 y se levanta con Docker Compose.

**Hay dos caminos, y se eligen con una línea del `.env`.** Cambia solo cómo
llega el tráfico de internet al servidor; todo lo demás es idéntico.

| | (A) Túnel de ngrok | (B) Dominio propio + Caddy |
|---|---|---|
| Hace falta | Una cuenta gratis de ngrok | Un dominio y abrir el 80/443 |
| URL | La asigna ngrok, cambia en cada reinicio | Fija, la tuya |
| TLS | Lo pone ngrok | Let's Encrypt, automático |
| Para qué | Probar, demos, enseñar el proyecto | Lo definitivo |

Empieza por (A): levanta en dos minutos y no toca DNS ni el Security Group.
Pásate a (B) cuando tengas dominio.

## Requisitos comunes

- Una instancia con Docker y el plugin de Compose.
- Un repositorio de GitHub **privado** para las notas, y un Personal Access
  Token con permiso de escritura sobre él.

---

## (A) Levantar con ngrok

Pasos completos, desde cero:

```bash
# 1. Traer el código
git clone https://github.com/Perlague/Drivesidian.git
cd Drivesidian
cp .env.example .env

# 2. Generar los tres secretos y pegarlos en el .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # x3

# 3. En el .env, dejar esta línea (viene así por defecto):
#      COMPOSE_FILE=docker-compose.yml:docker-compose.ngrok.yml
#    y poner el authtoken de https://dashboard.ngrok.com/get-started/your-authtoken
#      NGROK_AUTHTOKEN=...

# 4. Arriba
docker compose up -d

# 5. El log dice a qué URL conectarse
docker compose logs server
```

El log termina con el enlace:

```
────────────────────────────────────────────────────────────────
  Drivesidian está arriba.

  Panel web:   https://lawless-trudy-unspurious.ngrok-free.dev
  Origen:      túnel de ngrok, detectado solo

  Para vincular un equipo, el agente necesita esta URL:
      DRIVESIDIAN_API_URL=https://lawless-trudy-unspurious.ngrok-free.dev
────────────────────────────────────────────────────────────────
```

Esa URL es el panel web. Ábrela en el navegador y ya puedes registrarte.

**Nadie copia la URL a mano.** El servidor le pregunta al agente de ngrok cuál
le tocó (`http://ngrok:4040/api/tunnels`) y la usa para armar los enlaces de
vinculación. Si ngrok se reinicia y cambia, el servidor lo detecta en menos de
un minuto y lo vuelve a escribir en el log.

### Lo que hay que saber de ngrok

- **La URL cambia en cada reinicio del túnel** (plan gratuito). Un agente ya
  vinculado sigue apuntando a la anterior y deja de conectar: hay que volver a
  vincularlo. Es la razón principal para pasarse a (B).
- **La primera visita desde un navegador muestra una página de aviso de ngrok**
  con un botón "Visit Site". Es del plan gratuito, sale una vez por visitante.
  A las llamadas del agente no les afecta.
- **No publiques el puerto 4040.** La API del agente de ngrok no pide
  autenticación y permite abrir túneles nuevos. Por eso solo es alcanzable
  desde la red interna de compose.

---

## (B) Levantar con dominio propio

Antes de nada, el dominio tiene que resolver **ya** a la IP de la instancia:
Let's Encrypt valida por el puerto 80 y falla si no llega.

```bash
git clone https://github.com/Perlague/Drivesidian.git
cd Drivesidian
cp .env.example .env
nano .env
docker compose up -d
```

En el `.env`, cambiar el camino y rellenar el dominio:

```
COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml
DOMAIN=drivesidian.tudominio.com
ACME_EMAIL=tu-correo@ejemplo.com
PUBLIC_URL=https://drivesidian.tudominio.com
```

Caddy saca y renueva el certificado solo. En local, `DOMAIN=localhost` usa su CA
interna y sirve por HTTPS sin pedirle nada a Let's Encrypt.

---

## En los dos casos

El contenedor del servidor aplica las migraciones antes de arrancar, así que no
hay ningún paso manual de base de datos.

```bash
docker compose ps          # todos deben estar "healthy"
docker compose logs -f     # seguir el arranque
```

> **Si estás en Windows**, el separador de `COMPOSE_FILE` es `;` en vez de `:`
> (porque `:` aparece en rutas como `C:\`). En la EC2, que es Linux, va `:`.

## Poner el agente en el equipo del usuario

El instalador lleva la URL del servidor dentro, así que se construye apuntando a
la que tocó:

```powershell
cd installer
.\build.ps1 -ApiUrl https://lawless-trudy-unspurious.ngrok-free.dev
```

Sale `dist\DrivesidianAgentSetup.exe`. El usuario lo ejecuta y el agente abre
solo la página de vinculación. El detalle está en `AGENTE.md`.

Para probar el agente sin construir el instalador, basta la variable de entorno:

```powershell
$env:DRIVESIDIAN_API_URL = "https://lawless-trudy-unspurious.ngrok-free.dev"
cd agent
pnpm start
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

### Actualizar `marked` y DOMPurify

El editor no las carga de un CDN: viven en `web/public/vendor/`, versionadas en
el repo. Eso es lo que permite que la CSP del `Caddyfile` no autorice ningún
origen externo — con un `<script src="https://…">` habría que abrirle la puerta
a cdnjs, y entonces quien controle ese origen controla el sanitizador.

No hay gestor de paquetes en `web/` (el proyecto no tiene build step a
propósito), así que se actualizan a mano:

```bash
# Ajusta las versiones y ejecútalo desde la raíz del repo.
curl -sSL --fail -o web/public/vendor/marked.min.js https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js
curl -sSL --fail -o web/public/vendor/purify.min.js https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js

# Comprueba que son lo que dicen ser antes de commitear: la primera línea de
# cada archivo lleva la versión y la licencia.
head -c 200 web/public/vendor/marked.min.js
head -c 200 web/public/vendor/purify.min.js
```

Versiones actuales y su hash SRI, para poder comparar con el origen:

| Archivo | Versión | `sha384` |
|---|---|---|
| `marked.min.js` | 12.0.2 | `/TQbtLCAerC3jgaim+N78RZSDYV7ryeoBCVqTuzRrFec2akfBkHS7ACQ3PQhvMVi` |
| `purify.min.js` | 3.1.6 | `+VfUPEb0PdtChMwmBcBmykRMDd+v6D/oFmB3rZM/puCMDYcIvF968OimRh4KQY9a` |

Se recalculan con
`openssl dgst -sha384 -binary <archivo> | openssl base64 -A`. `.gitattributes`
marca esa carpeta como binaria para que git no toque los finales de línea y el
hash del repo siga coincidiendo con el de cdnjs.

Tras actualizar, **abre el editor y comprueba que el preview sigue pintando**.
Falla cerrado: si `marked` o DOMPurify no cargan, no renderiza nada y avisa, en
vez de meter HTML sin limpiar.

### La CSP y lo que implica

La cabecera `Content-Security-Policy` del `Caddyfile` es estricta: sin
`'unsafe-inline'` y sin orígenes externos. Dos consecuencias prácticas:

- **Ninguna vista de `web/views/` puede llevar `<script>…</script>` ni
  `style="…"`.** Los datos que el servidor pasa a una página viajan como
  atributos `data-*` del `<body>` (ver `web/views/partials/head.ejs`) y el
  espaciado sale de las clases de utilidad de `app.css`. Un estilo en línea no
  da error: el navegador lo descarta en silencio, que es peor.
- **Una nota con una imagen remota no la muestra en el preview**
  (`img-src 'self' data:`). Es a propósito: una `<img>` a un servidor ajeno
  dentro de una nota avisaría a su dueño cada vez que alguien la abre. Los
  adjuntos están fuera del MVP de todas formas.

La CSP la sirve Caddy, así que `pnpm dev` a pelo **no la tiene**. Para probar
que una vista nueva la respeta, levanta el stack con `DOMAIN=localhost`.

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
