# Postgres for docker-compose.coolify.yml with the roles init hook baked in.
# Coolify does not place repository files next to the compose file, so a bind
# mount of ./deploy/postgres/10-roles.sh would become an empty directory and
# vipe_migrator / vipe_api would never be created. docker-compose.prod.yml
# (plain VPS, repository checked out) keeps using bind mounts of the same files.
ARG POSTGRES_IMAGE=postgres:16-alpine@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab
FROM ${POSTGRES_IMAGE}
COPY packages/db/scripts/roles.sql /opt/vipe/roles.sql
COPY --chmod=0755 deploy/postgres/10-roles.sh /docker-entrypoint-initdb.d/10-roles.sh
