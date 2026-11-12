# Restaurant POS System

![Restaurant POS Logo](/public/vipe-pos.png)

## 🍽️ Descripción General

Un sistema completo de punto de venta (POS) para restaurantes, diseñado para optimizar las operaciones diarias desde la toma de órdenes hasta la gestión administrativa. Esta aplicación web proporciona interfaces específicas para meseros, cocina, cajeros, operadores de domicilios y administradores, con funcionalidades adaptadas a cada rol.

## ✨ Características Principales

- **Multi-rol**: Interfaces específicas para meseros, cocina, cajeros, domicilios y administradores
- **Gestión de mesas**: Asignación de mesas, estados y seguimiento de órdenes
- **Menú digital**: Categorías, platos, precios y descripciones
- **Carrito de compras**: Selección de productos, modificación de cantidades y comentarios
- **Gestión de órdenes**: Creación, seguimiento y finalización de órdenes
- **Pagos**: Procesamiento de pagos completos y parciales con diferentes métodos
- **Caja registradora**: Apertura, cierre, adiciones y retiros de efectivo
- **Inventario**: Artículos con SKU, fórmulas y preparaciones por lotes, bodegas, compras, conteos y mermas (ver [docs/inventario.md](docs/inventario.md))
- **Reportes**: Ventas, productos populares, transacciones y más
- **Domicilios**: Pedidos a domicilio con registro de clientes por teléfono, repartidores, tablero de estados y cobro anticipado o contra entrega (ver [docs/delivery-module.md](docs/delivery-module.md))
- **Impresión**: Tickets de cocina y facturas para clientes, con cola durable por restaurante
- **Promociones**: Configuración y aplicación de descuentos y ofertas
- **Configuración de negocio**: Personalización de impuestos, propinas y datos del negocio
- **Tiempo real**: Mesas, órdenes y domicilios se actualizan en todas las pantallas sin recargar
- **Diseño responsive**: Adaptado para dispositivos móviles y de escritorio

## 🛠️ Tecnologías Utilizadas

- **Frontend**: Next.js, React, TypeScript, Tailwind CSS, Shadcn, Zustand y TanStack Query
- **Backend**: API NestJS (`apps/api`) con contrato OpenAPI y cliente tipado generado (`openapi-fetch`)
- **Base de datos**: PostgreSQL 16 con Drizzle ORM y migraciones SQL (`packages/db`); políticas RLS y RPCs plpgsql para las operaciones transaccionales
- **Autenticación**: propia de la API (argon2id, JWT de acceso y sesión de refresco en cookies httpOnly)
- **Tiempo real**: `LISTEN/NOTIFY` de Postgres reenviado por socket.io
- **Almacenamiento**: compatible con S3 (Cloudflare R2 o MinIO) con URLs prefirmadas
- **Impresión**: servicio de Windows en Python (`pos/`)

> **Migración.** El proyecto funcionó sobre Supabase hasta esta migración; las decisiones, la topología y el estado están en [docs/arquitectura-backend.md](docs/arquitectura-backend.md).

## 📋 Requisitos Previos

- Node.js 24 y pnpm (la versión que usan las imágenes es pnpm 11)
- Docker con el plugin Docker Compose v2 (base de datos local, pruebas de base de datos, pruebas de integración de la API y almacenamiento local)
- Python 3.11 o superior solo para desarrollar el servicio de impresión

## 🚀 Configuración Inicial

El repositorio es un workspace de pnpm: la web vive en la raíz, la API en `apps/api` y el esquema de base de datos en `packages/db`.

### 1. Clonar el repositorio e instalar dependencias

```bash
git clone https://github.com/tu-usuario/restaurant-pos.git
cd restaurant-pos
pnpm install
```

### 2. Base de datos local

```bash
pnpm db:dev
```

Levanta el servicio `db` de `docker-compose.yml` (Postgres 16 con pgTAP), aplica las migraciones de `packages/db/migrations/` como `vipe_migrator` y carga `packages/db/seed/dev.sql`. Es idempotente: se puede repetir sin duplicar datos. Si el puerto 5432 está ocupado, usa `VIPE_DB_PORT=5433` (y ajusta `DATABASE_URL` en `apps/api/.env`).

### 3. Almacenamiento de imágenes (opcional)

```bash
docker compose up -d minio minio-init
```

MinIO local (API S3 en `:9000`, consola en `:9001`) con el bucket público `vipe-dev`. Sin él todo funciona salvo la subida de imágenes de platos (`/api/storage/*` responde 503).

### 4. API

```bash
cp apps/api/env.example apps/api/.env
pnpm api:dev
```

API NestJS en `http://localhost:4000`, documentación OpenAPI en `http://localhost:4000/api/docs`. `apps/api/env.example` ya apunta a la base y al MinIO locales.

### 5. Web

```bash
pnpm dev
```

