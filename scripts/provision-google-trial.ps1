[CmdletBinding()]
param(
  [string]$ProjectId = "",
  [string]$BillingAccount = "",
  [ValidateSet("europe-west1")]
  [string]$Region = "europe-west1",
  [ValidateSet("e2-standard-2")]
  [string]$MachineType = "e2-standard-2",
  [ValidatePattern('^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$')]
  [string]$InstanceName = "cst-google-trial-vm",
  [string]$AllowedSshCidr = "",
  [string]$SshPublicKey = (Join-Path $env:USERPROFILE ".ssh\id_ed25519.pub"),
  [string]$IdentityFile = (Join-Path $env:USERPROFILE ".ssh\id_ed25519"),
  [ValidatePattern('^[A-Za-z0-9._-]+$')]
  [string]$WslDistribution = "Ubuntu",
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')]
  [string]$NodeId = "google-trial",
  [string]$NodeLabel = "Google Cloud Trial",
  [ValidateRange(1, 1024)]
  [int]$Capacity = 2,
  [ValidateRange(1, 80)]
  [int]$ExpirationDays = 75,
  [switch]$Apply,
  [switch]$Deploy,
  [switch]$SkipAccountSeed,
  [switch]$Connect
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$NetworkName = "cst-google-trial"
$SubnetName = "cst-google-trial-euw1"
$FirewallName = "cst-google-trial-ssh"
$SubnetCidr = "10.43.1.0/24"
$Zones = @("europe-west1-b", "europe-west1-c", "europe-west1-d")
$TerminationTime = [DateTimeOffset]::UtcNow.AddDays($ExpirationDays).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")

if ($Deploy -and -not $Apply) { throw "-Deploy requiert -Apply." }
if ($Connect -and -not $Deploy) { throw "-Connect requiert -Deploy." }
if ($ProjectId.Trim() -and $ProjectId.Trim() -notmatch '^[a-z][a-z0-9-]{4,28}[a-z0-9]$') {
  throw "L'identifiant du projet Google Cloud est invalide."
}

function Invoke-WslCapture {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [switch]$AllowFailure
  )
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = @(& wsl.exe -d $WslDistribution -e @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previous
  }
  if ($exitCode -ne 0 -and -not $AllowFailure) {
    throw (($output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine)
  }
  return [pscustomobject]@{
    ExitCode = $exitCode
    Lines = @($output | ForEach-Object { [string]$_ })
  }
}

function Get-WslHome {
  $result = Invoke-WslCapture -Arguments @("printenv", "HOME")
  $value = ($result.Lines -join "`n").Trim()
  if (-not $value.StartsWith("/")) { throw "Dossier utilisateur WSL invalide." }
  return $value
}

$Gcloud = "$(Get-WslHome)/.local/bin/gcloud"
$gcloudReady = Invoke-WslCapture -Arguments @("test", "-x", $Gcloud) -AllowFailure
if ($gcloudReady.ExitCode -ne 0) {
  throw "Google Cloud CLI est introuvable. Utilise d'abord le bouton Connecter Google Cloud."
}

function Invoke-Gcloud {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [switch]$AllowFailure
  )
  return Invoke-WslCapture -Arguments (@($Gcloud) + $Arguments + @("--quiet")) -AllowFailure:$AllowFailure
}

function Invoke-GcloudJson {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [switch]$AllowFailure
  )
  # Certains `list --filter` ecrivent un WARNING sur stderr lorsqu'aucune
  # ressource ne correspond. stderr et stdout sont reunis par le pont WSL ;
  # masquer les warnings garde donc le JSON strictement parseable.
  $result = Invoke-Gcloud -Arguments ($Arguments + @("--format=json", "--verbosity=error")) -AllowFailure:$AllowFailure
  if ($result.ExitCode -ne 0 -or -not ($result.Lines -join "").Trim()) {
    return [pscustomobject]@{ ExitCode = $result.ExitCode; Data = $null; Lines = $result.Lines }
  }
  try {
    $data = ($result.Lines -join "`n") | ConvertFrom-Json
  }
  catch {
    if ($AllowFailure) {
      return [pscustomobject]@{ ExitCode = 1; Data = $null; Lines = $result.Lines }
    }
    throw "Reponse JSON Google Cloud invalide."
  }
  return [pscustomobject]@{ ExitCode = $result.ExitCode; Data = $data; Lines = $result.Lines }
}

