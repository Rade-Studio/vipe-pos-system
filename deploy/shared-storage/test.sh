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

cleanup() {
  docker rm -f "$id-minio" >/dev/null 2>&1 || true
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
check "no secret in provisioning logs" "0" "$(grep -c "$(value "$scratch/a.env" S3_SECRET_ACCESS_KEY)" "$scratch/a.log" || true)"

# mc as app-a, through the docker network.
as_a() {
  docker run --rm -i --network "$id-net" \
    -e MC_HOST_a="http://app-a:$(value "$scratch/a.env" S3_SECRET_ACCESS_KEY)@minio:9000" \
    --entrypoint /bin/sh "$MC_IMAGE" -c "$1" >/dev/null 2>&1
}
as_a 'echo hello | mc pipe a/app-a-staging/r1/dishes/x.txt'; check "app-a PUT in its bucket" 0 $?
denied=$(docker run --rm -i --network "$id-net" \
  -e MC_HOST_a="http://app-a:$(value "$scratch/a.env" S3_SECRET_ACCESS_KEY)@minio:9000" \
  --entrypoint /bin/sh "$MC_IMAGE" -c 'echo hello | mc pipe a/app-b-staging/r1/dishes/x.txt' 2>&1 || true)
# mc renders S3 AccessDenied (HTTP 403) as "Insufficient permissions".
check "app-a PUT in app-b bucket is denied" 1 "$(grep -c 'Insufficient permissions' <<<"$denied" || true)"
as_a 'mc ls a/app-a-staging' && rc=0 || rc=$?
check "app-a cannot list (no s3:ListBucket)" 1 "$([ "$rc" -ne 0 ] && echo 1 || echo 0)"

check "anonymous GET of an object" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$local_url/app-a-staging/r1/dishes/x.txt")"
check "anonymous listing of a bucket" 403 "$(curl -s -o /dev/null -w '%{http_code}' "$local_url/app-a-staging/")"
as_a 'mc rm a/app-a-staging/r1/dishes/x.txt'; check "app-a DELETE in its bucket" 0 $?
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
as_a 'echo again | mc pipe a/app-a-staging/r1/dishes/w.txt'; check "old secret still valid after re-run" 0 $?

bash "$here/provision-app.sh" --rotate app-a-staging app-a > "$scratch/a3.env" 2>/dev/null
new_secret=$(value "$scratch/a3.env" S3_SECRET_ACCESS_KEY)
check "--rotate prints a new secret" 1 "$([ -n "$new_secret" ] && [ "$new_secret" != "$(value "$scratch/a.env" S3_SECRET_ACCESS_KEY)" ] && echo 1 || echo 0)"
as_a 'echo again | mc pipe a/app-a-staging/r1/dishes/w.txt' && rc=0 || rc=$?
check "old secret rejected after --rotate" 1 "$([ "$rc" -ne 0 ] && echo 1 || echo 0)"

if [ "$failures" -eq 0 ]; then echo "PASS shared-storage"; else echo "FAILED $failures check(s)"; exit 1; fi
