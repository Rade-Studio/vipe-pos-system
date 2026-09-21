# Docker - VIPE POS System

## Desarrollo Local

### Requisitos
- Docker y Docker Compose instalados
- pnpm (se instala en el Dockerfile)

### Iniciar todo (Supabase + App)

```bash
# 1. Copiar archivo de variables de entorno
cp env.docker.template .env.docker

# 2. Iniciar contenedores
docker-compose up -d

# 3. Esperar ~30 segundos y ejecutar seed
pnpm docker:dev:seed
# O manualmente:
# docker exec -i supabase-db psql -U postgres -d postgres < supabase/seed.sql

# 4. Ver logs
pnpm docker:dev:logs

# 5. Abrir en navegador
open http://localhost:3000
```

### Servicios disponibles en desarrollo

| Servicio | URL |
|----------|-----|
| App Next.js | http://localhost:3000 |
| PostgreSQL | localhost:5432 |
| REST API | http://localhost:3000 |
| Auth | http://localhost:9999 |
| Storage | http://localhost:5000 |
| Studio (Prisma) | http://localhost:5555 |

### Comandos útiles

```bash
# Reconstruir y reiniciar
pnpm docker:dev:build

# Detener todo
pnpm docker:dev:down

# Ver logs de un servicio específico
docker-compose logs -f db
docker-compose logs -f app

# Acceder a PostgreSQL
docker exec -it supabase-db psql -U postgres -d postgres

# Ver migraciones aplicadas
docker exec -it supabase-db psql -U postgres -d postgres -c "\\dt"

# Resetear base de datos
docker-compose down -v
docker-compose up -d
```

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
├── docker-compose.yml        # Desarrollo (Supabase + App)
├── docker-compose.prod.yml   # Producción (solo App)
├── Dockerfile                # Multi-stage build
├── env.docker.template       # Template variables desarrollo
├── env.production.template   # Template variables producción
└── supabase/
    ├── migrations/           # Migraciones SQL
    └── seed.sql             # Datos iniciales
```

## Notas importantes

1. **Primera ejecución**: Las migraciones se aplican automáticamente al iniciar PostgreSQL por primera vez
2. **Seed de datos**: Debe ejecutarse manualmente después del primer inicio
3. **Persistencia**: Los datos de PostgreSQL persisten en el volumen `supabase-db-data`
4. **Producción**: No incluye Supabase local; depende completamente de tu instancia de Supabase externa
