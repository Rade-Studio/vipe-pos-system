# Arquitectura del backend: de Supabase a NestJS sobre Postgres

Registro de decisión de arquitectura (ADR). Describe el estado de partida, la topología
objetivo, las decisiones tomadas y el orden de migración. El plan de tareas vive en
`odd/tasks/migracion-backend-nestjs.md`.

## Estado

La migración está **implementada en la rama `feat/backend-nestjs`** y todavía no se ha
fusionado en `dev` ni en `main`. La web ya no depende de Supabase: dependencias, cliente,
directorio `supabase/` y variables se retiraron (T13b). Pendientes antes del corte real: el
ensayo contra una copia real de producción ([runbook-cutover.md](runbook-cutover.md),
sección 1) y las comprobaciones en vivo del primer despliegue en Coolify
([despliegue.md](despliegue.md#32-tres-comprobaciones-después-del-primer-despliegue)). La lista
completa de pendientes está en [despliegue.md](despliegue.md#7-limitaciones-conocidas).

Las secciones siguientes conservan el registro de decisión original; donde la
implementación cambió algo, se indica con una nota **Implementación**.

## 1. Contexto y problema

VIPE POS es una aplicación Next.js que habla **directamente** con Supabase desde el
navegador usando la anon key. No existe capa de servidor propia: toda la seguridad vive en
Postgres (RLS), la autenticación la provee GoTrue, el tiempo real lo provee Supabase
Realtime, las imágenes van a Supabase Storage y la creación de personal pasa por una Edge
Function con service role.

Esto genera dos problemas que motivan el cambio:

- **Costo**: el plan hosted de Supabase es caro para el tamaño del negocio.
- **Peso operativo**: el stack autoalojado de Supabase son unos diez contenedores (Kong,
  GoTrue, PostgREST, Realtime, Storage, Studio, pg-meta, Logflare, Vector, imgproxy) para
  servir una sola aplicación. No cabe razonablemente en una VPS pequeña.

Además hay defectos estructurales que conviene corregir de raíz y no con parches:

- 42 componentes de `components/admin` importan el cliente de base de datos directamente.
  Las reglas de acceso a datos están mezcladas con la interfaz.
- `(supabase.rpc as any)` en el servicio de domicilios para esquivar el tipado.
- Las variables `NEXT_PUBLIC_*` se inlinean en build y el cliente tiene un fallback a la
  URL de producción: una imagen construida sin variables apunta a producción.
- Reglas de negocio repartidas entre cliente y SQL sin frontera clara.
- Creación de usuarios de personal desde el navegador vía Edge Function con service role.

## 2. Lo que se conserva

La mayor parte del valor del sistema ya está en Postgres y **no depende de Supabase**:

| Activo | Cantidad | Destino |
|---|---|---|
| Funciones plpgsql (RPCs y triggers de guarda) | ~55 | Se conservan tal cual |
| Políticas RLS | 134 sobre 39 tablas | Se conservan, cambian 2 helpers |
| Tests pgTAP | 17 archivos | Se conservan, cambia el runner |
| Lógica pura de merge de realtime (`lib/realtime/*`) | 2 módulos probados | Se conservan |
| Tests Vitest de web | 100 archivos | Se conservan |

`pay_order`, `split_order`, `undo_split`, `close_register`, `register_summary`,
`create_delivery_order`, `set_delivery_status` y toda la familia de inventario
(`consume_order_stock`, `receive_purchase_order`, `produce_preparation`,
`apply_inventory_count`, `save_formula`, `inventory_adjust`, `inventory_transfer`) son el
núcleo transaccional: atómicas, con invariantes y probadas. Reescribirlas en TypeScript
sería descartar trabajo correcto. La API las invoca con `SELECT fn(...)` dentro de una
transacción.

## 3. Topología objetivo

Una VPS con Docker Compose o Coolify y cuatro servicios:

```
┌──────────────┐  HTTPS   ┌─────────────────────────────┐
│  Navegador   │ ───────► │ Reverse proxy (Caddy/Traefik)│
└──────────────┘          └──────┬──────────────┬────────┘
                                 │ /            │ /api, /socket.io
                          ┌──────▼─────┐  ┌─────▼──────────┐
                          │ web (Next) │  │ api (NestJS)   │
                          └────────────┘  └──┬──────────┬──┘
                                             │ pg       │ S3
                                      ┌──────▼─────┐ ┌──▼──────┐
                                      │ Postgres 16│ │ MinIO   │
                                      └────────────┘ └─────────┘
```

- **web**: Next.js solo como frontend. Conoce únicamente `NEXT_PUBLIC_API_URL` en runtime.
  **Implementación:** ni siquiera eso. La web llama a su propio origen (`/api`, `/socket.io/`)
  y no tiene variables de build ni de runtime; en desarrollo `next.config.mjs` reenvía esas
  rutas a `API_PROXY_TARGET`.
- **api**: NestJS. Dueño de todo acceso a datos, autenticación, autorización, tiempo real
  y URLs firmadas de almacenamiento.
- **Postgres 16**: base de datos plana con la extensión `pgtap` para tests. Sin los
  esquemas `auth`, `storage` ni `realtime`.
- **MinIO** o Cloudflare R2: almacenamiento S3-compatible para imágenes de platos.

Web y API comparten dominio detrás del proxy, lo que permite cookies de sesión
`httpOnly` sin CORS complicado.

**Implementación:** MinIO quedó como opción; el almacenamiento por defecto en producción es
Cloudflare R2 (sección 4.9). El proxy es Caddy en una VPS con Docker o Traefik en Coolify
(sección 4.10).

## 4. Decisiones

### 4.1 Servicio NestJS separado, no route handlers de Next

Un POS con tiempo real necesita WebSockets estables. Next.js standalone no los expone de
forma natural y mezclar backend y frontend en un mismo proceso acopla ciclos de despliegue
y escalado. NestJS aporta módulos, inyección de dependencias, guards, interceptores, un
gateway de WebSockets integrado y generación de OpenAPI. Es TypeScript como el resto del
proyecto.

### 4.2 Drizzle ORM con migraciones SQL planas

Drizzle da tipado fuerte sobre SQL explícito sin esconder la base de datos, y su migrador
aplica archivos `.sql` versionados. Las 49 migraciones de Supabase se **comprimen en un
baseline**: un `pg_dump --schema-only` de la base actual al que se le quitan los esquemas
`auth`, `storage`, `extensions`, la publicación `supabase_realtime` y los grants a `anon`
y `authenticated`. A partir de ahí, migraciones incrementales normales.

### 4.3 RLS se conserva como defensa en profundidad

Hoy las políticas dependen de `auth.uid()` a través de dos helpers:
`private.current_restaurant_id()` y `private.current_app_role()`. Ambos pasan a leer
`current_setting('app.user_id', true)`. La API abre una transacción por petición y ejecuta
`SET LOCAL app.user_id = $1` antes de cualquier consulta, conectada con un rol **sin**
`BYPASSRLS` ni superusuario. Resultado: las 134 políticas y la suite pgTAP siguen válidas
sin tocarlas, y un bug en la API no puede filtrar datos entre restaurantes.

### 4.4 Autenticación propia

- Tabla `users` propia reemplaza `auth.users`; `profiles.auth_user_id` pasa a
  `profiles.user_id`.
- Contraseñas con argon2.
- Access token JWT de vida corta en cookie `httpOnly`, `SameSite=Lax`, más refresh token
  con rotación. El socket reutiliza la misma cookie.
- La creación de personal es un endpoint de la API protegido por rol admin. Desaparece la
  Edge Function y el service role.

### 4.5 Tiempo real con LISTEN/NOTIFY

Triggers `AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW` llamados `notify_change` en
`orders`, `tables` y `order_deliveries` (migración `0004_realtime_notify.sql`) emiten
`pg_notify('pos_changes', private.change_payload(...))`. El payload nunca lleva la fila
nueva: `{table, op, id, restaurant_id}` más, en UPDATE y DELETE, `old` con la fila
anterior completa, porque las tres tablas son `REPLICA IDENTITY FULL` y la web ya lee
`old` (por ejemplo `old.order_type` en un DELETE).

**Implementación:** la migración `0007_orders_realtime_api.sql` añade el mismo trigger en
`order_items` (que la cocina necesita) y la incluye en `private.realtime_row`. Como un trigger
siempre tiene `OLD`, los eventos de `order_items` llevan el `old` completo (la cocina lee
`old.status`). El listener enriquece en el servidor: los eventos de `orders` llevan
`new.order_items` y los de `tables` llevan `new.waiter_name`, lo que elimina dos patrones N+1
del cliente. La web (`lib/api/realtime.ts`) vuelve a leer órdenes, mesas y domicilios ante
`resync` y ante cada reconexión del socket. En `order_deliveries` el `id` del
payload es su llave `order_id`. NOTIFY rechaza payloads de 8000 bytes o más: si con `old`
el payload supera 7000 bytes, `old` se reduce a las columnas llave (`id` u `order_id`,
`restaurant_id`, `order_type` si existe) y se marca `old_truncated: true`. Un cambio
revertido no notifica nada; los NOTIFY se entregan al hacer COMMIT.

En la API, `PgListenerService` usa un `pg.Client` dedicado (fuera del pool, rol
`vipe_api`, `application_name = vipe-realtime-listener`) con `LISTEN pos_changes`. Procesa
las notificaciones en orden: para INSERT y UPDATE carga la fila con
`private.realtime_row(table, id)`; DELETE no tiene fila nueva. El gateway socket.io
(namespace `/realtime`) la emite a la sala `restaurant:<restaurant_id>` como evento
`pos_changes`:

```json
{
  "schema": "public",
  "table": "orders",
  "commit_timestamp": "2026-11-04T18:45:21.512Z",
  "eventType": "UPDATE",
  "new": { "id": "...", "restaurant_id": "...", "status": "kitchen", "...": "..." },
  "old": { "id": "...", "restaurant_id": "...", "status": "active", "...": "..." },
  "errors": null
}
```

Es la forma de `RealtimePostgresChangesPayload`, así que `lib/realtime/order-merge.ts` y
`table-merge.ts` no cambian. INSERT lleva `old: {}`; DELETE lleva `new: {}` y la fila
borrada en `old`. `commit_timestamp` es la hora en que la API recibió la notificación
(Postgres no informa la hora del commit). Si la fila desapareció antes de cargarla, el
evento se omite: su DELETE llega después.

**Excepción deliberada a RLS.** `private.realtime_row` es `SECURITY DEFINER` con
`search_path = ''` y `EXECUTE` solo para `vipe_api`: lee una fila por llave primaria
(`order_id` en `order_deliveries`) de exactamente esas tres tablas sin `app.user_id`, porque
el listener no actúa en nombre de un usuario y debe repartir el cambio a la sala que indica
el payload. Cualquier otra tabla lanza `22023`. Un `SELECT` directo de `vipe_api` sobre esas
tablas sin `app.user_id` sigue sin ver filas (`170_realtime_notify.test.sql`).

El socket se autentica con la cookie `vipe_access` del handshake: JWT válido, sesión viva
y perfil activo, resueltos en una unidad de trabajo; si no, `connect_error` `unauthorized`.
Al quedar en su sala recibe `ready`. El upgrade a WebSocket con un `Origin` distinto de
`WEB_ORIGIN` se rechaza (`allowRequest`); sin `Origin` (clientes no navegador) solo cuenta la
cookie. Si se pierde la conexión del listener (error, cierre o un `SELECT 1` de latido cada
30 s que falla, más TCP keepalive), se cierra ese cliente, reconecta con backoff exponencial
de 1 s a 30 s y, tras cada reconexión, emite `resync` a todos los clientes para que vuelvan a
leer el estado, como hoy al re-suscribir el canal.

Cualquier rol puede llamar `pg_notify('pos_changes', ...)`, así que el listener no confía en
el `restaurant_id` del aviso: en INSERT y UPDATE emite a la sala del `restaurant_id` de la
fila cargada y descarta el aviso si no coincide; en DELETE descarta el aviso si
`old.restaurant_id` difiere.

#### Impresión

**Implementación:** cola durable `print_jobs` (migración `0010_printing.sql`), descrita a
continuación tal como quedó; los tokens se administran desde la pantalla
Configuración > Impresoras.

Antes, la web enviaba comandas y facturas por broadcast de Supabase a canales globales
(`room_commands`, `room_bills`). Cada impresora recibía los tickets de todos los
restaurantes, y un ticket enviado con el servicio apagado se perdía. Ahora:

- **Identidad.** Cada servicio de impresión (`pos/app.py`) usa un token de
  `printer_tokens`, ligado a un restaurante. Solo se guarda el sha256; `vipe_api` no puede
  leer `token_hash`. Un admin lo crea, lista y revoca en `/api/devices/printers`.
- **Cola durable.** `POST /api/print/commands` y `POST /api/print/invoices` (cualquier rol
  con sesión) insertan en `print_jobs` dentro de la transacción de la petición, con RLS por
  restaurante. Tras el commit (`UnitOfWork.afterCommit`) el gateway emite
  `print_job {id, kind, payload}` a la sala `printers:<restaurantId>`. Un rollback no emite
  nada. Los payloads son los del broadcast anterior, así que `pos/print_renderer.py` no
  cambia. En comandas, el id del trabajo reemplaza el `invoiceNumber` aleatorio.
- **Socket de impresoras.** El mismo namespace `/realtime` acepta `auth: {token}` además de
  la cookie. Un socket con token entra solo a `printers:<id>` (nunca a `restaurant:<id>`) y
  actualiza `last_seen_at`. Un socket de la web nunca recibe `print_job`. Al revocar un
  token se desconectan sus sockets.
- **Pendientes y confirmación.** En cada conexión el servicio pide
  `GET /api/print/jobs/pending` y confirma cada ticket impreso con
  `POST /api/print/jobs/:id/ack`, y vuelve a pedir pendientes cada 60 s. La lista trae como
  máximo 500, del más antiguo al más nuevo, y se pagina con `?after=<id>` (clave
  `(created_at, id)`). La confirmación es idempotente: se queda el primer `printed_at`.
  Ambas rutas usan `Authorization: Bearer <token>`. Al arrancar, la API borra los trabajos
  con más de 7 días y deja en el log cuántos nunca se imprimieron. El servicio confirma sin
  imprimir las comandas con más de 12 horas y los tickets que no puede generar.

**Segunda excepción deliberada a RLS.** El servicio de impresión no tiene `app.user_id`,
por eso lee y confirma sus trabajos con funciones `SECURITY DEFINER`
(`search_path = ''`, `EXECUTE` solo para `vipe_api`): `private.touch_printer`,
`private.printer_pending_jobs`, `private.ack_print_job` y `private.prune_print_jobs`. Las
tres primeras reciben el hash del token y resuelven el restaurante dentro de la función. Un
token revocado no resuelve nada (`200_printing.test.sql`).

### 4.6 Contratos generados

La API publica OpenAPI. El frontend consume un cliente tipado generado con
`openapi-typescript` y `openapi-fetch`. No se escriben tipos de respuesta a mano en web;
`types/supabase.ts` desaparece.

### 4.7 Tests

- **pgTAP** contra `postgres:16` con `pgtap` en Docker. Reemplaza `supabase test db`.
- **Vitest** para web, como hoy.
- **Tests de integración de la API** con Testcontainers levantando Postgres real.
- CI añade `api-lint`, `api-typecheck`, `api-tests` y adapta `db-tests` al nuevo runner.
  **Implementación:** un solo job `api` (lint, typecheck, build, pruebas y verificación de que
  `openapi.json` y `lib/api/schema.d.ts` no cambian), `db-tests` sobre el servicio `db` de
  `docker-compose.yml`, y `docker-build` en pull requests con una verificación de higiene de
  las imágenes. El job `deploy` espera a `api`.

### 4.8 Estructura del repositorio

El workspace pnpm ya existe. Se añaden `apps/api` y `packages/db`. La app web permanece en
la raíz durante la migración para no mover 180 archivos mientras se cambia su backend;
moverla a `apps/web` es una tarea opcional posterior.

### 4.9 Almacenamiento

**Implementación (T12).** La API emite URLs prefirmadas de PUT, ligadas al tipo de contenido y
al tamaño (`image/*` salvo SVG, máximo 5 MB). Las claves son
`<restaurantId>/dishes/<uuid>.<ext>`; la web guarda la URL pública en `imageUrl`, y
`DELETE /api/storage/objects` solo borra claves bajo el prefijo del restaurante y bajo
`S3_PUBLIC_BASE_URL`. La API solo usa S3 estándar (direcciones por ruta con
`S3_FORCE_PATH_STYLE`), así que sirve cualquier servicio compatible. Las imágenes oficiales de
MinIO ya no se pueden descargar: desarrollo y pruebas usan las compilaciones de Chainguard
fijadas por digest, y producción usa Cloudflare R2 por defecto, o MinIO en la misma VPS con un
perfil de compose. El bucket de producción necesita CORS desde el origen de la web.

### 4.10 Despliegue: VPS con Caddy o Coolify

**Implementación (T13a).** Coolify usa su propio proxy (Traefik) en 80/443, no aplica los
`profiles` de compose ni archivos de override, y necesita `exclude_from_hc: true` en servicios
de una sola ejecución. Por eso hay dos archivos:

- `docker-compose.prod.yml` para una VPS con Docker: `postgres`, `migrate` (una sola ejecución
  como `vipe_migrator`), `api`, `web`, `caddy` y MinIO opcional con el perfil
  `self-hosted-storage`.
- `docker-compose.coolify.yml` para Coolify: sin `caddy`, sin `minio` y sin puertos
  publicados; dominios `api` → `https://<sitio>:4000/api` y `https://<sitio>:4000/socket.io`,
  `web` → `https://<sitio>:3000`, *Strip prefixes* desactivado.

Guía paso a paso: [despliegue.md](despliegue.md).

## 5. Estrategia de migración: strangler

La web sigue funcionando contra Supabase hasta que un módulo esté servido completo por la
API. El cambio ocurre detrás de la frontera de servicios que ya existe:
`lib/supabase/<modulo>-service.ts` se reemplaza por `lib/api/<modulo>.ts` con la misma
interfaz hacia los hooks y componentes. En la misma entrega se borra el código Supabase de
ese módulo. Ningún módulo queda a medias.

Orden, de menor a mayor riesgo y de mayor a menor valor de validación:

1. **Catálogo**: categorías, platos, promociones, configuración del negocio. Lectura
   intensiva, bajo riesgo, valida el pipeline completo.
2. **Mesas y órdenes con tiempo real**: el corazón del POS. Valida cocina, mesero y
   cajero sincronizados.
3. **Pagos y caja**: RPCs existentes, ledger de dinero.
4. **Inventario**.
5. **Domicilios**.
6. **Personal, perfiles y almacenamiento**.
7. **Eliminar Supabase**: dependencias, `lib/supabase`, `supabase/`, variables,
   Dockerfiles y CI.
8. **Migración de datos y cut-over**.

## 6. Cut-over

1. Ensayo completo en una copia de staging.
2. Ventana sin ventas. Congelar escrituras en Supabase.
3. `pg_dump --data-only` del esquema `public`; `auth.users` se transforma a `users`
   conservando ids para que `profiles.user_id` siga apuntando bien; objetos de storage se
   copian al bucket S3.
4. Carga, verificación por pantalla y rol con una lista de chequeo, incluido tiempo real.
5. Cambio de entorno en el proxy. El proyecto Supabase queda en solo lectura una semana
   como respaldo de rollback.

Las contraseñas no se migran en claro: GoTrue guarda bcrypt y la API acepta bcrypt como
formato heredado y re-hashea a argon2 en el siguiente login exitoso.

**Implementación (T14).** Las herramientas viven en `packages/db/migration-from-supabase/`:
`export.sh` (solo lectura, un único snapshot), `copy-storage.ts` (copia reanudable de imágenes
con claves por restaurante), `import.sh` + `import.sql` (una transacción, rechaza un destino con
datos, regla de una caja abierta por restaurante, contadores) y `verify.sh` (conteos, sumas de
dinero y huérfanos entre origen y destino). `pnpm db:rehearse-migration` ensaya todo el
recorrido con contenedores desechables. Los pasos exactos están en
[runbook-cutover.md](runbook-cutover.md).

## 7. Lo que sale de la VPS

Kong, GoTrue, PostgREST, Supabase Realtime, Supabase Storage, Studio, pg-meta, Logflare,
Vector, imgproxy y el Edge Runtime. Entran NestJS y MinIO. De diez contenedores auxiliares
a dos servicios propios.

**Implementación:** con R2 como almacenamiento, la VPS ejecuta `postgres`, `api`, `web` y el
proxy (más `migrate`, que termina en cada despliegue).