function Convert-ToWslPath {
  param([Parameter(Mandatory = $true)][string]$WindowsPath)
  $result = Invoke-WslCapture -Arguments @("wslpath", "-a", "-u", $WindowsPath)
  return ($result.Lines -join "`n").Trim()
}

function Ensure-SshKeyPair {
  if ((Test-Path -LiteralPath $IdentityFile) -and (Test-Path -LiteralPath $SshPublicKey)) {
    return
  }
  if ((Test-Path -LiteralPath $IdentityFile) -xor (Test-Path -LiteralPath $SshPublicKey)) {
    throw "La paire SSH est incomplete. Conserve ou supprime les deux fichiers avant de recommencer."
  }
  $identityParent = Split-Path -Parent $IdentityFile
  if (-not $identityParent) { throw "Le chemin de la cle SSH est invalide." }
  New-Item -ItemType Directory -Path $identityParent -Force | Out-Null
  $wslIdentity = Convert-ToWslPath -WindowsPath $IdentityFile
  Write-Host "Creation d'une cle SSH locale dediee..." -ForegroundColor Cyan
  Invoke-WslCapture -Arguments @(
    "sh", "-c",
    'umask 077; ssh-keygen -q -t ed25519 -f "$1" -N ""',
    "cst-keygen", $wslIdentity
  ) | Out-Null
}

function Get-CurrentPublicIPv4 {
  try {
    $value = ([string](Invoke-RestMethod -Uri "https://api.ipify.org" -TimeoutSec 15)).Trim()
  }
  catch {
    throw "Impossible de detecter l'IPv4 publique. Indique -AllowedSshCidr x.x.x.x/32."
  }
  $address = $null
  if (-not [Net.IPAddress]::TryParse($value, [ref]$address) -or
      $address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
    throw "IPv4 publique invalide."
  }
  return "$value/32"
}

function Test-TcpPort {
  param([string]$HostName, [int]$Port, [int]$TimeoutMs = 1500)
  $client = New-Object Net.Sockets.TcpClient
  try {
    $pending = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $pending.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) { return $false }
    $client.EndConnect($pending)
    return $client.Connected
  }
  catch { return $false }
  finally { $client.Dispose() }
}

function Wait-Ssh {
  param([string]$HostName)
  $deadline = [DateTime]::UtcNow.AddMinutes(10)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-TcpPort -HostName $HostName -Port 22) { return }
    Start-Sleep -Seconds 10
  }
  throw "SSH n'est pas devenu accessible dans les 10 minutes."
}

function Wait-CloudInit {
  param([string]$HostName, [string]$PrivateKey)
  & ssh -i $PrivateKey -o BatchMode=yes -o ConnectTimeout=15 `
    -o ServerAliveInterval=30 -o StrictHostKeyChecking=accept-new `
    "ubuntu@$HostName" "cloud-init status --wait"
  if ($LASTEXITCODE -ne 0) { throw "cloud-init ne s'est pas termine correctement." }
}

Ensure-SshKeyPair
$resolvedPublicKey = (Resolve-Path -LiteralPath $SshPublicKey).Path
$resolvedIdentity = (Resolve-Path -LiteralPath $IdentityFile).Path
if (-not $AllowedSshCidr.Trim()) { $AllowedSshCidr = Get-CurrentPublicIPv4 }

$activeAccounts = Invoke-Gcloud -Arguments @(
  "auth", "list", "--filter=status:ACTIVE", "--format=value(account)"
)
$accountRows = @($activeAccounts.Lines | Where-Object { $_.Trim() -match '^[^@\s]+@[^@\s]+$' })
if ($accountRows.Count -eq 0) { throw "Aucun compte Google Cloud connecte." }

