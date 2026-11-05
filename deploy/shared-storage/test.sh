#!/usr/bin/env bash
# Local proof of the shared MinIO without Coolify: two apps, isolated
# credentials, anonymous read without listing, server-wide CORS and an
# idempotent provision-app.sh. Cleans up its containers and volume on exit.
#   bash deploy/shared-storage/test.sh
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
MINIO_IMAGE=$(sed -n 's/^ *image: \(cgr.dev\/chainguard\/minio@.*\)$/\1/p' "$here/docker-compose.yml")
MC_IMAGE=$(sed -n 's/^MC_IMAGE=//p' "$here/provision-app.sh")
id="shared-storage-test-$$"
scratch=$(mktemp -d)

sampler=
cleanup() {
  [ -n "$sampler" ] && kill "$sampler" 2>/dev/null || true
  docker rm -f "$id-minio" >/dev/null 2>&1 || true
  docker rm -f "$id-sp" >/dev/null 2>&1 || true
  docker volume rm "$id-data" >/dev/null 2>&1 || true
  docker network rm "$id-net" >/dev/null 2>&1 || true
  rm -rf "$scratch"
}
trap cleanup EXIT

failures=0
check() { # check <description> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1 (expected $2, got $3)"; failures=$((failures + 1)); fi
}

export MINIO_ROOT_USER=root-test
MINIO_ROOT_PASSWORD=$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')
export MINIO_ROOT_PASSWORD
ORIGIN_OK=https://app-a.example.com
ORIGIN_OTHER=https://app-b.example.com
ORIGIN_FOREIGN=https://evil.example.com

docker network create "$id-net" >/dev/null
docker volume create "$id-data" >/dev/null
docker run -d --name "$id-minio" --network "$id-net" --network-alias minio \
  -p 127.0.0.1::9000 -v "$id-data:/data" \
  -e MINIO_ROOT_USER -e MINIO_ROOT_PASSWORD \
  -e MINIO_API_CORS_ALLOW_ORIGIN="$ORIGIN_OK,$ORIGIN_OTHER" \
  "$MINIO_IMAGE" server /data >/dev/null
for _ in $(seq 60); do
  docker exec "$id-minio" mc ready local >/dev/null 2>&1 && break
  sleep 1
done
port=$(docker port "$id-minio" 9000/tcp | head -1 | sed 's/.*://')
local_url="http://127.0.0.1:$port"

export MINIO_NETWORK="$id-net" S3_PUBLIC_ENDPOINT="$local_url"
bash "$here/provision-app.sh" app-a-staging app-a > "$scratch/a.env" 2>"$scratch/a.log"
bash "$here/provision-app.sh" app-b-staging app-b > "$scratch/b.env" 2>"$scratch/b.log"
value() { sed -n "s/^$2=//p" "$1"; }
check "provision prints the S3_* block" "7" "$(grep -c '^S3_' "$scratch/a.env")"
value "$scratch/a.env" S3_SECRET_ACCESS_KEY > "$scratch/a.needle"
check "no secret in provisioning logs" "0" "$(grep -cF -f "$scratch/a.needle" "$scratch/a.log" || true)"

# mc as app-a, through the docker network. Credentials reach the container by
# name (-e MC_HOST_a), never on the docker argv; test secrets are hex.
as_a() {
  MC_HOST_a="http://app-a:$(value "$scratch/a.env" S3_SECRET_ACCESS_KEY)@minio:9000" \
    docker run --rm -i --network "$id-net" -e MC_HOST_a \
    --entrypoint /bin/sh "$MC_IMAGE" -c "$1" >/dev/null 2>&1
}
as_a 'echo hello | mc pipe a/app-a-staging/r1/dishes/x.txt' && rc=0 || rc=$?
check "app-a PUT in its bucket" 0 "$rc"
denied=$(MC_HOST_a="http://app-a:$(value "$scratch/a.env" S3_SECRET_ACCESS_KEY)@minio:9000" \
  docker run --rm -i --network "$id-net" -e MC_HOST_a \
  --entrypoint /bin/sh "$MC_IMAGE" -c 'echo hello | mc pipe a/app-b-staging/r1/dishes/x.txt' 2>&1 || true)
