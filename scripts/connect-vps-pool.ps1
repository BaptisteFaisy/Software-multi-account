[CmdletBinding()]
param(
  [string[]]$Profiles = @(),
  [ValidateRange(1, 65535)]
  [int]$StartLocalPort = 18080,
  [ValidatePattern('^$|^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')]
  [string]$PrimaryProfile = "",
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

function Resolve-ClientExecutable {
  if ($ClientExe.Trim()) {
    return (Resolve-Path -LiteralPath $ClientExe).Path
  }
  return @(
    (Join-Path $Root "Codex Switch Terminal Cloud.exe"),
    (Join-Path $Root "Codex Switch Terminal.exe"),
    (Join-Path $Root "src-tauri\target\release\codex-switch-terminal.exe")
  ) |
    Where-Object { Test-Path -LiteralPath $_ } |
    ForEach-Object { Get-Item -LiteralPath $_ } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}

if (-not (Test-Path -LiteralPath $ProfileDir)) {
  throw "Aucun profil VPS. Lance d'abord deploy:vps pour chaque noeud."
}

$requestedProfiles = @(
  $Profiles |
    ForEach-Object { [string]$_ -split ',' } |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ } |
    Select-Object -Unique
)
if ($requestedProfiles.Count -eq 0) {
  $requestedProfiles = @(
    Get-ChildItem -LiteralPath $ProfileDir -Filter "*.json" -File |
      Sort-Object BaseName |
      ForEach-Object { $_.BaseName }
  )
}
if ($requestedProfiles.Count -eq 0) {
  throw "Aucun profil VPS dans $ProfileDir."
}
foreach ($profileName in $requestedProfiles) {
  if ($profileName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') {
    throw "Nom de profil VPS invalide: $profileName"
  }
}
if ($PrimaryProfile.Trim()) {
  if ($requestedProfiles -notcontains $PrimaryProfile) {
    throw "Le profil principal '$PrimaryProfile' ne fait pas partie du pool demande."
  }
  $requestedProfiles = @($PrimaryProfile) + @($requestedProfiles | Where-Object { $_ -ne $PrimaryProfile })
}
if ($StartLocalPort + $requestedProfiles.Count - 1 -gt 65535) {
  throw "La plage de ports locaux depasse 65535."
}

$ssh = Get-Command ssh -ErrorAction SilentlyContinue
if (-not $ssh) { throw "Commande requise introuvable: ssh" }

$resolvedClient = $null
if (-not $CheckOnly) {
  $resolvedClient = Resolve-ClientExecutable
  if (-not $resolvedClient) {
    throw "Client desktop introuvable; indique son chemin avec -ClientExe."
  }
}

$globalKnownHosts = ""
if ($KnownHostsFile.Trim()) {
  $globalKnownHosts = (Resolve-Path -LiteralPath $KnownHostsFile).Path
}

