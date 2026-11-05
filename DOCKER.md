# Docker - VIPE POS System

Tres archivos de compose, uno por entorno:

| Archivo | Entorno | Servicios |
|---|---|---|
| `docker-compose.yml` | Desarrollo local | `db`, `minio`, `minio-init`, `app` (opcional) |
| `docker-compose.prod.yml` | Producción en una VPS con Docker | `postgres`, `migrate`, `api`, `web`, `caddy`; `minio` y `minio-init` con perfil |
| `docker-compose.coolify.yml` | Producción en Coolify | `postgres`, `migrate`, `api`, `web` |

La guía completa de producción está en [docs/despliegue.md](docs/despliegue.md).

## Desarrollo local (`docker-compose.yml`)

### Requisitos

- Docker y el plugin Docker Compose v2.
- Node 24 y pnpm para la API y la web fuera de contenedores.

### Base de datos (`db`)

Postgres 16 con pgTAP y `pg_prove`, construido desde `packages/db/docker/Dockerfile`. Al
crear el volumen, el init crea los roles `vipe_migrator` (dueño del esquema) y `vipe_api`
(rol de la API, sin `BYPASSRLS`). Puerto `VIPE_DB_PORT` (por defecto 5432).

```bash
pnpm db:dev      # levanta db, aplica las migraciones como vipe_migrator y carga packages/db/seed/dev.sql
pnpm test:db     # pruebas pgTAP sobre la base desechable vipe_pos_test
```

Las contraseñas de desarrollo (`postgres`, `vipe_migrator`, `vipe_api`) son valores por
defecto del compose de desarrollo; nunca se usan en producción.

### Almacenamiento (`minio`, `minio-init`)

Opcional. MinIO para las imágenes de platos (API S3 en `:9000`, consola en `:9001`);
`minio-init` crea el bucket público `vipe-dev`. Son compilaciones de Chainguard fijadas por
digest, porque MinIO ya no publica imágenes comunitarias.

```bash
docker compose up -d minio minio-init
```

`apps/api/env.example` ya trae las variables `S3_*` para este MinIO. Sin él, la API arranca
igual y `/api/storage/*` responde 503.

### API y web

Corren fuera de compose:

```bash
cp apps/api/env.example apps/api/.env
pnpm api:dev     # API NestJS en http://localhost:4000
pnpm dev         # web en http://localhost:3000; reenvía /api y /socket.io/ a API_PROXY_TARGET
```

`API_PROXY_TARGET` (por defecto `http://localhost:4000`) es una variable del servidor de
Next, no `NEXT_PUBLIC_*`.

### Web en contenedor (`app`, opcional)

Construye la imagen de producción de la web (`Dockerfile`) y la publica en
`http://localhost:3003` (portal en `/portal`). Next fija las reescrituras `/api` y
`/socket.io` al construir la imagen con el build arg `API_PROXY_TARGET`, que por defecto es
la API del host (`http://host.docker.internal:4000`).

```bash
docker compose up -d --build app
docker compose logs -f app
docker compose down

# atajos (binario docker-compose)
pnpm docker:dev:build
pnpm docker:dev:down
```

Para recarga en caliente usar `pnpm dev`.

| Servicio | URL |
|---|---|
| Web en contenedor | http://localhost:3003 |
| Web con `pnpm dev` | http://localhost:3000 |
| API | http://localhost:4000 (OpenAPI en `/api/docs`) |
| MinIO (S3 / consola) | http://localhost:9000 / http://localhost:9001 |

## Producción en una VPS (`docker-compose.prod.yml`)

```
postgres -> migrate (una sola vez) -> api, web <- caddy (HTTPS, :80/:443)
```

| Servicio | Imagen | Función |
|---|---|---|
| `postgres` | `postgres:16-alpine` (digest fijo) | Base de datos; `deploy/postgres/10-roles.sh` crea los roles con el volumen vacío. |
| `migrate` | `apps/api/Dockerfile`, target `migrate` | Aplica `packages/db/migrations` como `vipe_migrator` y termina. |
| `api` | `apps/api/Dockerfile`, target `api` | NestJS en `:4000` interno, como `vipe_api`. |
| `web` | `Dockerfile` | Next.js standalone en `:3000` interno, sin variables. |
| `caddy` | `caddy:2.10-alpine` (digest fijo) | HTTPS automático para `SITE_DOMAIN`; `/api/*` y `/socket.io/*` a la API, el resto a la web (`deploy/Caddyfile`). |
| `minio`, `minio-init` | Chainguard (perfil `self-hosted-storage`) | Almacenamiento en la misma VPS en lugar de R2. |

```bash
cp env.production.template .env      # completar cada valor
docker compose -f docker-compose.prod.yml config --quiet
docker compose -f docker-compose.prod.yml up -d --build --wait
docker compose -f docker-compose.prod.yml logs -f api
```

