[CmdletBinding()]
param(
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')]
  [string]$Profile = "",
  [ValidateRange(0, 65535)]
  [int]$LocalPort = 0,
  [string]$ClientExe = "",
  [string]$KnownHostsFile = "",
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$ProfileDir = Join-Path $env:APPDATA "codex-switch-terminal\vps"

function Unprotect-Secret {
  param([string]$Value)
  $secure = ConvertTo-SecureString -String $Value
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Quote-NativeArgument {
  param([string]$Value)
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + $Value.Replace('"', '\"') + '"'
}

if (-not (Test-Path -LiteralPath $ProfileDir)) {
  throw "Aucun profil VPS. Lance d'abord: npm run deploy:vps -- -SshTarget utilisateur@hote"
}

if (-not $Profile.Trim()) {
  $profiles = @(Get-ChildItem -LiteralPath $ProfileDir -Filter "*.json" -File)
  if ($profiles.Count -eq 0) {
    throw "Aucun profil VPS dans $ProfileDir."
  }
  if ($profiles.Count -gt 1) {
    $choices = ($profiles.BaseName | Sort-Object) -join ", "
    throw "Plusieurs profils VPS existent ($choices); indique -Profile."
  }
  $Profile = $profiles[0].BaseName
}

$profilePath = Join-Path $ProfileDir "$Profile.json"
if (-not (Test-Path -LiteralPath $profilePath)) {
  throw "Profil VPS introuvable: $Profile"
}
$config = Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json

$sshTarget = [string]$config.sshTarget
$sshPort = [int]$config.sshPort
$remotePort = [int]$config.remotePort
$identityFile = [string]$config.identityFile
if ($LocalPort -eq 0) { $LocalPort = [int]$config.defaultLocalPort }
if (-not $sshTarget -or $sshPort -lt 1 -or $remotePort -lt 1 -or $LocalPort -lt 1) {
  throw "Le profil VPS '$Profile' est incomplet."
}
if (-not [string]$config.tokenProtected) {
  throw "Le profil VPS '$Profile' ne contient pas de token protege."
}
$adminToken = Unprotect-Secret ([string]$config.tokenProtected)

$ssh = Get-Command ssh -ErrorAction SilentlyContinue
if (-not $ssh) { throw "Commande requise introuvable: ssh" }

$sshArgs = @(
  "-N",
  "-T",
  "-p", [string]$sshPort,
  "-L", "127.0.0.1:${LocalPort}:127.0.0.1:${remotePort}",
  "-o", "BatchMode=yes",
  "-o", "ExitOnForwardFailure=yes",
  "-o", "ServerAliveInterval=30",
  "-o", "ServerAliveCountMax=3"
)
if ($identityFile.Trim()) {
  if (-not (Test-Path -LiteralPath $identityFile)) {
    throw "Cle SSH du profil introuvable: $identityFile"
  }
  $sshArgs += @("-i", $identityFile)
}
if ($KnownHostsFile.Trim()) {
  $resolvedKnownHostsFile = (Resolve-Path -LiteralPath $KnownHostsFile).Path
  $sshArgs += @(
    "-o", "UserKnownHostsFile=$resolvedKnownHostsFile",
    "-o", "StrictHostKeyChecking=yes"
  )
}
$sshArgs += $sshTarget
$sshArgumentLine = ($sshArgs | ForEach-Object { Quote-NativeArgument ([string]$_) }) -join " "

$resolvedClient = $null
if (-not $CheckOnly) {
  if ($ClientExe.Trim()) {
    $resolvedClient = (Resolve-Path -LiteralPath $ClientExe).Path
  }
  else {
    $resolvedClient = @(
      (Join-Path $Root "Codex Switch Terminal Cloud.exe"),
      (Join-Path $Root "Codex Switch Terminal.exe"),
      (Join-Path $Root "src-tauri\target\release\codex-switch-terminal.exe")
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  }
  if (-not $resolvedClient) {
    throw "Client desktop introuvable; indique son chemin avec -ClientExe."
  }
}

$tunnel = $null
try {
  Write-Host "Ouverture du tunnel SSH vers $sshTarget..." -ForegroundColor Cyan
  $tunnel = Start-Process -FilePath $ssh.Source -ArgumentList $sshArgumentLine -WindowStyle Hidden -PassThru

  $health = $null
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if ($tunnel.HasExited) {
      throw "Le tunnel SSH s'est ferme avant d'etre pret (code $($tunnel.ExitCode))."
    }
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$LocalPort/healthz" -TimeoutSec 2
      if ($health.ok) { break }
    }
    catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $health -or -not $health.ok) {
    throw "Le tunnel est ouvert mais le runtime distant ne repond pas."
  }

  try {
    $authenticatedHealth = Invoke-RestMethod `
      -Uri "http://127.0.0.1:$LocalPort/api/health" `
      -Headers @{ Authorization = "Bearer $adminToken" } `
      -TimeoutSec 3
  }
  catch {
    throw "Le tunnel repond, mais l'authentification du profil VPS a echoue: $($_.Exception.Message)"
  }
  if (-not $authenticatedHealth.ok) {
    throw "Le runtime distant repond, mais son etat authentifie est invalide."
  }

  if ($CheckOnly) {
    Write-Host "Tunnel SSH et authentification valides." -ForegroundColor Green
    Write-Host "Noeud         : $($authenticatedHealth.nodeLabel) ($($authenticatedHealth.nodeId))"
    Write-Host "Version       : $($authenticatedHealth.version)"
    Write-Host "Adresse locale: http://127.0.0.1:$LocalPort"
    return
  }

  $previousRemote = $env:CST_CLIENT_REMOTE
  $previousBaseUrl = $env:CST_CLIENT_BASE_URL
  $previousToken = $env:CST_CLIENT_TOKEN
  try {
    $env:CST_CLIENT_REMOTE = "1"
    $env:CST_CLIENT_BASE_URL = "http://127.0.0.1:$LocalPort"
    $env:CST_CLIENT_TOKEN = $adminToken
    $client = Start-Process -FilePath $resolvedClient -WorkingDirectory (Split-Path -Parent $resolvedClient) -PassThru
  }
  finally {
    $env:CST_CLIENT_REMOTE = $previousRemote
    $env:CST_CLIENT_BASE_URL = $previousBaseUrl
    $env:CST_CLIENT_TOKEN = $previousToken
  }

  Write-Host "Connecte a $($authenticatedHealth.nodeLabel) via SSH. Ferme le client pour couper le tunnel." -ForegroundColor Green
  Wait-Process -Id $client.Id
}
finally {
  if ($tunnel -and -not $tunnel.HasExited) {
    Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $tunnel.Id -ErrorAction SilentlyContinue
  }
}
