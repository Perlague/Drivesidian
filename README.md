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

- **[Primer despliegue paso a paso](docs/PRIMER-DESPLIEGUE.md)** — guía literal para levantarlo la primera vez con ngrok, sin dominio.
- **[Desplegar el servidor](docs/DESPLIEGUE.md)** — EC2, Docker Compose, variables de entorno, respaldos.
- **[Instalar el agente](docs/AGENTE.md)** — para quien solo quiere sincronizar sus notas.
- **[Guardian](docs/GUARDIAN.md)** — el agente de IA que defiende la instancia: riesgos, capas, severidades y límites.
- **[Desplegar Guardian](docs/GUARDIAN-DESPLIEGUE.md)** — script de instalación de Suricata y CrowdSec, paso a paso.
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
  texto coherente. El agente nunca decide por su cuenta — corre en segundo plano
  sin nadie mirando, así que cualquier regla automática descartaría el trabajo
  de alguien sin avisarle.
- **El servidor no empuja, el agente pregunta.** Tu computadora está detrás de
  un NAT, sin IP pública. Eso tiene una ventaja: si está apagada no se acumula
  nada, porque el agente simplemente no está preguntando. Al encenderla, una
  consulta se trae todo lo que se perdió.

## Limitaciones conocidas

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