$billingResult = Invoke-GcloudJson -Arguments @("billing", "accounts", "list", "--filter=open=true")
$billingRows = @($billingResult.Data)
if ($BillingAccount.Trim()) {
  $billingName = if ($BillingAccount.StartsWith("billingAccounts/")) {
    $BillingAccount
  } else {
    "billingAccounts/$BillingAccount"
  }
  $billingRows = @($billingRows | Where-Object { $_.name -eq $billingName })
}
if ($billingRows.Count -ne 1) {
  if ($billingRows.Count -eq 0) {
    throw "Active d'abord l'essai Google Cloud et son compte de facturation."
  }
  throw "Plusieurs comptes de facturation sont actifs; indique -BillingAccount."
}
$billingName = [string]$billingRows[0].name
$billingId = ($billingName -split '/', 2)[1]

$projectsResult = Invoke-GcloudJson -Arguments @("projects", "list", "--filter=lifecycleState:ACTIVE")
$projects = @($projectsResult.Data)
if (-not $ProjectId.Trim()) {
  # Depuis gcloud 576, `projects list --format=json` omet les labels meme si
  # le filtre serveur les voit. La fiche detaillee reste la source de verite.
  $managedResult = Invoke-GcloudJson -Arguments @(
    "projects", "list", "--filter=lifecycleState:ACTIVE AND labels.cst-managed=true"
  )
  $managedProjects = @($managedResult.Data)
  if ($managedProjects.Count -gt 1) {
    throw "Plusieurs projets CST existent; indique -ProjectId."
  }
  if ($managedProjects.Count -eq 1) {
    $ProjectId = [string]$managedProjects[0].projectId
  }
  elseif ($Apply) {
    $ProjectId = "cst-trial-$([guid]::NewGuid().ToString('N').Substring(0, 12))"
    Write-Host "Creation du projet Google Cloud dedie $ProjectId..." -ForegroundColor Cyan
    Invoke-Gcloud -Arguments @(
      "projects", "create", $ProjectId, "--name=CST Trial",
      "--labels=cst-managed=true,cst-stack=google-trial"
    ) | Out-Null
  }
}

if (-not $ProjectId.Trim()) {
  Write-Host "Plan: creer un projet CST dedie, puis une VM $MachineType dans $Region."
  Write-Host "Relance avec -Apply -Deploy apres validation."
  return
}

$projectResult = Invoke-GcloudJson -Arguments @("projects", "describe", $ProjectId) -AllowFailure
$projectExists = $projectResult.ExitCode -eq 0 -and $null -ne $projectResult.Data
if (-not $projectExists -and -not $Apply) {
  throw "Projet Google Cloud introuvable: $ProjectId"
}
if ($projectExists -and $projectResult.Data.labels.'cst-managed' -ne "true") {
  throw "Le projet existe mais n'est pas gere par CST. Utilise un projet CST dedie."
}

$billingProject = Invoke-GcloudJson -Arguments @(
  "billing", "projects", "describe", $ProjectId
) -AllowFailure
$billingEnabled = $billingProject.ExitCode -eq 0 -and [bool]$billingProject.Data.billingEnabled

Write-Host "Plan Google Cloud: $ProjectId, $MachineType (2 vCPU / 8 Go), Ubuntu 24.04, disque 50 Go."
Write-Host "Reseau prive: $SubnetCidr; seul SSH est autorise depuis $AllowedSshCidr."
Write-Host "Garde-fou essai: suppression automatique de la VM le $TerminationTime."
if (-not $Apply) { return }

if (-not $billingEnabled) {
  Write-Host "Association du projet au credit Google Cloud actif..." -ForegroundColor Cyan
  Invoke-Gcloud -Arguments @(
    "billing", "projects", "link", $ProjectId, "--billing-account=$billingId"
  ) | Out-Null
}

