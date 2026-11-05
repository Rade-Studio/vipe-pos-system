# Guía de despliegue en una VPS

VIPE POS en producción son cuatro piezas en una sola VPS: Postgres 16, la API NestJS
(`apps/api`), la web Next.js (raíz del repositorio) y un proxy inverso con HTTPS. Las
imágenes de platos van a un almacenamiento compatible con S3 (Cloudflare R2 por defecto, o
MinIO en la misma VPS). Las estaciones de impresión (`pos/`) se conectan desde los equipos
del restaurante.

Hay dos formas de desplegar, con un archivo de compose para cada una:

| Opción | Archivo | Proxy y HTTPS | Cuándo usarla |
|---|---|---|---|
| A. VPS con Docker | `docker-compose.prod.yml` | Caddy incluido (`deploy/Caddyfile`) | Servidor propio sin panel. |
| B. Coolify | `docker-compose.coolify.yml` | Traefik de Coolify | El servidor ya usa Coolify (lo que hace hoy el job `deploy` de CI). |

Para pasar los datos desde el sistema anterior, seguir después [runbook-cutover.md](runbook-cutover.md).

```
navegador ──HTTPS──► proxy (Caddy o Traefik)
                       ├── /api/*, /socket.io/*  ──► api:4000 ──► postgres:5432
                       │                                  └──────► S3 (R2 o MinIO)
                       └── todo lo demás         ──► web:3000
estaciones de impresión ──HTTPS/WSS──► /socket.io/ y /api/print/*
```

## 1. Requisitos

- **VPS** Linux x86_64 con Docker Engine y el plugin Docker Compose v2 (`docker compose`).
  Tamaño orientativo: 2 vCPU, 4 GB de RAM y 40 GB de disco. Es una estimación, no una
  medición: las imágenes pesan unos 402 MB (api) y 324 MB (web), y la construcción de la
  web en la propia VPS es el paso que más memoria usa. Medir en staging antes de reducirla.
- **Dominio** propio para el POS (por ejemplo `pos.mirestaurante.com`) con un registro DNS
  `A` (y `AAAA` si la VPS tiene IPv6) apuntando a la VPS. Con MinIO propio publicado por
  Caddy hace falta un segundo nombre (`STORAGE_DOMAIN`) apuntando a la misma VPS.
- **Puertos** 80 y 443 abiertos hacia la VPS (443 también en UDP para HTTP/3 con Caddy).
- Copia del repositorio en la VPS (opción A) o conectada a Coolify (opción B), en la rama que
  se despliega.

Web y API comparten el mismo dominio: las cookies de sesión son del mismo origen y la web no
tiene ninguna URL de API en el build.

## 2. Opción A: VPS con `docker-compose.prod.yml` y Caddy

Servicios: `postgres` (con el script de roles `deploy/postgres/10-roles.sh`), `migrate`
(una sola ejecución como `vipe_migrator`), `api` (como `vipe_api`), `web`, `caddy` (puertos
80/443, HTTPS automático para `SITE_DOMAIN`) y, solo con el perfil `self-hosted-storage`,
`minio` y `minio-init`. Postgres, la API y la web no publican puertos en el host.

### 2.1 Archivo de entorno