La landing page pública queda en `http://localhost:3000` y el portal del sistema (login y vistas por rol) en `http://localhost:3000/portal`. Ingresa con una de las [cuentas de desarrollo](#cuentas-locales-de-desarrollo).

La web llama siempre a su propio origen (`/api/...`), sin URL de API en el build. En desarrollo, `next.config.mjs` reenvía `/api/:path*` y `/socket.io/` a `API_PROXY_TARGET` (variable del servidor de Next, por defecto `http://localhost:4000`; ver `.env.example`); en producción lo hace el proxy inverso. Así las cookies de sesión son del mismo origen.

### Reiniciar la base local

`pnpm db:dev` no borra datos. Para empezar de cero, elimina el contenedor y su volumen y vuelve a ejecutarlo:

```bash
docker compose down -v      # borra también el volumen de MinIO local
pnpm db:dev
```

## 📱 Guía de Uso

### Acceso al Sistema

El sistema se usa desde `/portal`: tras iniciar sesión, se mostrará una pantalla de selección de perfil:

- **Mesero**: Para tomar órdenes y gestionar mesas
- **Cocina**: Para ver y procesar órdenes
- **Cajero**: Para gestionar pagos y la caja registradora
- **Operador de domicilios**: Para tomar pedidos a domicilio, despacharlos y cerrarlos
- **Administrador**: Para configuración y reportes

El rol lo define la cuenta con la que se inició sesión (lo resuelve la API en cada petición): los perfiles no tienen contraseña propia.

#### Cuentas locales de desarrollo

`pnpm db:dev` carga `packages/db/seed/dev.sql`, que crea estas cuentas, todas con la contraseña `vipe-dev-2026` (guardada como hash argon2id). Son **solo para desarrollo local**; la semilla nunca se carga en producción.

| Correo | Rol |
|--------|-----|
| `admin@vipe.local` | Administrador |
| `mesero@vipe.local` | Mesero |
| `caja@vipe.local` | Cajero |
| `cocina@vipe.local` | Cocina |
| `domicilios@vipe.local` | Operador de domicilios |

#### Datos de demostración y primer restaurante

- `DEMO_PASSWORD=<12+ caracteres> pnpm db:demo` carga en la base `vipe_demo` un restaurante ficticio ("Casa Guadua") con personal de todos los roles (`@demo.vipe.pos`), menú, mesas, inventario con preparaciones, 30 días de historia y actividad en vivo; `--reset` lo reemplaza. Es la demostración de staging, accesible solo desde la red de Tailscale; ver [docs/despliegue.md](docs/despliegue.md), sección 3.6.
- `pnpm db:create-restaurant "<nombre>" <correo>` crea un restaurante y su primer administrador en una base sin registro (producción arranca vacía); la contraseña se lee de `ADMIN_PASSWORD` o de la entrada estándar y `--username` cambia el usuario del perfil. Ver la sección 3.5 de la misma guía.
- Los códigos de salida `2` (uso inválido) y `3` (ya existe) son los mismos con `pnpm` 11, la versión de las imágenes (`pnpm db:demo`, `pnpm db:create-restaurant`), y con `bash` (`bash packages/db/seed/demo/demo-db.sh`, `bash packages/db/seed/bootstrap/create-restaurant.sh`). Otras versiones de `pnpm` pueden devolver `1` para cualquier fallo; para distinguir `2` y `3`, ejecutar el script con `bash`.
- `pnpm db:test-seeds` prueba el contrato de ambos scripts contra contenedores desechables (no corre en CI).

### Vista de Mesero

1. Selecciona una mesa disponible
2. Asigna un mesero (si es necesario)
3. Selecciona productos por categoría
4. Agrega productos al carrito
5. Ajusta cantidades y agrega comentarios si es necesario
6. Envía la orden a cocina

En dispositivos móviles, el carrito se muestra como un botón flotante que abre un modal al hacer clic.

### Vista de Cocina

1. Visualiza las órdenes pendientes
2. Marca los productos como "en preparación" y luego como "listos"
3. Imprime tickets de cocina si es necesario

### Vista de Cajero

1. Abre la caja registradora al inicio del turno
2. Selecciona mesas con órdenes activas
3. Procesa pagos (completos o parciales)
4. Selecciona método de pago
5. Imprime facturas
6. Registra entradas y salidas de efectivo
7. Cierra la caja al final del turno

### Vista de Domicilios

El operador de domicilios trabaja desde un tablero de pedidos agrupados por estado.

**Nuevo domicilio** (botón "Nuevo domicilio"):

1. Busca al cliente por teléfono; si existe, se muestran sus direcciones guardadas (también puede registrar un cliente o una dirección nueva y guardarla)
2. Selecciona los productos del menú (el servidor toma los precios del menú)
3. Revisa el valor del domicilio: se sugiere el configurado por el administrador y es editable por pedido (no lleva impuesto ni propina)
4. Elige el modo de pago: **prepago** (Nequi/transferencia) o **contra entrega**; para contra entrega puede indicar "cambio para"
5. Agrega notas (máximo 300 caracteres) y crea el pedido; se envía la comanda a cocina

**Estados**: `recibido → preparando → listo → en camino → entregado`, o `fallido` (con motivo). Un pedido fallido puede reenviarse o cancelarse. Las transiciones se validan en el servidor. No se puede cancelar un pedido que ya tiene un pago.

**Despacho**: al enviar el pedido se elige un repartidor activo; en un reenvío se puede elegir otro. El tablero muestra si el pedido está pagado o pendiente.

**Cobro**: el pago se registra con "Registrar pago" en el tablero o desde el panel **Domicilios por cobrar** de la vista de Cajero. Ambos requieren una caja abierta (el operador no abre ni cierra cajas) y suman el valor del domicilio al total.

**Cocina**: los pedidos a domicilio comparten la cola con la etiqueta **DOMICILIO** y muestran al cliente en lugar de la mesa. Al servir el último producto, el pedido pasa automáticamente a "listo".

### Vista de Administrador

El panel de administración es un dashboard con barra lateral (plegable en escritorio, menú lateral en móvil), buscador de secciones con `⌘K`/`Ctrl+K` y la sección actual en la URL (`#inventory/items`), así que recargar o volver atrás conserva dónde estabas.

| Grupo | Secciones |
|-------|-----------|
| General | Resumen, Órdenes, Mesas, Caja |
| Catálogo | Menú (categorías, platos, promociones), Fórmulas |
| Inventario | Resumen, Artículos, Movimientos, Compras, Producción, Conteos, Bodegas |
| Configuración | Negocio, Impuestos y propinas, Inventario, Métodos de pago, Domicilios, Personal, Impresoras |

La guía de inventario y fórmulas está en [docs/inventario.md](docs/inventario.md).

En Configuración también hay dos apartados relacionados con domicilios:

- **Repartidores**: crea, edita y activa/desactiva repartidores (nombre y teléfono; no inician sesión) y define el valor sugerido del domicilio
- **Personal**: crea, edita, desactiva y elimina cuentas de acceso (correo, contraseña y rol: mesero, cocina, cajero u operador de domicilios) y cambia contraseñas, con `/api/staff`. Solo un administrador activo puede hacerlo, el restaurante es el del administrador, no se pueden crear ni modificar cuentas de administrador ni la propia; estas reglas se aplican dentro de la base de datos. Cambiar la contraseña o desactivar una cuenta cierra sus sesiones abiertas. Ver [docs/delivery-module.md](docs/delivery-module.md#alta-de-cuentas-de-personal)

Y uno para las estaciones de impresión:

- **Impresoras**: crea un token por estación de impresión (se muestra una sola vez), lista la última conexión de cada una y revoca tokens. Ver [Servicio de impresión](#️-servicio-de-impresión-python)

## 📁 Estructura del Proyecto

```
restaurant-pos/
├── app/                    # Rutas y páginas de Next.js
├── components/             # Componentes React
│   ├── admin/              # Componentes para administración
│   ├── auth/               # Componentes de autenticación
│   ├── cashier/            # Componentes para cajeros
│   ├── kitchen/            # Componentes para cocina
│   ├── layout/             # Componentes de estructura
│   ├── pos/                # Componentes del punto de venta
│   ├── printing/           # Componentes de impresión
│   ├── profiles/           # Selección de perfiles
│   ├── theme/              # Componentes de tema
│   ├── ui/                 # Componentes de UI reutilizables
│   └── views/              # Vistas principales por rol
├── hooks/                  # Hooks personalizados
├── lib/                    # Utilidades y lógica de la web
│   ├── api/                # Cliente tipado de la API, servicios por módulo y socket de tiempo real
│   └── realtime/           # Merge de eventos de tiempo real (órdenes y mesas)
├── public/                 # Archivos estáticos
├── store/                  # Estado global (Zustand)
├── types/                  # Definiciones de tipos TypeScript
├── utils/                  # Funciones utilitarias
├── apps/
│   └── api/                # API NestJS (Dockerfile con targets api y migrate)
├── packages/
│   └── db/                 # Migraciones SQL, roles, semilla, pruebas pgTAP, cliente Drizzle
│       └── migration-from-supabase/  # Herramientas del corte de datos (runbook)
├── pos/                    # Servicio de impresión en Python (Windows)
├── deploy/                 # Caddyfile e init de roles de producción
└── docs/                   # Arquitectura, despliegue, runbook y guías de módulos
```

## 🔄 Flujo de Datos

1. **Autenticación**: `POST /api/auth/login` deja las cookies de sesión; la API resuelve el perfil, el rol y el restaurante en cada petición
2. **Acceso a datos**: la web usa los servicios de `lib/api/` sobre el cliente tipado; la API abre una transacción por petición con `app.user_id`, y las políticas RLS limitan los datos al restaurante del usuario
3. **Reglas de negocio**: precios, cuentas, pagos, inventario y estados se calculan en la API y en las RPCs de Postgres, nunca en el navegador
4. **Tiempo Real**: los triggers de Postgres avisan con `pg_notify`; la API reenvía el cambio por socket.io a las pantallas del mismo restaurante
5. **Estado Global**: Zustand y TanStack Query guardan configuración, estado de caja y datos del POS en la web

## 📊 Modelos de Datos

### Tablas Principales

- **categories**: Categorías de productos
- **dishes**: Platos y bebidas
- **ingredients**: Artículos de inventario (materia prima y preparaciones, con SKU)
- **inventory_locations**, **inventory_lots**, **inventory_movements**: Bodegas, lotes y kardex
- **suppliers**, **purchase_orders**: Proveedores y órdenes de compra
- **recipes**, **recipe_ingredients**: Fórmulas de platos y preparaciones (se guardan con la RPC `save_formula`)
- **tables**: Mesas del restaurante
- **profiles**: Usuarios del sistema
- **orders**: Órdenes de clientes
- **order_items**: Productos en cada orden
- **cash_registers**: Registros de caja
- **payment_transactions**: Transacciones de pago
- **cash_transactions**: Movimientos de efectivo
- **promotions**: Promociones y descuentos
- **business_config**: Configuración del negocio

## 🔧 Configuración Avanzada

### Personalización de Impuestos y Propinas

En el panel de administración, puedes configurar:
- Porcentaje de impuestos
- Porcentaje de propina sugerida
- Porcentaje de sugerencia de precio

### Control de Inventario

Con el control de inventario activo, cada venta descuenta la fórmula del plato en la bodega predeterminada. Ver [docs/inventario.md](docs/inventario.md).

### Información del Negocio

Personaliza la información que aparece en las facturas:
- Nombre del negocio
- Dirección
- Teléfono
- NIT/RUT/RFC

## 🧪 Pruebas

| Comando | Qué cubre | Requiere |
|---|---|---|
| `pnpm test` | Web: lógica, hooks y componentes (Vitest) | — |
| `pnpm test:watch` | Lo mismo, en modo interactivo | — |
| `pnpm typecheck` | Tipos de la web | — |
| `pnpm lint` | ESLint de la web | — |
| `pnpm api:test` | API: specs unitarias y de integración (Vitest; las de integración levantan Postgres y MinIO con Testcontainers) | Docker |
| `pnpm api:lint`, `pnpm api:typecheck`, `pnpm api:build` | Calidad estática y compilación de la API | — |
| `pnpm db:typecheck` | Paquete de base de datos y herramientas de migración | — |
| `pnpm test:db` | Base de datos: RLS, permisos, RPCs y triggers (pgTAP sobre Postgres 16) | Docker |
| `pnpm db:rehearse-migration` | Ensayo completo de la migración de datos con contenedores desechables | Docker |
| `pnpm db:rehearse-real` | Ensayo de la migración con datos reales de Supabase (`SUPABASE_DB_URL`) hacia contenedores desechables | Docker |
| `python3 -m unittest discover -s pos` | Servicio de impresión (sin impresora ni red) | Python 3.11 |

Otras verificaciones: `pnpm build` (web).

### Pruebas de base de datos

El comportamiento de la base de datos (políticas RLS, permisos, RPCs) se cubre con
pruebas SQL de pgTAP en `packages/db/tests/`, que corren sobre el servicio `db` de
`docker-compose.yml` (Postgres 16 + pgTAP), con las migraciones de
`packages/db/migrations/` aplicadas y `pg_prove`:

```bash
pnpm test:db                                                  # todos los archivos
pnpm test:db packages/db/tests/010_tenant_isolation.test.sql  # uno solo
```

El script recrea en cada ejecución la base desechable `vipe_pos_test` (la base
de desarrollo `vipe_pos` no se toca), aplica las migraciones como `vipe_migrator`,
carga `packages/db/tests/seed.sql` y ejecuta los archivos. Si el puerto 5432 está
ocupado, usa `VIPE_DB_PORT=5433 pnpm test:db`.

Cada archivo es autónomo (`BEGIN; ... SELECT plan(n); ... finish(); ROLLBACK;`), así
que la base nunca se modifica. Para suplantar a un usuario se usa el rol de la API
y el ajuste `app.user_id`, igual que hace la API en cada transacción:

```sql
SELECT set_config('app.user_id', '<uuid del usuario>', true);
SET LOCAL ROLE vipe_api;
```

Consulta `packages/db/tests/README.md` para escribir pruebas.

### Base de datos y contrato

```bash
pnpm db:migrate                                # aplica packages/db/migrations (requiere DATABASE_URL de vipe_migrator)
pnpm --filter @vipe/db schema:pull             # regenera packages/db/src/schema desde una base migrada (requiere DATABASE_URL)
pnpm --filter @vipe/api openapi                # escribe apps/api/openapi.json
pnpm web:api-types                             # genera lib/api/schema.d.ts desde openapi.json
```

`apps/api/openapi.json` y `lib/api/schema.d.ts` están versionados; CI falla si alguno
difiere de lo que produce el código.

---

## 🔌 API (apps/api)

La API expone `GET /api/health` y la documentación OpenAPI en `/api/docs`. Todas las rutas viven bajo `/api`; el tiempo real, en `/socket.io/`.

### Autenticación

Cookies httpOnly (`SameSite=Lax`): `vipe_access` (JWT de acceso, ruta `/`) y `vipe_refresh` (token opaco de refresco, ruta `/api/auth`). Toda ruta exige `vipe_access` salvo las públicas; cada petición autenticada corre en una transacción con `app.user_id`, de modo que RLS limita los datos al restaurante del usuario.

| Endpoint | Respuesta |
| --- | --- |
| `POST /api/auth/login` `{email, password}` | `200 {user: {id, email}, profile: {id, name, role, restaurantId}}` y ambas cookies; `401 Invalid credentials` si el correo no existe, la contraseña es incorrecta o el usuario está inactivo; `403` si el usuario no tiene perfil activo. |
| `POST /api/auth/refresh` | `204` y cookies rotadas; `401` si falta el token de refresco, venció, fue revocado o ya se usó. |
| `POST /api/auth/logout` | `204`, revoca la sesión (por la cookie de refresco o, si falta, por la de acceso) y borra ambas cookies. El token de acceso deja de valer de inmediato. |
| `GET /api/auth/me` | `200` con el mismo cuerpo del login; `401` sin cookie de acceso válida. |

Los errores siempre tienen la forma `{statusCode, error, message}`. Las respuestas 4xx originadas en la base de datos incluyen `code` (SQLSTATE) y, para `P0001` con `DETAIL`, `details`; los 422 de validación no llevan `code`.

### Tiempo real

Socket.io en el namespace `/realtime` (ruta `/socket.io`), autenticado con la misma cookie `vipe_access` del handshake; sin cookie válida, sesión viva y perfil activo la conexión falla con `connect_error` `unauthorized`. Un `Origin` de navegador distinto de `WEB_ORIGIN` también se rechaza. Cada socket entra a la sala `restaurant:<id>` de su restaurante y recibe:

| Evento | Payload |
| --- | --- |
| `ready` | `{restaurantId}` al quedar suscrito. |
| `pos_changes` | `{schema: 'public', table, commit_timestamp, eventType: 'INSERT' \| 'UPDATE' \| 'DELETE', new, old, errors: null}`, la forma `RealtimePostgresChangesPayload` que consumen `lib/realtime/order-merge.ts` y `table-merge.ts`, para `orders` (con `new.order_items`), `order_items` (con el `old` completo), `tables` (con `new.waiter_name`) y `order_deliveries`. |
| `resync` | Sin payload; el listener de Postgres se reconectó y pudo perder cambios: el cliente vuelve a leer el estado. |

La web abre una sola conexión `socket.io-client` (versión fija `4.8.4`, la
misma del servidor) al namespace `/realtime`, autenticada con la cookie de sesión
(`lib/api/realtime.ts`). Recibe `pos_changes` (mesas con `waiter_name`, órdenes con
`order_items`, ítems de orden), y ante `resync` o una reconexión vuelve a leer las
órdenes, las mesas y los domicilios; tras un refresco de sesión se reconecta. La ruta es
`/socket.io/` con la barra final: en desarrollo `next.config.mjs` usa
`skipTrailingSlashRedirect` y una regla explícita para `/socket.io/` (sin ellas Next
responde 308 o envía `/socket.io` y la API contesta 404); en producción el proxy inverso
debe conservar la barra y permitir el upgrade a WebSocket.

### Catálogo y configuración

Lecturas para cualquier rol autenticado, escrituras solo `admin`; DTOs en camelCase, campos desconocidos -> 422.

- `GET|POST /api/catalog/categories` (`?active=true`), `PATCH|DELETE /api/catalog/categories/:id` (409 `Category has dishes` si tiene platos).
- `GET|POST /api/catalog/dishes` (`?categoryId=&active=true&pricing=promotions`: aplica la mejor promoción vigente con el reloj del servidor), `PATCH|DELETE /api/catalog/dishes/:id`.
- `GET|POST /api/catalog/promotions`, `GET /api/catalog/promotions/active`, `PATCH|DELETE /api/catalog/promotions/:id` (borra también sus platos), `GET|PUT /api/catalog/promotions/:id/dishes` (`PUT {dishIds}` reemplaza el conjunto de forma atómica).
- `GET /api/config` (todas las claves conocidas con valores por defecto del servidor, tipadas) y `PUT /api/config` (upsert por restaurante y clave en una transacción; devuelve la configuración completa).

### Órdenes, mesas y meseros

Cada escritura es una sola transacción; la cuenta la calcula la base de datos con `private.recompute_order_bill`, nunca el cliente.

- `GET /api/orders?status=kitchen,delivered&include=table,waiter` (ítems siempre incluidos, más recientes primero, máximo 500) y `GET /api/orders/:id`.
- `POST /api/orders` `{tableId, waiterId?, items: [{dishId, quantity, unitPrice?, comments?}], tipPercentage?, force?}` (admin, mesero, cajero; solo `dine_in`, los domicilios los crea su módulo): el precio cobrado es siempre el del catálogo con las promociones vigentes (reloj del servidor); `unitPrice` es el precio que mostró el cliente y, si difiere, responde 409 `Price changed` con `{prices}` sin escribir nada. 409 `Table has an open order` con `{orderId}` si la mesa ya tiene una orden abierta. Crea la orden y sus ítems en `kitchen`, verifica stock con `check_dishes_stock` (409 `{shortages}` salvo `force: true`), descuenta con `consume_order_stock` y deja la mesa en `kitchen`. `POST /api/orders/:id/items` `{items, force?}` agrega ítems con las mismas reglas (409 `Order is closed` si está pagada o cancelada).
- `PATCH /api/orders/:id/status` `{status: 'delivered'}` (solo desde `kitchen`; `paid` y `cancelled` -> 422), `POST /api/orders/:id/items/served` `{itemIds}` (cocina; al servir el último ítem la orden pasa a `delivered` y la mesa a `served`), `DELETE /api/orders/:id` (admin; `delete_order_with_items`; la mesa se libera solo si no le queda otra orden abierta; 409 `Order is paid` para órdenes pagadas).
- `GET /api/tables` (por número, con `waiterName`), `POST /api/tables`, `PATCH|DELETE /api/tables/:id` (admin; 409 `La mesa tiene órdenes abiertas`; el número es único por restaurante; el PATCH responde 409 si el estado cambia a `kitchen` o `served` sin una orden abierta, o a `available` o `reserved` con una orden abierta), `POST /api/tables/:id/assign` `{waiterId}` (-> `occupied`) y `POST /api/tables/:id/release` `{force?}` (409 desde `kitchen`, `delivered` o `served`, salvo admin con `force: true`, y siempre que la mesa tenga una orden abierta, aunque sea con `force`; liberar una mesa reservada cancela la reserva).
- `GET /api/staff/waiters`: meseros activos del restaurante.

### Pagos y caja

`/api/payments` (métodos de pago con código y orden calculados en el servidor, cobro con `pay_order`, división de cuentas) y `/api/registers` (apertura con hora del servidor, una sola caja abierta por restaurante, resumen y cierre con `register_summary`/`close_register`; con órdenes abiertas el cierre responde 409 `open_orders` salvo `{ "leaveOpenOrders": true }`; el cierre exige el arqueo `countedCash` (pesos enteros, 422 `counted_cash_required`), acepta `denominations` cuya suma debe ser igual (422 `count_mismatch`) y pide `note` cuando hay diferencia con el esperado después de propinas (422 `note_required`), y guarda contado, diferencia, nota, denominaciones y quién cerró; movimientos de efectivo con motivo obligatorio `reason` —`change_fund`, `supplier`, `petty_cash`, `tips_payout`, `safe_deposit` u `other`, que exige `description`— y autor `createdBy`). Las fechas de caja y de órdenes completadas (`?date=AAAA-MM-DD`) usan la zona horaria del restaurante (columna `restaurants.timezone`, por defecto `America/Bogota`).

### Inventario

`/api/inventory`: artículos con stock inicial en la misma transacción, categorías, bodegas, proveedores, lotes FEFO, movimientos paginados (fechas `from`/`to` en la zona horaria del restaurante), ajustes y traslados, órdenes de compra con diff de líneas atómico y recepción con estado de pago, producción, conteos, fórmulas con costo unitario calculado en el servidor y resumen. Disponibilidad de platos: `POST /api/inventory/dish-availability` aplica la regla de `check_dishes_stock` (saldo de la bodega principal; control de inventario desactivado = todo disponible).

### Domicilios

`/api/delivery`: `GET /customers?phone=` busca el cliente por teléfono normalizado (`+57 310…` → `310…`) con sus direcciones (404 si no existe); `GET|POST /couriers` y `PATCH /couriers/:id` administran domiciliarios (escritura solo admin); `POST /orders` crea el domicilio, descuenta inventario y encola la comanda de cocina en una sola transacción y devuelve `consumption` con los faltantes; `POST /orders/:id/status {action, courierId?, reason?}` aplica las transiciones de `set_delivery_status` con el mensaje del servidor y `code`; `GET /active` lista los domicilios abiertos y los cerrados hoy según la zona horaria del restaurante.

### Personal y dashboard

`/api/staff` (solo admin): alta, edición, baja y cambio de contraseña de cuentas de mesero, cocina, cajero y operador de domicilios; las reglas (admin activo del mismo restaurante, nunca un admin ni la propia cuenta, lista de roles permitidos) se aplican dentro de la base de datos. Dashboard: `GET /api/dashboard/summary?days=` calcula ventas del mes, órdenes en cocina, serie diaria y platos más vendidos en la zona horaria del restaurante. Caja del administrador (`/api/cash`, solo admin): todas las cifras usan el **día de negocio**, la fecha de apertura de cada caja en la zona horaria del restaurante menos la hora de corte `businessDayCutoffHour` de `/api/config` (0 a 6, por defecto 4: una caja abierta a la 1:30 a. m. pertenece al día anterior). `GET /api/cash/days/AAAA-MM-DD` entrega el tablero del día (turnos con ventas netas, propinas, medios de pago, movimientos, esperado, contado, diferencia, quién cerró y quién validó; totales, mesas, domicilios, propinas por mesero, anulaciones y el mismo día de la semana anterior), `GET /api/cash/days/AAAA-MM-DD/ledger` el libro con saldo de efectivo acumulado por caja (al cierre es el esperado antes del pago de propinas) y `GET /api/cash/report?from=&to=&group=day|week|month` el resumen del período (máximo 366 días, 422 `range_too_long`) comparado con el período anterior de igual duración, con diferencia por cajero y propinas por mesero. `POST /api/registers/:id/validate` (admin) valida un turno cerrado una sola vez (409 `register_open` si sigue abierto). Informe Z: `POST /api/cash/days/AAAA-MM-DD/z` numera el día cerrado con el siguiente consecutivo del restaurante y guarda su foto (resumen del día, base e impuesto calculados sobre las ventas netas con precios con impuesto incluido, rango de órdenes, descuentos, propinas por método y por mesero, siempre fuera de ventas y de la base); 409 `day_open` con un turno abierto, 409 `day_empty` sin turnos, y una segunda emisión devuelve el mismo Z. `GET /api/cash/z?from=&to=` lista los Z del rango por número con los `gaps` de la numeración y `GET /api/cash/z/:number` entrega uno para reimprimirlo; el día (`GET /api/cash/days/...`) trae `z`. Un Z no se edita ni se borra (tabla `z_reports`, migración 0029). El tipo de impuesto `taxType` de `/api/config` es `INC` (impuesto nacional al consumo, por defecto) o `IVA` y rotula facturas, tirillas y el Z con `taxPercentage` (`INC (8 %)`); cambiarlo no cambia el porcentaje.

### Almacenamiento

La API emite URLs prefirmadas (PUT) hacia un almacenamiento compatible con S3 configurado con `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL` y `S3_FORCE_PATH_STYLE` (ver `apps/api/env.example`); sin esas variables la API arranca y `/api/storage/*` responde 503 `Storage is not configured`. En desarrollo, `docker compose up -d minio minio-init` levanta MinIO (API S3 en `:9000`, consola en `:9001`) y crea el bucket público `vipe-dev`; la imagen es la compilación de Chainguard fijada por digest porque el proyecto original ya no publica imágenes comunitarias. En producción, las variables `S3_*` deben apuntar a Cloudflare R2 u otro almacenamiento compatible con S3, con la regla CORS de [docs/despliegue.md](docs/despliegue.md#4-almacenamiento-de-imágenes). `POST /api/storage/uploads {kind: 'dish', contentType, size}` acepta `image/*` salvo SVG hasta 5 MB y devuelve `{uploadUrl, key, publicUrl}` con la clave `<restaurantId>/dishes/<uuid>.<ext>`; `DELETE /api/storage/objects {publicUrl}` solo borra objetos bajo el prefijo del restaurante.

### Impresión

`POST /api/print/commands` y `POST /api/print/invoices` (cualquier rol con sesión) encolan el ticket y lo envían a las impresoras del restaurante; `GET /api/print/jobs/pending` y `POST /api/print/jobs/:id/ack` (token de impresora como `Authorization: Bearer`); `GET|POST /api/devices/printers` y `DELETE /api/devices/printers/:id` (admin). Detalle en [Servicio de impresión](#️-servicio-de-impresión-python).

### Variables de entorno

Desarrollo: `apps/api/env.example`. Producción: las arma el compose a partir de `env.production.template` (ver [docs/despliegue.md](docs/despliegue.md)).

| Variable | Obligatoria | Valor por defecto | Uso |
| --- | --- | --- | --- |
| `PORT` | no | `4000` | Puerto HTTP. |
| `DATABASE_URL` | sí | | Conexión como `vipe_api` (nunca superusuario ni `BYPASSRLS`). |
| `WEB_ORIGIN` | sí | | Origen de la web autorizado por CORS con credenciales. |
| `JWT_SECRET` | sí | | Clave HS256 del token de acceso; mínimo 32 caracteres. |
| `COOKIE_SECURE` | no | `true` | Marca las cookies como `Secure`; `false` solo en desarrollo local por http. |
| `TRUST_PROXY_HOPS` | no | `0` | Proxies delante de la API cuya IP reenviada (`X-Forwarded-For`) se confía para los límites por cliente; los compose usan `1` (Traefik o Caddy). Nunca más que los saltos reales. |
| `ACCESS_TOKEN_TTL_SECONDS` | no | `900` | Vida del token y la cookie de acceso. |
| `REFRESH_TOKEN_TTL_SECONDS` | no | `2592000` | Vida de la sesión de refresco (30 días). |
| `S3_ENDPOINT` | no | | Endpoint S3 (MinIO local, R2 en producción); vacío para AWS S3. |
| `S3_REGION` | no | `us-east-1` | Región; R2 usa `auto`. |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL` | no | | Bucket, credenciales y URL pública de lectura. Todas vacías = `/api/storage/*` responde 503; incompletas = la API no arranca. |
| `S3_FORCE_PATH_STYLE` | no | `false` | `true` para direcciones `<endpoint>/<bucket>/<clave>` (MinIO). |

---

## 🖨️ Servicio de impresión (Python)

`pos/app.py` es un servicio de Windows (ícono en la bandeja) que imprime comandas y facturas en impresoras térmicas ESC/POS, USB o de red. Se conecta a la API de VIPE.

### Cómo llega un ticket a la impresora

1. La web llama a `sendCommand` o `sendFactura` (`lib/api/print.ts`), que hacen `POST /api/print/commands` o `POST /api/print/invoices` con la sesión del usuario.
2. La API guarda el ticket en `print_jobs` dentro de la transacción de la petición. Cuando la transacción confirma, emite `print_job {id, kind, payload}` solo a la sala `printers:<restaurantId>` del restaurante del usuario.
3. El servicio de impresión imprime el ticket y confirma con `POST /api/print/jobs/<id>/ack`.
4. En cada conexión o reconexión, y cada 60 s mientras está conectado, el servicio pide `GET /api/print/jobs/pending` e imprime lo que quedó pendiente. La API devuelve como máximo 500 trabajos, del más antiguo al más nuevo; el servicio sigue con `?after=<id del último>` hasta recibir menos de 500. Un ticket enviado con el PC apagado se imprime al volver.

Cada impresora recibe solo los tickets de su restaurante.

**Regla de los 7 días.** Cuando arranca, la API borra los trabajos con más de 7 días, impresos o no. Si alguno nunca se imprimió, lo deja en el log de la API como advertencia (`pruned N print jobs older than 7 days that were never printed`). Un servicio de impresión apagado más de 7 días pierde esos tickets.

**Comandas viejas.** Una comanda con más de 12 horas se confirma sin imprimirla, para que la cocina no reciba una ráfaga de pedidos atrasados tras un corte largo. Las facturas se imprimen sin importar su antigüedad.

| `kind` | `payload` (igual al antiguo broadcast) | Impresora |
| --- | --- | --- |
| `command` | `{invoiceNumber, items, waiter, table?, delivery?}`; `invoiceNumber` es el id del trabajo | `comandas` |
| `invoice` | `{invoiceNumber, invoice, displayItems}` (`invoice` es un `PrintableInvoice`) | `facturas` |

El servicio descarta duplicados por id de trabajo, así que un ticket que llega por el socket y por la lista de pendientes sale una sola vez. Una reimpresión de la misma factura es un trabajo nuevo y sí se imprime. Si la impresora no está configurada o falla, el trabajo queda pendiente y se reintenta en la siguiente consulta (máximo 60 s). Un ticket que no se puede generar (datos inválidos) se confirma y se descarta, con su id en el log.

### Tokens de impresora

El servicio se autentica con un token de impresora ligado a un restaurante. No usa cookies ni claves de base de datos.

- Un admin lo crea en **Configuración > Impresoras** (o con `POST /api/devices/printers {name}`). La respuesta trae el token en texto plano (`vpt_...`) **una sola vez**; la API guarda solo su sha256.
- `GET /api/devices/printers` lista las impresoras con `lastSeenAt` (última conexión) y `revokedAt`.
- `DELETE /api/devices/printers/<id>` revoca el token y desconecta sus sockets abiertos. Desde ese momento el socket y `/api/print/jobs/*` responden `unauthorized`/401.

El token viaja como `auth: {token}` en el handshake de socket.io (namespace `/realtime`, ruta `/socket.io`) y como `Authorization: Bearer <token>` en `/api/print/jobs/*`.

La base de desarrollo (`pnpm db:dev`) trae un token listo para el restaurante de prueba:

```
VIPE_PRINTER_TOKEN=vpt_dev-printer-token-2026
```

### 🛵 Impresión de domicilios

Los payloads de comanda y factura incluyen un bloque opcional `delivery`. Con él, la comanda se imprime como `COMANDA — DOMICILIO` con el cliente y las notas, y la factura muestra CLIENTE / TEL / DIRECCION en lugar de MESA / MESERO, la línea `DOMICILIO` dentro del total y `CAMBIO PARA` en pedidos contra entrega. Los payloads sin `delivery` se imprimen igual que antes.

### 📋 Requisitos

* Windows 10 o superior.
* Python 3.11 o superior (solo para desarrollo).
* Impresoras compatibles con ESC/POS, USB o de red.

### 📦 Dependencias

Todas están fijadas con `==` en `pos/requirements.txt`:

| Librería | Uso |
| --- | --- |
| **python-socketio[asyncio_client]** | Conexión socket.io con la API (`print_job`) |
| **aiohttp** | Trabajos pendientes y confirmaciones por HTTP |
| **python-dotenv** | Cargar `pos/.env` en desarrollo |
| **customtkinter** | Diálogos de configuración |
| **pystray** | Ícono en la bandeja de Windows |
| **Pillow** | Imágenes para impresión |
| **html2text** | HTML a texto plano |
| **escpos-python** | Impresoras USB y de red ESC/POS |
| **pywin32** | Cifrado DPAPI de las credenciales (solo Windows) |
| **pyusb** | Detección de impresoras USB |
| **pyinstaller** | Empaquetado del `.exe` |

### ⚙️ Estructura

```
pos/
├── app.py                 # Punto de entrada: bandeja, configuración, conexión con la API
├── print_jobs.py          # Manejo de print_job: duplicados, impresión, cuándo confirmar
├── print_renderer.py      # Bytes ESC/POS de comandas y facturas
├── print_encoder.py       # Negociación de la página de códigos
├── printer_auth.py        # VIPE_API_URL y VIPE_PRINTER_TOKEN
├── dedupe.py              # Caché de trabajos ya impresos
├── test_*.py              # Pruebas unitarias (sin red)
├── requirements.txt
├── vipe_pos_installer.iss # Instalador Inno Setup
└── vipe-pos.ico
```

### 🛠️ Desarrollo local

```bash
pip install -r pos/requirements.txt
```

Crea `pos/.env`:

```
VIPE_API_URL=http://localhost:4000
VIPE_PRINTER_TOKEN=vpt_dev-printer-token-2026
```

Con la API corriendo (`pnpm db:dev` y `pnpm api:dev`):

```bash
python pos/app.py --dev
```

Pruebas (no necesitan impresora, red ni las dependencias de Windows):

```bash
python3 -m unittest discover -s pos
```

### 🏗️ Generar el ejecutable (.exe)

```bash
pip install pyinstaller pywin32
pyinstaller --noconfirm --onedir --windowed --icon=vipe-pos.ico --hidden-import=win32crypt --hidden-import=pywintypes app.py
```

El ejecutable queda en `dist/`. Para el instalador, abre `vipe_pos_installer.iss` en [Inno Setup](https://jrsoftware.org/isinfo.php) y compílalo; genera `VipePOS_Setup.exe`.

### 🚀 Instalación

1. Ejecuta `VipePOS_Setup.exe`. Se instala en `C:\Program Files\Vipe POS` con acceso directo en el menú Inicio, el escritorio y el inicio de Windows.
2. En la primera ejecución pide la URL del servidor (`VIPE_API_URL`) y el token de impresora (`VIPE_PRINTER_TOKEN`).
3. Ambos se guardan cifrados con DPAPI en `%APPDATA%\VipePOS\printer_credentials.dat`.

Para cambiarlos, borra ese archivo y vuelve a abrir el programa.

**Borra `%APPDATA%\VipePOS\credentials.dat`** en cada estación que tenía la versión anterior: guarda la configuración de la versión anterior y ya no se usa.

### 🚚 Pasos de despliegue

1. **Reinstala cada estación** con el nuevo `VipePOS_Setup.exe`; la versión anterior no se conecta a la API y no recibe tickets.
2. **Un token por estación.** Un admin lo crea en **Administración > Configuración > Impresoras** y lo copia (solo se muestra esa vez). Desde la misma pantalla se revoca al retirar la estación. También se puede usar la API con la sesión de un admin (`POST /api/devices/printers {name}`, `DELETE /api/devices/printers/<id>`).
3. **Configura la estación** con `VIPE_API_URL` (la URL pública, sin `/api`) y `VIPE_PRINTER_TOKEN` en el diálogo de la primera ejecución.
4. **Proxy inverso.** Debe enviar a la API `/socket.io/` con el upgrade a WebSocket (`Upgrade` y `Connection`, conservando la barra final) y `/api/print/*` conservando el encabezado `Authorization`.
5. Borra el `credentials.dat` antiguo (ver arriba).

### ✅ Comprobación

1. El ícono aparece en la bandeja del sistema.
2. En la pantalla Impresoras (o `GET /api/devices/printers`), la última conexión de la estación se actualiza al conectar.
3. Envía una orden desde la vista de mesero: la comanda sale en la impresora `comandas`.

---

## 🚀 Despliegue

Producción es una sola VPS con Postgres, la API, la web y un proxy inverso con HTTPS; las imágenes van a Cloudflare R2 (o MinIO en la misma VPS).

- [docs/despliegue.md](docs/despliegue.md): requisitos, opción A con `docker-compose.prod.yml` y Caddy, opción B con Coolify (`docker-compose.coolify.yml`), almacenamiento, estaciones de impresión, seguridad, respaldos y limitaciones conocidas.
- [docs/runbook-cutover.md](docs/runbook-cutover.md): corte de datos desde el sistema anterior, verificación por rol y reversión.
- [DOCKER.md](DOCKER.md): los tres archivos de compose.

| Ambiente | Rama | Despliegue |
|----------|------|------------|
| `production` | `main` | Job `deploy` de CI hacia Coolify en cada push a `main` |
| `staging` | `dev` | Job `deploy` de CI hacia Coolify en cada push a `dev` |

La web no tiene variables de build ni de runtime: el navegador llama a su propio origen. Las variables de producción están en `env.production.template`.

## 🤝 Contribución

1. Haz un fork del repositorio
2. Crea una rama para tu característica (`git checkout -b feature/amazing-feature`)
3. Haz commit de tus cambios (`git commit -m 'Add some amazing feature'`)
4. Haz push a la rama (`git push origin feature/amazing-feature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está licenciado bajo la Licencia MIT - ver el archivo [LICENSE](LICENSE) para más detalles.

## 📞 Soporte

Para soporte, contacta a [rade@support.com](mailto:ahernand.development@gmail.com) o abre un issue en el repositorio.

---

Desarrollado con ❤️ para restaurantes que buscan optimizar sus operaciones.