$tunnels = @()
$poolNodes = @()
try {
  for ($index = 0; $index -lt $requestedProfiles.Count; $index++) {
    $profileName = $requestedProfiles[$index]
    $profilePath = Join-Path $ProfileDir "$profileName.json"
    if (-not (Test-Path -LiteralPath $profilePath)) {
      throw "Profil VPS introuvable: $profileName"
    }
    $config = Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json
    $sshTarget = [string]$config.sshTarget
    $sshPort = [int]$config.sshPort
    $remotePort = [int]$config.remotePort
    $identityFile = [string]$config.identityFile
    $localPort = $StartLocalPort + $index
    if (-not $sshTarget -or $sshPort -lt 1 -or $remotePort -lt 1) {
      throw "Le profil VPS '$profileName' est incomplet."
    }
    if (-not [string]$config.tokenProtected) {
      throw "Le profil VPS '$profileName' ne contient pas de token protege."
    }
    $adminToken = Unprotect-Secret ([string]$config.tokenProtected)

    $profileKnownHosts = $globalKnownHosts
    if (-not $profileKnownHosts -and [string]$config.knownHostsFile) {
      $profileKnownHosts = (Resolve-Path -LiteralPath ([string]$config.knownHostsFile)).Path
    }
    $sshArgs = @(
      "-N",
      "-T",
      "-p", [string]$sshPort,
      "-L", "127.0.0.1:${localPort}:127.0.0.1:${remotePort}",
      "-o", "BatchMode=yes",
      "-o", "ExitOnForwardFailure=yes",
      "-o", "ServerAliveInterval=30",
      "-o", "ServerAliveCountMax=3"
    )
    if ($identityFile.Trim()) {
      if (-not (Test-Path -LiteralPath $identityFile)) {
        throw "Cle SSH du profil '$profileName' introuvable: $identityFile"
      }
      $sshArgs += @("-i", $identityFile)
    }
    if ($profileKnownHosts) {
      $sshArgs += @(
        "-o", "UserKnownHostsFile=$profileKnownHosts",
        "-o", "StrictHostKeyChecking=yes"
      )
    }
    $sshArgs += $sshTarget
    $sshArgumentLine = ($sshArgs | ForEach-Object { Quote-NativeArgument ([string]$_) }) -join " "

    Write-Host "Ouverture de $profileName sur 127.0.0.1:$localPort..." -ForegroundColor Cyan
    $tunnel = Start-Process `
      -FilePath $ssh.Source `
      -ArgumentList $sshArgumentLine `
      -WindowStyle Hidden `
      -PassThru
    $tunnels += $tunnel

    $health = $null
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
      if ($tunnel.HasExited) {
        throw "Le tunnel '$profileName' s'est ferme avant d'etre pret (code $($tunnel.ExitCode))."
      }
      try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$localPort/healthz" -TimeoutSec 2
        if ($health.ok) { break }
      }
      catch {
        Start-Sleep -Milliseconds 250
      }
    }
    if (-not $health -or -not $health.ok) {
      throw "Le tunnel '$profileName' est ouvert mais le runtime distant ne repond pas."
    }
    try {
      $authenticatedHealth = Invoke-RestMethod `
        -Uri "http://127.0.0.1:$localPort/api/health" `
        -Headers @{ Authorization = "Bearer $adminToken" } `
        -TimeoutSec 3
    }
    catch {
      throw "L'authentification du profil '$profileName' a echoue: $($_.Exception.Message)"
    }
    if (-not $authenticatedHealth.ok) {
      throw "Le runtime '$profileName' repond, mais son etat authentifie est invalide."
    }

    $label = ([string]$authenticatedHealth.nodeLabel).Trim()
    if (-not $label) { $label = $profileName }
    $label = $label.Replace('|', '/')
    $baseUrl = "http://127.0.0.1:$localPort"
    $priority = $index * 10
    $poolNodes += [pscustomobject]@{
      Profile = $profileName
      Label = $label
      BaseUrl = $baseUrl
      Token = $adminToken
      Priority = $priority
      Ready = $authenticatedHealth.ready -ne $false -and $authenticatedHealth.draining -ne $true
      Version = [string]$authenticatedHealth.version
    }
    Write-Host "Pret: $label ($baseUrl)" -ForegroundColor Green
  }

  if ($CheckOnly) {
    $poolNodes |
      Select-Object Profile, Label, BaseUrl, Ready, Version |
      Format-Table -AutoSize
    Write-Host "Pool valide; tous les tunnels et tokens ont ete verifies." -ForegroundColor Green
    return
  }

  $primary = $poolNodes[0]
  $nodeLines = ($poolNodes | ForEach-Object {
    "$($_.Label)|$($_.BaseUrl)|$($_.Token)|$($_.Priority)"
  }) -join "`n"
  $previousRemote = $env:CST_CLIENT_REMOTE
  $previousBaseUrl = $env:CST_CLIENT_BASE_URL
  $previousToken = $env:CST_CLIENT_TOKEN
  $previousNodes = $env:CST_CLIENT_NODES
  try {
    $env:CST_CLIENT_REMOTE = "1"
    $env:CST_CLIENT_BASE_URL = $primary.BaseUrl
    $env:CST_CLIENT_TOKEN = $primary.Token
    $env:CST_CLIENT_NODES = $nodeLines
    $client = Start-Process `
      -FilePath $resolvedClient `
      -WorkingDirectory (Split-Path -Parent $resolvedClient) `
      -PassThru
  }
  finally {
    $env:CST_CLIENT_REMOTE = $previousRemote
    $env:CST_CLIENT_BASE_URL = $previousBaseUrl
    $env:CST_CLIENT_TOKEN = $previousToken
    $env:CST_CLIENT_NODES = $previousNodes
  }

  Write-Host "Pool de $($poolNodes.Count) VPS connecte. Ferme le client pour couper les tunnels." -ForegroundColor Green
  Wait-Process -Id $client.Id
}
finally {
  foreach ($tunnel in $tunnels) {
    if ($tunnel -and -not $tunnel.HasExited) {
      Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
      Wait-Process -Id $tunnel.Id -ErrorAction SilentlyContinue
    }
  }
}
