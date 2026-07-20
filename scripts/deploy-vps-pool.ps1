[CmdletBinding()]
param(
  [string]$Config = "config/oracle-vps-pool.json",
  [switch]$PreflightOnly,
  [switch]$SkipPreflight,
  [switch]$SkipPoolCheck
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$PreflightScript = Join-Path $ScriptDir "check-vps-ready.ps1"
$DeployScript = Join-Path $ScriptDir "deploy-vps.ps1"
$PoolScript = Join-Path $ScriptDir "connect-vps-pool.ps1"

function Expand-ConfigPath {
  param([AllowEmptyString()][string]$Value)
  if (-not $Value.Trim()) { return "" }
  return [Environment]::ExpandEnvironmentVariables($Value.Trim())
}

function Get-IntegerValue {
  param(
    [object]$Value,
    [int]$Default,
    [int]$Minimum,
    [int]$Maximum,
    [string]$Name
  )
  if ($null -eq $Value -or [string]$Value -eq "") { return $Default }
  $parsed = 0
  if (-not [int]::TryParse([string]$Value, [ref]$parsed) -or $parsed -lt $Minimum -or $parsed -gt $Maximum) {
    throw "$Name doit etre compris entre $Minimum et $Maximum."
  }
  return $parsed
}

$configPath = Expand-ConfigPath $Config
if (-not [IO.Path]::IsPathRooted($configPath)) {
  $configPath = Join-Path $Root $configPath
}
$configPath = (Resolve-Path -LiteralPath $configPath).Path
$manifest = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$nodes = @($manifest.nodes)
if ($nodes.Count -eq 0) {
  throw "Le manifeste ne contient aucun noeud."
}

$ids = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$localPorts = [Collections.Generic.HashSet[int]]::new()
$normalized = @()
foreach ($node in $nodes) {
  $id = ([string]$node.id).Trim()
  $label = ([string]$node.label).Trim()
  $sshTarget = ([string]$node.sshTarget).Trim()
  if ($id -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') {
    throw "Identifiant de noeud invalide: $id"
  }
  if (-not $ids.Add($id)) { throw "Identifiant de noeud duplique: $id" }
  if (-not $label -or $label.Contains('|') -or $label.Contains("`r") -or $label.Contains("`n")) {
    throw "Le label du noeud '$id' est vide ou invalide."
  }
  if ($sshTarget -notmatch '^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$') {
    throw "Cible SSH invalide pour '$id': $sshTarget"
  }
  $identityFile = Expand-ConfigPath ([string]$node.identityFile)
  $knownHostsFile = Expand-ConfigPath ([string]$node.knownHostsFile)
  if (-not $identityFile -or -not (Test-Path -LiteralPath $identityFile)) {
    throw "Cle SSH introuvable pour '$id': $identityFile"
  }
  if ($knownHostsFile -and -not (Test-Path -LiteralPath $knownHostsFile)) {
    throw "Fichier known_hosts introuvable pour '$id': $knownHostsFile"
  }
  if ($knownHostsFile -and $node.acceptNewHostKey -eq $true) {
    throw "Le noeud '$id' ne peut pas combiner knownHostsFile et acceptNewHostKey."
  }
  $sshPort = Get-IntegerValue $node.sshPort 22 1 65535 "$id.sshPort"
  $remotePort = Get-IntegerValue $node.remotePort 8080 1 65535 "$id.remotePort"
  $localPort = Get-IntegerValue $node.localPort (18080 + $normalized.Count) 1 65535 "$id.localPort"
  $capacity = Get-IntegerValue $node.capacity 2 1 1024 "$id.capacity"
  if (-not $localPorts.Add($localPort)) { throw "Port local duplique: $localPort" }
  $normalized += [pscustomobject]@{
    Id = $id
    Label = $label
    SshTarget = $sshTarget
    IdentityFile = (Resolve-Path -LiteralPath $identityFile).Path
    KnownHostsFile = if ($knownHostsFile) { (Resolve-Path -LiteralPath $knownHostsFile).Path } else { "" }
    SshPort = $sshPort
    RemotePort = $remotePort
    LocalPort = $localPort
    Capacity = $capacity
    SeedAccounts = $node.seedAccounts -ne $false
    AcceptNewHostKey = $node.acceptNewHostKey -eq $true
  }
}

for ($index = 0; $index -lt $normalized.Count; $index++) {
  $expectedPort = $normalized[0].LocalPort + $index
  if ($normalized[$index].LocalPort -ne $expectedPort) {
    throw "Les localPort du pool doivent etre consecutifs a partir de $($normalized[0].LocalPort)."
  }
}

if (-not $SkipPreflight) {
  foreach ($node in $normalized) {
    Write-Host "Precontrole $($node.Id) ($($node.SshTarget))..." -ForegroundColor Cyan
    $preflightArgs = @{
      SshTarget = $node.SshTarget
      IdentityFile = $node.IdentityFile
      SshPort = $node.SshPort
    }
    if ($node.KnownHostsFile) { $preflightArgs.KnownHostsFile = $node.KnownHostsFile }
    if ($node.AcceptNewHostKey) { $preflightArgs.AcceptNewHostKey = $true }
    & $PreflightScript @preflightArgs
  }
}
if ($PreflightOnly) {
  Write-Host "Precontrole valide pour $($normalized.Count) noeud(s)." -ForegroundColor Green
  return
}

foreach ($node in $normalized) {
  Write-Host "Deploiement $($node.Id) ($($node.SshTarget))..." -ForegroundColor Cyan
  $deployArgs = @{
    SshTarget = $node.SshTarget
    IdentityFile = $node.IdentityFile
    SshPort = $node.SshPort
    RemotePort = $node.RemotePort
    LocalPort = $node.LocalPort
    NodeId = $node.Id
    NodeLabel = $node.Label
    Capacity = $node.Capacity
  }
  if ($node.KnownHostsFile) { $deployArgs.KnownHostsFile = $node.KnownHostsFile }
  if ($node.AcceptNewHostKey) { $deployArgs.AcceptNewHostKey = $true }
  if (-not $node.SeedAccounts) { $deployArgs.SkipAccountSeed = $true }
  & $DeployScript @deployArgs
}

if (-not $SkipPoolCheck) {
  $profileIds = @($normalized | ForEach-Object { $_.Id })
  $poolArgs = @{
    Profiles = $profileIds
    StartLocalPort = $normalized[0].LocalPort
    PrimaryProfile = $profileIds[0]
    CheckOnly = $true
  }
  & $PoolScript @poolArgs
}

Write-Host "Pool deploye: $($normalized.Id -join ', ')" -ForegroundColor Green