```bash
cp env.production.template .env
chmod 600 .env
# generar cada secreto (POSTGRES_PASSWORD, VIPE_MIGRATOR_PASSWORD, VIPE_API_PASSWORD, JWT_SECRET):
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`env.production.template` describe cada variable. Obligatorias (el stack no arranca sin
ellas): `SITE_DOMAIN`, `POSTGRES_PASSWORD`, `VIPE_MIGRATOR_PASSWORD`, `VIPE_API_PASSWORD` y
`JWT_SECRET` (mínimo 32 caracteres). El grupo `S3_*` va completo o completamente vacío (ver
sección 4). Si el equipo no tiene Node, cualquier generador de 48 bytes aleatorios sirve
(por ejemplo `openssl rand -base64 48`).

Validar antes de arrancar (no muestra errores si todo está bien):

```bash
docker compose -f docker-compose.prod.yml config --quiet
```

### 2.2 Primer arranque

El orden lo imponen los `depends_on` del compose: `postgres` sano → `migrate` termina con
código 0 → `api` sana; `web` arranca en paralelo (no depende de `api`), y `caddy` espera a que
`api` y `web` estén sanas. Se puede arrancar todo de una vez:

```bash
docker compose -f docker-compose.prod.yml up -d --build --wait
```

o paso a paso, para ver cada fase:

```bash
docker compose -f docker-compose.prod.yml up -d --wait postgres     # crea vipe_migrator y vipe_api (solo con el volumen vacío)
docker compose -f docker-compose.prod.yml up --build migrate        # aplica packages/db/migrations y termina
docker compose -f docker-compose.prod.yml up -d --build --wait api web caddy
```

Con MinIO propio (sección 4.2):

```bash
docker compose -f docker-compose.prod.yml --profile self-hosted-storage up -d --build --wait
```

El script de roles corre **solo** cuando el volumen `postgres_data` está vacío. Cambiar
después `VIPE_MIGRATOR_PASSWORD` o `VIPE_API_PASSWORD` en `.env` no cambia la contraseña en
la base: hay que volver a ejecutar `packages/db/scripts/roles.sql` como superusuario (ver
el encabezado de ese archivo) y luego reiniciar `api`.

### 2.3 Comprobaciones y healthchecks

Cada servicio tiene healthcheck (`api`: `GET /api/health`; `web`: `GET /`; `caddy`: su API de
administración interna; `postgres`: `pg_isready`).

```bash
docker compose -f docker-compose.prod.yml ps
curl -s https://<sitio>/api/health
# {"status":"ok","service":"vipe-pos-api"}
curl -s "https://<sitio>/socket.io/?EIO=4&transport=polling"
# 0{"sid":...,"upgrades":["websocket"],...}
```

Después, iniciar sesión en `https://<sitio>/portal` y comprobar en la pestaña Red del
navegador que `wss://<sitio>/socket.io/?EIO=4&transport=websocket` queda en `101`.

### 2.4 Logs

```bash
docker compose -f docker-compose.prod.yml logs -f api          # o web, caddy, postgres
docker compose -f docker-compose.prod.yml logs migrate         # resultado de la última migración
```

Atajos de `package.json`: `pnpm docker:prod`, `pnpm docker:prod:down` y
`pnpm docker:prod:logs` llaman al binario antiguo `docker-compose`; con Docker Compose v2
usar los comandos `docker compose` de esta guía.

### 2.5 Actualizaciones y reversión

Las imágenes se construyen en la VPS a partir del código; no hay registro de imágenes ni
etiquetas versionadas. Actualizar es traer el código y reconstruir:

```bash
git fetch origin
git checkout <commit o rama>
docker compose -f docker-compose.prod.yml up -d --build --wait
```

`migrate` corre en cada `up` y salta las migraciones ya aplicadas. Hacer un respaldo
(2.6) antes de cualquier actualización que traiga migraciones nuevas
(`packages/db/migrations/`).

Revertir es volver al commit anterior y reconstruir con el mismo comando. Las migraciones
**no** tienen paso de reversión: si la versión nueva aplicó una migración que la anterior no
conoce, la reversión del código no deshace el esquema. En ese caso restaurar el respaldo
previo (2.6) y luego arrancar el commit anterior.

### 2.6 Respaldos con `pg_dump` y prueba de restauración

Respaldo en formato custom, desde el host (guardar el archivo fuera de la VPS):

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U postgres -d vipe_pos -Fc > vipe_pos-$(date +%F).dump
```

Si `POSTGRES_USER` o `POSTGRES_DB` no son los valores por defecto, usar los de `.env`. El
archivo contiene hashes de contraseñas y datos de clientes: guardarlo cifrado.

Prueba de restauración en un contenedor desechable (los roles deben existir antes del
`pg_restore`, porque las políticas y los dueños los nombran):

```bash
docker run -d --name vipe-restore-test -e POSTGRES_PASSWORD=restore-test postgres:16-alpine
docker exec vipe-restore-test pg_isready -U postgres     # repetir hasta "accepting connections"
docker exec vipe-restore-test createdb -U postgres vipe_pos
docker exec -i vipe-restore-test psql -U postgres -d vipe_pos -v ON_ERROR_STOP=1 \
  -v migrator_password=prueba -v api_password=prueba -v db_name=vipe_pos \
  < packages/db/scripts/roles.sql
