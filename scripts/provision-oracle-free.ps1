[CmdletBinding()]
param(
  [ValidatePattern('^[A-Za-z0-9._-]+$')]
  [string]$Profile = "CST",
  [ValidatePattern('^[A-Za-z][A-Za-z0-9_-]{0,99}$')]
  [string]$CompartmentName = "cst",
  [ValidatePattern('^[a-z][a-z0-9-]{0,39}$')]
  [string]$StackName = "cst-oracle-free",
  [string]$AllowedSshCidr = "",
  [string]$SshPublicKey = (Join-Path $env:USERPROFILE ".ssh\id_ed25519.pub"),
  [string]$IdentityFile = (Join-Path $env:USERPROFILE ".ssh\id_ed25519"),
  [string]$WslDistribution = "Ubuntu",
  [string]$ConfigFile = "",
  [string]$OciBin = "",
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')]
  [string]$NodeId = "oracle-free",
  [string]$NodeLabel = "Oracle Always Free",
  [ValidateRange(1, 1024)]
  [int]$Capacity = 2,
  [ValidateRange(1, 2)]
  [int]$Ocpus = 2,
  [ValidateRange(1, 12)]
  [int]$MemoryGB = 12,
  [switch]$Apply,
  [switch]$Deploy,
  [switch]$SkipAccountSeed,
  [switch]$Connect
)

$ErrorActionPreference = "Stop"

if ($Deploy -and -not $Apply) {
  throw "-Deploy requiert -Apply. Sans -Apply, la commande reste un preflight sans mutation."
}
if ($Connect -and -not $Deploy) {
  throw "-Connect requiert -Deploy."
}

foreach ($command in @("wsl.exe", "ssh")) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "Commande requise introuvable: $command"
  }
}

$resolvedPublicKey = (Resolve-Path -LiteralPath $SshPublicKey).Path
$resolvedIdentity = (Resolve-Path -LiteralPath $IdentityFile).Path

function Invoke-WslText {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  $output = @(& wsl.exe -d $WslDistribution -e @Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "Commande WSL en echec: $($output -join [Environment]::NewLine)"
  }
  return (($output | ForEach-Object { [string]$_ }) -join "`n").Trim()
}

function Convert-ToWslPath {
  param([Parameter(Mandatory = $true)][string]$WindowsPath)
  return (Invoke-WslText -Arguments @("wslpath", "-a", "-u", $WindowsPath))
}

function Get-CurrentPublicIPv4 {
  try {
    $value = ([string](Invoke-RestMethod -Uri "https://api.ipify.org" -TimeoutSec 15)).Trim()
  }
  catch {
    throw "Impossible de detecter l'IPv4 publique. Indiquez -AllowedSshCidr x.x.x.x/32. Cause: $($_.Exception.Message)"
  }

  $address = $null
  if (-not [Net.IPAddress]::TryParse($value, [ref]$address) -or
      $address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
    throw "Le service de detection n'a pas retourne une IPv4 valide. Indiquez -AllowedSshCidr x.x.x.x/32."
  }
  return "$value/32"
}

function Test-TcpPort {
  param(
    [Parameter(Mandatory = $true)][string]$HostName,
    [Parameter(Mandatory = $true)][int]$Port,
    [int]$TimeoutMs = 1500
  )

  $client = New-Object Net.Sockets.TcpClient
  try {
    $pending = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $pending.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) { return $false }
    $client.EndConnect($pending)
    return $client.Connected
  }
  catch {
    return $false
  }
  finally {
    $client.Dispose()
  }
}

function Wait-Ssh {
  param([Parameter(Mandatory = $true)][string]$HostName)

  $deadline = [DateTime]::UtcNow.AddMinutes(10)
  Write-Host "Attente du service SSH sur $HostName..." -ForegroundColor Cyan
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-TcpPort -HostName $HostName -Port 22) {
      Write-Host "SSH est accessible." -ForegroundColor Green
      return
    }
    Start-Sleep -Seconds 10
  }
  throw "SSH n'est pas devenu accessible dans les 10 minutes."
}