# mc renders S3 AccessDenied (HTTP 403) as "Insufficient permissions".
check "app-a PUT in app-b bucket is denied" 1 "$(grep -c 'Insufficient permissions' <<<"$denied" || true)"
as_a 'mc ls a/app-a-staging' && rc=0 || rc=$?
check "app-a cannot list (no s3:ListBucket)" 1 "$([ "$rc" -ne 0 ] && echo 1 || echo 0)"

check "anonymous GET of an object" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$local_url/app-a-staging/r1/dishes/x.txt")"
check "anonymous listing of a bucket" 403 "$(curl -s -o /dev/null -w '%{http_code}' "$local_url/app-a-staging/")"
as_a 'mc rm a/app-a-staging/r1/dishes/x.txt' && rc=0 || rc=$?
check "app-a DELETE in its bucket" 0 "$rc"
check "object gone after DELETE" 404 "$(curl -s -o /dev/null -w '%{http_code}' "$local_url/app-a-staging/r1/dishes/x.txt")"

preflight() {
  curl -s -o /dev/null -D - -X OPTIONS "$local_url/app-a-staging/r1/dishes/y.png" \
    -H "Origin: $1" -H 'Access-Control-Request-Method: PUT' -H 'Access-Control-Request-Headers: content-type' |
    tr -d '\r' | sed -n 's/^[Aa]ccess-[Cc]ontrol-[Aa]llow-[Oo]rigin: //p'
}
check "preflight from an allowed origin" "$ORIGIN_OK" "$(preflight "$ORIGIN_OK")"
check "preflight from the second allowed origin" "$ORIGIN_OTHER" "$(preflight "$ORIGIN_OTHER")"
check "preflight from a foreign origin" "" "$(preflight "$ORIGIN_FOREIGN")"

