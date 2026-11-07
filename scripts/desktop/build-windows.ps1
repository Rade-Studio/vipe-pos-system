<#
.SYNOPSIS
  Build the VIPE desktop app on Windows from a mirror of desktop/.
.DESCRIPTION
  -Step check  : cargo check of app\src-tauri (fast compile check).
  -Step bundle : pnpm tauri build (NSIS installer, unsigned in F5b).
  The output goes to C:\Users\Admin\vipe-desktop-build\<Step>.log and the exit
  code to <Step>.rc, so a caller (for example WSL) can read both afterwards.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\desktop\build-windows.ps1 -Step check
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('check', 'bundle')][string]$Step,
  [string]$BuildDir = 'C:\Users\Admin\vipe-desktop-build'
)

$ErrorActionPreference = 'Stop'
$Source = (Resolve-Path (Join-Path $PSScriptRoot '..\..\desktop')).ProviderPath
if (-not (Test-Path (Join-Path $Source 'app\src-tauri\Cargo.toml'))) { throw "desktop/ not found at $Source" }
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
$Log = Join-Path $BuildDir "$Step.log"
$Rc = Join-Path $BuildDir "$Step.rc"
Set-Content -Path $Rc -Value 'running'
Set-Content -Path $Log -Value "VIPE desktop $Step $(Get-Date -Format o) from $Source"

# Rust is installed per user and not on PATH.
$env:Path = "C:\Users\Admin\.cargo\bin;$env:Path"

function Invoke-Logged([string]$Exe, [string[]]$ArgList) {
  Add-Content -Path $Log -Value "> $Exe $($ArgList -join ' ')"
  # cargo and pnpm write progress to stderr; under 'Stop' PowerShell 5 would throw on it.
  $ErrorActionPreference = 'Continue'
  & $Exe @ArgList *>> $Log
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0) { throw "$Exe exited with $LASTEXITCODE" }
}

$code = 0
try {
  # Mirror without build outputs; /XD keeps the build dir's own target and node_modules.
  $ErrorActionPreference = 'Continue'
  & robocopy $Source $BuildDir /MIR /NFL /NDL /NJH /NP /XD node_modules target dist gen /XF "$Step.log" "$Step.rc" check.log check.rc bundle.log bundle.rc *>> $Log
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed with $LASTEXITCODE" }
  $ErrorActionPreference = 'Stop'

  $App = Join-Path $BuildDir 'app'
  Push-Location $App
  try {
    $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
    if (-not $pnpm -and (Get-Command corepack -ErrorAction SilentlyContinue)) {
      Invoke-Logged 'corepack' @('enable', 'pnpm')
      $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
    }
    if ($pnpm) {
      Invoke-Logged 'pnpm' @('install', '--ignore-workspace')
    } else {
      Invoke-Logged 'npm' @('install', '--no-audit', '--no-fund')
    }
    if ($Step -eq 'check') {
      Invoke-Logged 'cargo' @('check', '--manifest-path', 'src-tauri\Cargo.toml')
    } elseif ($pnpm) {
      Invoke-Logged 'pnpm' @('tauri', 'build')
    } else {
      Invoke-Logged 'npx' @('tauri', 'build')
    }
  } finally {
    Pop-Location
  }
} catch {
  Add-Content -Path $Log -Value "FAILED: $_"
  $code = 1
}
Set-Content -Path $Rc -Value $code
Add-Content -Path $Log -Value "exit $code"
exit $code
