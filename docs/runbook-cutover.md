# Runbook: corte de Supabase a Postgres + API NestJS

Plan y evidencia: `odd/tasks/migracion-backend-nestjs.md` (T13, T14, T15). Los pasos de despliegue siguen
[despliegue.md](despliegue.md): **opción A** (VPS con `docker-compose.prod.yml` y Caddy) u **opción B** (Coolify con
`docker-compose.coolify.yml`). Donde un paso cambia según la opción, se indican ambas.

El corte mueve datos de forma **irreversible** hacia la base nueva. Supabase no se modifica: queda en solo lectura una semana como respaldo.

## Resumen

| Fase | Dónde | Duración estimada | Escribe en producción |
|---|---|---|---|
| 0. Prerrequisitos | equipo del operador | 1 día antes | No |
| 1. Ensayo en staging | copia de producción | 1-2 h | No |
| 2. Ventana de congelamiento | producción | 30-60 min | Sí (base nueva) |
| 3. Verificación por rol y pantalla | producción | 30 min | Solo pruebas controladas |
| 4. Reversión (si hace falta) | proxy | 5 min | No |

## 0. Prerrequisitos

- Docker en el equipo que ejecuta el corte. No hace falta instalar `psql`: los scripts usan la imagen `postgres:17` (`PG_CLIENT_IMAGE` la cambia; `PG_CLIENT=local` usa el `psql` del sistema).
- Node 24 y pnpm 11, con el repositorio en la rama del despliegue y `pnpm install` hecho.
- Acceso a Supabase:
  - `SUPABASE_DB_URL`: conexión del **session pooler** (Settings → Database → Connection string → Session pooler), con la forma `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`. La conexión directa `db.<ref>.supabase.co` solo resuelve por IPv6: úsela únicamente desde un equipo con IPv6. No sirve el transaction pooler (puerto 6543), porque el export mantiene una sesión abierta con un snapshot. El export solo lee.
  - Las cadenas de conexión deben ser URL `postgres://` o `postgresql://` (no se aceptan cadenas `host=... password=...`). Si la contraseña tiene `@`, `:` o `/`, codifíquelos como `%40`, `%3A` y `%2F`. Los scripts nunca pasan la contraseña como argumento de un proceso.
  - `SUPABASE_PUBLIC_STORAGE_URL`: `https://<ref>.supabase.co/storage/v1/object/public`.
