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
| `pos_changes` | `{schema: 'public', table, commit_timestamp, eventType: 'INSERT' \| 'UPDATE' \| 'DELETE', new, old, errors: null}`, la forma de `postgres_changes` de Supabase, para `orders`, `tables` y `order_deliveries`. |
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

## 🖨️ Sistema de Impresión y Suscripción en Python

Complementario a la aplicación web, este sistema se encarga de:

* Escuchar en tiempo real los eventos de Supabase (comandas y facturas).
* Imprimir automáticamente en impresoras térmicas USB o de red.
* Ejecutarse al iniciar Windows gracias al instalador.

### 🛵 Impresión de domicilios

Los payloads de comanda y factura incluyen un bloque opcional `delivery` (aditivo). Con él, la comanda se imprime como `COMANDA — DOMICILIO` con el cliente y las notas, y la factura muestra CLIENTE / TEL / DIRECCION en lugar de MESA / MESERO, la línea `DOMICILIO` dentro del total y `CAMBIO PARA` en pedidos contra entrega. Los payloads sin `delivery` se imprimen igual que antes. Un listener antiguo ignora ese bloque: la comanda de un domicilio sale como `COMANDA — Mesa None` y la factura no trae la línea `DOMICILIO`, de modo que su `TOTAL SIN PROPINA` no incluye la tarifa aunque `TOTAL A PAGAR` sí. Actualiza el ejecutable de impresión antes de usar domicilios.

### 🚩 Características

* Conexión en tiempo real a Supabase (canales de comandas y facturas).
* Soporte para impresoras USB y de red.
* Manejo de credenciales en entorno seguro (cifrado en AppData).
* Autoarranque al iniciar Windows.
* Compatible con Windows 10/11.

### 📋 Requisitos Previos

* Windows 10 o superior.
* Python 3.11 o superior (solo para desarrollo).
* Impresoras compatibles con ESC/POS o de red.

---

## 🧑‍💻 Dependencias del Sistema Python

Estas son las librerías necesarias para desarrollo y empaquetado del sistema de impresión en Python.

### 📦 Dependencias para Desarrollo

Instala todas desde `requirements.txt` o individualmente:

```bash
pip install python-dotenv customtkinter pystray Pillow html2text escpos-python pywin32 usb
```

O crea un `requirements.txt` con:

```
python-dotenv
customtkinter
pystray
Pillow
html2text
escpos-python
pywin32
usb
```

### 🛠️ Dependencias Específicas Explicadas

| Librería          | Uso Principal                                  |
| ----------------- | ---------------------------------------------- |
| **python-dotenv** | Cargar variables desde .env en desarrollo      |
| **customtkinter** | Interfaces gráficas para capturar credenciales |
| **pystray**       | Ícono en la bandeja del sistema Windows        |
| **Pillow**        | Manejo de imágenes para impresión              |
| **html2text**     | Convertir HTML a texto plano para impresoras   |
| **escpos-python** | Control de impresoras USB y de red ESC/POS     |
| **pywin32**       | Cifrado/descifrado con DPAPI (win32crypt)      |
| **usb**           | Detección de dispositivos USB                  |

---

Incluye este bloque debajo de la sección **Requisitos Previos** o **Configuración Inicial** para que esté completamente documentado. ¿Te gustaría que también lo traduzca al inglés si vas a publicarlo internacionalmente?

### ⚙️ Estructura del Proyecto Python

```
pos-listener/
├── app.py                    # Punto de entrada
├── requirements.txt          # Dependencias
├── vipe_pos_installer.iss    # Script de instalador Inno Setup
└── assets/
    └── vipe-pos.ico          # Icono del sistema
```

### 🛠️ Desarrollo Local

#### 1. Instalar dependencias

```bash
pip install -r requirements.txt
```

#### 2. Configurar entorno de desarrollo

Crea un archivo `.env`:

```
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_KEY=tu-api-key
ENVIRONMENT=dev
```

#### 3. Ejecutar en modo desarrollo

```bash
python app.py --dev
```

### 🏗️ Generar el Ejecutable (.exe)

#### 1. Instalar PyInstaller

```bash
pip install pyinstaller pywin32
```

#### 2. Generar el ejecutable

```bash
pyinstaller --noconfirm --onedir --windowed --icon=assets/vipe-pos.ico --hidden-import=win32crypt --hidden-import=pywintypes app.py
```

El ejecutable se creará en `dist/vipe_pos/vipe_pos.exe`.

### 🛠️ Crear Instalador (.exe)

#### 1. Instalar Inno Setup

Descarga desde [https://jrsoftware.org/isinfo.php](https://jrsoftware.org/isinfo.php)

#### 2. Abrir `vipe_pos_installer.iss` y compilar

Esto generará un archivo `VipePOS_Setup.exe`.

### 🚀 Instalación

1. Ejecuta `VipePOS_Setup.exe`.
2. El sistema se instalará en `C:\Program Files\Vipe POS`.
3. Se creará un acceso directo en el menú Inicio, Escritorio y carpeta de inicio (autoarranque).
4. La primera vez que se ejecute, solicitará las credenciales de Supabase.
5. Las credenciales se almacenarán cifradas en `%APPDATA%\VipePOS\credentials.dat`.

### ✅ Comprobación

1. Verifica que el sistema esté corriendo en segundo plano (ícono en la bandeja del sistema).
2. Realiza una orden desde la app web.
3. La impresora debería recibir automáticamente la comanda o factura.

### 🛠️ Reconfigurar Credenciales

Si necesitas cambiar las credenciales:

1. Elimina el archivo `%APPDATA%\VipePOS\credentials.dat`.
2. Vuelve a ejecutar el sistema y se te pedirá ingresarlas nuevamente.

---

¿Quieres que prepare también un ejemplo de `.gitignore` para este proyecto Python?

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
