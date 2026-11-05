# Runbook: corte de Supabase a Postgres + API NestJS

Borrador de T14 (`odd/tasks/migracion-backend-nestjs.md`). Se finaliza en T15 con los archivos de despliegue de T13.
Los pasos marcados **«completar en T13»** dependen del `docker-compose.prod.yml` y del proxy de producción, que todavía no existen.

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
- Base destino ya creada con roles y migraciones (**completar en T13**: servicio `postgres` + `migrate` del compose de producción):
  - `TARGET_DATABASE_URL`: conexión de **superusuario** al destino (la importación usa `session_replication_role`).
  - `roles.sql` aplicado y `pnpm db:migrate` ejecutado como `vipe_migrator`.
- Almacenamiento S3 (R2 recomendado o MinIO propio) con bucket de lectura pública y las variables de la API: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`, `S3_FORCE_PATH_STYLE`.
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

**Completar en T13**: `docker compose -f docker-compose.prod.yml up -d api web caddy`, healthchecks en verde, proxy apuntando `/api/*` y `/socket.io/*` a la API (con upgrade WebSocket) y el resto a la web.

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
- [ ] Personal: lista completa; asignar contraseña a los usuarios reportados como `user_without_password` (pueden entrar enseguida). Los `user_banned` solo se reactivan con el `UPDATE` del reporte.
- [ ] Inventario: existencias, lotes y movimientos iguales; crear un insumo sin SKU genera el siguiente (`MP-000N`) sin chocar.
- [ ] Compras: crear una orden de compra genera el siguiente número.
- [ ] Impresoras: crear un token por estación (ver 3.6).

### 3.2 Mesero

- [ ] Login, ver mesas con su estado.
- [ ] Crear un pedido de prueba: llega a cocina **en vivo** sin recargar.
- [ ] Agregar ítems a un pedido abierto.

### 3.3 Cocina

- [ ] El pedido de prueba aparece en vivo; marcar ítems como servidos actualiza la mesa en la pantalla del mesero sin recargar.

### 3.4 Caja

- [ ] Caja abierta: es la que quedó abierta (o abrir una nueva; una segunda apertura responde «A register is already open»).
- [ ] Cobrar el pedido de prueba con dos medios de pago; el resumen de caja cuadra.
- [ ] Pedidos completados del día: aparecen los históricos (incluidos los pagos antiguos de `payment_transactions`).
- [ ] Cerrar caja al final de la prueba.

### 3.5 Domicilios

- [ ] Buscar un cliente existente por teléfono: trae sus direcciones.
- [ ] Crear un domicilio de prueba y avanzarlo de estado; el tablero se actualiza en vivo.

### 3.6 Estaciones de impresión (T8c)

En cada equipo con impresora:

1. Admin crea un token para la estación (pantalla Impresoras o `POST /api/devices/printers`); se muestra **una sola vez**.
2. Desinstalar el servicio anterior e instalar la versión nueva de `pos/` (`vipe_pos_installer.iss`).
3. Borrar el archivo de credenciales anterior `%APPDATA%\VipePOS\credentials.dat`.
4. Primer arranque: ingresar `VIPE_API_URL` (dominio de producción) y `VIPE_PRINTER_TOKEN`; quedan cifrados en `%APPDATA%\VipePOS\printer_credentials.dat`.
5. Probar: una comanda desde el mesero y una factura desde caja salen en la impresora correcta, y solo en la de su restaurante.
6. Requisito de proxy (**completar en T13**): `/socket.io/` con upgrade WebSocket y `/api/print/*` reenviando el header `Authorization`.

### 3.7 Datos

- [ ] `verify.sh` en verde (paso 2.6).
- [ ] Totales de pagos del último día operativo iguales a los de Supabase.
- [ ] Ningún `image_url` apunta a `supabase.co`.

## 4. Reversión

Supabase no se tocó durante el corte (solo lecturas), así que volver atrás es redirigir el tráfico.

1. **Antes de abrir el servicio** (falla en 2.5-2.6 o en la sección 3): no hay nada que revertir en datos. Mantener la app actual, quitar el modo mantenimiento (y devolver la escritura a `anon`/`authenticated` si se revocó), corregir y repetir el ensayo.
2. **Después de abrir el servicio**: apuntar el proxy de vuelta a la app anterior (**completar en T13** con el comando exacto). Los pedidos y pagos hechos en la base nueva **no** existen en Supabase: anotarlos a partir de la base nueva antes de volver.
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
| `scripts/build-source-schema.sh` | — | Regenera `fixtures/source-schema.sql` desde `supabase/migrations` (solo útil antes de T13). |

Contraseña de los usuarios del fixture: `vipe-rehearsal-2026` (datos sintéticos, no reales).
