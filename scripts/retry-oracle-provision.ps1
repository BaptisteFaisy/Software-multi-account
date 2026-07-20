[CmdletBinding()]
param(
  [ValidateRange(1, 1000)]
  [int]$MaxAttempts = 72,
  [ValidateRange(60, 86400)]
  [int]$DelaySeconds = 300,
  [string]$LogFile = "",
  [string]$WslDistribution = "Ubuntu",
  [switch]$IncludeAccountSeed,
  [switch]$ForceLaunch,
  [switch]$FullSizeOnly
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProvisionScript = Join-Path $ScriptDir "provision-oracle-free.ps1"
$CapacityScript = Join-Path $ScriptDir "check-oracle-a1-capacity.sh"
$StateDir = Join-Path $env:APPDATA "codex-switch-terminal\oracle"
if (-not $LogFile.Trim()) { $LogFile = Join-Path $StateDir "provision-retry.log" }
$SuccessFile = Join-Path $StateDir "provision-success.json"

New-Item -ItemType Directory -Path $StateDir -Force | Out-Null

$capacityWslPath = @(& wsl.exe -d $WslDistribution -e wslpath -a -u $CapacityScript 2>&1)
if ($LASTEXITCODE -ne 0) {
  throw "Impossible de convertir le chemin du controle de capacite pour WSL."
}
$capacityWslPath = (($capacityWslPath | ForEach-Object { [string]$_ }) -join "`n").Trim()

$mutex = New-Object Threading.Mutex($false, "Local\CSTOracleAlwaysFreeProvision")
$hasMutex = $false

function Write-RetryLog {
  param([Parameter(Mandatory = $true)][string]$Message)
  $line = "{0:o} {1}" -f [DateTimeOffset]::Now, $Message
  Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
  Write-Output $line
}

function Wait-InChunks {
  param([Parameter(Mandatory = $true)][int]$Seconds)
  $remaining = $Seconds
  while ($remaining -gt 0) {
    $chunk = [Math]::Min(30, $remaining)
    Start-Sleep -Seconds $chunk
    $remaining -= $chunk
  }
}

try {
  try {
    $hasMutex = $mutex.WaitOne(0)
  }
  catch [Threading.AbandonedMutexException] {
    # Une ancienne boucle peut avoir ete arretee pendant son attente. Le
    # processus courant possede alors bien le mutex et peut reprendre proprement.
    $hasMutex = $true
    Write-RetryLog "Verrou abandonne recupere apres l'arret d'une ancienne relance."
  }
  if (-not $hasMutex) {
    throw "Un retry Oracle CST est deja actif sur ce poste."
  }

  if (Test-Path -LiteralPath $SuccessFile) {
    Write-RetryLog "Provisionnement Oracle deja termine; controle ignore."
    exit 0
  }

  Write-RetryLog $(if ($IncludeAccountSeed) {
    "Le premier deploiement copiera les comptes locaux."
  } else {
    "Le premier deploiement demarrera sans copier les comptes locaux."
  })

  $capacityProfiles = @(
    [pscustomobject]@{ Ocpus = 2; MemoryGB = 12; Capacity = 2; Label = "2 OCPU / 12 Go" }
  )
  if (-not $FullSizeOnly) {
    $capacityProfiles += [pscustomobject]@{
      Ocpus = 1
      MemoryGB = 6
      Capacity = 1
      Label = "1 OCPU / 6 Go"
    }
  }
  if ($ForceLaunch) {
    Write-RetryLog "Les rapports negatifs seront suivis d'une vraie tentative de lancement."
  }

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    Write-RetryLog "Controle $attempt/$MaxAttempts de la capacite Oracle A1 Always Free."
    try {
      $availableProfile = $null
      $launchForced = $false
      foreach ($capacityProfile in $capacityProfiles) {
        Write-RetryLog "Test du profil A1 $($capacityProfile.Label)."
        $previousErrorAction = $ErrorActionPreference
        try {
          $ErrorActionPreference = "Continue"
          $capacityOutput = @(
            & wsl.exe -d $WslDistribution -e bash $capacityWslPath `
              --ocpus ([string]$capacityProfile.Ocpus) `
              --memory-gb ([string]$capacityProfile.MemoryGB) 2>&1
          )
          $capacityExit = $LASTEXITCODE
        }
        finally {
          $ErrorActionPreference = $previousErrorAction
        }
        foreach ($line in $capacityOutput) {
          Add-Content -LiteralPath $LogFile -Value ([string]$line) -Encoding UTF8
          Write-Output ([string]$line)
        }

        if ($capacityExit -eq 75) {
          continue
        }
        if ($capacityExit -ne 0) {
          throw "Le rapport de capacite OCI a echoue (code $capacityExit)."
        }
        $availableProfile = $capacityProfile
        break
      }

      if ($null -eq $availableProfile -and $ForceLaunch) {
        $availableProfile = $capacityProfiles[0]
        $launchForced = $true
        Write-RetryLog "Rapport negatif; tentative reelle forcee pour A1 $($availableProfile.Label)."
      }

      if ($null -eq $availableProfile) {
        Write-RetryLog "Aucune capacite A1 disponible; aucune creation n'est tentee."
      }
      else {
        if (-not $launchForced) {
          Write-RetryLog "Capacite A1 $($availableProfile.Label) detectee; lancement du provisionnement complet."
        }
        $arguments = @{
          Apply = $true
          Deploy = $true
          Ocpus = [int]$availableProfile.Ocpus
          MemoryGB = [int]$availableProfile.MemoryGB
          Capacity = [int]$availableProfile.Capacity
        }
        if (-not $IncludeAccountSeed) { $arguments.SkipAccountSeed = $true }

        & $ProvisionScript @arguments *>&1 | ForEach-Object {
          $line = [string]$_
          Add-Content -LiteralPath $LogFile -Value ([string]$line) -Encoding UTF8
          Write-Output $line
        }

        $result = [ordered]@{
          completedAt = [DateTimeOffset]::Now.ToString("o")
          attempt = $attempt
          profile = "oracle-free"
          ocpus = [int]$availableProfile.Ocpus
          memoryGB = [int]$availableProfile.MemoryGB
        }
        [IO.File]::WriteAllText(
          $SuccessFile,
          (($result | ConvertTo-Json) + [Environment]::NewLine),
          (New-Object Text.UTF8Encoding($false))
        )
        Write-RetryLog "Provisionnement et deploiement CST termines avec succes."
        exit 0
      }
    }
    catch {
      Write-RetryLog "Tentative en echec: $($_.Exception.Message)"
    }

    if ($attempt -lt $MaxAttempts) {
      Write-RetryLog "Nouvel essai dans $DelaySeconds secondes."
      Wait-InChunks -Seconds $DelaySeconds
    }
  }

  Write-RetryLog "Nombre maximal de tentatives atteint sans capacite A1."
  exit 1
}
finally {
  if ($hasMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
