# El contexto de build es la RAÍZ del monorepo, no server/: Express sirve las
# vistas EJS y los estáticos desde ../web (ver index.js), así que la imagen
# necesita las dos carpetas. Se construye con:
#   docker build -f server/Dockerfile .
#
# Node 22 y no el 18 del sistema de la EC2: esa versión perdió soporte en abril
# de 2025. Contenerizar resuelve de paso esa deuda técnica.
FROM node:22-alpine AS deps

WORKDIR /app/server

# pnpm en todo el monorepo, nunca npm (ver CLAUDE.md). Corepack lo trae Node.
RUN corepack enable && corepack prepare pnpm@10.18.1 --activate

# Solo el manifiesto y el lockfile primero: mientras no cambien, Docker reutiliza
# la capa de dependencias y no vuelve a instalar en cada build.
COPY server/package.json server/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile


FROM node:22-alpine AS runtime

# tini como PID 1 para que las señales lleguen a Node: sin él, un
# `docker compose down` mata el contenedor a la brava en vez de dejar que el
# proceso cierre sus conexiones.
RUN apk add --no-cache tini

WORKDIR /app/server

# node_modules incluye node-pg-migrate, que es devDependency: el entrypoint lo
# necesita para aplicar las migraciones al arrancar. Es la única dependencia de
# desarrollo del proyecto, así que no se instala con --prod.
COPY --from=deps /app/server/node_modules ./node_modules
COPY server/ ./
# Ruta absoluta y no ../web: el destino se resuelve contra el WORKDIR y conviene
# no dejarlo a interpretación.
COPY web/ /app/web/

# Las migraciones corren antes de arrancar (ver docker-entrypoint.sh).
COPY server/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# La imagen de Node ya trae un usuario sin privilegios; se usa en vez de root.
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
EXPOSE 3000

# V8 dimensiona su heap según la memoria del HOST, no según el límite del
# contenedor, así que sin este tope el proceso crece hasta que el cgroup lo mata.
# Va por debajo del mem_limit del compose.
ENV NODE_OPTIONS="--max-old-space-size=256"

ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "index.js"]
