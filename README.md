# Restaurant POS System

![Restaurant POS Logo](/public/vipe-pos.png)

## 🍽️ Descripción General

Un sistema completo de punto de venta (POS) para restaurantes, diseñado para optimizar las operaciones diarias desde la toma de órdenes hasta la gestión administrativa. Esta aplicación web proporciona interfaces específicas para meseros, cocina, cajeros y administradores, con funcionalidades adaptadas a cada rol.

## ✨ Características Principales

- **Multi-rol**: Interfaces específicas para meseros, cocina, cajeros y administradores
- **Gestión de mesas**: Asignación de mesas, estados y seguimiento de órdenes
- **Menú digital**: Categorías, platos, precios y descripciones
- **Carrito de compras**: Selección de productos, modificación de cantidades y comentarios
- **Gestión de órdenes**: Creación, seguimiento y finalización de órdenes
- **Pagos**: Procesamiento de pagos completos y parciales con diferentes métodos
- **Caja registradora**: Apertura, cierre, adiciones y retiros de efectivo
- **Inventario**: Artículos con SKU, fórmulas y preparaciones por lotes, bodegas, compras, conteos y mermas (ver [docs/inventario.md](docs/inventario.md))
- **Reportes**: Ventas, productos populares, transacciones y más
- **Domicilios**: Pedidos a domicilio con registro de clientes por teléfono, repartidores, tablero de estados y cobro anticipado o contra entrega (ver [docs/delivery-module.md](docs/delivery-module.md))
- **Impresión**: Tickets de cocina y facturas para clientes
- **Promociones**: Configuración y aplicación de descuentos y ofertas
- **Configuración de negocio**: Personalización de impuestos, propinas y datos del negocio
- **Diseño responsive**: Adaptado para dispositivos móviles y de escritorio

## 🛠️ Tecnologías Utilizadas

- **Frontend**: Next.js, React, TypeScript, Tailwind CSS
- **Backend**: Supabase (PostgreSQL)
- **Estado**: Zustand
- **Gráficos**: Shadcn
- **Autenticación**: Supabase Auth
- **Almacenamiento**: Supabase Storage
- **Tiempo real**: Supabase Realtime

## 📋 Requisitos Previos

- Node.js (v18 o superior)
- npm o yarn
- Cuenta en Supabase

## 🚀 Configuración Inicial

### 1. Clonar el repositorio

```bash
git clone https://github.com/tu-usuario/restaurant-pos.git
cd restaurant-pos
```

### 2. Instalar dependencias

```bash
npm install
# o
yarn install
```

### 3. Configurar variables de entorno

Crea un archivo `.env` en la raíz del proyecto con las siguientes variables:

```
NEXT_PUBLIC_SUPABASE_URL=tu_url_de_supabase
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_clave_anonima_de_supabase
SUPABASE_SERVICE_ROLE_KEY=tu_clave_de_servicio_de_supabase
```

### 4. Configurar la base de datos