function Wait-CloudInit {
  param([Parameter(Mandatory = $true)][string]$HostName)

  $sshArgs = @(
    "-i", $resolvedIdentity,
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=15",
    "-o", "ServerAliveInterval=30",
    "-o", "StrictHostKeyChecking=accept-new",
    "ubuntu@$HostName",
    "cloud-init status --wait"
  )
  Write-Host "Attente de la fin de cloud-init..." -ForegroundColor Cyan
  & ssh @sshArgs
  if ($LASTEXITCODE -ne 0) {
    throw "cloud-init ne s'est pas termine correctement sur la VM Oracle."
  }
}

$wslHome = Invoke-WslText -Arguments @("printenv", "HOME")
if (-not $ConfigFile.Trim()) { $ConfigFile = "$wslHome/.oci/config" }
if (-not $OciBin.Trim()) { $OciBin = "$wslHome/.local/bin/oci" }

$scriptPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "provision-oracle-free.sh"
$wslScriptPath = Convert-ToWslPath -WindowsPath $scriptPath
$wslPublicKey = Convert-ToWslPath -WindowsPath $resolvedPublicKey

if (-not $AllowedSshCidr.Trim()) {
  $AllowedSshCidr = Get-CurrentPublicIPv4
  Write-Host "IPv4 publique detectee; SSH sera limite a $AllowedSshCidr." -ForegroundColor Cyan
}

$arguments = @(
  "-d", $WslDistribution,
  "-e", "bash", $wslScriptPath,
  "--profile", $Profile,
  "--config-file", $ConfigFile,
  "--oci-bin", $OciBin,
  "--compartment-name", $CompartmentName,
  "--stack-name", $StackName,
  "--ssh-public-key", $wslPublicKey,
  "--allowed-ssh-cidr", $AllowedSshCidr,
  "--ocpus", [string]$Ocpus,
  "--memory-gb", [string]$MemoryGB
)
if ($Apply) { $arguments += "--apply" }

$runOutput = @()
$previousErrorAction = $ErrorActionPreference
try {
  # Windows PowerShell transforme chaque ligne stderr d'un executable natif en
  # NativeCommandError. On doit conserver la suite du diagnostic et utiliser le
  # vrai code de sortie WSL pour decider du succes.
  $ErrorActionPreference = "Continue"
  & wsl.exe @arguments 2>&1 | Tee-Object -Variable runOutput | ForEach-Object { Write-Host ([string]$_) }
  $provisionExit = $LASTEXITCODE
}
finally {
  $ErrorActionPreference = $previousErrorAction
}
if ($provisionExit -ne 0) {
  throw "Le preflight/provisionnement OCI a echoue (code $provisionExit)."
}

if (-not $Deploy) {
  return
}

$ipLines = @($runOutput | ForEach-Object { [string]$_ } | Where-Object { $_ -match '^CST_ORACLE_PUBLIC_IP=' })
if ($ipLines.Count -ne 1) {
  throw "Le provisionnement n'a pas retourne une IPv4 publique unique."
}
$publicIp = ($ipLines[0] -split '=', 2)[1].Trim()
$parsedIp = $null
if (-not [Net.IPAddress]::TryParse($publicIp, [ref]$parsedIp) -or
    $parsedIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
  throw "IPv4 publique OCI invalide: $publicIp"
}

Wait-Ssh -HostName $publicIp
Wait-CloudInit -HostName $publicIp

# Le chemin historique reste disponible via scripts/deploy-vps.ps1. Les VM
# neuves utilisent maintenant le deploiement portable Ansible + Compose.
$deployScript = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "deploy-vps-ansible.ps1"
$deployArgs = @{
  SshTarget = "ubuntu@$publicIp"
  IdentityFile = $resolvedIdentity
  NodeId = $NodeId
  NodeLabel = $NodeLabel
  Capacity = $Capacity
  AcceptNewHostKey = $true
}
if ($SkipAccountSeed) { $deployArgs.SkipAccountSeed = $true }
if ($Connect) { $deployArgs.Connect = $true }

Write-Host "Deploiement de CST sur la VM Oracle..." -ForegroundColor Cyan
& $deployScript @deployArgs
if ($LASTEXITCODE -ne 0) {
  throw "Le deploiement CST sur Oracle a echoue."
}

Write-Host "Oracle Always Free et CST sont operationnels via le profil '$NodeId'." -ForegroundColor Green
