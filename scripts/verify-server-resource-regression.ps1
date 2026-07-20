[CmdletBinding(DefaultParameterSetName = "Measure")]
param(
  [Parameter(Mandatory = $true, ParameterSetName = "Capture")]
  [ValidateNotNullOrEmpty()]
  [string]$CapturePath,

  [Parameter(Mandatory = $true, ParameterSetName = "Measure")]
  [ValidateRange(1, [int]::MaxValue)]
  [int]$RootProcessId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$temporaryCapture = $null

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Program,

    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "La commande '$Program $($Arguments -join ' ')' a echoue (code $LASTEXITCODE)."
  }
}

Push-Location $projectRoot
try {
  if ($PSCmdlet.ParameterSetName -eq "Capture") {
    $resolvedCapture = (Resolve-Path -LiteralPath $CapturePath).Path
  }
  else {
    $temporaryCapture = Join-Path ([IO.Path]::GetTempPath()) (
      "cst-server-resource-{0}.json" -f [Guid]::NewGuid().ToString("N")
    )
    $label = "native-codex-equivalent-load-{0}" -f (
      [DateTime]::UtcNow.ToString("yyyyMMddTHHmmssZ")
    )
    $capture = & "powershell.exe" @(
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "scripts/measure-server-resources.ps1",
      "-RootProcessId",
      $RootProcessId,
      "-DurationSeconds",
      12,
      "-SampleIntervalMilliseconds",
      1000,
      "-ProcessTreeRefreshMilliseconds",
      4000,
      "-Label",
      $label
    ) | Out-String
    if ($LASTEXITCODE -ne 0) {
      throw "La mesure de ressources a echoue (code $LASTEXITCODE)."
    }
    [IO.File]::WriteAllText(
      $temporaryCapture,
      $capture,
      [Text.UTF8Encoding]::new($false)
    )
    $resolvedCapture = $temporaryCapture
  }

  # Refuser d'abord une capture non equivalente afin de ne pas depenser de CPU
  # dans les contrats si la preuve de ressources est inutilisable.
  Invoke-Checked -Program "node" -Arguments @(
    "scripts/verify-server-resource-budget.mjs",
    "--capture",
    $resolvedCapture
  )

  # Concurrence volontairement fixee a un test a la fois : ce garde-fou doit
  # rester utilisable pendant que des agents reels sont actifs.
  Invoke-Checked -Program "node" -Arguments @(
    "--test",
    "--test-concurrency=1",
    "tests/server-idle-resource-budget.test.mjs",
    "tests/server-resource-budget.test.mjs",
    "tests/server-resource-measurement.test.mjs",
    "tests/chat-child-lifecycle.test.mjs",
    "tests/interface-mode.test.mjs",
    "tests/site-usability.test.mjs",
    "tests/chat-composer-controls.test.mjs",
    "tests/terminal-environments.test.mjs",
    "tests/terminal-transport.test.mjs"
  )

  Invoke-Checked -Program "cargo" -Arguments @(
    "test",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--lib",
    "--features",
    "desktop",
    "chat::tests::official_npm_codex_uses_its_native_binary_with_safe_fallbacks"
  )
}
finally {
  if ($temporaryCapture -and (Test-Path -LiteralPath $temporaryCapture)) {
    Remove-Item -LiteralPath $temporaryCapture -Force
  }
  Pop-Location
}
