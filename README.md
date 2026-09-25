# Drivesidian

Sincroniza automáticamente las notas de una carpeta de tu vault de Obsidian
hacia un repositorio de GitHub, con autenticación de dos factores propia y
notificación al celular cuando la sincronización termina.

Proyecto de Ingeniería de Software — Tecmilenio.

## Cómo funciona

```
  Tu computadora                     Servidor (EC2)                GitHub
  ┌──────────────┐                   ┌──────────────┐             ┌────────┐
  │   Obsidian   │                   │              │             │        │
  │      ↓       │   PUT /api/       │   Express    │  un commit  │  Repo  │
  │  Drivesidian/│ ────notes/sync──► │      +       │ ──por lote► │ privado│
  │      ↑       │                   │   Postgres   │             │        │
  │   Agente     │ ◄───vinculación── │      +       │             └────────┘
  └──────────────┘                   │    Caddy     │                       
                                     └──────┬───────┘             ┌────────┐
                                            └───────notificación─►│ ntfy   │
                                                                  └────────┘
```

Tres piezas, cada una en su carpeta:

| Carpeta | Qué es |
|---|---|
| **`agent/`** | Proceso local que vigila tu vault. Corre en tu máquina, nunca en la nube. No tiene acceso a GitHub. |
| **`server/`** | API en Express sobre Postgres. Es el único componente con credenciales de GitHub. |
| **`web/`** | Panel y editor de notas, en EJS y JavaScript plano, servido por el mismo Express. |
| **`installer/`** | Instalador de Windows (WiX Burn) que empaqueta el agente con Node.js. |

## Manuales

- **[Desplegar el servidor](docs/DESPLIEGUE.md)** — EC2, Docker Compose, variables de entorno, respaldos.
- **[Instalar el agente](docs/AGENTE.md)** — para quien solo quiere sincronizar sus notas.
- **[Eventos de seguridad](docs/SEGURIDAD.md)** — el feed que consume Guardian, el proyecto hermano de Ciberseguridad.
- **[Construir el instalador](installer/README.md)** — para generar el `.exe` de distribución.

## Decisiones que explican el diseño

- **El agente nunca toca git.** Centralizar las credenciales de GitHub en el
  servidor es la única forma segura de escalar sin repartir tokens de escritura
  a cada máquina.
- **Commits por lote, no por guardado.** Evita saturar el historial y los
  límites de la API de GitHub. La cola vive en Postgres, así que sobrevive a un
  reinicio del servidor.
- **2FA implementado desde cero** (TOTP, RFC 6238) con el módulo `crypto` de
  Node. Es una decisión de aprendizaje: sustituirlo por una librería haría
  perder el objetivo del proyecto.
- **Nada de copiar tokens a mano.** El agente pide un código, abre el navegador
  y recoge su acceso cuando lo apruebas. El usuario final no es programador.
- **Conflictos los resuelve un humano.** Si editas la misma nota desde Obsidian
  y desde la web, el servidor detecta el choque y te muestra ambas versiones en
  lugar de intentar fusionarlas: concatenar dos ediciones de prosa no produce
  texto coherente.

## Limitaciones conocidas

- **La edición desde la web no baja a tu vault local.** El flujo es en un solo
  sentido: disco → servidor → GitHub. Si editas una nota en el panel, el
  archivo de tu computadora sigue como estaba, y la próxima vez que lo toques en
  Obsidian el agente lo volverá a subir pisando lo que escribiste en la web.
- **No hay borrado de notas.** Si borras un archivo en Obsidian, el registro en
  Postgres y el archivo en GitHub se quedan.
- **El repositorio de GitHub es compartido.** Todos los usuarios escriben en el
  mismo repo, cada uno en su carpeta. Es privado, así que solo quien lo opera
  puede leerlo.
- **Solo Windows.** El instalador del agente no existe para Linux ni macOS,
  aunque el código del agente corre en los tres.

## Tecnologías

Node.js · Express · PostgreSQL · EJS · Docker Compose · Caddy · WiX Burn ·
`chokidar` · `zod` · `pg`

Sin ORM, sin framework de frontend y sin librerías de JWT, TOTP ni git: todo eso
está escrito a mano con el módulo `crypto` nativo.

## Licencia

Ver [LICENSE](LICENSE).