Write-Host "Activation de Compute Engine..." -ForegroundColor Cyan
Invoke-Gcloud -Arguments @("services", "enable", "compute.googleapis.com", "--project=$ProjectId") | Out-Null

# Compute Engine peut recreer un reseau `default` avec SSH/RDP publics lors de
# la premiere activation. Le projet est dedie a CST : seul le VPC prive cree
# plus bas doit subsister.
$defaultNetwork = Invoke-Gcloud -Arguments @(
  "compute", "networks", "describe", "default", "--project=$ProjectId"
) -AllowFailure
if ($defaultNetwork.ExitCode -eq 0) {
  Write-Host "Suppression du reseau Google par defaut trop permissif..." -ForegroundColor Cyan
  $defaultFirewallResult = Invoke-GcloudJson -Arguments @(
    "compute", "firewall-rules", "list", "--project=$ProjectId", "--filter=network:default"
  )
  $defaultFirewallNames = @(
    $defaultFirewallResult.Data |
      Where-Object { ([string]$_.network) -match '/networks/default$' } |
      ForEach-Object { [string]$_.name } |
      Where-Object { $_ -match '^[a-z][-a-z0-9]{0,62}$' }
  )
  if ($defaultFirewallNames.Count -gt 0) {
    Invoke-Gcloud -Arguments (@(
      "compute", "firewall-rules", "delete"
    ) + $defaultFirewallNames + @("--project=$ProjectId")) | Out-Null
  }
  Invoke-Gcloud -Arguments @(
    "compute", "networks", "delete", "default", "--project=$ProjectId"
  ) | Out-Null
}

$network = Invoke-Gcloud -Arguments @(
  "compute", "networks", "describe", $NetworkName, "--project=$ProjectId"
) -AllowFailure
if ($network.ExitCode -ne 0) {
  Invoke-Gcloud -Arguments @(
    "compute", "networks", "create", $NetworkName,
    "--project=$ProjectId", "--subnet-mode=custom", "--bgp-routing-mode=regional"
  ) | Out-Null
}

$subnet = Invoke-Gcloud -Arguments @(
  "compute", "networks", "subnets", "describe", $SubnetName,
  "--project=$ProjectId", "--region=$Region"
) -AllowFailure
if ($subnet.ExitCode -ne 0) {
  Invoke-Gcloud -Arguments @(
    "compute", "networks", "subnets", "create", $SubnetName,
    "--project=$ProjectId", "--region=$Region", "--network=$NetworkName",
    "--range=$SubnetCidr", "--enable-private-ip-google-access"
  ) | Out-Null
}

$firewall = Invoke-Gcloud -Arguments @(
  "compute", "firewall-rules", "describe", $FirewallName, "--project=$ProjectId"
) -AllowFailure
if ($firewall.ExitCode -eq 0) {
  Invoke-Gcloud -Arguments @(
    "compute", "firewall-rules", "update", $FirewallName,
    "--project=$ProjectId", "--source-ranges=$AllowedSshCidr"
  ) | Out-Null
}
else {
  Invoke-Gcloud -Arguments @(
    "compute", "firewall-rules", "create", $FirewallName,
    "--project=$ProjectId", "--network=$NetworkName", "--direction=INGRESS",
    "--priority=1000", "--action=ALLOW", "--rules=tcp:22",
    "--source-ranges=$AllowedSshCidr", "--target-tags=cst-ssh"
  ) | Out-Null
}

$instances = Invoke-GcloudJson -Arguments @(
  "compute", "instances", "list", "--project=$ProjectId", "--filter=name=$InstanceName"
)
$instanceRows = @($instances.Data)
if ($instanceRows.Count -gt 1) { throw "Plusieurs VM portent le nom $InstanceName." }

