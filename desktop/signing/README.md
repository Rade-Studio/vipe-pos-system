# Desktop app signing

Public half of the signing material for the VIPE desktop app (Tauri 2,
`odd/tasks/fase3-operacion.md` F5). Private keys are never committed.

| File | What it is |
|---|---|
| `vipe-pos-codesign.cer` | Self-signed Authenticode certificate (DER), `CN=VIPE POS Code Signing, O=Rade Studio, C=CO`, RSA 3072, EKU code signing only, valid until 2031-11-07. SHA-1 thumbprint `C594FA9787C8B198635461CC517B7E228ED260E4`. |
| `updater.key.pub` | Tauri updater public key (minisign). Goes into `plugins.updater.pubkey` in `tauri.conf.json`. |
| `Install-VipeCertificate.ps1` | Installs the certificate into `LocalMachine\Root` and `LocalMachine\TrustedPublisher` after checking the thumbprint. `-Check` only verifies the file; `-Remove` uninstalls it. |
| `Instalar-certificado.cmd`, `Quitar-certificado.cmd` | Double-click wrappers (run as administrator). |
| `LEEME.txt` | Installation steps in Spanish for whoever sets up a restaurant computer. |

## Why a self-signed certificate

During the pilot we install the app on every restaurant computer ourselves, so
we install this certificate first and Windows then trusts the installer and the
app without the "Unknown publisher" warning. Updates are verified separately
with the Tauri updater key. When restaurants start installing on their own,
move to a publicly trusted certificate (for example Azure Trusted Signing) so
no certificate has to be installed by hand.

## Secrets (GitHub Actions)

| Secret | Content |
|---|---|
| `WINDOWS_CODESIGN_PFX_BASE64` | Base64 of the PKCS#12 with the code-signing key and certificate |
| `WINDOWS_CODESIGN_PFX_PASSWORD` | Password of that PKCS#12 |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater private key |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password of the updater key |

The offline backup of the private material lives outside the repository, in the
maintainer's protected directory, and must also be kept on offline storage.
Losing the updater key means installed apps can no longer update and must be
reinstalled.

## Risk

A computer that trusts this certificate accepts any program signed with its
private key. Keep the key only in the secrets above and the offline backup,
never on restaurant computers, and rotate it (new certificate, reinstall on
each computer) if it is ever exposed.