docker exec -i vipe-restore-test pg_restore -U postgres -d vipe_pos --exit-on-error < vipe_pos-AAAA-MM-DD.dump
docker exec vipe-restore-test psql -U postgres -d vipe_pos -tAc "SELECT count(*) FROM public.orders"
docker rm -f vipe-restore-test
```

Para restaurar en producción: detener `api` (`docker compose -f docker-compose.prod.yml stop api`),
recrear la base vacía con los roles y ejecutar el mismo `pg_restore` contra el servicio
`postgres`. Hacer la prueba anterior con regularidad: un respaldo que nunca se restauró no
está probado.

### 2.7 Rotar `JWT_SECRET`

`JWT_SECRET` firma solo el token de acceso (15 minutos). Al cambiarlo y reiniciar `api`:

- Todos los tokens de acceso dejan de valer. La web recibe 401, renueva la sesión una vez
  con la cookie de refresco y sigue; el usuario no tiene que volver a iniciar sesión.
- Las sesiones de refresco **no** se cierran: el token de refresco es opaco y la base guarda
  su sha256, sin relación con `JWT_SECRET`. Para cerrar de verdad todas las sesiones, además
  de rotar la clave, revocar las sesiones en la base (tabla `auth_sessions`).
- Los tokens de impresora no cambian.

```bash
docker compose -f docker-compose.prod.yml up -d --wait api
```

## 3. Opción B: Coolify con `docker-compose.coolify.yml`

Diferencias con la opción A: sin `caddy` (Coolify maneja 80/443 y HTTPS con Traefik), sin
`minio` propio (las imágenes van al MinIO compartido de la VPS, sección 4.3), sin puertos
publicados, `migrate` con `exclude_from_hc: true` y `WEB_ORIGIN` obligatorio. Además, `postgres`
se construye desde `deploy/postgres/Dockerfile`, que incluye `10-roles.sh` y `roles.sql` dentro de
la imagen: Coolify no coloca los archivos del repositorio junto al compose, así que un montaje
`./deploy/...` llegaría como un directorio vacío y no se crearían `vipe_migrator` ni `vipe_api`.
Si un primer despliegue ya inicializó el volumen sin esos roles, hay que borrar el volumen de
`postgres` (solo si está vacío) y desplegar de nuevo, porque el script de roles corre una sola vez.
Si el volumen ya tiene datos, no se borra: se ejecuta `roles.sql` como superusuario, igual que en
2.2, con el script que la imagen ya incluye y las contraseñas del contenedor, y después se vuelve a
desplegar para que corra `migrate`:

```bash
docker exec <contenedor-postgres> sh /docker-entrypoint-initdb.d/10-roles.sh
```

Staging responde solo a los clientes de la red de Tailscale: desde la IP pública, el proxy de
Coolify devuelve 403 en todas las rutas (`/`, `/api`, `/socket.io`).

### 3.1 Crear el recurso

1. Nuevo recurso desde el repositorio Git, **Build Pack: Docker Compose**.
2. **Docker Compose Location**: `/docker-compose.coolify.yml`.
3. **Domains** por servicio (reemplazar `<sitio>` por el dominio del POS):

   | Servicio | Domains |
   |---|---|
   | `api` | `https://<sitio>:4000/api,https://<sitio>:4000/socket.io` |
   | `web` | `https://<sitio>:3000` |

   El puerto indica a Coolify el puerto interno del contenedor; el público sigue siendo 443.
4. **Strip prefixes: desactivado** en `api`. La API espera las rutas completas `/api/...` y
   `/socket.io/`.
5. **Environment**: obligatorias `POSTGRES_PASSWORD`, `VIPE_MIGRATOR_PASSWORD`,
   `VIPE_API_PASSWORD`, `JWT_SECRET` y `WEB_ORIGIN=https://<sitio>`; opcionales
   `POSTGRES_USER`, `POSTGRES_DB`, `COOKIE_SECURE` (dejar `true`),
   `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_SECONDS`. El grupo `S3_*` es obligatorio
   y sale del MinIO compartido (sección 4.3): ejecutar
   `provision-app.sh vipe-pos-<ambiente> vipe-pos-<ambiente>` y pegar el bloque impreso.
   `SITE_DOMAIN`, `STORAGE_*` y `MINIO_*` no se usan en este archivo.
6. En el recurso del MinIO compartido, agregar `https://<sitio>` a `MINIO_CORS_ORIGINS` y
   volver a desplegarlo.

Validación local del archivo (Docker Compose rechaza la clave `exclude_from_hc`, propia de
Coolify, así que se quita esa línea para validar). Todas las variables obligatorias son
`${VAR:?}`, así que la validación necesita un archivo con ellas; para validar basta con valores
de prueba (nunca los secretos reales en un archivo temporal):

```bash
check_env=$(mktemp)
printf '%s\n' POSTGRES_PASSWORD=prueba VIPE_MIGRATOR_PASSWORD=prueba VIPE_API_PASSWORD=prueba \
  JWT_SECRET=prueba-de-validacion-de-32-caracteres WEB_ORIGIN=https://pos.example.com \
  S3_ENDPOINT=https://s3.example.com S3_REGION=us-east-1 S3_BUCKET=vipe-pos-staging S3_ACCESS_KEY_ID=prueba \
  S3_SECRET_ACCESS_KEY=prueba S3_PUBLIC_BASE_URL=https://s3.example.com/vipe-pos-staging S3_FORCE_PATH_STYLE=true > "$check_env"
sed '/exclude_from_hc/d' docker-compose.coolify.yml | docker compose -f - --env-file "$check_env" config --quiet
rm -f "$check_env"
```