$zone = $null
if ($instanceRows.Count -eq 1) {
  $instance = $instanceRows[0]
  if ($instance.labels.'cst-managed' -ne "true") {
    throw "La VM existante n'est pas geree par CST."
  }
  $zone = ([string]$instance.zone -split '/')[-1]
  if ([string]$instance.status -eq "TERMINATED") {
    Invoke-Gcloud -Arguments @(
      "compute", "instances", "start", $InstanceName,
      "--project=$ProjectId", "--zone=$zone"
    ) | Out-Null
  }
}
else {
  $metadataFile = Join-Path $env:TEMP ("cst-google-ssh-" + [guid]::NewGuid().ToString("N") + ".txt")
  try {
    $publicKey = (Get-Content -LiteralPath $resolvedPublicKey -Raw).Trim()
    [IO.File]::WriteAllText(
      $metadataFile,
      "ubuntu:$publicKey`n",
      (New-Object Text.UTF8Encoding($false))
    )
    $wslMetadata = Convert-ToWslPath -WindowsPath $metadataFile
    foreach ($candidateZone in $Zones) {
      Write-Host "Creation de la VM dans $candidateZone..." -ForegroundColor Cyan
      $created = Invoke-Gcloud -Arguments @(
        "compute", "instances", "create", $InstanceName,
        "--project=$ProjectId", "--zone=$candidateZone", "--machine-type=$MachineType",
        "--subnet=$SubnetName", "--network-tier=STANDARD", "--tags=cst-ssh",
        "--image-family=ubuntu-2404-lts-amd64", "--image-project=ubuntu-os-cloud",
        "--boot-disk-size=50GB", "--boot-disk-type=pd-balanced",
        "--termination-time=$TerminationTime", "--instance-termination-action=DELETE",
        "--metadata-from-file=ssh-keys=$wslMetadata",
        "--no-service-account", "--no-scopes",
        "--shielded-vtpm", "--shielded-integrity-monitoring",
        "--labels=cst-managed=true,cst-stack=google-trial"
      ) -AllowFailure
      if ($created.ExitCode -eq 0) {
        $zone = $candidateZone
        break
      }
      $details = $created.Lines -join "`n"
      if ($details -notmatch 'ZONE_RESOURCE_POOL_EXHAUSTED|resource pool exhausted|does not have enough resources') {
        throw $details
      }
    }
  }
  finally {
    Remove-Item -LiteralPath $metadataFile -Force -ErrorAction SilentlyContinue
  }
  if (-not $zone) { throw "Aucune zone europe-west1 ne peut accueillir la VM actuellement." }
}

$instanceResult = Invoke-GcloudJson -Arguments @(
  "compute", "instances", "describe", $InstanceName,
  "--project=$ProjectId", "--zone=$zone"
)
$publicIp = [string]$instanceResult.Data.networkInterfaces[0].accessConfigs[0].natIP
$parsedIp = $null
if (-not [Net.IPAddress]::TryParse($publicIp, [ref]$parsedIp) -or
    $parsedIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
  throw "Google Cloud n'a pas attribue d'IPv4 publique valide."
}

Write-Output "CST_GOOGLE_PROJECT=$ProjectId"
Write-Output "CST_GOOGLE_ZONE=$zone"
Write-Output "CST_GOOGLE_PUBLIC_IP=$publicIp"
Write-Output "CST_GOOGLE_TERMINATION_TIME=$TerminationTime"
if (-not $Deploy) { return }

Wait-Ssh -HostName $publicIp
Wait-CloudInit -HostName $publicIp -PrivateKey $resolvedIdentity
$deployScript = Join-Path $ScriptDir "deploy-vps-ansible.ps1"
$deployArgs = @{
  SshTarget = "ubuntu@$publicIp"
  IdentityFile = $resolvedIdentity
  NodeId = $NodeId
  NodeLabel = $NodeLabel
  Capacity = $Capacity
  LocalPort = 18082
  AcceptNewHostKey = $true
}
if ($SkipAccountSeed) { $deployArgs.SkipAccountSeed = $true }
if ($Connect) { $deployArgs.Connect = $true }
& $deployScript @deployArgs
if ($LASTEXITCODE -ne 0) { throw "Le deploiement CST sur Google Cloud a echoue." }

Write-Host "Google Cloud et CST sont operationnels via le profil '$NodeId'." -ForegroundColor Green
