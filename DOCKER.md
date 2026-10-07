# Docker - VIPE POS System

## Desarrollo Local

### Requisitos
- Docker y Docker Compose instalados
- [Supabase CLI](https://supabase.com/docs/guides/cli) (se ejecuta vía `pnpm supabase`)
- pnpm (se instala en el Dockerfile)

### La base de datos la levanta la Supabase CLI

El stack de Supabase local (db, kong, auth, storage, realtime, studio) **ya no se
levanta con Docker Compose**: lo administra la Supabase CLI y expone sus servicios en
los puertos `4432x` del host.

```bash
# 1. Levantar Supabase (db, auth, storage, realtime, studio)
pnpm supabase start

# 2. Ver URL y claves para pegarlas en el .env de la raíz
pnpm supabase status
#    NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:44321
#    NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY que imprime `supabase status`>

# 3. (Opcional) Rebuild de la base: aplica supabase/migrations/ + supabase/seed.sql
pnpm supabase db reset

# 4. Pruebas SQL de pgTAP contra la base local
pnpm test:db
```

> `supabase db reset` destruye los datos locales (perfiles, mesas, comandas).
> Para detener los contenedores: `pnpm supabase stop` (agrega `--no-backup` para
> borrar también los datos locales).

### App Next.js en Docker

`docker-compose.yml` solo levanta la app. Toma `NEXT_PUBLIC_SUPABASE_URL` y
`NEXT_PUBLIC_SUPABASE_ANON_KEY` del entorno o del `.env` de la raíz (localmente los
de `pnpm supabase status`), y se pasan como build args porque Next.js las inlinea
en build time.

```bash
# App en http://localhost:3003 (puerto del host 3003 -> 3000 del contenedor)
docker compose up -d --build
docker compose logs -f app
docker compose down

# Atajos equivalentes
pnpm docker:dev:build
pnpm docker:dev:down
```

Los servicios de Supabase local siguen accesibles en el host:

| Servicio | URL |
|----------|-----|
| App Next.js (contenedor) | http://localhost:3003 |
| Supabase API (URL local) | http://127.0.0.1:44321 |
| Supabase Studio | http://127.0.0.1:54323 |

Usa `pnpm supabase status` para ver las URLs y claves vigentes.

---

## Producción

### Requisitos
- Docker y Docker Compose instalados
- Una instancia de **Supabase Cloud** o **Supabase Self-hosted** activa
- URL y Anon Key de tu proyecto Supabase

### Configuración

```bash
# 1. Copiar archivo de variables de producción
cp env.production.template .env

# 2. Editar .env con los datos de tu Supabase:
#    - NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
#    - NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Iniciar en producción

```bash
# Build y start
pnpm docker:prod

# Detener
pnpm docker:prod:down

# Ver logs
pnpm docker:prod:logs
```

### Con Nginx (opcional)

Descomentar la sección `nginx` en `docker-compose.prod.yml` y crear la configuración:

```nginx
# nginx/nginx.conf
server {
    listen 80;
    server_name tu-dominio.com;

    location / {
        proxy_pass http://app:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## Estructura de archivos

```
├── docker-compose.yml        # Desarrollo (solo App; la DB usa la Supabase CLI)
├── docker-compose.prod.yml   # Producción (solo App)
├── Dockerfile                # Multi-stage build
├── env.production.template   # Template variables producción
└── supabase/
    ├── migrations/           # Migraciones SQL (fuente de verdad del esquema)
    ├── tests/                # Pruebas pgTAP (pnpm test:db)
    ├── config.toml           # Configuración local de la Supabase CLI
    └── seed.sql              # Datos iniciales
```

## Notas importantes

1. **Esquema**: todo el esquema vive en `supabase/migrations/` y lo aplica la Supabase CLI
2. **Seed de datos**: lo carga automáticamente `pnpm supabase db reset`
3. **Build args**: `NEXT_PUBLIC_SUPABASE_*` se inlinean en build time; si faltan, el contenedor
   no arranca y Docker Compose indica cuáles definir
4. **Producción**: no incluye Supabase local; depende completamente de tu instancia de Supabase externa