### 3.2 Tres comprobaciones después del primer despliegue

Hasta el primer despliegue real no están probados el valor por defecto de *strip prefix*,
la prioridad de `/api` y `/socket.io` sobre `/` en el enrutador, ni el upgrade a WebSocket
por el proxy de Coolify. Comprobar:

```bash
# a. El prefijo /api llega a la API
curl -s https://<sitio>/api/health
# {"status":"ok","service":"vipe-pos-api"}

# b. /socket.io/ llega con la barra final (sin ella la API responde 404 "Cannot GET /socket.io")
curl -s "https://<sitio>/socket.io/?EIO=4&transport=polling"
# 0{"sid":...,"upgrades":["websocket"],...}
```

```bash
# c. El proxy acepta el upgrade a WebSocket: debe imprimir 101
curl -sS --http1.1 -o /dev/null -w '%{http_code}\n' --max-time 5 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  "https://<sitio>/socket.io/?EIO=4&transport=websocket"
# 101
```

(`curl` termina por `--max-time` después de recibir el `101`; el código impreso es lo que
cuenta.) Después, iniciar sesión en el navegador y comprobar que las pantallas reciben
cambios en vivo; en la pestaña Red la conexión `wss://<sitio>/socket.io/...` también aparece en
`101`.

Si (a) o (b) devuelven la página de la web, el enrutador de Coolify dio prioridad a `/`; si
devuelven 404 de la API sin el prefijo, *strip prefixes* quedó activo.

Producción arranca con la base vacía y la aplicación no tiene pantalla de registro: después de
estas comprobaciones, crear el primer restaurante y su administrador (sección 3.5).

### 3.3 Despliegue desde CI

El job `deploy` de `.github/workflows/ci.yml` corre en cada push a `main` (producción) y a
`dev` (staging), después de `lint`, `typecheck`, `unit-tests`, `api`, `build`, `db-tests` y
`pos-deps-check`. Llama a la API de Coolify (`POST /api/v1/deploy`) y espera el resultado.
Secretos del repositorio:

| Secreto | Uso |
|---|---|
| `COOLIFY_URL` | URL base de la instancia de Coolify. |
| `COOLIFY_TOKEN` | Token de API de Coolify con los permisos `deploy` y `read` (con solo `deploy`, la consulta del estado del despliegue responde 403 y el job falla). |
| `COOLIFY_APP_UUID_PRODUCTION` | UUID del recurso de producción (rama `main`). |
| `COOLIFY_APP_UUID_STAGING` | UUID del recurso de staging (rama `dev`). |

Los UUID deben ser los de los recursos Docker Compose creados en 3.1, no los de un
despliegue anterior de la web sola.

**Orden obligatorio para entrar con este stack.** Hoy `COOLIFY_APP_UUID_STAGING` y
`COOLIFY_APP_UUID_PRODUCTION` apuntan a los recursos anteriores (solo la imagen de la web). Si
se fusiona esta rama en `dev` o `main` antes de cambiarlos, CI despliega la web nueva en el
recurso viejo: una web **sin API ni base de datos**, en la que fallan el inicio de sesión y
todas las pantallas. Seguir este orden:

1. Abrir el pull request como borrador: solo corre CI (el job `deploy` no se ejecuta en pull requests).
2. Crear en Coolify el recurso Docker Compose de staging (sección 3.1) en un subdominio propio (por ejemplo `staging-pos.<dominio>`), accesible solo desde la red de Tailscale, desplegar la rama del pull request directamente desde ese recurso y pasar las comprobaciones de 3.2.
3. Cambiar el secreto `COOLIFY_APP_UUID_STAGING` al UUID del recurso nuevo de staging.
4. Solo entonces fusionar en `dev`: el job `deploy` despliega en el recurso nuevo de staging.
5. Para producción: crear el recurso Docker Compose de producción, y cambiar `COOLIFY_APP_UUID_PRODUCTION` al UUID nuevo y fusionar en `main` únicamente dentro de la ventana de corte ([runbook-cutover.md](runbook-cutover.md), sección 2), nunca antes.

### 3.4 Logs, actualizaciones y respaldos en Coolify

