param(
  [int]$Port = 8080
)

# Demarreur LEGER du noeud Windows, lance par la tache planifiee. Ne build PAS :
# il lance la release active via la jonction 'current' (voir update-node.ps1).
# Separer "demarrer" de "builder/mettre a jour" permet la bascule atomique :
# la tache pointe toujours vers current\cst-server.exe, seule la cible de la
# jonction change.

$ErrorActionPreference = "Stop"

$DataDir = Join-Path $env:APPDATA "codex-switch-terminal-server"
$EnvFile = Join-Path $DataDir "server.local.env.ps1"
$NodeHome = Join-Path $env:LOCALAPPDATA "codex-switch-terminal-node"
$CurrentExe = Join-Path $NodeHome "current\cst-server.exe"
$CurrentDist = Join-Path $NodeHome "current\dist"

if (Test-Path $EnvFile) { . $EnvFile }
if (-not $env:CST_ADMIN_TOKEN) { throw "CST_ADMIN_TOKEN absent de $EnvFile." }

$env:CST_DATA_DIR = $DataDir
$env:CST_STATIC_DIR = $CurrentDist
# Le port passe au demarreur de la tache planifiee doit rester prioritaire sur
# un CST_BIND partage avec une autre instance locale (par exemple le portable
# sur 8081). Ce noeud Tailscale reste volontairement lie au loopback.
$env:CST_BIND = "127.0.0.1:$Port"
# Un noeud Tailscale tourne sans operateur devant l'ecran. Le sandbox Codex
# eleve relance sinon son setup UAC a chaque nouveau workspace/chat.
if (-not $env:CST_CODEX_WINDOWS_SANDBOX) {
  $env:CST_CODEX_WINDOWS_SANDBOX = "unelevated"
}

if (-not (Test-Path $CurrentExe)) {
  throw "Release active introuvable: $CurrentExe (lance d'abord update-node.ps1)."
}

$LogDir = Join-Path $DataDir "logs"
$SupervisorLog = Join-Path $LogDir "server-supervisor.log"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-SupervisorLog {
  param([string]$Message)

  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $SupervisorLog -Value "[$timestamp] $Message" -Encoding UTF8
}

# La tache planifiee surveille ce script, pas directement cst-server.exe.
# Sans cette boucle, un abort natif (par exemple une allocation memoire refusee)
# laisse PowerShell terminer avec succes et Windows ne declenche aucun restart.
while ($true) {
  if (-not (Test-Path $CurrentExe)) {
    Write-SupervisorLog "Release active absente; nouvelle tentative dans 5 secondes."
    Start-Sleep -Seconds 5
    continue
  }

  Write-SupervisorLog "Demarrage du noeud sur $env:CST_BIND."
  & $CurrentExe
  $exitCode = $LASTEXITCODE

  if ($exitCode -eq 0) {
    Write-SupervisorLog "Arret normal du noeud; redemarrage dans 5 secondes pour maintenir le service."
  }
  else {
    Write-SupervisorLog "Arret inattendu du noeud (code $exitCode); redemarrage dans 5 secondes."
  }
  Start-Sleep -Seconds 5
}
