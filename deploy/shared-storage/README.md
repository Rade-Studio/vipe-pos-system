# Almacenamiento compartido de la VPS (MinIO)

Un único servidor MinIO, compatible con S3, para todas las aplicaciones de la VPS. No pertenece a VIPE POS: se despliega en Coolify como un recurso Docker Compose propio (`deploy/shared-storage/docker-compose.yml`). Cada aplicación y cada ambiente reciben:

- un bucket propio (por ejemplo `vipe-pos-staging`, `vipe-pos-production`);
- un usuario propio, cuya política solo permite `s3:GetObject`, `s3:PutObject` y `s3:DeleteObject` sobre los objetos de ese bucket (sin listar, sin acceso a otros buckets);
- lectura anónima de objetos por su clave (`s3:GetObject`), sin listado anónimo del bucket.

Las credenciales administradoras (`MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`) solo se usan para aprovisionar; ninguna aplicación las recibe. El script las pasa al contenedor de `mc` como variables de entorno por nombre y `mc alias set` las lee por la entrada estándar; el secreto de la aplicación llega a `mc admin user add` también por la entrada estándar. Ninguna credencial aparece como argumento de un proceso. La contraseña administradora no puede empezar ni terminar con espacios, porque `mc` los recorta al leerla; se recomienda `openssl rand -hex 32`.

## Archivos

| Archivo | Uso |
|---|---|
| `docker-compose.yml` | Recurso de Coolify: servicio `minio`, volumen `minio_data`, sin puertos publicados. La cabecera describe dominios y variables. |
| `provision-app.sh` | Crea o actualiza bucket, lectura anónima, usuario y política de una aplicación, e imprime su bloque `S3_*`. |
| `test.sh` | Prueba local sin Coolify (dos aplicaciones, aislamiento, CORS, URL prefirmada, idempotencia). Limpia todo al terminar. |

## Puesta en marcha

1. En Coolify, crear el recurso Docker Compose con `/deploy/shared-storage/docker-compose.yml` y seguir la cabecera del archivo: dominio `https://<s3-dominio>:9000` para la API S3 (lo usan los navegadores y las URL prefirmadas), Strip prefixes desactivado. La consola (puerto 9001) no se publica: se usa con un túnel SSH sobre Tailscale, `ssh -L 9001:<ip-del-contenedor>:9001 root@100.103.73.111`, y `http://localhost:9001`.
2. Definir `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` (`openssl rand -hex 32`) y `MINIO_CORS_ORIGINS`.
3. Desplegar y comprobar `curl -s -o /dev/null -w '%{http_code}\n' https://<s3-dominio>/minio/health/live` (debe imprimir `200`).

## Conectar una aplicación nueva

1. Elegir un bucket por aplicación y ambiente: `<app>-staging`, `<app>-production`. Un usuario por bucket: si el usuario ya existe con la política de otro bucket, el script termina con código 3 sin cambiar nada; usar otro nombre de usuario.
2. Agregar el origen de la aplicación (por ejemplo `https://pos.example.com`) a `MINIO_CORS_ORIGINS`, separado por comas, y volver a desplegar el recurso. MinIO aplica esta lista a todos los buckets del servidor: no existe CORS por bucket.
3. En la VPS, con la red Docker del recurso (`docker network ls`, la red lleva el UUID del recurso de Coolify):

   ```bash
   read -r MINIO_ROOT_USER; read -rs MINIO_ROOT_PASSWORD   # valores del recurso en Coolify; no quedan en el historial
   export MINIO_ROOT_USER MINIO_ROOT_PASSWORD
   MINIO_NETWORK=<red-del-recurso> S3_PUBLIC_ENDPOINT=https://<s3-dominio> \
     bash deploy/shared-storage/provision-app.sh vipe-pos-production vipe-pos-production
   ```

   Sin acceso a la red Docker, apuntar el cliente al dominio público: `MINIO_URL=https://<s3-dominio>` y sin `MINIO_NETWORK`.
4. Copiar el bloque impreso en la sección Environment de la aplicación. El secreto se muestra una sola vez:

   ```text
   S3_ENDPOINT=https://<s3-dominio>
   S3_REGION=us-east-1
   S3_BUCKET=vipe-pos-production
   S3_ACCESS_KEY_ID=vipe-pos-production
   S3_SECRET_ACCESS_KEY=<48 caracteres hexadecimales>
   S3_PUBLIC_BASE_URL=https://<s3-dominio>/vipe-pos-production
   S3_FORCE_PATH_STYLE=true
   ```

El script es idempotente: volver a ejecutarlo mantiene el usuario y su secreto (imprime el bloque con la línea del secreto comentada) y reaplica bucket, lectura anónima y política.

## Rotar la clave de una aplicación

```bash
MINIO_NETWORK=<red-del-recurso> S3_PUBLIC_ENDPOINT=https://<s3-dominio> \
  bash deploy/shared-storage/provision-app.sh --rotate vipe-pos-production vipe-pos-production
```

El secreto anterior deja de funcionar de inmediato. Pegar el nuevo `S3_SECRET_ACCESS_KEY` en la aplicación y volver a desplegarla; hasta entonces sus subidas fallan (las lecturas públicas siguen funcionando).

## Respaldos y restauración

El volumen `minio_data` contiene todos los buckets. Dos formas:

- **Copia del volumen** (el recurso detenido para una copia consistente):

  ```bash
  docker run --rm -v <volumen-minio_data>:/data:ro -v "$PWD":/backup alpine \
    tar czf /backup/minio-$(date +%F).tgz -C /data .
  ```

  Restaurar: detener el recurso, vaciar el volumen y extraer el archivo con `tar xzf` en `/data`; luego iniciar el recurso.
- **Copia por bucket**, sin detener el servicio: `mc mirror local/<bucket> /backup/<bucket>` desde un contenedor `minio-client` con la misma imagen del script; restaurar con `mc mirror /backup/<bucket> local/<bucket>`. Los usuarios y políticas se vuelven a crear con `provision-app.sh` (con `--rotate`, porque los secretos no se respaldan así).

Probar la restauración en una VPS o volumen aparte antes de necesitarla.

## Por qué imágenes de Chainguard

MinIO dejó de publicar imágenes y binarios comunitarios actualizados. Chainguard mantiene `cgr.dev/chainguard/minio` y `cgr.dev/chainguard/minio-client` compiladas desde el código fuente, con actualizaciones de seguridad. Ambas se fijan por digest (el mismo que `docker-compose.prod.yml`) para que cada despliegue use exactamente la imagen probada; actualizar el digest es un cambio explícito y revisado.

## Prueba local

```bash
bash deploy/shared-storage/test.sh
```

Termina con `PASS shared-storage` y elimina sus contenedores, volumen y red.