Los logs y el historial de despliegues están en el panel de cada recurso. El panel de Coolify
puede no ofrecer detener un solo servicio de un recurso Docker Compose; en ese caso usar la CLI
en la VPS (`docker ps --format '{{.Names}}'` para ver los nombres, que llevan el UUID del recurso,
y `docker stop <contenedor>` / `docker start <contenedor>`). Un push a la rama
redepliega; para volver a una versión anterior, desplegar el commit anterior (revertir en
Git y hacer push, o redeplegar ese commit desde el panel). Las mismas advertencias de 2.5
sobre migraciones aplican.

Respaldos con `pg_dump` en la VPS: Coolify nombra los contenedores con el UUID del recurso.

```bash
docker ps --format '{{.Names}}' | grep postgres
docker exec <contenedor-postgres> pg_dump -U postgres -d vipe_pos -Fc > vipe_pos-$(date +%F).dump
```

La prueba de restauración es la de 2.6.

### 3.5 Primer restaurante y administrador

`packages/db/seed/bootstrap/create-restaurant.sh` crea un restaurante y su primer usuario
administrador en una sola transacción. Después, ese administrador inicia sesión en
`https://<sitio>/portal` y crea el personal desde **Personal**. En staging, el portal responde
solo a los clientes de la red de Tailscale.

- Argumentos: el nombre del restaurante y el correo del administrador; `--admin-name` para el
  nombre que se muestra (por defecto `Administrador`) y `--username` para el usuario del perfil
  (por defecto, la parte del correo antes de `@`; de 1 a 50 caracteres, sin espacios). El usuario
  es único en toda la base: si la demo u otro restaurante ya usa, por ejemplo, `admin`, hay que
  indicar otro con `--username`.
- Contraseña: se lee de la variable `ADMIN_PASSWORD` o, si está vacía, de la entrada estándar
  (en una terminal la pide sin mostrarla). Nunca va como argumento. Mínimo 12 caracteres; se
  guarda como hash argon2id calculado con la dependencia `argon2` de la API.
- Códigos de salida del script ejecutado con `bash`: `0` creado; `2` uso, nombre, correo,
  usuario, contraseña o UUID del recurso inválidos o ausentes; `3` ya existe un restaurante con
  ese nombre (sin distinguir mayúsculas), un usuario con ese correo o un perfil con ese usuario,
  también si otro proceso lo creó mientras corría (no se cambia nada); `1` cualquier otro error,
  incluido un fallo de `psql` o de `docker` (no queda nada a medias). `pnpm db:create-restaurant`
  devuelve los mismos códigos. Un `--username` vacío termina con código `2`.

En el servidor el script corre en el host y usa `docker exec`: `psql` en el contenedor
`postgres` y `node` en el contenedor `api` del recurso. Encuentra los contenedores por el nombre
que les da Coolify, `<servicio>-<uuid del recurso>-<fecha>`. El UUID es obligatorio con
`--target coolify`, con `--app-uuid <uuid>` o con la variable `VIPE_COOLIFY_APP_UUID`; no hay valor
por defecto, para que una variable olvidada no escriba en el recurso equivocado (sin UUID, código
`2`). A la inversa, un UUID sin `--target coolify` también termina con código `2` antes de tocar
ninguna base, en vez de escribir en la base local. El recurso de staging es `zyxpf2vqnowxdolrgne8vxew`. Las escrituras corren como
`vipe_migrator` (`SET LOCAL ROLE`), sea cual sea el `POSTGRES_USER` del contenedor. Basta con
copiar los scripts al servidor; no hace falta el repositorio:

```bash
# desde un equipo con el repositorio
scp -r packages/db/seed/bootstrap root@<servidor>:/root/vipe-seed/
ssh root@<servidor>
# en el servidor: pide la contraseña sin mostrarla
bash /root/vipe-seed/bootstrap/create-restaurant.sh --target coolify \
  --app-uuid <uuid del recurso de producción> \
  --admin-name "<nombre del administrador>" "<nombre del restaurante>" <correo del administrador>
```

El script comprueba que el esquema exista (lo crea el servicio `migrate`) y no aplica
migraciones. Para probarlo en local contra el stack de desarrollo (`--target local`, que es el
valor por defecto, sobre la base `VIPE_DB_NAME`, por defecto `vipe_pos`):

```bash
bash packages/db/seed/bootstrap/create-restaurant.sh "<nombre del restaurante>" <correo del administrador>
```

`pnpm db:test-seeds` prueba el contrato de este script y el de la demo (3.6) contra contenedores
desechables que imitan un recurso de Coolify, uno de ellos con `POSTGRES_USER=vipeowner`; no corre
en CI.

La opción A (`docker-compose.prod.yml`) no tiene destino propio en el script: ahí se puede
ejecutar `create-restaurant.sql` con `psql` como superusuario, siguiendo el encabezado del
archivo.