# The API storage flow: presigned PUT bound to Content-Type and size.
sdk="$repo/apps/api/node_modules/@aws-sdk"
if [ -d "$sdk/client-s3" ] && [ -d "$sdk/s3-request-presigner" ]; then
  node_out=$(SDK="$sdk" S3_ENDPOINT="$local_url" S3_BUCKET=app-a-staging \
    S3_ACCESS_KEY_ID=app-a S3_SECRET_ACCESS_KEY="$(value "$scratch/a.env" S3_SECRET_ACCESS_KEY)" node -e '
      const { S3Client, PutObjectCommand } = require(process.env.SDK + "/client-s3");
      const { getSignedUrl } = require(process.env.SDK + "/s3-request-presigner");
      const client = new S3Client({ endpoint: process.env.S3_ENDPOINT, region: "us-east-1", forcePathStyle: true,
        credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
        requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
      const body = Buffer.from("fake-png-bytes");
      (async () => {
        const url = await getSignedUrl(client,
          new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: "r1/dishes/z.png", ContentType: "image/png", ContentLength: body.length }),
          { expiresIn: 300, signableHeaders: new Set(["content-type", "content-length"]) });
        const ok = await fetch(url, { method: "PUT", headers: { "content-type": "image/png" }, body });
        const bad = await fetch(url, { method: "PUT", headers: { "content-type": "image/jpeg" }, body });
        const foreign = await getSignedUrl(client,
          new PutObjectCommand({ Bucket: "app-b-staging", Key: "r1/dishes/z.png", ContentType: "image/png", ContentLength: body.length }),
          { expiresIn: 300, signableHeaders: new Set(["content-type", "content-length"]) });
        const other = await fetch(foreign, { method: "PUT", headers: { "content-type": "image/png" }, body });
        console.log(ok.status + " " + bad.status + " " + other.status);
        client.destroy();
      })().catch((e) => { console.log("error " + e.message); });')
  check "presigned PUT: signed type / another type / app-b bucket" "200 403 403" "$node_out"
else
  echo "skip presigned PUT (apps/api/node_modules/@aws-sdk not installed)"
fi

key_before=$(value "$scratch/a.env" S3_ACCESS_KEY_ID)
bash "$here/provision-app.sh" app-a-staging app-a > "$scratch/a2.env" 2>/dev/null
check "re-run keeps the access key" "$key_before" "$(value "$scratch/a2.env" S3_ACCESS_KEY_ID)"
check "re-run does not print a new secret" "" "$(value "$scratch/a2.env" S3_SECRET_ACCESS_KEY)"
as_a 'echo again | mc pipe a/app-a-staging/r1/dishes/w.txt' && rc=0 || rc=$?
check "old secret still valid after re-run" 0 "$rc"

bash "$here/provision-app.sh" --rotate app-a-staging app-a > "$scratch/a3.env" 2>/dev/null
new_secret=$(value "$scratch/a3.env" S3_SECRET_ACCESS_KEY)
check "--rotate prints a new secret" 1 "$([ -n "$new_secret" ] && [ "$new_secret" != "$(value "$scratch/a.env" S3_SECRET_ACCESS_KEY)" ] && echo 1 || echo 0)"
as_a 'echo again | mc pipe a/app-a-staging/r1/dishes/w.txt' && rc=0 || rc=$?
check "old secret rejected after --rotate" 1 "$([ "$rc" -ne 0 ] && echo 1 || echo 0)"

for bad in 'a"b app-x' 'AB app-x' 'app-a-staging $(id)' '-x app-x'; do
  read -r b u <<<"$bad"
  bash "$here/provision-app.sh" "$b" "$u" >/dev/null 2>&1 && rc=0 || rc=$?
  check "rejects names: $bad" 2 "$rc"
done

# app-a (rotated secret) has no admin rights and no reach into app-b's bucket.
# Each denial first proves the rotated secret still works with an allowed PUT,
# so a denial can never pass just because the credentials are invalid.
as_a3() {
  MC_HOST_a="http://app-a:$new_secret@minio:9000" \
    docker run --rm -i --network "$id-net" -e MC_HOST_a \
    --entrypoint /bin/sh "$MC_IMAGE" -c "$1" >/dev/null 2>&1
}
as_b() {
  MC_HOST_b="http://app-b:$(value "$scratch/b.env" S3_SECRET_ACCESS_KEY)@minio:9000" \
    docker run --rm -i --network "$id-net" -e MC_HOST_b \
    --entrypoint /bin/sh "$MC_IMAGE" -c "$1" >/dev/null 2>&1
}
denied_as_a3() { # denied_as_a3 <description> <mc command>
  as_a3 'echo ok | mc pipe a/app-a-staging/r1/valid.txt' && rc=0 || rc=$?
  check "rotated secret valid before: $1" 0 "$rc"
  as_a3 "$2" && rc=0 || rc=$?
  check "$1" 1 "$([ "$rc" -ne 0 ] && echo 1 || echo 0)"
}
as_b 'echo keep | mc pipe b/app-b-staging/r1/keep.txt' && rc=0 || rc=$?
check "app-b PUT in its bucket" 0 "$rc"
denied_as_a3 "app-a denied mc admin user list" 'mc admin user list a'
denied_as_a3 "app-a denied mc mb" 'mc mb a/app-a-extra'
denied_as_a3 "app-a denied rm in app-b bucket" 'mc rm a/app-b-staging/r1/keep.txt'
check "app-b object survives app-a rm" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$local_url/app-b-staging/r1/keep.txt")"

# No credential on any command line while provisioning. sampled <name> <args>
# runs provision-app.sh while sampling every process argv; when the sampler
# missed every mc process it retries once with --rotate (a new secret, kept as
# a needle too). Every printed secret and root password is a needle.
: > "$scratch/needles"
: > "$scratch/ps.txt"
printf '%s\n' "$MINIO_ROOT_PASSWORD" >> "$scratch/needles"
sampled() {
  local name=$1 try rc=0 extra=()
  shift
  for try in 1 2; do
    : > "$scratch/ps-$name.txt"
    ( while :; do ps -eo args >> "$scratch/ps-$name.txt"; done ) &
    sampler=$!
    bash "$here/provision-app.sh" "${extra[@]}" "$@" > "$scratch/$name-$try.env" 2>/dev/null && rc=0 || rc=$?
    kill "$sampler"; wait "$sampler" 2>/dev/null || true
    sampler=
    cat "$scratch/ps-$name.txt" >> "$scratch/ps.txt"
    secret=$(value "$scratch/$name-$try.env" S3_SECRET_ACCESS_KEY)
    [ -n "$secret" ] && printf '%s\n' "$secret" >> "$scratch/needles"
    [ "$try" = 1 ] && cp "$scratch/$name-$try.env" "$scratch/$name.env"
    grep -qE '(^|/)mc( |$)' "$scratch/ps-$name.txt" && break
    extra=(--rotate)
  done
  check "sampler saw mc while provisioning $name" 1 "$(grep -qE '(^|/)mc( |$)' "$scratch/ps-$name.txt" && echo 1 || echo 0)"
  return "$rc"
}
sampled c app-c-staging app-c || true

# One user per bucket: provisioning app-c for another bucket is refused.
bash "$here/provision-app.sh" app-c-other app-c >/dev/null 2>"$scratch/c-other.log" && rc=0 || rc=$?
check "existing user with another bucket policy exits 3" 3 "$rc"
check "refusal names the user and its policies" 1 "$(grep -c 'user app-c already has policies: app-app-c-staging' "$scratch/c-other.log" || true)"
export MC_HOST_root="http://$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD@minio:9000"
policies=$(docker run --rm --network "$id-net" -e MC_HOST_root --entrypoint /bin/sh "$MC_IMAGE" \
  -c 'mc admin user info --json root app-c' | sed -n 's/.*"policyName":"\([^"]*\)".*/\1/p')
check "app-c keeps only its policy" "app-app-c-staging" "$policies"

# The app user may never be the root user: exit 2 before anything is created.
bash "$here/provision-app.sh" app-r-staging "$MINIO_ROOT_USER" >/dev/null 2>"$scratch/r.log" && rc=0 || rc=$?
check "app user equal to MINIO_ROOT_USER exits 2" 2 "$rc"
docker run --rm --network "$id-net" -e MC_HOST_root --entrypoint /bin/sh "$MC_IMAGE" \
  -c 'mc stat root/app-r-staging' >/dev/null 2>&1 && rc=0 || rc=$?
check "root-user refusal creates no bucket" 1 "$([ "$rc" -ne 0 ] && echo 1 || echo 0)"

# Fail closed: when user info cannot be read (here: credentials without admin
# rights), nothing is created and the script exits 1 with a message.
MINIO_ROOT_USER=app-a MINIO_ROOT_PASSWORD="$new_secret" \
  bash "$here/provision-app.sh" app-z-staging app-z >/dev/null 2>"$scratch/z.log" && rc=0 || rc=$?
check "unreadable user info exits 1" 1 "$rc"
check "unreadable user info is reported" 1 "$(grep -c 'cannot read user app-z' "$scratch/z.log" || true)"
docker run --rm --network "$id-net" -e MC_HOST_root --entrypoint /bin/sh "$MC_IMAGE" \
  -c 'mc stat root/app-z-staging' >/dev/null 2>&1 && rc=0 || rc=$?
check "unreadable user info creates no bucket" 1 "$([ "$rc" -ne 0 ] && echo 1 || echo 0)"

# Root passwords with URL-reserved, quote, space and non-ASCII characters.
sp_pw="p@ss:w/rd%41&x+y?z#q é ñ✓ $(od -An -tx1 -N8 /dev/urandom | tr -d ' \n')"
printf '%s\n' "$sp_pw" >> "$scratch/needles"
docker run -d --name "$id-sp" --network "$id-net" --network-alias minio-sp \
  -e MINIO_ROOT_USER=root-sp -e MINIO_ROOT_PASSWORD="$sp_pw" "$MINIO_IMAGE" server /data >/dev/null
for _ in $(seq 60); do docker exec "$id-sp" mc ready local >/dev/null 2>&1 && break; sleep 1; done
MINIO_ROOT_USER=root-sp MINIO_ROOT_PASSWORD="$sp_pw" MINIO_URL=http://minio-sp:9000 \
  sampled sp app-sp-staging app-sp && rc=0 || rc=$?
check "special-character root password provisions" 0 "$rc"
check "special-character run prints a secret" 1 "$([ -n "$(value "$scratch/sp.env" S3_SECRET_ACCESS_KEY)" ] && echo 1 || echo 0)"
docker rm -f "$id-sp" >/dev/null 2>&1 || true

check "no credential in process argv ($(grep -cE '(^|/)mc( |$)' "$scratch/ps.txt" || true) mc samples)" 0 \
  "$(grep -cF -f "$scratch/needles" "$scratch/ps.txt" || true)"

if [ "$failures" -eq 0 ]; then echo "PASS shared-storage"; else echo "FAILED $failures check(s)"; exit 1; fi
