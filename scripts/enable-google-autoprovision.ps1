[CmdletBinding()]
param(
  [ValidatePattern('^[A-Za-z0-9 ._-]{1,80}$')]
  [string]$TaskName = "CST Google Trial Autoprovision",
  [ValidateRange(1, 30)]
  [int]$IntervalMinutes = 2
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$Watcher = (Resolve-Path -LiteralPath (Join-Path $ScriptDir "watch-google-billing-and-provision.ps1")).Path
$PowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
$UserId = [Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction `
  -Execute $PowerShell `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Watcher`" -TaskName `"$TaskName`"" `
  -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
  -RepetitionDuration (New-TimeSpan -Days 365)
$principal = New-ScheduledTaskPrincipal `
  -UserId $UserId `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 6)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Description "Attend la validation de l'essai Google, puis deploie automatiquement CST avec Ansible et Docker Compose." `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Output "Surveillance Google Cloud active toutes les $IntervalMinutes minute(s)."