### 3.6 Datos de demostración

Staging es el entorno de demostración del POS, accesible solo desde la red de Tailscale, y no
recibe datos reales: arranca con un restaurante ficticio, "Casa Guadua" (Medellín, COP), cargado por `packages/db/seed/demo/demo-db.sh`.
Nombres, teléfonos, direcciones y NIT son inventados. Contiene:

- Personal de todos los roles, con correo `@demo.vipe.pos`: `admin@`, `mesero.andres@`,
  `mesera.valentina@`, `mesero.julian@`, `cocina@`, `cocina.oscar@`, `caja@`, `caja.camilo@` y
  `domicilios@`. Todos usan la contraseña de `DEMO_PASSWORD`.
- 8 categorías y 38 platos con precios en pesos, cuatro promociones (dos vigentes, una próxima y
  una vencida), 12 mesas, 3 domiciliarios, inventario con fórmulas, proveedores, una orden de
  compra en camino y cinco insumos bajo el mínimo.
- Tres preparaciones (hogao, ají de la casa y arroz con coco) con su fórmula y la producción de
  hoy, que usan algunos platos.
- 30 días de historia: una caja por día abierta y cerrada, picos de almuerzo y cena, más
  movimiento el fin de semana, pagos repartidos entre Efectivo, Bancolombia, Nequi y
  Transferencia (algunos divididos), propina sugerida en la mayoría de las mesas y domicilios
  pagados contra entrega o por adelantado.
- Actividad en este momento: mesas en cocina, servidas, ocupadas y reservada, comandas con
  platos pendientes, cuatro domicilios en curso (recibido, en preparación, listo y en camino) y la
  caja de hoy abierta.

Los datos pasan por las mismas funciones que usa la API (`create_staff_user`, `pay_order`,
`create_delivery_order`, `set_delivery_status`, `close_register`, `produce_preparation`, entre otras), ejecutadas como el
rol que lo haría en la aplicación; después se ajustan las fechas a la historia. Cargarlo toma unos
20 segundos. Las fechas son relativas al momento de la carga: con los días, la actividad "en vivo"
envejece y la historia se corre; volver a cargar con `--reset` la actualiza.

En staging, desde el host, con los scripts copiados como en 3.5:

```bash
# desde un equipo con el repositorio
scp -r packages/db/seed/bootstrap packages/db/seed/demo root@<servidor>:/root/vipe-seed/
ssh root@<servidor>
# en el servidor
read -r -s -p 'Contraseña de las cuentas demo: ' DEMO_PASSWORD; echo; export DEMO_PASSWORD
bash /root/vipe-seed/demo/demo-db.sh --target coolify --app-uuid zyxpf2vqnowxdolrgne8vxew           # base vacía
bash /root/vipe-seed/demo/demo-db.sh --target coolify --app-uuid zyxpf2vqnowxdolrgne8vxew --reset   # reemplazar la demo
unset DEMO_PASSWORD
```

- Sin `--reset`, el script se niega con código `3` si la base ya tiene algún restaurante, y no
  cambia nada.
- `--reset` borra solo los restaurantes que creó la semilla de demostración (marcados con
  `demo_seed` en `business_config`) y todo lo que depende de ellos, y vuelve a cargar, en una sola
  transacción. Si existe algún restaurante que no es de la demo, se niega con código `3` antes de
  borrar.
- `DEMO_PASSWORD` vacía o de menos de 12 caracteres, o `--target coolify` sin UUID del recurso:
  código `2`. La contraseña se pasa a `node` por la entrada estándar y a `psql` solo llega el hash.
- `--reset` falla con código `1`, antes de borrar, si una tabla de `public` con columna
  `restaurant_id` no está en la lista de `reset.sql`; la tabla nueva se agrega a esa lista.
- `pnpm db:demo` devuelve los mismos códigos que el script ejecutado con `bash`.
- El UUID se indica siempre, con `--app-uuid` o `VIPE_COOLIFY_APP_UUID`; si el recurso de staging
  cambia, se usa el nuevo.

En local, `bash packages/db/seed/demo/demo-db.sh` (o con `--reset`; `pnpm db:demo` hace lo mismo,
con los mismos códigos de salida) carga la demo en la base `vipe_demo` del
stack de desarrollo (`VIPE_DEMO_DB` para otra), creándola y migrándola si falta, de modo que
`vipe_pos` conserva la semilla de desarrollo. Para verla, arrancar la API con
`DATABASE_URL=postgres://vipe_api:vipe_api@localhost:5432/vipe_demo`.

