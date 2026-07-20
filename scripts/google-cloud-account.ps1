[CmdletBinding()]
param(
  [ValidatePattern('^[A-Za-z0-9._-]+$')]
  [string]$WslDistribution = "Ubuntu",
  [switch]$Status,
  [switch]$Login,
  [switch]$OpenTrial
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallScript = Join-Path $ScriptDir "install-gcloud-cli.sh"
$BrowserBridgeScript = Join-Path $ScriptDir "open-windows-browser-from-wsl.sh"
$TrialUrl = "https://console.cloud.google.com/freetrial"

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
  $wslHome = ($result.Lines -join "`n").Trim()
  if (-not $wslHome.StartsWith("/")) {
    throw "Le dossier utilisateur WSL est invalide."
  }
  return $wslHome
}

function Get-GcloudPath {
  return "$(Get-WslHome)/.local/bin/gcloud"
}

function Test-GcloudInstalled {
  param([Parameter(Mandatory = $true)][string]$GcloudPath)
  $result = Invoke-WslCapture -Arguments @("test", "-x", $GcloudPath) -AllowFailure
  return $result.ExitCode -eq 0
}

function Invoke-Gcloud {
  param(
    [Parameter(Mandatory = $true)][string]$GcloudPath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [switch]$AllowFailure
  )
  return Invoke-WslCapture -Arguments (@($GcloudPath) + $Arguments) -AllowFailure:$AllowFailure
}

function Install-Gcloud {
  $resolvedInstaller = (Resolve-Path -LiteralPath $InstallScript).Path
  $converted = Invoke-WslCapture -Arguments @("wslpath", "-a", "-u", $resolvedInstaller)
  $wslInstaller = ($converted.Lines -join "`n").Trim()
  Invoke-WslCapture -Arguments @("bash", $wslInstaller) | Out-Null
}

function Install-BrowserBridge {
  $resolvedBridge = (Resolve-Path -LiteralPath $BrowserBridgeScript).Path
  $converted = Invoke-WslCapture -Arguments @("wslpath", "-a", "-u", $resolvedBridge)
  $wslBridge = ($converted.Lines -join "`n").Trim()
  $target = "$(Get-WslHome)/.local/bin/cst-open-windows-browser"
  Invoke-WslCapture -Arguments @("install", "-m", "0755", $wslBridge, $target) | Out-Null
  return $target
}

function Get-GoogleStatus {
  $gcloud = Get-GcloudPath
  $installed = Test-GcloudInstalled -GcloudPath $gcloud
  if (-not $installed) {
    return [ordered]@{
      supported = $true
      installed = $false
      authenticated = $false
      account = $null
      projects = @()
      selectedProject = $null
      billingReady = $false
      billingEnabled = $false
      message = "Le CLI Google Cloud sera installe automatiquement lors de la connexion."
    }
  }

  $accountResult = Invoke-Gcloud -GcloudPath $gcloud -Arguments @(
    "auth", "list", "--filter=status:ACTIVE", "--format=value(account)", "--quiet"
  ) -AllowFailure
  $accounts = @(
    $accountResult.Lines |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ -match '^[^@\s]+@[^@\s]+$' }
  )
  if ($accounts.Count -eq 0) {
    return [ordered]@{
      supported = $true
      installed = $true
      authenticated = $false
      account = $null
      projects = @()
      selectedProject = $null
      billingReady = $false
      billingEnabled = $false
      message = "Connecte un compte Google pour lire les projets et le credit d'essai."
    }
  }

  $projectResult = Invoke-Gcloud -GcloudPath $gcloud -Arguments @(
    "projects", "list", "--filter=lifecycleState:ACTIVE AND labels.cst-managed=true",
    "--format=value(projectId)", "--quiet"
  ) -AllowFailure
  $projects = @(
    $projectResult.Lines |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ -match '^[a-z][a-z0-9-]{4,28}[a-z0-9]$' } |
      Select-Object -Unique
  )

  $configuredResult = Invoke-Gcloud -GcloudPath $gcloud -Arguments @(
    "config", "get-value", "project", "--quiet"
  ) -AllowFailure
  $configured = ($configuredResult.Lines -join "`n").Trim()
  $selected = if ($projects -contains $configured) {
    $configured
  }
  elseif ($projects.Count -eq 1) {
    $projects[0]
  }
  else {
    $null
  }

  $billingAccounts = Invoke-Gcloud -GcloudPath $gcloud -Arguments @(
    "billing", "accounts", "list", "--filter=open=true", "--format=value(name)", "--quiet"
  ) -AllowFailure
  $billingReady = @($billingAccounts.Lines | Where-Object { $_ -match '^billingAccounts/' }).Count -gt 0
  $billingEnabled = $false
  if ($selected) {
    $billingProject = Invoke-Gcloud -GcloudPath $gcloud -Arguments @(
      "billing", "projects", "describe", $selected, "--format=value(billingEnabled)", "--quiet"
    ) -AllowFailure
    $billingEnabled = ($billingProject.Lines -join "`n").Trim().ToLowerInvariant() -eq "true"
  }

  $message = if (-not $billingReady) {
    "Active l'essai Google Cloud; la carte reste saisie uniquement chez Google."
  }
  elseif (-not $selected -and $projects.Count -gt 1) {
    "Choisis le projet Google Cloud dedie au VPS."
  }
  elseif (-not $selected) {
    "Le provisionneur creera un projet CST dedie avec le credit actif."
  }
  elseif (-not $billingEnabled) {
    "Le provisionneur reliera ce projet au compte de facturation actif."
  }
  else {
    "Compte, projet et credit prets pour la creation du VPS."
  }

  return [ordered]@{
    supported = $true
    installed = $true
    authenticated = $true
    account = $accounts[0]
    projects = @($projects)
    selectedProject = $selected
    billingReady = $billingReady
    billingEnabled = $billingEnabled
    message = $message
  }
}

if (@($Status, $Login, $OpenTrial | Where-Object { $_ }).Count -gt 1) {
  throw "Choisis une seule action Google Cloud."
}

if ($OpenTrial) {
  Start-Process $TrialUrl | Out-Null
  Write-Output "Page officielle de l'essai Google Cloud ouverte."
  exit 0
}

if ($Login) {
  $gcloud = Get-GcloudPath
  if (-not (Test-GcloudInstalled -GcloudPath $gcloud)) {
    Install-Gcloud
    $gcloud = Get-GcloudPath
  }
  $browser = Install-BrowserBridge
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & wsl.exe -d $WslDistribution -e env "BROWSER=$browser" $gcloud auth login --force
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previous
  }
  if ($exitCode -ne 0) {
    throw "La connexion Google Cloud n'a pas ete terminee."
  }
  Write-Output "Connexion Google Cloud terminee."
  exit 0
}

try {
  $result = Get-GoogleStatus
}
catch {
  $result = [ordered]@{
    supported = $false
    installed = $false
    authenticated = $false
    account = $null
    projects = @()
    selectedProject = $null
    billingReady = $false
    billingEnabled = $false
    message = $_.Exception.Message
  }
}
$result | ConvertTo-Json -Depth 5 -Compress
