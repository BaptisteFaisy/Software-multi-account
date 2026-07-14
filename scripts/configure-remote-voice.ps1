param(
  [Parameter(Mandatory = $true)]
  [string]$TranscriptionUrl,
  [Parameter(Mandatory = $true)]
  [string]$OllamaUrl,
  [string]$TranscriptionModel = "whisper-1",
  [string]$SummaryModel = "qwen3:4b-instruct-2507-q4_K_M",
  [string]$VoiceHome = "",
  [switch]$FallbackLocal,
  [switch]$AllowInsecureHttp
)

$ErrorActionPreference = "Stop"

if (-not $VoiceHome.Trim()) {
  if (-not $env:APPDATA) {
    throw "APPDATA est introuvable. Passe explicitement -VoiceHome <dossier>."
  }
  $VoiceHome = Join-Path $env:APPDATA "codex-switch-terminal\voice"
}
$VoiceHome = [IO.Path]::GetFullPath($VoiceHome)

function Resolve-VoiceUri {
  param(
    [Parameter(Mandatory = $true)][string]$Value,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $uri = $null
  if (-not [Uri]::TryCreate($Value.Trim(), [UriKind]::Absolute, [ref]$uri)) {
    throw "$Label invalide : $Value"
  }
  if ($uri.Scheme -notin @("http", "https")) {
    throw "$Label doit utiliser HTTP ou HTTPS."
  }
  if ($uri.UserInfo) {
    throw "$Label ne doit pas contenir d'identifiants. Utilise une variable d'environnement de jeton."
  }
  if ($uri.Fragment) {
    throw "$Label ne doit pas contenir de fragment (#...)."
  }
  if ($uri.Scheme -eq "http" -and -not $uri.IsLoopback -and -not $AllowInsecureHttp) {
    throw "$Label doit utiliser HTTPS hors de cette machine. -AllowInsecureHttp est reserve a un reseau prive temporaire."
  }
  return $uri.AbsoluteUri.TrimEnd("/")
}

$TranscriptionUrl = Resolve-VoiceUri -Value $TranscriptionUrl -Label "URL de transcription"
$OllamaUrl = Resolve-VoiceUri -Value $OllamaUrl -Label "URL Ollama"
if (-not $TranscriptionModel.Trim()) {
  throw "TranscriptionModel ne peut pas etre vide."
}
if (-not $SummaryModel.Trim()) {
  throw "SummaryModel ne peut pas etre vide."
}

New-Item -ItemType Directory -Path $VoiceHome -Force | Out-Null
$configPath = Join-Path $VoiceHome "config.json"
$existingWhisperModel = $null
if (Test-Path -LiteralPath $configPath) {
  try {
    $existing = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $existingWhisperModel = $existing.whisperModel
  } catch {
    throw "La configuration existante $configPath est invalide : $($_.Exception.Message)"
  }
}

$voiceConfig = [ordered]@{
  transcriptionMode = "remote"
  remoteTranscriptionUrl = $TranscriptionUrl
  remoteTranscriptionModel = $TranscriptionModel.Trim()
  remoteFallbackLocal = [bool]$FallbackLocal
  ollamaModel = $SummaryModel.Trim()
  ollamaUrl = $OllamaUrl
}
if ($existingWhisperModel) {
  $voiceConfig["whisperModel"] = $existingWhisperModel
}

$json = $voiceConfig | ConvertTo-Json
$utf8WithoutBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($configPath, "$json`n", $utf8WithoutBom)

Write-Host ""
Write-Host "Saisie vocale distante configuree." -ForegroundColor Green
Write-Host "Configuration : $configPath"
Write-Host "Transcription : $TranscriptionUrl ($($TranscriptionModel.Trim()))"
Write-Host "Reformulation : $OllamaUrl ($($SummaryModel.Trim()))"
Write-Host "Repli local   : $([bool]$FallbackLocal)"
Write-Host ""
Write-Host "Les jetons ne sont pas stockes dans le fichier. Definis-les avant de lancer Switch :"
Write-Host '  $env:CST_VOICE_TRANSCRIPTION_API_KEY = Read-Host "Jeton STT"'
Write-Host '  $env:CST_VOICE_OLLAMA_API_KEY = Read-Host "Jeton Ollama"'
if ($AllowInsecureHttp) {
  Write-Host '  $env:CST_VOICE_ALLOW_INSECURE_REMOTE = "1"'
}
Write-Host "Puis redemarre l'application."
