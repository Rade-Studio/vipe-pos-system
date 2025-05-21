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
- **Inventario**: Control de ingredientes, recetas y alertas de stock bajo
- **Reportes**: Ventas, productos populares, transacciones y más
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

Ejecuta los scripts SQL en el siguiente orden para configurar la base de datos en Supabase:

1. `create-database-schema.sql` - Crea las tablas principales
2. `create-storage-bucket.sql` - Configura el almacenamiento
3. `create-business-config-table.sql` - Tabla de configuración
4. `create-payment-transactions-table.sql` - Transacciones de pago
5. `create-cash-transactions-table.sql` - Transacciones de caja
6. `create-ingredient-transactions-table.sql` - Transacciones de ingredientes
7. `create-recipes-tables.sql` - Tablas de recetas
8. `create-promotions-table.sql` - Tabla de promociones
9. `insert-sample-data.sql` - Datos de ejemplo (opcional)

Puedes ejecutar estos scripts desde la interfaz SQL de Supabase o usando la herramienta CLI.

### 5. Iniciar el servidor de desarrollo

```bash
npm run dev
# o
yarn dev
```

La aplicación estará disponible en `http://localhost:3000`.

## 📱 Guía de Uso

### Acceso al Sistema

Al iniciar la aplicación, se mostrará una pantalla de selección de perfil:

- **Mesero**: Para tomar órdenes y gestionar mesas
- **Cocina**: Para ver y procesar órdenes
- **Cajero**: Para gestionar pagos y la caja registradora
- **Administrador**: Para configuración y reportes

Cada perfil está protegido por una contraseña que puede configurarse en el panel de administración.

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

### Vista de Administrador

1. Gestiona el menú (categorías y platos)
2. Configura mesas
3. Administra personal
4. Controla inventario
5. Configura promociones
6. Visualiza reportes y estadísticas
7. Configura parámetros del negocio (impuestos, propinas, etc.)

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
└── utils/                  # Funciones utilitarias
```

## 🔄 Flujo de Datos

1. **Autenticación**: Gestión de perfiles y acceso mediante contraseñas
2. **Estado Global**: Almacenamiento de configuración, estado de caja, y datos del POS
3. **Servicios de Supabase**: Comunicación con la base de datos para CRUD y operaciones complejas
4. **Tiempo Real**: Actualización en tiempo real de órdenes, mesas y estados

## 📊 Modelos de Datos

### Tablas Principales

- **categories**: Categorías de productos
- **dishes**: Platos y bebidas
- **ingredients**: Ingredientes para el inventario
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

Activa o desactiva el control de inventario para:
- Seguimiento automático de ingredientes
- Alertas de stock bajo
- Prevención de venta de productos sin stock

### Contraseñas de Acceso

Configura contraseñas personalizadas para cada rol:
- Mesero
- Cocina `default: 1234`
- Cajero `default: 5678`
- Administrador `default: 9999`

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

---

## 🖨️ Sistema de Impresión y Suscripción en Python

Complementario a la aplicación web, este sistema se encarga de:

* Escuchar en tiempo real los eventos de Supabase (comandas y facturas).
* Imprimir automáticamente en impresoras térmicas USB o de red.
* Ejecutarse al iniciar Windows gracias al instalador.

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

La aplicación está optimizada para desplegarse en Vercel:

```bash
npm run build
# o
yarn build
```

Para otros proveedores, asegúrate de configurar correctamente las variables de entorno.

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