Nunca cargar la demo en producción.

## 4. Almacenamiento de imágenes

La API firma subidas (PUT prefirmado) y guarda la URL pública en el plato. Claves:
`<restaurantId>/dishes/<uuid>.<ext>`. Sin ninguna variable `S3_*` la API arranca y
`/api/storage/*` responde 503 `Storage is not configured`; con el grupo incompleto la API no
arranca.

### 4.1 Cloudflare R2 (opción A, o alternativa al MinIO compartido)

1. Crear el bucket (por ejemplo `vipe-pos`).
2. Habilitar acceso público de lectura: un dominio propio conectado al bucket o el
   subdominio `r2.dev`. Esa URL, sin `/` final, es `S3_PUBLIC_BASE_URL`.
3. Crear un token de API de R2 con lectura y escritura sobre el bucket.
4. Regla CORS del bucket (R2 no trae ninguna; sin ella el navegador no puede subir):

   ```json
   [
     {
       "AllowedOrigins": ["https://<sitio>"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

Variables:

| Variable | Valor en R2 |
|---|---|
| `S3_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `S3_REGION` | `auto` |
| `S3_BUCKET` | nombre del bucket |
| `S3_ACCESS_KEY_ID` | Access Key ID del token de R2 |
| `S3_SECRET_ACCESS_KEY` | Secret Access Key del token de R2 |
| `S3_PUBLIC_BASE_URL` | URL pública del bucket, sin `/` final |
| `S3_FORCE_PATH_STYLE` | `false` |

### 4.2 MinIO en la misma VPS (solo opción A)

Perfil `self-hosted-storage` de `docker-compose.prod.yml`. `minio-init` crea `S3_BUCKET`
con lectura pública de objetos (sin listado) y el servicio `minio` permite CORS desde
`WEB_ORIGIN`. Con `STORAGE_SITE=on`, Caddy publica MinIO en `STORAGE_DOMAIN`
(`deploy/caddy/storage-on.caddy`).

```
STORAGE_SITE=on
STORAGE_DOMAIN=storage.<sitio>
MINIO_ROOT_USER=<usuario>
MINIO_ROOT_PASSWORD=<secreto>
S3_ENDPOINT=https://<STORAGE_DOMAIN>
S3_REGION=us-east-1
S3_BUCKET=vipe
S3_ACCESS_KEY_ID=<MINIO_ROOT_USER>
S3_SECRET_ACCESS_KEY=<MINIO_ROOT_PASSWORD>
S3_PUBLIC_BASE_URL=https://<STORAGE_DOMAIN>/vipe
S3_FORCE_PATH_STYLE=true
```

Las imágenes de MinIO son las compilaciones de Chainguard fijadas por digest (MinIO dejó de
publicar imágenes comunitarias). El volumen `minio_data` entra en los respaldos de la VPS;
`pg_dump` no lo cubre.

### 4.3 Almacenamiento compartido de la VPS (MinIO)

La opción B usa un único MinIO para toda la VPS, desplegado como un recurso Docker Compose
propio de Coolify (`deploy/shared-storage/docker-compose.yml`), no como parte de VIPE POS. Otras
aplicaciones de la VPS se conectan al mismo servidor. R2 (sección 4.1) sigue siendo una
alternativa: basta con cargar su grupo `S3_*` en lugar del de MinIO.

- **Aislamiento.** Cada aplicación y ambiente tiene su bucket (`vipe-pos-staging`,
  `vipe-pos-production`) y su usuario, con permiso solo para leer, escribir y borrar objetos de
  ese bucket. Los objetos se leen de forma anónima por su clave; nadie lista un bucket sin
  credenciales. Las credenciales administradoras no se entregan a ninguna aplicación.
- **CORS.** MinIO aplica una sola lista de orígenes a todo el servidor:
  `MINIO_CORS_ORIGINS` (separada por comas) debe incluir `https://<sitio>` de cada aplicación
  y ambiente conectados; tras cambiarla, volver a desplegar el recurso.
- **Aprovisionamiento.** En la VPS, con las credenciales administradoras en el entorno:

  ```bash
  MINIO_NETWORK=<red-del-recurso> S3_PUBLIC_ENDPOINT=https://<s3-dominio> \
    bash deploy/shared-storage/provision-app.sh vipe-pos-production vipe-pos-production
  ```

  `provision-app.sh` es idempotente y solo imprime en la salida estándar el bloque `S3_*` para
  pegar en el recurso de VIPE POS (el secreto se muestra una vez; `--rotate` genera uno nuevo).

