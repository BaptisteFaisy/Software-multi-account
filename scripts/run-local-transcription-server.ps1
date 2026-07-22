[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8178,
  [ValidateRange(1, 64)]
  [int]$Threads = 4
)

$ErrorActionPreference = "Stop"

$voiceDir = Join-Path $env:APPDATA "codex-switch-terminal\voice"
$server = Join-Path $voiceDir "whisper\Release\whisper-server.exe"
$model = Join-Path $voiceDir "models\ggml-large-v3-turbo-q5_0.bin"
$ffmpeg = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\ffmpeg.exe"
$runtimeDir = Join-Path $voiceDir "server"
$tempDir = Join-Path $runtimeDir "tmp"
$stdoutLog = Join-Path $runtimeDir "whisper-server.log"
$stderrLog = Join-Path $runtimeDir "whisper-server.error.log"

foreach ($required in @($server, $model, $ffmpeg)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "Composant de transcription introuvable : $required"
  }
}

New-Item -ItemType Directory -Force -Path $runtimeDir, $tempDir | Out-Null
$env:PATH = "$(Split-Path -Parent $ffmpeg);$env:PATH"

$arguments = @(
  "--host", "127.0.0.1",
  "--port", [string]$Port,
  "--model", $model,
  "--language", "auto",
  "--inference-path", "/v1/audio/transcriptions",
  "--convert",
  "--tmp-dir", $tempDir,
  "--threads", [string]$Threads,
  "--processors", "1"
)

$process = Start-Process `
  -FilePath $server `
  -ArgumentList $arguments `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -Wait `
  -PassThru
exit $process.ExitCode