- Base destino ya creada con roles y migraciones, **sin** la API ni la web en marcha (así nadie escribe antes de la importación):
  - Opción A, en la VPS con el `.env` completo ([despliegue.md](despliegue.md#21-archivo-de-entorno)):

    ```bash
    docker compose -f docker-compose.prod.yml up -d --wait postgres    # crea vipe_migrator y vipe_api con el volumen vacío
    docker compose -f docker-compose.prod.yml up --build migrate       # aplica packages/db/migrations y termina con código 0
    ```

  - Opción B: crear el recurso de Coolify ([despliegue.md](despliegue.md#31-crear-el-recurso)) y desplegarlo una vez;
    `postgres` y `migrate` dejan el esquema listo. Detener `api` y `web` desde el panel hasta el paso 2.7.
  - `TARGET_DATABASE_URL`: conexión de **superusuario** al destino (la importación usa `session_replication_role`).
    Ningún compose publica el puerto de Postgres: ejecutar los scripts **en la VPS** y usar la IP interna del
    contenedor (los scripts corren el cliente con `--network host`):

    ```bash
    # Opción A
    PG_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \
      "$(docker compose -f docker-compose.prod.yml ps -q postgres)")
    # Opción B (Coolify nombra el contenedor con el UUID del recurso)
    PG_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' <contenedor-postgres>)

    export TARGET_DATABASE_URL="postgres://postgres:<POSTGRES_PASSWORD>@$PG_IP:5432/vipe_pos"
    ```

    En ese caso la VPS también necesita Node 24, pnpm y el repositorio con `pnpm install` (para `copy-storage.ts`).
- Almacenamiento S3 (R2 recomendado o MinIO propio, ver [despliegue.md](despliegue.md#4-almacenamiento-de-imágenes)) con bucket de lectura pública, la regla CORS para el origen de la web y las variables de la API: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`, `S3_FORCE_PATH_STYLE`.
- Un directorio de trabajo nuevo y privado, por ejemplo `~/corte-AAAA-MM-DD/`. **Contiene hashes de contraseñas**: no subirlo a ningún lado y borrarlo al cerrar la semana de respaldo.
- Lista de estaciones de impresión (equipo, restaurante, persona en sitio) para reinstalarlas (ver 3.6).
- Confirmar que el ensayo automático pasa en el commit que se va a desplegar:

  ```bash
  pnpm db:rehearse-migration
  ```

  Debe terminar en `rehearsal: PASS`. Recorre fixture → export → copia de imágenes → import → verify → login por la API.

> Ninguno de los scripts imprime contraseñas ni cadenas de conexión completas; solo `host:puerto/base`.

## 1. Ensayo en staging contra una copia de producción

Objetivo: correr exactamente los mismos comandos del corte sobre datos reales, sin tocar producción.

1. Crear una copia de la base de Supabase (backup restaurado en un proyecto o Postgres de staging). Ese es el `SUPABASE_DB_URL` del ensayo.
2. Levantar un destino de staging vacío con roles y migraciones, y un bucket S3 de staging.
3. Ejecutar los pasos 2.3 a 2.7 contra staging.
4. Revisar con calma:
   - `import-report.txt`: usuarios sin contraseña, usuarios borrados, cajas cerradas por la regla 0009, imágenes sin copia, contadores ajustados.
   - `storage-report.csv`: objetos faltantes, rechazados (SVG o no imagen) y sin referencia.
   - Que `verify.sh` termine con `verify: all N checks passed`.
5. Probar la app de staging con la sección 3 completa.
6. Anotar tiempos de cada paso para dimensionar la ventana real.

Si algo falla, se corrige en el repositorio y se repite el ensayo. **No se pasa a producción con un ensayo fallido.**

## 2. Ventana de congelamiento (producción)

Avisar al restaurante: durante la ventana no se toman pedidos ni pagos. Elegir una hora sin servicio.

### 2.1 Cerrar la operación

- Todas las cajas cerradas desde la app actual (si alguna queda abierta, la importación aplica la regla 0009 y deja abierta solo la de actividad más reciente; las otras quedan registradas en `private.migration_0009_closed_registers`).
- Sin pedidos activos en cocina, o anotados para recrearlos.
- Domicilios en curso entregados o anotados.

### 2.2 Congelar Supabase

- Poner la app actual en mantenimiento (o detener el despliegue web) para que nadie escriba.
- Opcional y recomendado: revocar escritura a `anon` y `authenticated` desde el SQL editor de Supabase, para garantizar solo lectura.
- Consistencia del export: `export.sh` toma **un solo snapshot** (`pg_export_snapshot()` en una sesión que queda abierta, `pg_dump --snapshot` y `SET TRANSACTION SNAPSHOT` para los CSV y los conteos), así que todos los archivos describen el mismo instante aunque alguien escribiera durante el export. Aun así, el congelamiento es obligatorio: lo que se escriba en Supabase **después** del export no llega a la base nueva.

### 2.3 Exportar (solo lectura)

```bash
export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
bash packages/db/migration-from-supabase/export.sh ~/corte-AAAA-MM-DD/export
```

Esperado: `export: users: N, dish objects: N, dishes with image: N, tables: 36` y `done`.

### 2.4 Copiar imágenes

```bash
export SUPABASE_PUBLIC_STORAGE_URL='https://<ref>.supabase.co/storage/v1/object/public'
export S3_ENDPOINT=... S3_REGION=... S3_BUCKET=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...
export S3_PUBLIC_BASE_URL=... S3_FORCE_PATH_STYLE=...
pnpm --filter @vipe/db exec tsx migration-from-supabase/copy-storage.ts ~/corte-AAAA-MM-DD/export
```

- Esperado: `copied N, already present 0, failed 0`. Si `failed` > 0 el script termina con código 1: **volver a ejecutarlo** (es reanudable, salta lo ya copiado con el mismo tamaño). No importar hasta que termine con 0: `import.sh` rechaza (código 4) un export cuyo `storage-report.csv` tenga filas `failed`.
- Las claves son `<restaurantId>/dishes/<uuid>.<ext>`, iguales a las que emite la API.

### 2.5 Importar

```bash
export TARGET_DATABASE_URL='postgres://postgres:<password>@<host>:5432/vipe_pos'
bash packages/db/migration-from-supabase/import.sh ~/corte-AAAA-MM-DD/export
```

- Corre en **una sola transacción**: ante cualquier error no queda nada a medias.
- Si el destino ya tiene datos, se niega (`target is not empty`, código 3) y no cambia nada. Solo si se sabe que esos datos sobran (por ejemplo, un intento previo): repetir con `--force-empty-target`, que borra todas las filas de la aplicación dentro de la misma transacción.
- Guardar `import-report.txt` y revisarlo:
  - `user_without_password`: importados **activos** con un hash inutilizable; no pueden entrar hasta que el admin les asigne una contraseña desde Personal (el reporte trae el id de perfil). Con eso entran de inmediato.
  - `user_banned`: importados **inactivos**. La app no tiene cómo reactivarlos: cuando el bloqueo deba terminar, ejecutar como `vipe_migrator` el `UPDATE public.users SET is_active = true WHERE id = '...';` que imprime el reporte para ese usuario.
  - `user_deleted_skipped`: no se importan; su perfil queda sin login y desactivado (los pedidos históricos lo siguen referenciando).
  - `register_closed_0009`: cajas cerradas por la regla de una caja abierta por restaurante.
  - `image_refused_type` (aparece primero): imágenes que no se copiaron porque son SVG o no son imágenes (la API tampoco las acepta); el plato queda sin imagen. Volver a subirla en PNG, JPG o WebP desde Menú.
  - `image_cleared`: platos cuya URL apuntaba a un objeto que no existe en Storage; quedan sin imagen.
  - `counter_raised`: contadores de SKU y documentos ajustados al máximo en uso.

### 2.6 Verificar

```bash
S3_PUBLIC_BASE_URL=... bash packages/db/migration-from-supabase/verify.sh
```

Debe terminar con `verify: all N checks passed`. Cualquier `FAIL` detiene el corte: ir a la sección 4.

### 2.7 Encender el stack nuevo

Antes, el DNS del dominio debe apuntar a la VPS nueva (si cambió de servidor) y las variables `S3_*` del stack deben ser
las mismas usadas en 2.4.

Opción A:

```bash
docker compose -f docker-compose.prod.yml up -d --build --wait api web caddy
docker compose -f docker-compose.prod.yml ps        # postgres, api, web y caddy "healthy"; migrate "exited (0)"
```

Caddy envía `/api/*` y `/socket.io/*` a la API (con el upgrade a WebSocket y la cabecera `Authorization`) y el resto a la
web (`deploy/Caddyfile`).

Opción B: iniciar `api` y `web` desde el panel de Coolify (o redeplegar el recurso) con los dominios y *Strip prefixes*
de [despliegue.md](despliegue.md#31-crear-el-recurso).

En ambas opciones, comprobar:

```bash
curl -s https://<sitio>/api/health
# {"status":"ok","service":"vipe-pos-api"}
curl -s "https://<sitio>/socket.io/?EIO=4&transport=polling"
# 0{"sid":...,"upgrades":["websocket"],...}
```

y, con una sesión iniciada en el navegador, que `wss://<sitio>/socket.io/?EIO=4&transport=websocket` queda en `101` en la
pestaña Red. Si algo falla, no abrir el servicio: ir a la sección 4.

### 2.8 Limpiar la base staging interna

Cuando la sección 3 esté aprobada:

```sql
DROP SCHEMA import_src CASCADE;  -- copia de los datos de origen usada por verify.sql
```

## 3. Lista de verificación por rol y pantalla

Usar un usuario real de cada rol. Marcar cada punto. Los usuarios importados con bcrypt pasan a argon2id en su primer login (transparente para ellos).

### 3.1 Admin

- [ ] Login con su contraseña de siempre.
- [ ] Panel: ventas del mes y platos populares coinciden con el último reporte de Supabase.
- [ ] Menú: platos con imagen se ven (URL bajo `S3_PUBLIC_BASE_URL`); subir una imagen nueva funciona.
- [ ] Personal: crear una cuenta de prueba, iniciar sesión con ella y eliminarla.
- [ ] Personal: lista completa; asignar contraseña a los usuarios reportados como `user_without_password` (pueden entrar enseguida). Los `user_banned` solo se reactivan con el `UPDATE` del reporte.
- [ ] Inventario: existencias, lotes y movimientos iguales; crear un insumo sin SKU genera el siguiente (`MP-000N`) sin chocar.
- [ ] Compras: crear una orden de compra genera el siguiente número.
- [ ] Órdenes y Mesas: la orden de prueba aparece con su mesa y mesero; crear y editar una mesa.
- [ ] Configuración: impuestos, propinas, métodos de pago y valor del domicilio conservan sus valores.
- [ ] Impresoras: crear un token por estación (ver 3.6).

### 3.2 Mesero

- [ ] Login, ver mesas con su estado.
- [ ] Crear un pedido de prueba: llega a cocina **en vivo** sin recargar.
- [ ] Agregar ítems a un pedido abierto.
- [ ] En un segundo navegador (otro mesero o el admin) la mesa cambia de estado sin recargar.
- [ ] Liberar una mesa sin pedido; una mesa con pedido en cocina no se puede liberar.

### 3.3 Cocina

- [ ] El pedido de prueba aparece en vivo; marcar ítems como servidos actualiza la mesa en la pantalla del mesero sin recargar.
- [ ] El domicilio de prueba (3.5) aparece con la etiqueta **DOMICILIO**; al servir el último producto pasa a «listo» en el tablero de domicilios.
- [ ] La comanda sale en la impresora de comandas (3.6).

### 3.4 Caja

- [ ] Caja abierta: es la que quedó abierta (o abrir una nueva; una segunda apertura responde «A register is already open»).
- [ ] Cobrar el pedido de prueba con dos medios de pago; el resumen de caja cuadra.
- [ ] Pedidos completados del día: aparecen los históricos (incluidos los pagos antiguos de `payment_transactions`).
- [ ] Cerrar caja al final de la prueba.

### 3.5 Domicilios

- [ ] Buscar un cliente existente por teléfono: trae sus direcciones.
- [ ] Crear un domicilio de prueba y avanzarlo de estado; el tablero se actualiza en vivo.
- [ ] Despachar con un repartidor activo y entregar.
- [ ] Registrar el pago con una caja abierta (desde el tablero o desde «Domicilios por cobrar» en Caja); el total incluye el valor del domicilio.

### 3.6 Estaciones de impresión (T8c)

En cada equipo con impresora:

1. Admin crea un token para la estación (pantalla Impresoras o `POST /api/devices/printers`); se muestra **una sola vez**.
2. Desinstalar el servicio anterior e instalar la versión nueva de `pos/` (`vipe_pos_installer.iss`).
3. Borrar el archivo de credenciales anterior `%APPDATA%\VipePOS\credentials.dat`.
4. Primer arranque: ingresar `VIPE_API_URL` (dominio de producción) y `VIPE_PRINTER_TOKEN`; quedan cifrados en `%APPDATA%\VipePOS\printer_credentials.dat`.
5. Probar: una comanda desde el mesero y una factura desde caja salen en la impresora correcta, y solo en la de su restaurante.
6. Requisito de proxy: `/socket.io/` con upgrade WebSocket (conservando la barra final) y `/api/print/*` reenviando el header `Authorization`. La opción A lo cumple con `deploy/Caddyfile`; en la opción B lo confirman las comprobaciones de 2.7.
7. En la pantalla Impresoras, la estación muestra su última conexión.

### 3.7 Datos

- [ ] `verify.sh` en verde (paso 2.6).
- [ ] Totales de pagos del último día operativo iguales a los de Supabase.
- [ ] Ningún `image_url` apunta a `supabase.co`.

## 4. Reversión

Supabase no se tocó durante el corte (solo lecturas), así que volver atrás es redirigir el tráfico.

1. **Antes de abrir el servicio** (falla en 2.5-2.6 o en la sección 3): no hay nada que revertir en datos. Mantener la app actual, quitar el modo mantenimiento (y devolver la escritura a `anon`/`authenticated` si se revocó), corregir y repetir el ensayo.
2. **Después de abrir el servicio**: los pedidos y pagos hechos en la base nueva **no** existen en Supabase. Antes de volver, sacar un respaldo de la base nueva para anotarlos:

   ```bash
   # Opción A
   docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U postgres -d vipe_pos -Fc > ~/corte-AAAA-MM-DD/base-nueva.dump
   # Opción B
   docker exec <contenedor-postgres> pg_dump -U postgres -d vipe_pos -Fc > ~/corte-AAAA-MM-DD/base-nueva.dump
   ```

   Luego liberar el dominio y volver a la app anterior:

   - Opción A: `docker compose -f docker-compose.prod.yml stop caddy api web` (los datos quedan en el volumen
     `postgres_data`) y apuntar el DNS del dominio de vuelta al despliegue anterior, o volver a desplegarlo en su
     plataforma con su configuración de antes del corte.
   - Opción B: detener `api` y `web` del recurso Docker Compose en Coolify y volver a desplegar en ese dominio el
     recurso anterior (la web de antes del corte, con sus variables de Supabase).
   - Quitar el modo mantenimiento de la app anterior y devolver la escritura a `anon`/`authenticated` si se revocó (2.2).
3. Supabase queda en **solo lectura una semana** como respaldo y referencia. Pasada la semana sin incidentes: borrar el directorio de trabajo del corte, y pausar o eliminar el proyecto de Supabase.

## Referencia de scripts

Todos en `packages/db/migration-from-supabase/`.

| Script | Variables | Qué hace |
|---|---|---|
| `export.sh <dir>` | `SUPABASE_DB_URL` | Dump de datos de `public` y `private.inventory_counters`, CSV de `auth.users`, objetos del bucket `dishes`, imágenes de platos y conteos. Solo lectura. |
| `copy-storage.ts <dir>` | `SUPABASE_PUBLIC_STORAGE_URL`, `S3_*` | Copia imágenes por restaurante y escribe `mapping.csv` y `storage-report.csv`. Reanudable. |
| `import.sh <dir> [--force-empty-target]` | `TARGET_DATABASE_URL` (superusuario) | Carga en `import_src` y ejecuta `import.sql` en una transacción. Rechaza un destino con datos. |
| `verify.sh` | `TARGET_DATABASE_URL`, `S3_PUBLIC_BASE_URL` | Ejecuta `verify.sql`; código distinto de 0 ante cualquier diferencia. |
| `rehearse.sh` (`pnpm db:rehearse-migration`) | opcional `REHEARSAL_PORT_BASE` (55400) | Ensayo completo con contenedores desechables. |
| `scripts/build-source-schema.sh` | opcional `VIPE_SOURCE_COMMIT`, `VIPE_SOURCE_SCHEMA_OUT` | Regenera `fixtures/source-schema.sql` desde `supabase/migrations` leído de Git en ese commit (el directorio ya no existe en la rama). |

Contraseña de los usuarios del fixture: `vipe-rehearsal-2026` (datos sintéticos, no reales).
