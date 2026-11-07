# Installs the VIPE POS code-signing certificate so Windows trusts the
# VIPE desktop app installer and its updates. Run as administrator.
#   -Check   only verifies the certificate file, installs nothing
#   -Remove  removes the certificate from this computer
param([switch]$Check, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$Expected = 'C594FA9787C8B198635461CC517B7E228ED260E4'
$Stores = @('Root', 'TrustedPublisher')
$CertPath = Join-Path $PSScriptRoot 'vipe-pos-codesign.cer'

if (-not (Test-Path -LiteralPath $CertPath)) {
  Write-Host "No encuentro vipe-pos-codesign.cer junto a este script." -ForegroundColor Red
  exit 1
}
$Cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($CertPath)
if ($Cert.Thumbprint -ne $Expected) {
  Write-Host "Este archivo no es el certificado de VIPE POS. No se instaló nada." -ForegroundColor Red
  exit 1
}
Write-Host "Certificado: $($Cert.Subject)"
Write-Host "Huella:      $($Cert.Thumbprint)"
Write-Host "Vence:       $($Cert.NotAfter.ToString('yyyy-MM-dd'))"
if ($Check) { Write-Host "El certificado es el correcto." -ForegroundColor Green; exit 0 }

$Admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $Admin) {
  Write-Host "Abre este archivo con clic derecho > Ejecutar como administrador." -ForegroundColor Yellow
  exit 1
}

foreach ($Store in $Stores) {
  $Location = "Cert:\LocalMachine\$Store"
  if ($Remove) {
    Get-ChildItem $Location | Where-Object { $_.Thumbprint -eq $Expected } | Remove-Item
  } else {
    Import-Certificate -FilePath $CertPath -CertStoreLocation $Location | Out-Null
  }
}
if ($Remove) {
  Write-Host "Listo: se quitó el certificado de VIPE POS de este computador." -ForegroundColor Green
} else {
  Write-Host "Listo: este computador confía en las apps firmadas por VIPE POS." -ForegroundColor Green
}