Dominios, respaldos del volumen, rotación y la prueba local (`deploy/shared-storage/test.sh`)
están en [deploy/shared-storage/README.md](../deploy/shared-storage/README.md).

## 5. Estaciones de impresión

1. Un admin crea un token por estación en **Administración > Configuración > Impresoras**. El
   token (`vpt_...`) se muestra una sola vez.
2. Instalar el servicio según [pos/README.md](../pos/README.md) (instalador
   `pos/vipe_pos_installer.iss`).
3. En la primera ejecución, ingresar `VIPE_API_URL=https://<sitio>` (sin `/api`) y
   `VIPE_PRINTER_TOKEN`. Quedan cifrados con DPAPI en
   `%APPDATA%\VipePOS\printer_credentials.dat`.
4. Requisitos del proxy: reenviar `/socket.io/` con el upgrade a WebSocket (`Upgrade` y
   `Connection`) conservando la barra final, y `/api/print/*` conservando la cabecera
   `Authorization`. Caddy (`deploy/Caddyfile`) lo hace sin configuración extra; en Coolify lo
   cubren las comprobaciones de 3.2.
5. Comprobar: en la pantalla Impresoras la estación muestra su última conexión, y una comanda
   enviada desde la vista de mesero sale en la impresora de comandas.

La estación solo necesita salida HTTPS (443) hacia la VPS.

## 6. Lista de seguridad

- [ ] Ningún secreto por defecto: `POSTGRES_PASSWORD`, `VIPE_MIGRATOR_PASSWORD`,
      `VIPE_API_PASSWORD`, `JWT_SECRET` (y `MINIO_ROOT_*` si aplica) generados al azar y
      distintos entre sí y entre staging y producción.
- [ ] `.env` con permisos `600` y fuera del repositorio.
- [ ] `COOKIE_SECURE=true` (el sitio solo se sirve por HTTPS).
- [ ] La API se conecta como `vipe_api` (sin superusuario ni `BYPASSRLS`; RLS siempre
      aplica). **Nunca** apuntar `DATABASE_URL` de la API a `vipe_migrator` ni al
      superusuario: los compose ya lo arman así, no cambiarlo.
- [ ] `vipe_migrator` solo lo usa `migrate`; el superusuario solo para administración,
      respaldos y la importación del corte.
- [ ] Firewall: públicos solo 80 y 443 (SSH restringido a las IP de administración).
      Postgres no publica puerto en ninguno de los dos compose.
- [ ] Las cuentas de desarrollo (`*@vipe.local`, `packages/db/seed/dev.sql`) y el token
      `vpt_dev-printer-token-2026` no existen en producción: la semilla de desarrollo solo
      la carga `pnpm db:dev`.
- [ ] Producción no tiene cuentas `@demo.vipe.pos` ni el restaurante "Casa Guadua": la
      semilla de demostración (3.6) es solo para staging.
- [ ] Respaldos fuera de la VPS, cifrados, con una restauración probada.

## 7. Limitaciones conocidas

Pendientes abiertos del plan (`odd/tasks/migracion-backend-nestjs.md`):

- **Corte sin ensayo real.** Falta un ensayo del corte contra una copia real de producción;
  hasta entonces no están probadas las formas reales de `auth.users` y `storage.objects`
  (runbook, sección 1).
- **Coolify sin probar en vivo.** El valor por defecto de *strip prefix*, la prioridad de
  `/api` y `/socket.io` sobre `/` y el upgrade a WebSocket por el proxy de Coolify se
  confirman con las comprobaciones de 3.2. Tampoco se ha visto en GitHub el paso
  "Image hygiene" del job `docker-build`.
- **Pantallas en vivo en dos navegadores.** La tarea T8b (mesas y órdenes en la web) sigue
  abierta en el plan: las comprobaciones manuales con dos navegadores no se registraron; la
  lista de verificación del runbook (sección 3) las cubre.
- **"Meseros activos" desactualizado.** La lista del encabezado se carga una vez al entrar al
  portal; tras crear o editar personal no cambia hasta recargar.
- **CORS del bucket.** Obligatorio en producción (sección 4.1); sin él fallan las subidas
  desde el navegador.
- **Subidas huérfanas.** Una imagen subida y no guardada en el plato queda en el bucket
  (diseño: se prefiere no borrar de más).
- **Imágenes de MinIO.** Los digests de Chainguard pueden dejar de descargarse; habría que
  actualizarlos.
- **Cola de impresión.** Al arrancar, la API borra los trabajos de impresión con más de 7
  días, impresos o no; las comandas con más de 12 horas se confirman sin imprimir.
- **Listado de órdenes.** `GET /api/orders` devuelve como máximo 500 filas, sin paginación.
