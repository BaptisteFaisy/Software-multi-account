param(
  [int]$Port = 18081
)

$ErrorActionPreference = "Stop"

$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$tempRoot = [IO.Path]::GetFullPath((Join-Path $workspace (".tmp-messaging-visual-" + [guid]::NewGuid().ToString("N"))))
$staticDir = Join-Path $tempRoot "static"
$dataDir = Join-Path $tempRoot "data"
$proofDir = Join-Path $workspace ".codex-proof"
$serverExe = Join-Path $workspace "src-tauri\target\debug\cst-server.exe"
$server = $null

if (-not (Test-Path -LiteralPath $serverExe -PathType Leaf)) {
  throw "Serveur introuvable : $serverExe"
}

if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
  throw "Le port $Port est deja utilise."
}

New-Item -ItemType Directory -Force -Path $staticDir, $dataDir, $proofDir | Out-Null

try {
  Push-Location $workspace
  try {
    & npx.cmd vite build --outDir $staticDir --emptyOutDir
    if ($LASTEXITCODE -ne 0) { throw "Le build Vite a echoue." }
  } finally {
    Pop-Location
  }

  $env:CST_BIND = "127.0.0.1:$Port"
  $env:CST_DATA_DIR = $dataDir
  $env:CST_STATIC_DIR = $staticDir
  $env:CST_AUTH_SECURE_COOKIE = "false"

  $server = Start-Process -FilePath $serverExe `
    -WorkingDirectory $workspace `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $tempRoot "server.stdout.log") `
    -RedirectStandardError (Join-Path $tempRoot "server.stderr.log") `
    -PassThru

  $baseUrl = "http://127.0.0.1:$Port"
  $ready = $false
  for ($attempt = 0; $attempt -lt 80; $attempt++) {
    if ($server.HasExited) { break }
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/healthz" -TimeoutSec 1 | Out-Null
      $ready = $true
      break
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $ready) {
    $stderr = Get-Content -Raw -ErrorAction SilentlyContinue -LiteralPath (Join-Path $tempRoot "server.stderr.log")
    throw "Le serveur de smoke test n'a pas demarre. $stderr"
  }

  $nonce = [guid]::NewGuid().ToString("N").Substring(0, 12)
  $aliceSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $bobSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $aliceBody = @{ username = "Alice_$nonce"; email = "alice_$nonce@example.invalid"; password = "Smoke-Alice-$nonce-A1!" } | ConvertTo-Json
  $bobBody = @{ username = "Bob_$nonce"; email = "bob_$nonce@example.invalid"; password = "Smoke-Bob-$nonce-B1!" } | ConvertTo-Json

  $alice = Invoke-RestMethod -Uri "$baseUrl/api/auth/register" -Method Post -ContentType "application/json" -Body $aliceBody -WebSession $aliceSession
  $bob = Invoke-RestMethod -Uri "$baseUrl/api/auth/register" -Method Post -ContentType "application/json" -Body $bobBody -WebSession $bobSession

  $imageBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $workspace "public\icons\pwa-192.png")))
  $messageWithImage = @{
    body = "Bonjour Bob, voici une image privee."
    images = @(@{
      name = "aperçu-cst.png"
      mimeType = "image/png"
      dataBase64 = $imageBase64
    })
  } | ConvertTo-Json -Depth 5
  Invoke-RestMethod -Uri "$baseUrl/api/private-messages/conversations/$($bob.user.id)" -Method Post -ContentType "application/json" -Body $messageWithImage -WebSession $aliceSession | Out-Null
  Invoke-RestMethod -Uri "$baseUrl/api/private-messages/conversations/$($alice.user.id)" -Method Post -ContentType "application/json" -Body (@{ body = "Bonjour Alice, message bien recu." } | ConvertTo-Json) -WebSession $bobSession | Out-Null

  $cookie = $aliceSession.Cookies.GetCookies([Uri]$baseUrl)["cst_session"]
  if (-not $cookie) { throw "Le cookie de session Alice est absent." }

  $desktopProof = Join-Path $proofDir "messaging-desktop-visual.png"
  $mobileProof = Join-Path $proofDir "messaging-mobile-visual.png"
  $env:CST_MESSAGING_SMOKE_URL = $baseUrl
  $env:CST_MESSAGING_SMOKE_COOKIE = $cookie.Value
  $env:CST_MESSAGING_DESKTOP_PROOF = $desktopProof
  $env:CST_MESSAGING_MOBILE_PROOF = $mobileProof

  Push-Location $workspace
  try {
    & node "scripts\smoke-messaging-visual.mjs"
    if ($LASTEXITCODE -ne 0) { throw "Le smoke test Playwright a echoue." }
  } finally {
    Pop-Location
  }
} finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    $server.WaitForExit(5000) | Out-Null
  }

  $workspacePrefix = $workspace.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  $safeTemp = $tempRoot.StartsWith($workspacePrefix, [StringComparison]::OrdinalIgnoreCase) -and
    ([IO.Path]::GetFileName($tempRoot)).StartsWith(".tmp-messaging-visual-", [StringComparison]::Ordinal)
  if ($safeTemp -and (Test-Path -LiteralPath $tempRoot)) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
