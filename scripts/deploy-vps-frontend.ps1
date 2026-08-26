[CmdletBinding()]
param(
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')]
  [string]$Profile = "azure",
  [string]$SourceDir = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$ProfilePath = Join-Path $env:APPDATA "codex-switch-terminal\vps\$Profile.json"

if (-not (Test-Path -LiteralPath $ProfilePath -PathType Leaf)) {
  throw "Profil VPS introuvable : $ProfilePath"
}

$profileData = Get-Content -LiteralPath $ProfilePath -Raw | ConvertFrom-Json
$sshTarget = [string]$profileData.sshTarget
$sshPort = [int]$profileData.sshPort
$identityFile = ([string]$profileData.identityFile).Trim()
$knownHostsFile = [string]$profileData.knownHostsFile
$containerName = ([string]$profileData.containerName).Trim()
if (-not $containerName) {
  $containerName = "codex-switch-terminal"
}

if ($sshTarget -notmatch '^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$') {
  throw "Cible SSH invalide dans le profil '$Profile'."
}
if ($sshPort -lt 1 -or $sshPort -gt 65535) {
  throw "Port SSH invalide dans le profil '$Profile'."
}
if ($containerName -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$') {
  throw "Nom de conteneur invalide dans le profil '$Profile'."
}
$resolvedIdentityFile = ""
if ($identityFile) {
  if (-not (Test-Path -LiteralPath $identityFile -PathType Leaf)) {
    throw "Cle SSH introuvable : $identityFile"
  }
  $resolvedIdentityFile = (Resolve-Path -LiteralPath $identityFile).Path
}

$resolvedSource = if ($SourceDir.Trim()) {
  (Resolve-Path -LiteralPath $SourceDir).Path
}
else {
  Join-Path $Root "dist"
}
if (-not (Test-Path -LiteralPath $resolvedSource -PathType Container)) {
  throw "Build frontend introuvable : $resolvedSource"
}

$indexPath = Join-Path $resolvedSource "index.html"
if (-not (Test-Path -LiteralPath $indexPath -PathType Leaf)) {
  throw "Build frontend invalide : index.html est absent."
}
$tiktokBundle = Get-ChildItem -LiteralPath (Join-Path $resolvedSource "assets") `
  -Filter "tiktok-accounts-*.js" -File -ErrorAction SilentlyContinue |
  Select-Object -First 1
if (-not $tiktokBundle) {
  throw "Build frontend invalide : le bundle TikTok est absent."
}

foreach ($command in @("tar", "ssh", "scp")) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "Commande requise introuvable : $command"
  }
}

$deployId = [guid]::NewGuid().ToString("N")
$archiveName = "cst-frontend-$deployId.tar.gz"
$localArchive = Join-Path $env:TEMP $archiveName
$remoteArchive = "/tmp/$archiveName"
$containerArchive = "/tmp/$archiveName"
$containerRoot = "/opt/codex-switch-terminal"
$activeDir = "$containerRoot/dist"
$stageDir = "$containerRoot/.frontend-stage-$deployId"
$backupDir = "$containerRoot/dist.previous-$deployId"
$localIndexHash = (Get-FileHash -LiteralPath $indexPath -Algorithm SHA256).Hash.ToLowerInvariant()

$sshArgs = @(
  "-p", [string]$sshPort,
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=15",
  "-o", "ServerAliveInterval=10",
  "-o", "ServerAliveCountMax=6"
)
$scpArgs = @(
  "-P", [string]$sshPort,
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=15"
)
if ($resolvedIdentityFile) {
  $sshArgs = @("-i", $resolvedIdentityFile) + $sshArgs
  $scpArgs = @("-i", $resolvedIdentityFile) + $scpArgs
}
if ($knownHostsFile.Trim()) {
  $resolvedKnownHosts = (Resolve-Path -LiteralPath $knownHostsFile).Path
  $sshArgs += @("-o", "UserKnownHostsFile=$resolvedKnownHosts")
  $scpArgs += @("-o", "UserKnownHostsFile=$resolvedKnownHosts")
}

function Invoke-Remote {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command,
    [switch]$Capture
  )

  if ($Capture) {
    $output = & ssh @sshArgs $sshTarget $Command
    if ($LASTEXITCODE -ne 0) {
      throw "Commande distante echouee : $Command"
    }
    return ($output -join "`n").Trim()
  }

  & ssh @sshArgs $sshTarget $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Commande distante echouee : $Command"
  }
}