Cada secreto es obligatorio (`${VAR:?}`): el stack no arranca con contraseñas por defecto.

**Perfil `self-hosted-storage` y `STORAGE_SITE`.** Con el perfil arrancan `minio` y
`minio-init`. `STORAGE_SITE` elige qué archivo importa Caddy: `off` (por defecto,
`deploy/caddy/storage-off.caddy`, vacío) o `on` (`deploy/caddy/storage-on.caddy`, publica
MinIO en `STORAGE_DOMAIN`, que pasa a ser obligatorio).

```bash
docker compose -f docker-compose.prod.yml --profile self-hosted-storage up -d --build --wait
```

## Producción en Coolify (`docker-compose.coolify.yml`)

Sin `caddy` (el proxy de Coolify maneja 80/443), sin `minio` (Coolify no aplica perfiles;
las imágenes van a R2) y sin puertos publicados. `postgres` se construye desde
`deploy/postgres/Dockerfile`, que incluye `10-roles.sh` y `roles.sql` en la imagen, porque
Coolify no coloca los archivos del repositorio junto al compose. Recurso Docker Compose con
**Docker Compose Location** `/docker-compose.coolify.yml`, dominios `api` →
`https://<sitio>:4000/api,https://<sitio>:4000/socket.io` y `web` → `https://<sitio>:3000`,
**Strip prefixes** desactivado. Staging responde solo a los clientes de la red de Tailscale
(desde la IP pública, el proxy devuelve 403). Detalle y comprobaciones en
[docs/despliegue.md](docs/despliegue.md#3-opción-b-coolify-con-docker-composecoolifyyml).

Validación local (Docker Compose rechaza la clave `exclude_from_hc` de Coolify, y cada variable
obligatoria es `${VAR:?}`, así que hace falta un archivo con valores de prueba):

```bash
check_env=$(mktemp)
printf '%s\n' POSTGRES_PASSWORD=prueba VIPE_MIGRATOR_PASSWORD=prueba VIPE_API_PASSWORD=prueba \
  JWT_SECRET=prueba-de-validacion-de-32-caracteres WEB_ORIGIN=https://pos.example.com \
  S3_ENDPOINT=https://s3.example.com S3_REGION=us-east-1 S3_BUCKET=vipe-pos-staging S3_ACCESS_KEY_ID=prueba \
  S3_SECRET_ACCESS_KEY=prueba S3_PUBLIC_BASE_URL=https://s3.example.com/vipe-pos-staging S3_FORCE_PATH_STYLE=true > "$check_env"
sed '/exclude_from_hc/d' docker-compose.coolify.yml | docker compose -f - --env-file "$check_env" config --quiet
rm -f "$check_env"
```

Antes de fusionar en `dev` o `main`, seguir el orden de [docs/despliegue.md, sección 3.3](docs/despliegue.md#33-despliegue-desde-ci):
CI despliega en los recursos de Coolify configurados en `COOLIFY_APP_UUID_STAGING` y `COOLIFY_APP_UUID_PRODUCTION`.

## Estructura de archivos

```
├── docker-compose.yml           # Desarrollo: db, minio, minio-init, app
├── docker-compose.prod.yml      # VPS: postgres, migrate, api, web, caddy (+ minio con perfil)
├── docker-compose.coolify.yml   # Coolify: postgres, migrate, api, web
├── Dockerfile                   # Imagen de la web (Next.js standalone)
├── apps/api/Dockerfile          # Imágenes de la API (target api) y de migrate (target migrate)
├── env.production.template      # Variables de producción
├── deploy/
│   ├── Caddyfile                # Proxy inverso y cabeceras de seguridad
│   ├── caddy/                   # storage-on.caddy / storage-off.caddy (STORAGE_SITE)
│   └── postgres/
│       ├── 10-roles.sh          # Init de roles de producción
│       └── Dockerfile           # Postgres de Coolify con 10-roles.sh y roles.sql incluidos
└── packages/db/
    ├── docker/Dockerfile        # Postgres 16 + pgTAP de desarrollo y pruebas
    ├── migrations/              # Migraciones SQL (fuente de verdad del esquema)
    ├── scripts/roles.sql        # Roles vipe_migrator y vipe_api
    ├── seed/dev.sql             # Datos de desarrollo (pnpm db:dev)
    ├── seed/bootstrap/          # Primer restaurante y administrador (pnpm db:create-restaurant)
    ├── seed/demo/               # Demo de staging (pnpm db:demo)
    ├── seed/test.sh             # Contrato de ambos scripts (pnpm db:test-seeds)
    └── tests/                   # Pruebas pgTAP (pnpm test:db)
```
