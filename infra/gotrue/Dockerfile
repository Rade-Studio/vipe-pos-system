FROM supabase/gotrue:v2.158.1
USER root
COPY migrations/20221208132122_backfill_email_last_sign_in_at.up.sql /usr/local/etc/auth/migrations/20221208132122_backfill_email_last_sign_in_at.up.sql
USER gotrue