$switched = $false
try {
  $beforeInspect = Invoke-Remote `
    -Command "sudo -n docker inspect -f '{{.State.StartedAt}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' $containerName" `
    -Capture
  $beforeHealth = Invoke-Remote `
    -Command "sudo -n docker exec $containerName curl -fsS http://127.0.0.1:8080/healthz" `
    -Capture

  & tar -C $resolvedSource -czf $localArchive .
  if ($LASTEXITCODE -ne 0) {
    throw "Impossible de creer l'archive frontend."
  }

  & scp @scpArgs $localArchive "${sshTarget}:$remoteArchive"
  if ($LASTEXITCODE -ne 0) {
    throw "Impossible de transferer l'archive frontend."
  }

  Invoke-Remote -Command "sudo -n docker cp $remoteArchive ${containerName}:$containerArchive"
  Invoke-Remote -Command "sudo -n docker exec -u 0 $containerName mkdir $stageDir"
  Invoke-Remote -Command "sudo -n docker exec -u 0 $containerName tar -xzf $containerArchive -C $stageDir"
  Invoke-Remote -Command "sudo -n docker exec $containerName test -s $stageDir/index.html"

  $remoteTikTokBundle = Invoke-Remote `
    -Command "sudo -n docker exec $containerName find $stageDir/assets -maxdepth 1 -type f -name tiktok-accounts-*.js" `
    -Capture
  if (-not $remoteTikTokBundle.Trim()) {
    throw "Le bundle TikTok est absent du dossier de preparation distant."
  }

  # Le repertoire dist de production peut etre un bind mount Docker. Une copie
  # conserve ce montage actif, contrairement a un renommage du point de montage.
  Invoke-Remote -Command "sudo -n docker exec -u 0 $containerName mkdir $backupDir"
  Invoke-Remote -Command "sudo -n docker exec -u 0 $containerName cp -a $activeDir/. $backupDir/"
  $switched = $true
  try {
    Invoke-Remote -Command "sudo -n docker exec -u 0 $containerName cp -a $stageDir/. $activeDir/"
  }
  catch {
    Invoke-Remote -Command "sudo -n docker exec -u 0 $containerName cp -a $backupDir/. $activeDir/"
    $switched = $false
    throw
  }

  $remoteHashLine = Invoke-Remote `
    -Command "sudo -n docker exec $containerName sha256sum $activeDir/index.html" `
    -Capture
  $remoteIndexHash = ($remoteHashLine -split '\s+')[0].ToLowerInvariant()
  if ($remoteIndexHash -ne $localIndexHash) {
    throw "Le hash distant ne correspond pas au build local."
  }

  $afterHealth = Invoke-Remote `
    -Command "sudo -n docker exec $containerName curl -fsS http://127.0.0.1:8080/healthz" `
    -Capture
  $afterInspect = Invoke-Remote `
    -Command "sudo -n docker inspect -f '{{.State.StartedAt}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' $containerName" `
    -Capture

  $beforeStartedAt = ($beforeInspect -split '\s+')[0]
  $afterStartedAt = ($afterInspect -split '\s+')[0]
  if ($beforeStartedAt -ne $afterStartedAt) {
    throw "Le conteneur a redemarre pendant la publication frontend."
  }

  Write-Host "Frontend VPS publie sans redemarrage." -ForegroundColor Green
  Write-Host "Profil       : $Profile"
  Write-Host "Cible        : $sshTarget"
  Write-Host "Conteneur    : $containerName"
  Write-Host "Bundle TikTok: $remoteTikTokBundle"
  Write-Host "SHA-256      : $remoteIndexHash"
  Write-Host "Sauvegarde   : $backupDir"
  Write-Host "Avant        : $beforeHealth"
  Write-Host "Apres        : $afterHealth"
  Write-Host "Etat         : $afterInspect"
}
catch {
  if ($switched) {
    Write-Warning "La publication a eu lieu ; la sauvegarde distante est conservee dans $backupDir."
  }
  throw
}
finally {
  if (Test-Path -LiteralPath $localArchive -PathType Leaf) {
    Remove-Item -LiteralPath $localArchive -Force
  }
}
