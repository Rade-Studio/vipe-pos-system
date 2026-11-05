# Plain Postgres 16 with pgTAP and pg_prove for the database test suite.
# No Supabase component: this is the target runtime of
# odd/tasks/migracion-backend-nestjs.md (T4).
FROM postgres:16

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       postgresql-16-pgtap \
       libtap-parser-sourcehandler-pgtap-perl \
  && rm -rf /var/lib/apt/lists/*

# Runs once, on an empty data directory: creates vipe_migrator and vipe_api.
COPY scripts/roles.sql /opt/vipe/roles.sql
COPY docker/init-roles.sh /docker-entrypoint-initdb.d/10-roles.sh
