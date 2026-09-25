# Primer despliegue, paso a paso

Camino con ngrok, sin dominio propio. Solo pasos: haz esto, copia aquello, pégalo
allá. El porqué de cada cosa está en [DESPLIEGUE.md](DESPLIEGUE.md).

Ten a mano un bloc de notas para pegar 6 valores que vas a ir recogiendo.

---

## Parte 0 — En tu Windows, antes de nada

1. Abre una terminal en la carpeta del proyecto.
2. Commitea y sube lo que haya pendiente:

```powershell
git add -A
git commit -m "chore: script de secretos y guia de primer despliegue"
git push origin develop
```

---

## Parte 1 — GitHub: repositorio de notas

1. Entra a **https://github.com/new**
2. Campo **Repository name**: escribe `drivesidian-notas`
3. Marca el círculo **Private**
4. Botón **Create repository** (abajo)
5. **Apunta en tu bloc:**
   - `GITHUB_OWNER` = tu usuario de GitHub (`Perlague`)
   - `GITHUB_REPO` = `drivesidian-notas`

---

## Parte 2 — GitHub: token de acceso

1. Entra a **https://github.com/settings/tokens**
2. Botón **Generate new token** → opción **Generate new token (classic)**
3. Campo **Note**: escribe `drivesidian`
4. Desplegable **Expiration**: elige `No expiration`
5. En la lista de permisos, marca la casilla **`repo`** (la de arriba, se marcan
   solas las de abajo)
6. Baja hasta el final → botón **Generate token**
7. Aparece una línea verde que empieza con `ghp_`. Botón de copiar (📋)
8. **Apunta en tu bloc:** `GITHUB_TOKEN` = eso que copiaste

> Si sales de esa página sin copiarlo, no se puede volver a ver. Tendrías que
> generar otro.

---

## Parte 3 — ngrok: authtoken

1. Entra a **https://dashboard.ngrok.com/get-started/your-authtoken**
   (crea la cuenta gratis si te lo pide)
2. Botón **Copy** junto al token
3. **Apunta en tu bloc:** `NGROK_AUTHTOKEN` = eso

---

## Parte 4 — ngrok: dominio fijo

1. Entra a **https://dashboard.ngrok.com/domains**
2. Botón **+ Create Domain** (o **+ New Domain**)
3. Deja el nombre que te propone, o escribe uno libre
4. Botón **Create**
5. **Apunta en tu bloc:** `DOMINIO_NGROK` = lo que quedó, algo como
   `algo-algo-algo.ngrok-free.app` (sin `https://`)

---

## Parte 5 — AWS: entrar a la instancia

1. Entra a **https://console.aws.amazon.com**
2. Arriba a la derecha, junto a tu nombre, hay un selector de región. Elige
   **N. Virginia (us-east-1)**
3. En la barra de búsqueda de arriba escribe `EC2` y entra al primer resultado
4. Menú de la izquierda → **Instances**
5. Marca la casilla de **DrivesidianVM**
6. Botón **Connect** (arriba a la derecha de la tabla)
7. Pestaña **EC2 Instance Connect**
8. Botón **Connect** (abajo)

Se abre una terminal negra en el navegador. **Todo lo que sigue se escribe ahí**,
hasta que se diga lo contrario.

---

## Parte 6 — Preparar la máquina

Pega estas líneas una por una y espera a que cada una termine:

```bash
sudo apt update
```

```bash
sudo apt install -y git docker.io docker-compose-v2
```

```bash
sudo usermod -aG docker $USER
```

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
```

```bash
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

```bash
sudo systemctl disable --now drivesidian
```

```bash
sudo systemctl disable --now postgresql
```

> Si alguna de las dos últimas dice `Unit ... does not exist`, está bien. Sigue.

**Ahora cierra la pestaña del navegador y repite la Parte 5** (Connect otra vez).
Es necesario para que el permiso de Docker tome efecto.

De vuelta en la terminal, comprueba:

```bash
docker compose version
```

Tiene que responder con un número de versión. Si dice `permission denied`,
vuelve a cerrar y reconectar.

---

## Parte 7 — Traer el código

```bash
git clone -b develop https://github.com/Perlague/Drivesidian.git
```

Te va a pedir:
- **Username**: tu usuario de GitHub
- **Password**: pega el `GITHUB_TOKEN` de tu bloc (no tu contraseña de GitHub)

```bash
cd Drivesidian
```

---

## Parte 8 — Crear el archivo de configuración

```bash
./scripts/init-env.sh
```

Te va a decir que faltan 4 variables. Ábrelo:

```bash
nano .env
```

Muévete con las flechas y rellena estas cuatro líneas con lo de tu bloc,
**sin espacios alrededor del `=`**:

