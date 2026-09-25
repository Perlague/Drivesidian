# Eventos de seguridad

Drivesidian emite un feed de eventos que consume **Guardian**, el agente de IA
del proyecto hermano de Ciberseguridad que corre con OpenClaw en la misma
instancia.

## El reparto: la app emite, Guardian ejecuta

La aplicación **solo aplica** lo que necesita contexto de aplicación: el bloqueo
de cuenta por intentos fallidos de 2FA y los límites por token. Todo lo que es
de red —cortar una IP, bloquear un rango— es de Guardian vía `ufw`.

**La app nunca toca el firewall.** Un bug en Express no debe poder dejar a nadie
fuera del servidor.

## Cómo leerlo

Cada evento se escribe a dos destinos.

**En vivo, por stdout** — una línea de JSON por evento, que Docker recoge:

```bash
docker compose logs -f server | grep drivesidian.security
```

El campo `log` es el marcador para filtrar sin romper el parseo: la línea
completa sigue siendo JSON válido.

```json
{"log":"drivesidian.security","occurred_at":"2026-09-25T00:38:17.023Z",
 "type":"token.used_after_revoke","severity":"critical","user_id":"10",
 "ip":"203.0.113.55","user_agent":"node",
 "details":{"path":"/api/notes/sync","method":"PUT"}}
```

**Histórico, en Postgres** — la tabla `security_events`, consultable con
`GET /api/admin/security-events` (requiere rol `admin`) y filtros por `type`,
`severity`, `since`, `until`, `limit` y `offset`.

Se podan a los 90 días (`SECURITY_EVENT_RETENTION_DAYS`).

## Campos

| Campo | Notas |
|---|---|
| `occurred_at` | ISO 8601 en UTC. |
| `type` | Del catálogo cerrado de abajo. |
| `severity` | `info`, `warn` o `critical`. |
| `user_id` | **Puede ser `null`**: un login con un correo inexistente no tiene a quién atribuirse, y es justo uno de los eventos que más importan. |
| `ip` | La IP real del cliente. Ver el aviso sobre `TRUST_PROXY`. |
| `user_agent` | Tal como lo mandó el cliente. |
| `details` | Objeto variable según el tipo. |

## Catálogo

### Autenticación

| Tipo | Severidad | Cuándo |
|---|---|---|
| `auth.register` | info | Cuenta creada. |
| `auth.login.success` | info | Sesión iniciada. `details.twofa` dice si la cuenta tiene segundo factor. |
| `auth.login.failed_password` | warn | `details.reason` distingue `unknown_email` de `bad_password`. |
| `auth.login.failed_totp` | warn | Código de 2FA incorrecto. `details.failed_attempts` lleva la cuenta. |
| `auth.lockout` | **critical** | Cuenta bloqueada 15 minutos al quinto fallo seguido. |
| `auth.login.blocked` | warn | Intento de entrar a una cuenta bloqueada. |
| `auth.logout` | info | Sesión cerrada. |
| `2fa.enrolled` | info | Segundo factor activado. |

### Accesos de agente

| Tipo | Severidad | Cuándo |
|---|---|---|
| `token.created` | info | `details.source` dice si vino del panel o de una vinculación. |
| `token.revoked` | info | Revocado desde el panel o por el desinstalador. |
| `token.used_after_revoke` | **critical** | Un token con firma válida pero ya revocado. O un agente que quedó corriendo, o un token filtrado. |

### Vinculación

| Tipo | Severidad | Cuándo |
|---|---|---|
| `pairing.requested` | info | Un equipo pidió un código. |
| `pairing.approved` | info | Un humano lo aprobó desde el navegador. |
| `pairing.consumed` | info | El agente recogió su acceso. |
| `pairing.rejected` | **critical** | Intento de canje con el verifier equivocado: alguien vio el código pero no tiene el secreto del agente. |
| `pairing.expired` | info | Se intentó usar un código caducado. |

### Autorización

| Tipo | Severidad | Cuándo |
|---|---|---|
| `authz.denied` | warn | Una sesión sin el rol necesario intentó llegar a algo de admin. `details.surface` distingue `api` (403) de `page` (redirección), y `required_role`/`actual_role` dicen qué faltaba. |

No consigue nada —el middleware corta antes del controller— pero es de las
señales más limpias del feed: una cuenta normal no toca `/api/admin` sin querer.
**Una línea por media hora y por cuenta**, no una por rechazo.

### Límites

| Tipo | Severidad | Cuándo |
|---|---|---|
| `ratelimit.exceeded` | warn | Ver la nota de abajo sobre el volumen. |
| `quota.exceeded` | warn | Un usuario alcanzó su tope de 2000 notas. |
| `notes.bulk_read` | warn | Alguien pidió más de 100 notas de golpe con un agent token. Un agente al día pide unas pocas; esto es el patrón de quien se lleva todo. Una línea por hora y por token. |

## Dos cosas que conviene no romper

**El rate limiting emite un evento por ventana, no por petición rechazada.**
Guardian lee este feed y cada línea le cuesta tokens. Una ráfaga de 10.000
peticiones produce **una** línea con el conteo dentro:

```json
{"hits":301,"max":300,"window_ms":3600000,"path":"/api/users/login"}
```

Si el abuso se sostiene, se vuelve a avisar como máximo una vez por ventana y
por clave. Cambiarlo a un evento por rechazo inundaría el contexto de Guardian
sin darle más información.

**El tipo dice lo que pasó, no lo que se intentaba.** `pairing.rejected` existe
como tipo propio y no como un `pairing.consumed` con un flag en `details`,
porque un feed que dice "canjeado" cuando en realidad se rechazó un canje es
peor que no tener el evento.

El mismo criterio aplica a cualquier tipo nuevo: antes de agregarlo, preguntarse
si Guardian puede actuar con él y si su volumen está acotado. Por eso **no
existe** un evento para los cuerpos de petición rechazados por tamaño: una nota
grande casi siempre es un usuario legítimo, y el caso de abuso real ya lo cubre
el limitador con una sola línea.

## Aviso sobre las IPs

Detrás de Caddy, `req.ip` solo es la IP real del cliente si Express confía en la
cabecera `X-Forwarded-For`. Eso se activa con **`TRUST_PROXY=1`**, que el
`docker-compose.yml` ya pone.

Sin esa variable, **todos** los eventos llegan con la IP del contenedor de
Caddy, que es exactamente el dato que Guardian necesita y no tendría. Verificado:
con ella, `req.ip` devuelve el `X-Forwarded-For`; sin ella, la del proxy.

Al revés también importa: activarla **sin** un proxy delante permite que
cualquier cliente falsifique su IP con una cabecera. Por eso está apagada por
defecto y solo se enciende en el despliegue con Docker.

## Probarlo sin esperar a que pase algo

Hay un banco de pruebas local que levanta el servidor, ejecuta nueve escenarios
de abuso y muestra el feed resultante:

```bash
cd test
pnpm start
```

Produce 19 eventos, de los cuales 2 son `critical`, y borra sus datos al
terminar. No está en el repositorio — ver `test/README.md` en tu copia local.

## Pendiente de acordar

**Qué acción toma Guardian ante cada tipo.** El feed está definido y funcionando,
pero la política de respuesta —cuándo cortar una IP, cuándo solo anotar— es una
conversación con el otro proyecto que todavía no ha ocurrido.