La base de datos local se levanta con la [Supabase CLI](https://supabase.com/docs/guides/cli).
Todo el esquema vive en un único directorio versionado, `supabase/migrations/`:

```bash
pnpm supabase start        # levanta db, auth, storage, realtime y studio
pnpm supabase db reset     # aplica las migraciones y carga supabase/seed.sql
```

`pnpm supabase status` muestra la URL local y las claves (`API_URL`,
`ANON_KEY`, `SERVICE_ROLE_KEY`) para pegarlas en el `.env` de la sección anterior.

### Fresh stack

Para borrar la base local y reconstruirla desde cero (migraciones + datos de ejemplo):

```bash
pnpm supabase db reset
```

**Warning:** `supabase db reset` destruye los datos locales (perfiles, mesas, comandas).
Para detener los contenedores: `pnpm supabase stop` (agrega `--no-backup` para borrar también los datos locales).

### 5. Iniciar el servidor de desarrollo

```bash
npm run dev
# o
yarn dev
```

La landing page pública estará disponible en `http://localhost:3000` y el portal del sistema (login y vistas por rol) en `http://localhost:3000/portal`.

## 📱 Guía de Uso

### Acceso al Sistema

El sistema se usa desde `/portal`: tras iniciar sesión, se mostrará una pantalla de selección de perfil:

- **Mesero**: Para tomar órdenes y gestionar mesas
- **Cocina**: Para ver y procesar órdenes
- **Cajero**: Para gestionar pagos y la caja registradora
- **Operador de domicilios**: Para tomar pedidos a domicilio, despacharlos y cerrarlos
- **Administrador**: Para configuración y reportes

El rol lo define la sesión de Supabase de la cuenta: los perfiles no tienen contraseña propia.

#### Cuentas locales de desarrollo

`supabase/seed.sql` (cargado por `pnpm supabase db reset`) crea estas cuentas. Son **solo para desarrollo local**; no las uses en producción.

| Correo | Contraseña | Rol |
|--------|------------|-----|
| `admin@restaurant.com` | `admin123` | Administrador |
| `carlos@restaurant.com` | `carlos123` | Cajero |
| `maria@restaurant.com` | `maria123` | Mesero |
| `deiby@restaurant.com` | `deiby123` | Mesero |
| `tester@restaurant.com` | `tester123` | Mesero |
| `domicilios@restaurant.com` | `domicilios123` | Operador de domicilios |

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
| Configuración | Negocio, Impuestos y propinas, Inventario, Métodos de pago, Domicilios, Personal |

La guía de inventario y fórmulas está en [docs/inventario.md](docs/inventario.md).

En Configuración también hay dos apartados relacionados con domicilios:

- **Repartidores**: crea, edita y activa/desactiva repartidores (nombre y teléfono; no inician sesión) y define el valor sugerido del domicilio
- **Personal**: crea cuentas de acceso (correo, contraseña y rol: mesero, cocina, cajero u operador de domicilios) mediante la Edge Function `create-staff-account`. Solo la puede invocar un administrador, el restaurante se toma del administrador que la invoca y no permite crear cuentas de rol administrador. Ver [docs/delivery-module.md](docs/delivery-module.md#alta-de-cuentas-de-personal) y [DOCKER.md](DOCKER.md) para servirla o desplegarla

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
├── lib/                    # Utilidades y servicios
│   └── supabase/           # Servicios de Supabase
├── public/                 # Archivos estáticos
├── store/                  # Estado global (Zustand)
├── types/                  # Definiciones de tipos TypeScript
├── utils/                  # Funciones utilitarias
├── apps/
│   └── api/                # Backend NestJS (en migración, ver docs/arquitectura-backend.md)
└── packages/
    └── db/                 # Esquema, migraciones SQL y cliente Drizzle
```

El repositorio es un workspace de pnpm. La app web vive en la raíz; el backend y la base
de datos son paquetes propios. La migración desde Supabase hacia este backend se describe en
[docs/arquitectura-backend.md](docs/arquitectura-backend.md).

## 🔄 Flujo de Datos

1. **Autenticación**: Sesión de Supabase; el rol de la cuenta define a qué perfil accede
2. **Estado Global**: Almacenamiento de configuración, estado de caja, y datos del POS
3. **Servicios de Supabase**: Comunicación con la base de datos para CRUD y operaciones complejas
4. **Tiempo Real**: Actualización en tiempo real de órdenes, mesas y estados

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

```bash
npm run test
# o
yarn test
```

La lógica pura de TypeScript (`lib/payments`, `store`) se prueba con Vitest en
entorno Node, sin navegador:

```bash
pnpm test                                      # una pasada
pnpm test:watch                                # modo interactivo
```

Pruebas de la capa de impresión en Python (desde la raíz del repositorio):

```bash
python3 -m unittest pos/test_print_renderer.py
```

Otras verificaciones: `pnpm typecheck` y `pnpm build`.

### Backend (apps/api)

```bash
pnpm api:dev                                   # NestJS en modo watch (lee apps/api/.env, ver apps/api/env.example)
pnpm api:test                                  # specs de la API (Vitest; las de integración levantan Postgres con Testcontainers, requiere Docker)
pnpm api:lint && pnpm api:typecheck            # calidad estática
pnpm api:build                                 # compila packages/db/dist y apps/api/dist
pnpm db:typecheck                              # paquete de base de datos
pnpm db:migrate                                # aplica packages/db/migrations (requiere DATABASE_URL)
pnpm --filter @vipe/db schema:pull             # regenera packages/db/src/schema desde una base migrada (requiere DATABASE_URL)
```

La API expone `GET /api/health` y la documentación OpenAPI en `/api/docs`.

Catálogo y configuración (lecturas para cualquier rol autenticado, escrituras solo `admin`; DTOs en camelCase, campos desconocidos -> 422):

- `GET|POST /api/catalog/categories` (`?active=true`), `PATCH|DELETE /api/catalog/categories/:id` (409 `Category has dishes` si tiene platos).
- `GET|POST /api/catalog/dishes` (`?categoryId=&active=true&pricing=promotions`: aplica la mejor promoción vigente con el reloj del servidor), `PATCH|DELETE /api/catalog/dishes/:id`.
- `GET|POST /api/catalog/promotions`, `GET /api/catalog/promotions/active`, `PATCH|DELETE /api/catalog/promotions/:id` (borra también sus platos), `GET|PUT /api/catalog/promotions/:id/dishes` (`PUT {dishIds}` reemplaza el conjunto de forma atómica).
- `GET /api/config` (todas las claves conocidas con valores por defecto del servidor, tipadas) y `PUT /api/config` (upsert por restaurante y clave en una transacción; devuelve la configuración completa).

Órdenes, mesas y meseros (cada escritura es una sola transacción; la cuenta la calcula la base de datos con `private.recompute_order_bill`, nunca el cliente):

- `GET /api/orders?status=kitchen,delivered&include=table,waiter` (ítems siempre incluidos, más recientes primero, máximo 500) y `GET /api/orders/:id`.
- `POST /api/orders` `{tableId, waiterId?, items: [{dishId, quantity, unitPrice?, comments?}], tipPercentage?, force?}` (admin, mesero, cajero; solo `dine_in`, los domicilios los crea su módulo): el precio cobrado es siempre el del catálogo con las promociones vigentes (reloj del servidor); `unitPrice` es el precio que mostró el cliente y, si difiere, responde 409 `Price changed` con `{prices}` sin escribir nada. 409 `Table has an open order` con `{orderId}` si la mesa ya tiene una orden abierta. Crea la orden y sus ítems en `kitchen`, verifica stock con `check_dishes_stock` (409 `{shortages}` salvo `force: true`), descuenta con `consume_order_stock` y deja la mesa en `kitchen`. `POST /api/orders/:id/items` `{items, force?}` agrega ítems con las mismas reglas (409 `Order is closed` si está pagada o cancelada).
- `PATCH /api/orders/:id/status` `{status: 'delivered'}` (solo desde `kitchen`; `paid` y `cancelled` -> 422), `POST /api/orders/:id/items/served` `{itemIds}` (cocina; al servir el último ítem la orden pasa a `delivered` y la mesa a `served`), `DELETE /api/orders/:id` (admin; `delete_order_with_items`; la mesa se libera solo si no le queda otra orden abierta; 409 `Order is paid` para órdenes pagadas).
- `GET /api/tables` (por número, con `waiterName`), `POST /api/tables`, `PATCH|DELETE /api/tables/:id` (admin; 409 `Table has open orders`; el número es único por restaurante), `POST /api/tables/:id/assign` `{waiterId}` (-> `occupied`) y `POST /api/tables/:id/release` `{force?}` (409 desde `kitchen`, `delivered`, `served` o `reserved`, salvo admin con `force: true`).
- `GET /api/staff/waiters`: meseros activos del restaurante.

#### Stack local sin Supabase (Postgres + API + web)

```bash
pnpm db:dev      # levanta el servicio `db` de docker-compose, aplica las migraciones y carga packages/db/seed/dev.sql
pnpm api:dev     # API en http://localhost:4000 (copiar apps/api/env.example a apps/api/.env)
pnpm dev         # web en http://localhost:3000; /api y /socket.io se reenvían a la API
```

`pnpm db:dev` es idempotente: se puede repetir sin duplicar datos. La semilla crea un
restaurante con categorías, platos y mesas de ejemplo, y estas cuentas, todas con la
contraseña de desarrollo `vipe-dev-2026` (guardada como hash argon2id):

| Correo | Rol |
| --- | --- |
| `admin@vipe.local` | admin |
| `mesero@vipe.local` | waiter |
| `caja@vipe.local` | cashier |
| `cocina@vipe.local` | kitchen |

La web llama siempre a su propio origen (`/api/...`), sin URL de API en el build. En
desarrollo, `next.config.mjs` reenvía `/api/:path*` y `/socket.io/:path*` a
`API_PROXY_TARGET` (variable del servidor de Next, por defecto `http://localhost:4000`);
en producción lo hace el proxy inverso. Así las cookies de sesión son del mismo origen.
El inicio y cierre de sesión ya pasan por la API. Este stack no necesita variables de
Supabase: sin `NEXT_PUBLIC_SUPABASE_URL` ni la clave anónima, el cliente heredado usa
valores inertes y los módulos aún no migrados simplemente no devuelven datos.

Pagos y caja: `/api/payments` (métodos de pago con código y orden calculados en el servidor, cobro con `pay_order`, división de cuentas) y `/api/registers` (apertura con hora del servidor, una sola caja abierta por restaurante, resumen y cierre con `register_summary`/`close_register`, movimientos de efectivo). Las fechas de caja y de órdenes completadas (`?date=AAAA-MM-DD`) usan la zona horaria del restaurante (columna `restaurants.timezone`, por defecto `America/Bogota`).

Inventario (`/api/inventory`): artículos con stock inicial en la misma transacción, categorías, bodegas, proveedores, lotes FEFO, movimientos paginados (fechas `from`/`to` en la zona horaria del restaurante), ajustes y traslados, órdenes de compra con diff de líneas atómico y recepción con estado de pago, producción, conteos, fórmulas con costo unitario calculado en el servidor y resumen. Disponibilidad de platos: `POST /api/inventory/dish-availability` aplica la regla de `check_dishes_stock` (saldo de la bodega principal; control de inventario desactivado = todo disponible).

Impresión: `POST /api/print/commands` y `POST /api/print/invoices` (cualquier rol con sesión) encolan el ticket y lo envían a las impresoras del restaurante; `GET /api/print/jobs/pending` y `POST /api/print/jobs/:id/ack` (token de impresora como `Authorization: Bearer`); `GET|POST /api/devices/printers` y `DELETE /api/devices/printers/:id` (admin). Detalle en [Servicio de impresión](#️-servicio-de-impresión-python).

Domicilios (`/api/delivery`): `GET /customers?phone=` busca el cliente por teléfono normalizado (`+57 310…` → `310…`) con sus direcciones (404 si no existe); `GET|POST /couriers` y `PATCH /couriers/:id` administran domiciliarios (escritura solo admin); `POST /orders` crea el domicilio, descuenta inventario y encola la comanda de cocina en una sola transacción y devuelve `consumption` con los faltantes; `POST /orders/:id/status {action, courierId?, reason?}` aplica las transiciones de `set_delivery_status` con el mensaje del servidor y `code`; `GET /active` lista los domicilios abiertos y los cerrados hoy según la zona horaria del restaurante.

Errores: las respuestas 4xx originadas en la base de datos incluyen `code` (SQLSTATE) y, para `P0001` con `DETAIL`, `details`; los 422 de validación no llevan `code`.

Tiempo real: la web abre una sola conexión `socket.io-client` (versión fija `4.8.4`, la
misma del servidor) al namespace `/realtime`, autenticada con la cookie de sesión
(`lib/api/realtime.ts`). Recibe `pos_changes` (mesas con `waiter_name`, órdenes con
`order_items`, ítems de orden), y ante `resync` o una reconexión vuelve a leer las
órdenes, las mesas y los domicilios; tras un refresco de sesión se reconecta. La ruta es
`/socket.io/` con la barra final: en desarrollo `next.config.mjs` usa
`skipTrailingSlashRedirect` y una regla explícita para `/socket.io/` (sin ellas Next
responde 308 o envía `/socket.io` y la API contesta 404); en producción el proxy inverso
debe conservar la barra y permitir el upgrade a WebSocket.

Contrato tipado: `pnpm --filter @vipe/api openapi` escribe `apps/api/openapi.json` y
`pnpm web:api-types` genera `lib/api/schema.d.ts` (ambos versionados). CI falla si
alguno difiere de lo que produce el código.

Variables de entorno (`apps/api/env.example`):

| Variable | Obligatoria | Valor por defecto | Uso |
| --- | --- | --- | --- |
| `PORT` | no | `4000` | Puerto HTTP. |
| `DATABASE_URL` | sí | | Conexión como `vipe_api` (nunca superusuario ni `BYPASSRLS`). |
| `WEB_ORIGIN` | sí | | Origen de la web autorizado por CORS con credenciales. |
| `JWT_SECRET` | sí | | Clave HS256 del token de acceso; mínimo 32 caracteres. |
| `COOKIE_SECURE` | no | `true` | Marca las cookies como `Secure`; `false` solo en desarrollo local por http. |
| `ACCESS_TOKEN_TTL_SECONDS` | no | `900` | Vida del token y la cookie de acceso. |
| `REFRESH_TOKEN_TTL_SECONDS` | no | `2592000` | Vida de la sesión de refresco (30 días). |

Autenticación por cookies httpOnly (`SameSite=Lax`): `vipe_access` (JWT de acceso, ruta `/`) y `vipe_refresh` (token opaco de refresco, ruta `/api/auth`). Toda ruta exige `vipe_access` salvo las públicas; cada petición autenticada corre en una transacción con `app.user_id`, de modo que RLS limita los datos al restaurante del usuario.

| Endpoint | Respuesta |
| --- | --- |
| `POST /api/auth/login` `{email, password}` | `200 {user: {id, email}, profile: {id, name, role, restaurantId}}` y ambas cookies; `401 Invalid credentials` si el correo no existe, la contraseña es incorrecta o el usuario está inactivo; `403` si el usuario no tiene perfil activo. |
| `POST /api/auth/refresh` | `204` y cookies rotadas; `401` si falta el token de refresco, venció, fue revocado o ya se usó. |
| `POST /api/auth/logout` | `204`, revoca la sesión (por la cookie de refresco o, si falta, por la de acceso) y borra ambas cookies. El token de acceso deja de valer de inmediato. |
| `GET /api/auth/me` | `200` con el mismo cuerpo del login; `401` sin cookie de acceso válida. |

Los errores siempre tienen la forma `{statusCode, error, message}`.

Tiempo real: socket.io en el namespace `/realtime` (ruta `/socket.io`), autenticado con la misma cookie `vipe_access` del handshake; sin cookie válida, sesión viva y perfil activo la conexión falla con `connect_error` `unauthorized`. Un `Origin` de navegador distinto de `WEB_ORIGIN` también se rechaza. Cada socket entra a la sala `restaurant:<id>` de su restaurante y recibe:

| Evento | Payload |
| --- | --- |
| `ready` | `{restaurantId}` al quedar suscrito. |
| `pos_changes` | `{schema: 'public', table, commit_timestamp, eventType: 'INSERT' \| 'UPDATE' \| 'DELETE', new, old, errors: null}`, la forma de `postgres_changes` de Supabase, para `orders` (con `new.order_items`), `order_items` (con el `old` completo), `tables` (con `new.waiter_name`) y `order_deliveries`. |
| `resync` | Sin payload; el listener de Postgres se reconectó y pudo perder cambios: el cliente vuelve a leer el estado. |

### Pruebas de base de datos

El comportamiento de la base de datos (políticas RLS, permisos, RPCs) se cubre con
pruebas SQL de pgTAP en `packages/db/tests/`, que corren sobre Postgres 16 sin
Supabase: el servicio `db` de `docker-compose.yml` (Postgres + pgTAP), las
migraciones de `packages/db/migrations/` aplicadas con `pnpm db:migrate` y
`pg_prove`. Solo requiere Docker; no hace falta `pnpm supabase start`:

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
y el ajuste `app.user_id`, igual que hará la API en cada transacción:

```sql
SELECT set_config('app.user_id', '<uuid del usuario>', true);
SET LOCAL ROLE vipe_api;
```

Consulta `packages/db/tests/README.md` para escribir pruebas. Las pruebas antiguas
de `supabase/tests/` siguen ahí hasta que se retire Supabase (T13).

---

## 🖨️ Servicio de impresión (Python)

`pos/app.py` es un servicio de Windows (ícono en la bandeja) que imprime comandas y facturas en impresoras térmicas ESC/POS, USB o de red. Se conecta a la API de VIPE, no a Supabase.

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

- Un admin lo crea con `POST /api/devices/printers {name}`. La respuesta trae el token en texto plano (`vpt_...`) **una sola vez**; la API guarda solo su sha256.
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

**Borra `%APPDATA%\VipePOS\credentials.dat`** en cada estación que tenía la versión anterior: guarda la URL y la clave de Supabase y ya no se usa.

### 🚚 Pasos de despliegue

1. **Reinstala cada estación** con el nuevo `VipePOS_Setup.exe`; la versión anterior escucha Supabase y no recibe tickets de la API.
2. **Un token por estación.** Hasta que exista la pantalla de impresoras del admin (T12), créalo con la API usando la sesión de un admin:

   ```bash
   curl -X POST https://<servidor>/api/devices/printers \
     -H 'Content-Type: application/json' -b 'vipe_access=<cookie del admin>' \
     -d '{"name": "Cocina principal"}'
   ```

   Copia el `token` de la respuesta (solo se muestra esa vez). Para retirar una estación: `DELETE /api/devices/printers/<id>`.
3. **Configura la estación** con `VIPE_API_URL` (la URL pública, sin `/api`) y `VIPE_PRINTER_TOKEN` en el diálogo de la primera ejecución.
4. **Proxy inverso.** Debe enviar a la API `/socket.io/` con el upgrade a WebSocket (`Upgrade` y `Connection`, conservando la barra final) y `/api/print/*` conservando el encabezado `Authorization`.
5. Borra el `credentials.dat` antiguo (ver arriba).

### ✅ Comprobación

1. El ícono aparece en la bandeja del sistema.
2. En `GET /api/devices/printers`, `lastSeenAt` de la impresora se actualiza al conectar.
3. Envía una orden desde la vista de mesero: la comanda sale en la impresora `comandas`.

---

## 🚀 Despliegue

La aplicación se despliega en Railway con el `Dockerfile` del repositorio (configurado en `railway.json`). Supabase sigue siendo la base de datos.

| Ambiente | Rama | Despliegue |
|----------|------|------------|
| `production` | `main` | Automático en cada push a `main` |
| `staging` | `dev` | Automático en cada push a `dev` |

Cada ambiente necesita estas variables en el servicio `web` de Railway. Se usan en el build, así que un cambio requiere redesplegar:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Para construir localmente:

```bash
pnpm build
```

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
