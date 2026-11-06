# Runbook: corte de Supabase a Postgres + API NestJS

Plan y evidencia: `odd/tasks/migracion-backend-nestjs.md` (T13, T14, T15). Los pasos de despliegue siguen
[despliegue.md](despliegue.md): **opción A** (VPS con `docker-compose.prod.yml` y Caddy) u **opción B** (Coolify con
`docker-compose.coolify.yml`). Donde un paso cambia según la opción, se indican ambas.

El corte mueve datos de forma **irreversible** hacia la base nueva. En Supabase solo se cambian permisos (2.2: se revoca la escritura a `anon` y `authenticated`, con un archivo para restaurarla); los datos no se tocan y el proyecto queda en solo lectura una semana como respaldo.

> **Producción arranca vacía.** El plan vigente (`odd/tasks/migracion-backend-nestjs.md`, L15) no importa datos de
> Supabase a producción: se crea la base, se despliega el stack y se registra el primer restaurante con su
> administrador ([despliegue.md, sección 3.5](despliegue.md#35-primer-restaurante-y-administrador)). En ese caso basta
> con los prerrequisitos de la base destino (sección 0) y el paso 2.7; se omiten el congelamiento, la exportación, la
> importación y la verificación de datos (2.1 a 2.6 y 2.8). Este runbook completo queda como procedimiento opcional
> para una base que sí deba llevar los datos de Supabase.

> **Antes de fusionar la rama.** CI despliega en Coolify en cada push a `dev` (staging) y a `main` (producción) con
> `COOLIFY_APP_UUID_STAGING` / `COOLIFY_APP_UUID_PRODUCTION`, que hoy apuntan a la web anterior. Seguir el orden de
> [despliegue.md, sección 3.3](despliegue.md#33-despliegue-desde-ci): la fusión en `main` y el cambio de
> `COOLIFY_APP_UUID_PRODUCTION` se hacen **dentro** de esta ventana (paso 2.7), nunca antes.

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

  - Opción B ([despliegue.md](despliegue.md#31-crear-los-recursos)): primero el recurso **PostgreSQL** de producción en
    Coolify, con `vipe_migrator` y `vipe_api` creados por `deploy/postgres/create-roles.sh --container <uuid de la base>`
    y su respaldo diario a S3. Después, el recurso Docker Compose de producción con `DATABASE_HOST` igual al UUID de la
    base, **sin dominios asignados todavía** (el dominio de producción sigue en la app anterior hasta 2.7), desplegado
    una vez desde el panel con la rama del corte: `migrate` aplica las migraciones en la base y termina con código 0.
    Detener `api` y `web` hasta el paso 2.7. Si el panel no permite detener un servicio suelto, usar la CLI en la VPS:
    `docker ps --format '{{.Names}}' | grep -E 'api|web'` y `docker stop <contenedor-api> <contenedor-web>`.
  - `TARGET_DATABASE_URL`: conexión de **superusuario** al destino (la importación usa `session_replication_role`).
    Ninguna de las dos opciones publica el puerto de Postgres: ejecutar los scripts **en la VPS** y usar la IP interna
    del contenedor (los scripts corren el cliente con `--network host`):

    Un contenedor conectado a varias redes tiene una IP por red, así que se pide la IP de una red concreta. Ver sus
    redes con `docker inspect -f '{{json .NetworkSettings.Networks}}' <contenedor>`: en la opción A la red es
    `vipe-pos_default` (el compose fija `name: vipe-pos`); en la opción B es la red predefinida `coolify`, y el
    contenedor de la base se llama exactamente como el UUID del recurso de base de datos.

    ```bash
    # Opción A: superusuario postgres con POSTGRES_PASSWORD del .env
    PG_IP=$(docker inspect -f '{{(index .NetworkSettings.Networks "vipe-pos_default").IPAddress}}' \
      "$(docker compose -f docker-compose.prod.yml ps -q postgres)")
    echo "$PG_IP"     # debe ser una sola IP
    export TARGET_DATABASE_URL="postgres://postgres:<POSTGRES_PASSWORD>@$PG_IP:5432/vipe_pos"

    # Opción B: el superusuario es el POSTGRES_USER del recurso de base de datos (su contraseña y su base,
    # POSTGRES_PASSWORD y POSTGRES_DB, están en la configuración del recurso en Coolify)
    PG_IP=$(docker inspect -f '{{(index .NetworkSettings.Networks "coolify").IPAddress}}' <uuid de la base>)
    echo "$PG_IP"     # debe ser una sola IP
    export TARGET_DATABASE_URL="postgres://<POSTGRES_USER>:<POSTGRES_PASSWORD>@$PG_IP:5432/<POSTGRES_DB>"
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

Atajo local: `pnpm db:rehearse-real` corre los pasos 2.3 a 2.6 (export, copia de imágenes, import y verify) contra el Supabase real que indique `SUPABASE_DB_URL`, pero el destino es siempre un Postgres y un MinIO desechables en la máquina del operador. No acepta `TARGET_DATABASE_URL`, así que no puede escribir en Coolify ni en producción, y el origen solo se lee (`export.sh` abre cada sesión en solo lectura). Lo ejecuta quien tiene la contraseña:

```bash
SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
  pnpm db:rehearse-real
```

Imprime los conteos del origen, el reporte de imágenes por estado, el reporte de import y `verify: all N checks passed`, y guarda el log en `/tmp/vipe-rehearse-real-<id>.log` solo si no contiene la credencial. El directorio de export (con hashes reales) se borra siempre al salir. `REHEARSAL_KEEP=1` deja el destino vivo para inspeccionarlo; esos contenedores guardan los hashes reales de las contraseñas, así que hay que borrarlos con `docker rm -f` al terminar. Ctrl-C también borra el export y los contenedores y sale con 130. `pnpm db:test-rehearse-real` prueba el script con el fixture como origen (no corre en CI). Sirve para encontrar desvíos de esquema y datos antes del ensayo completo; no reemplaza la sección 3 contra staging.


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

- Poner la app actual en mantenimiento (o detener el despliegue web).
- **Revocar la escritura en Supabase (obligatorio).** La app anterior habla con Supabase directamente desde el navegador
  con la anon key: una pestaña que ya estaba abierta sigue escribiendo aunque el despliegue esté en mantenimiento. Lo
  escrito después del export se pierde. Ejecutar contra `SUPABASE_DB_URL`, en este orden, **antes** de 2.3. Un cliente
  `psql` en contenedor (la URL viaja por el entorno, no como argumento del proceso del host):

  ```bash
  cd ~/corte-AAAA-MM-DD
  supa_psql() { docker run --rm -i --env SUPABASE_DB_URL postgres:17 sh -c 'psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 "$@"' psql "$@"; }
  ```

  1. Guardar los permisos actuales como sentencias `GRANT` que los restauran (archivo `restaurar-permisos.sql`):

     ```bash
     supa_psql -At > restaurar-permisos.sql <<'SQL'
     SELECT format('GRANT %s ON TABLE %I.%I TO %I;', privilege_type, table_schema, table_name, grantee)
       FROM information_schema.role_table_grants
      WHERE grantee IN ('anon', 'authenticated') AND table_schema = 'public'
        AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
     UNION ALL
     SELECT DISTINCT format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO %s;', p.nspname, p.proname, p.args,
            CASE WHEN r.grantee = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(r.grantee) END)
       FROM information_schema.routine_privileges r
       JOIN (SELECT n.nspname, f.proname, f.proname || '_' || f.oid AS specific_name,
                    pg_get_function_identity_arguments(f.oid) AS args
               FROM pg_proc f JOIN pg_namespace n ON n.oid = f.pronamespace) p
         ON p.nspname = r.specific_schema AND p.specific_name = r.specific_name
      WHERE r.grantee IN ('anon', 'authenticated', 'PUBLIC') AND r.routine_schema = 'public'
        AND r.privilege_type = 'EXECUTE';
     SQL
     wc -l restaurar-permisos.sql     # debe tener líneas; guardarlo junto al export
     ```

  2. Revocar (las RPCs como `pay_order` son `SECURITY DEFINER` y las llama `authenticated`, por eso también `EXECUTE`):

     ```bash
     supa_psql <<'SQL'
     REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
     REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
     SQL
     ```

  3. Comprobar que no queda escritura. `EXECUTE` también puede venir de `PUBLIC` (permiso por defecto de Postgres):
     si la segunda cifra no es 0, ejecutar además `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;`
     (el archivo del paso 1 ya incluye los `GRANT ... TO PUBLIC` para restaurarlo) y repetir la comprobación.

     ```bash
     supa_psql -At <<'SQL'
     SELECT count(*) FROM pg_tables t, unnest(ARRAY['anon', 'authenticated']) AS role
      WHERE t.schemaname = 'public'
        AND has_table_privilege(role, format('%I.%I', t.schemaname, t.tablename), 'INSERT,UPDATE,DELETE');
     SELECT count(*) FROM pg_proc f JOIN pg_namespace n ON n.oid = f.pronamespace,
            unnest(ARRAY['anon', 'authenticated']) AS role
      WHERE n.nspname = 'public' AND has_function_privilege(role, f.oid, 'EXECUTE');
     SQL
     # esperado: 0 y 0
     ```

  4. Guardar los conteos de origen para compararlos antes de 2.7:

     ```bash
     cat > conteos.sql <<'SQL'
     SELECT 'orders', count(*) FROM public.orders UNION ALL
     SELECT 'order_items', count(*) FROM public.order_items UNION ALL
     SELECT 'payments', count(*) FROM public.payments UNION ALL
     SELECT 'payment_transactions', count(*) FROM public.payment_transactions UNION ALL
     SELECT 'cash_transactions', count(*) FROM public.cash_transactions UNION ALL
     SELECT 'cash_registers', count(*) FROM public.cash_registers UNION ALL
     SELECT 'order_deliveries', count(*) FROM public.order_deliveries UNION ALL
     SELECT 'inventory_movements', count(*) FROM public.inventory_movements;
     SQL
     supa_psql -At < conteos.sql > conteos-antes.txt
     ```
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

Justo antes de 2.7, confirmar que Supabase no recibió escrituras desde el export:

```bash
cd ~/corte-AAAA-MM-DD
supa_psql -At < conteos.sql > conteos-despues.txt
diff conteos-antes.txt conteos-despues.txt && echo "sin cambios"
```

Si `diff` muestra diferencias, **abortar**: alguien escribió en Supabase después del export (la revocación de 2.2 no se
aplicó completa). Ir a la sección 4, punto 1, revisar la comprobación de 2.2 y repetir desde 2.3 con
`--force-empty-target` en 2.5 (todavía no se abrió el servicio).

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

Opción B, en este orden (dos recursos no pueden reclamar el mismo dominio en el proxy de Coolify):

1. En la app anterior de Coolify (la web sola), quitar el dominio de producción de su campo **Domains** y guardar, o
   detener la app. Anotar el valor exacto que tenía, para la reversión.
2. En el recurso Docker Compose nuevo, asignar los dominios de [despliegue.md](despliegue.md#31-crear-los-recursos)
   (`api` → `https://<sitio>:4000/api,https://<sitio>:4000/socket.io`, `web` → `https://<sitio>:3000`), con
   *Strip prefixes* desactivado, y redeplegar el recurso (o iniciar `api` y `web` con `docker start` si se detuvieron
   por la CLI; la asignación de dominios requiere redeplegar para que el proxy la tome).
3. Cambiar el secreto `COOLIFY_APP_UUID_PRODUCTION` al UUID del recurso nuevo y fusionar en `main`
   ([despliegue.md, sección 3.3](despliegue.md#33-despliegue-desde-ci), paso 5). El job `deploy` vuelve a desplegar el
   mismo commit en el recurso nuevo.

En ambas opciones, comprobar:

```bash
curl -s https://<sitio>/api/health
# {"status":"ok","service":"vipe-pos-api"}
curl -s "https://<sitio>/socket.io/?EIO=4&transport=polling"
# 0{"sid":...,"upgrades":["websocket"],...}
```

```bash
curl -sS --http1.1 -o /dev/null -w '%{http_code}\n' --max-time 5 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  "https://<sitio>/socket.io/?EIO=4&transport=websocket"
# 101
```

y, con una sesión iniciada en el navegador, que las pantallas reciben cambios en vivo. Si algo falla, no abrir el
servicio: ir a la sección 4.

> **Desde este paso, nunca usar `import.sh --force-empty-target`**: borra todas las filas de la base nueva, incluidos los
> pedidos y pagos reales hechos después de abrir el servicio.

### 2.8 Limpiar la base staging interna

Cuando la sección 3 esté aprobada, como superusuario en la base nueva:

```bash
# Opción A
docker compose -f docker-compose.prod.yml exec -T postgres psql -U postgres -d vipe_pos -v ON_ERROR_STOP=1 \
  -c 'DROP SCHEMA import_src CASCADE'
# Opción B: el contenedor de la base se llama como su UUID; psql como su POSTGRES_USER en su POSTGRES_DB
docker exec <uuid de la base> sh -c \
  'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "DROP SCHEMA import_src CASCADE"'
```

`import_src` es la copia de los datos de origen que usa `verify.sql`.

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

En Supabase solo cambiaron permisos (2.2); los datos no se tocaron. Volver atrás es restaurar esos permisos y redirigir
el tráfico. Restaurar la escritura (en todos los casos de esta sección):

```bash
cd ~/corte-AAAA-MM-DD
supa_psql < restaurar-permisos.sql
```

1. **Antes de abrir el servicio** (falla en 2.5-2.6, en la comparación de conteos o en la sección 3): no hay nada que revertir en datos. Restaurar los permisos (arriba), mantener la app actual, quitar el modo mantenimiento, corregir y repetir el ensayo. En la opción B, si ya se hizo 2.7, deshacer también los dominios como en el punto 2.
2. **Después de abrir el servicio**: los pedidos y pagos hechos en la base nueva **no** existen en Supabase. Antes de volver, sacar un respaldo de la base nueva para anotarlos:

   ```bash
   # Opción A
   docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U postgres -d vipe_pos -Fc > ~/corte-AAAA-MM-DD/base-nueva.dump
   # Opción B
   docker exec <uuid de la base> sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > ~/corte-AAAA-MM-DD/base-nueva.dump
   ```

   Luego liberar el dominio y volver a la app anterior:

   - Opción A: `docker compose -f docker-compose.prod.yml stop caddy api web` (los datos quedan en el volumen
     `postgres_data`) y apuntar el DNS del dominio de vuelta al despliegue anterior, o volver a desplegarlo en su
     plataforma con su configuración de antes del corte.
   - Opción B, en orden inverso a 2.7:
     1. En el recurso Docker Compose nuevo, quitar los dominios de `api` y `web` y redeplegar (o detener el recurso;
        con la CLI: `docker stop <contenedor-api> <contenedor-web>`). El recurso de base de datos no se detiene ni se
        borra: los datos de la base nueva quedan en él.
     2. En la app anterior, volver a poner en **Domains** el valor anotado en 2.7 y redeplegarla (o iniciarla).
     3. Devolver `COOLIFY_APP_UUID_PRODUCTION` al UUID de la app anterior y revertir la fusión en `main` (un commit de
        reversión), para que el próximo push no vuelva a desplegar el stack nuevo.
   - Restaurar los permisos de Supabase (`restaurar-permisos.sql`, arriba) y quitar el modo mantenimiento de la app anterior.
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
| `rehearse-real.sh` (`pnpm db:rehearse-real`) | `SUPABASE_DB_URL`; opcionales `SUPABASE_PUBLIC_STORAGE_URL`, `REHEARSAL_PORT_BASE` (55500), `REHEARSAL_LOG`, `REHEARSAL_KEEP=1` | Export, copia, import y verify de un Supabase real hacia un Postgres y un MinIO desechables. Rechaza `TARGET_DATABASE_URL`. |
| `scripts/build-source-schema.sh` | opcional `VIPE_SOURCE_COMMIT`, `VIPE_SOURCE_SCHEMA_OUT` | Regenera `fixtures/source-schema.sql` desde `supabase/migrations` leído de Git en ese commit (el directorio ya no existe en la rama). |

Contraseña de los usuarios del fixture: `vipe-rehearsal-2026` (datos sintéticos, no reales).
