#!/usr/bin/env bash
# Checks the public signing material in desktop/signing (run from the repo root).
set -euo pipefail
d=desktop/signing
fp=$(openssl x509 -inform DER -in $d/vipe-pos-codesign.cer -noout -fingerprint -sha1 | cut -d= -f2 | tr -d :)
[ "$fp" = C594FA9787C8B198635461CC517B7E228ED260E4 ]
t=$(openssl x509 -inform DER -in $d/vipe-pos-codesign.cer -noout -text)
grep -q 'CA:FALSE' <<<"$t"; grep -q 'Public-Key: (3072 bit)' <<<"$t"
grep -A1 'Key Usage: critical' <<<"$t" | grep -qx ' *Digital Signature'
grep -A1 'Extended Key Usage: critical' <<<"$t" | grep -qx ' *Code Signing'
grep -q 'Not After : Nov  7 .* 2031 GMT' <<<"$t"
base64 -d $d/updater.key.pub | head -1 | grep -q '^untrusted comment: minisign public key: '
[ "$(base64 -d $d/updater.key.pub | sed -n 2p | base64 -d | wc -c)" -eq 42 ]
[ "$(head -c3 $d/Install-VipeCertificate.ps1 | xxd -p)" = efbbbf ]
! grep -qv $'\r$' $d/Install-VipeCertificate.ps1
for f in a.key a.pfx a.p12 a.pem a.pvk a.password sub/a.key; do git check-ignore -q $d/$f; done
! git ls-files $d | grep -Eq '\.(key|pfx|p12|pem|pvk|password)$'
grep -q "$fp" $d/Install-VipeCertificate.ps1 $d/README.md $d/LEEME.txt
echo "signing material OK"