```
NGROK_AUTHTOKEN=lo_que_copiaste_de_ngrok
GITHUB_TOKEN=ghp_lo_que_copiaste_de_github
GITHUB_OWNER=Perlague
GITHUB_REPO=drivesidian-notas
```

Para guardar y salir de nano:
- **Ctrl + O**, luego **Enter** (guarda)
- **Ctrl + X** (sale)

Comprueba:

```bash
./scripts/init-env.sh
```

Tiene que decir **`.env completo`**. Si no, vuelve a `nano .env`.

---

## Parte 9 — Poner tu dominio de ngrok

```bash
nano ngrok.yml
```

Al final del archivo, debajo de la línea `addr: server:3000`, añade una línea
nueva **con 4 espacios de sangría al inicio**:

```
    domain: algo-algo-algo.ngrok-free.app
```

Queda así:

```yaml
tunnels:
  drivesidian:
    proto: http
    addr: server:3000
    domain: algo-algo-algo.ngrok-free.app
```

Guarda: **Ctrl + O**, **Enter**, **Ctrl + X**

---

## Parte 10 — Levantar

```bash
docker compose up -d
```

Tarda varios minutos la primera vez (está construyendo la imagen). Cuando
termine:

```bash
docker compose ps
```

Las tres líneas tienen que decir **`healthy`** o **`running`**. Luego:

```bash
docker compose logs server
```

Al final del texto sale tu enlace:

```
────────────────────────────────────────────────────────────────
  Drivesidian está arriba.

  Panel web:   https://algo-algo-algo.ngrok-free.app
  Origen:      túnel de ngrok, detectado solo

  Para vincular un equipo, el agente necesita esta URL:
      DRIVESIDIAN_API_URL=https://algo-algo-algo.ngrok-free.app
────────────────────────────────────────────────────────────────
```

**Apunta en tu bloc:** `URL_PANEL` = ese enlace.

---

## Parte 11 — Crear tu cuenta

1. Abre `URL_PANEL` en tu navegador
2. Sale una página gris de ngrok con un botón **Visit Site**. Clic
3. Ya en Drivesidian: enlace **Crear cuenta**
4. Rellena **correo** y **contraseña** → botón **Crear cuenta**
5. Te lleva al login: mismos datos → **Entrar**
6. Te manda a activar el segundo factor. Abre **Google Authenticator** en tu
   celular → botón **+** → **Escanear código QR** → apunta a la pantalla
7. Escribe en la web los **6 dígitos** que muestra la app → **Confirmar**

---

## Parte 12 — Instalar el agente en tu computadora

Vuelve a **tu Windows**, terminal en la carpeta del proyecto:

```powershell
cd installer
.\build.ps1 -ApiUrl https://algo-algo-algo.ngrok-free.app
```

(usa tu `URL_PANEL` en vez de ese ejemplo)

Cuando termine, ejecuta el archivo que dejó en `installer\dist\DrivesidianAgentSetup.exe`:

1. Windows muestra **"Windows protegió tu PC"** → enlace **Más información** →
   botón **Ejecutar de todas formas**
2. Siguiente hasta terminar
3. Se abre el navegador solo en la página de vinculación
4. Botón **Vincular este equipo**

---

## Parte 13 — Comprobar que funciona

1. Abre tu vault de Obsidian
2. Dentro hay una carpeta nueva **`Drivesidian`**. Crea ahí una nota cualquiera
3. Guarda
4. En la web, sección **Notas**: tiene que aparecer, con estado `pending`
5. Ve a **Configuración** → botón **Sincronizar ahora**
6. Entra a tu repositorio `drivesidian-notas` en GitHub: la nota está ahí, en una
   carpeta `user-1-...`

Listo.

---

## Si algo falla

| Síntoma | Qué hacer |
|---|---|
| `permission denied` al usar docker | Cierra la pestaña de AWS y reconecta (Parte 5) |
| `docker compose ps` muestra `unhealthy` o `restarting` | `docker compose logs server` y lee las últimas líneas |
| El log dice `localhost` en vez de tu dominio | `docker compose restart server`, espera 1 minuto, vuelve a mirar el log |
| `falta X en el .env` al levantar | `nano .env`, rellena esa variable, `docker compose up -d` |
| El agente no conecta | Comprueba que la URL del instalador es igual a `URL_PANEL` |
| Se cortó la terminal de AWS | No pasa nada, reconecta y sigue. Los contenedores siguen corriendo |

Para apagar todo sin borrar datos:

```bash
cd ~/Drivesidian && docker compose down
```

Para volver a levantarlo:

```bash
cd ~/Drivesidian && docker compose up -d
```
