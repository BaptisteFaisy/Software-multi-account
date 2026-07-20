[CmdletBinding()]
param(
  [string]$Distro = "Ubuntu",
  [string]$ServerBinary = "",
  [switch]$KeepArtifacts
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$RunId = ([guid]::NewGuid().ToString("N")).Substring(0, 12)
$WindowsRoot = Join-Path $env:TEMP "cst-vps-ssh-smoke-$RunId"
$WslRoot = "/tmp/cst-vps-ssh-smoke-$RunId"
$IdentityFile = Join-Path $WindowsRoot "id_ed25519"
$HostIdentityFile = Join-Path $WindowsRoot "ssh_host_ed25519_key"
$KnownHostsFile = Join-Path $WindowsRoot "known_hosts"
$AppData = Join-Path $WindowsRoot "appdata"
$ServerStdout = Join-Path $WindowsRoot "server.stdout.log"
$ServerStderr = Join-Path $WindowsRoot "server.stderr.log"
$SshdStdout = Join-Path $WindowsRoot "sshd.stdout.log"
$SshdStderr = Join-Path $WindowsRoot "sshd.stderr.log"
$ProfileName = "ssh-smoke-$RunId"
$ServerProcess = $null
$SshdProcess = $null

function Quote-NativeArgument {
  param([string]$Value)
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + $Value.Replace('"', '\"') + '"'
}

function Quote-BashLiteral {
  param([string]$Value)
  $singleQuoteEscape = "'" + '"' + "'" + '"' + "'"
  return "'" + $Value.Replace("'", $singleQuoteEscape) + "'"
}

function Start-HiddenProcess {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [string]$StandardOutput,
    [string]$StandardError
  )
  $argumentLine = ($ArgumentList | ForEach-Object { Quote-NativeArgument ([string]$_) }) -join " "
  return Start-Process `
    -FilePath $FilePath `
    -ArgumentList $argumentLine `
    -WindowStyle Hidden `
    -RedirectStandardOutput $StandardOutput `
    -RedirectStandardError $StandardError `
    -PassThru
}

function Get-FreeTcpPort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    return ([Net.IPEndPoint]$listener.LocalEndpoint).Port
  }
  finally {
    $listener.Stop()
  }
}

function Assert-NativeSuccess {
  param([string]$Operation)
  if ($LASTEXITCODE -ne 0) {
    throw "$Operation a echoue (code $LASTEXITCODE)."
  }
}

function Read-LogTail {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return "" }
  return ((Get-Content -LiteralPath $Path -Tail 80 -ErrorAction SilentlyContinue) -join [Environment]::NewLine)
}

foreach ($command in @("wsl.exe", "ssh.exe", "ssh-keygen.exe")) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "Commande requise introuvable: $command"
  }
}
if (-not (Test-Path -LiteralPath (Join-Path $Root "scripts\connect-vps.ps1"))) {
  throw "Connecteur VPS introuvable."
}
if (-not (Test-Path -LiteralPath (Join-Path $Root "scripts\connect-vps-pool.ps1"))) {
  throw "Connecteur de pool VPS introuvable."
}

$SshPort = Get-FreeTcpPort
do { $RemotePort = Get-FreeTcpPort } while ($RemotePort -eq $SshPort)
do { $LocalPort = Get-FreeTcpPort } while ($LocalPort -in @($SshPort, $RemotePort))
$AdminToken = "cst-ssh-smoke-$([guid]::NewGuid().ToString('N'))"

New-Item -ItemType Directory -Force -Path $WindowsRoot, $AppData | Out-Null

try {
  & ssh-keygen.exe -q -t ed25519 -N '""' -f $IdentityFile
  Assert-NativeSuccess "La generation de la cle SSH temporaire"
  & ssh-keygen.exe -q -t ed25519 -N '""' -f $HostIdentityFile
  Assert-NativeSuccess "La generation de la cle hote SSH temporaire"

  $PublicKeyWindows = "$IdentityFile.pub"
  $PublicKeyWindowsForWsl = $PublicKeyWindows.Replace("\", "/")
  $PublicKeyWsl = (& wsl.exe -d $Distro -e wslpath -a -u $PublicKeyWindowsForWsl).Trim()
  Assert-NativeSuccess "La conversion du chemin de la cle publique"
  $HostIdentityWindowsForWsl = $HostIdentityFile.Replace("\", "/")
  $HostIdentityWsl = (& wsl.exe -d $Distro -e wslpath -a -u $HostIdentityWindowsForWsl).Trim()
  Assert-NativeSuccess "La conversion du chemin de la cle hote"
  $HostPublicKeyWsl = (& wsl.exe -d $Distro -e wslpath -a -u "$HostIdentityWindowsForWsl.pub").Trim()
  Assert-NativeSuccess "La conversion du chemin de la cle hote publique"

  if (-not $ServerBinary.Trim()) {
    $ServerBinary = (& wsl.exe -d $Distro -e bash -lc `
      "find /home /root -path '*/.cache/cst-vps-target/debug/cst-server' -type f -executable -print -quit 2>/dev/null").Trim()
    Assert-NativeSuccess "La recherche du binaire cst-server Linux"
  }
  if (-not $ServerBinary.Trim()) {
    throw "Binaire Linux cst-server introuvable; indique -ServerBinary."
  }
  & wsl.exe -d $Distro -e test -x $ServerBinary
  Assert-NativeSuccess "La verification du binaire cst-server Linux"

  & wsl.exe -d $Distro -u root -e rm -rf -- $WslRoot
  Assert-NativeSuccess "Le nettoyage du repertoire WSL temporaire"
  & wsl.exe -d $Distro -u root -e mkdir -p `
    "$WslRoot/package" `
    "$WslRoot/openssh" `
    "$WslRoot/data" `
    "$WslRoot/static" `
    "$WslRoot/workspaces"
  Assert-NativeSuccess "La creation des repertoires WSL temporaires"
  & wsl.exe -d $Distro -u root -e chown _apt:root "$WslRoot/package"
  Assert-NativeSuccess "La preparation du cache OpenSSH temporaire"
  & wsl.exe -d $Distro -u root --cd "$WslRoot/package" -e apt-get download openssh-server
  Assert-NativeSuccess "Le telechargement du paquet OpenSSH"
  $openSshPackage = (& wsl.exe -d $Distro -u root -e find "$WslRoot/package" `
    -maxdepth 1 -type f -name 'openssh-server_*.deb' -print -quit).Trim()
  Assert-NativeSuccess "La recherche du paquet OpenSSH"
  if (-not $openSshPackage) { throw "Paquet OpenSSH telecharge introuvable." }
  & wsl.exe -d $Distro -u root -e dpkg-deb -x $openSshPackage "$WslRoot/openssh"
  Assert-NativeSuccess "L'extraction du paquet OpenSSH"
  & wsl.exe -d $Distro -u root -e test -x "$WslRoot/openssh/usr/sbin/sshd"
  Assert-NativeSuccess "La verification du serveur OpenSSH extrait"
  & wsl.exe -d $Distro -u root -e install -m 0600 $PublicKeyWsl "$WslRoot/authorized_keys"
  Assert-NativeSuccess "L'installation de la cle SSH autorisee"
  & wsl.exe -d $Distro -u root -e install -m 0600 $HostIdentityWsl "$WslRoot/ssh_host_ed25519_key"
  Assert-NativeSuccess "L'installation de la cle hote SSH"
  & wsl.exe -d $Distro -u root -e install -m 0644 $HostPublicKeyWsl "$WslRoot/ssh_host_ed25519_key.pub"
  Assert-NativeSuccess "L'installation de la cle hote SSH publique"
  & wsl.exe -d $Distro -u root -e test -d /run/sshd
  if ($LASTEXITCODE -ne 0) {
    & wsl.exe -d $Distro -u root -e mkdir -p /run/sshd
    Assert-NativeSuccess "La creation du repertoire OpenSSH d'execution"
    & wsl.exe -d $Distro -u root -e touch "$WslRoot/remove-run-sshd"
    Assert-NativeSuccess "Le marquage du repertoire OpenSSH ephemere"
  }

  $hostPublicKey = (Get-Content -LiteralPath "$HostIdentityFile.pub" -Raw).Trim()
  $hostKeyParts = @($hostPublicKey -split '\s+')
  if ($hostKeyParts.Count -lt 2) { throw "Cle hote SSH temporaire invalide." }
  "[127.0.0.1]:$SshPort $($hostKeyParts[0]) $($hostKeyParts[1])" |
    Set-Content -LiteralPath $KnownHostsFile -Encoding ascii

  $serverCommand = @(
    "echo `$`$ > $(Quote-BashLiteral "$WslRoot/server.pid");",
    "exec env",
    "HOME=/root",
    "CST_BIND=127.0.0.1:$RemotePort",
    "CST_DATA_DIR=$(Quote-BashLiteral "$WslRoot/data")",
    "CST_WORKSPACES_ROOT=$(Quote-BashLiteral "$WslRoot/workspaces")",
    "CST_STATIC_DIR=$(Quote-BashLiteral "$WslRoot/static")",
    "CST_PUBLIC_BASE_URL=http://127.0.0.1:$RemotePort",
    "CST_ADMIN_TOKEN=$(Quote-BashLiteral $AdminToken)",
    "CST_NODE_ID=vps-ssh-smoke",
    "CST_NODE_LABEL=VPS-SSH-smoke",
    "CST_NODE_CAPACITY=2",
    (Quote-BashLiteral $ServerBinary)
  ) -join " "
  $ServerProcess = Start-HiddenProcess `
    -FilePath (Get-Command wsl.exe).Source `
    -ArgumentList @("-d", $Distro, "-u", "root", "-e", "bash", "-lc", $serverCommand) `
    -StandardOutput $ServerStdout `
    -StandardError $ServerStderr

  $runtimeReady = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if ($ServerProcess.HasExited) {
      throw "Le runtime Linux s'est arrete avant sa sonde de sante (code $($ServerProcess.ExitCode))."
    }
    try {
      $runtimeHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$RemotePort/healthz" -TimeoutSec 1
      if ($runtimeHealth.ok) {
        $runtimeReady = $true
        break
      }
    }
    catch { Start-Sleep -Milliseconds 200 }
  }
  if (-not $runtimeReady) { throw "Le runtime Linux ne repond pas avant l'ouverture du tunnel SSH." }

  $sshdBinary = "$WslRoot/openssh/usr/sbin/sshd"
  $sshdOptions = @(
    "Port=$SshPort",
    "ListenAddress=127.0.0.1",
    "HostKey=$WslRoot/ssh_host_ed25519_key",
    "PidFile=$WslRoot/sshd.pid",
    "AuthorizedKeysFile=$WslRoot/authorized_keys",
    "PermitRootLogin=prohibit-password",
    "PasswordAuthentication=no",
    "KbdInteractiveAuthentication=no",
    "UsePAM=no",
    "StrictModes=no",
    "AllowTcpForwarding=yes",
    "GatewayPorts=no",
    "X11Forwarding=no",
    "UseDNS=no",
    "PrintMotd=no",
    "LogLevel=VERBOSE",
    "Subsystem=sftp internal-sftp"
  )
  $sshdArguments = @("-d", $Distro, "-u", "root", "-e", $sshdBinary, "-D", "-e", "-f", "/dev/null")
  foreach ($option in $sshdOptions) { $sshdArguments += @("-o", $option) }
  $SshdProcess = Start-HiddenProcess `
    -FilePath (Get-Command wsl.exe).Source `
    -ArgumentList $sshdArguments `
    -StandardOutput $SshdStdout `
    -StandardError $SshdStderr

  $sshReady = $false
  for ($attempt = 0; $attempt -lt 80; $attempt++) {
    if ($SshdProcess.HasExited) {
      throw "Le serveur OpenSSH ephemere s'est arrete (code $($SshdProcess.ExitCode))."
    }
    $probe = [Net.Sockets.TcpClient]::new()
    try {
      $connected = $probe.ConnectAsync("127.0.0.1", $SshPort).Wait(250)
      if ($connected -and $probe.Connected) {
        $sshReady = $true
        break
      }
    }
    catch {}
    finally { $probe.Dispose() }
    Start-Sleep -Milliseconds 100
  }
  if (-not $sshReady) { throw "Le serveur OpenSSH ephemere ne repond pas." }

  $profileDir = Join-Path $AppData "codex-switch-terminal\vps"
  New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
  $secureToken = ConvertTo-SecureString -String $AdminToken -AsPlainText -Force
  $profile = [ordered]@{
    version = 1
    id = $ProfileName
    label = "VPS SSH smoke"
    sshTarget = "root@127.0.0.1"
    sshPort = $SshPort
    identityFile = $IdentityFile
    remotePort = $RemotePort
    defaultLocalPort = $LocalPort
    tokenProtected = (ConvertFrom-SecureString -SecureString $secureToken)
  }
  $profile | ConvertTo-Json | Set-Content `
    -LiteralPath (Join-Path $profileDir "$ProfileName.json") `
    -Encoding UTF8

  $previousAppData = $env:APPDATA
  try {
    $env:APPDATA = $AppData
    $connectionOutput = & powershell.exe `
      -NoProfile `
      -ExecutionPolicy Bypass `
      -File (Join-Path $Root "scripts\connect-vps.ps1") `
      -Profile $ProfileName `
      -KnownHostsFile $KnownHostsFile `
      -CheckOnly 2>&1
    $connectionExitCode = $LASTEXITCODE

    $poolConnectionOutput = & powershell.exe `
      -NoProfile `
      -ExecutionPolicy Bypass `
      -File (Join-Path $Root "scripts\connect-vps-pool.ps1") `
      -Profiles $ProfileName `
      -StartLocalPort $LocalPort `
      -KnownHostsFile $KnownHostsFile `
      -CheckOnly 2>&1
    $poolConnectionExitCode = $LASTEXITCODE
  }
  finally {
    $env:APPDATA = $previousAppData
  }
  $connectionText = ($connectionOutput | Out-String).Trim()
  if ($connectionExitCode -ne 0) {
    throw "Le connecteur VPS a echoue (code $connectionExitCode):`n$connectionText"
  }
  if ($connectionText -notmatch "Tunnel SSH et authentification valides") {
    throw "Le connecteur VPS n'a pas confirme le tunnel authentifie:`n$connectionText"
  }
  $poolConnectionText = ($poolConnectionOutput | Out-String).Trim()
  if ($poolConnectionExitCode -ne 0) {
    throw "Le connecteur de pool VPS a echoue (code $poolConnectionExitCode):`n$poolConnectionText"
  }
  if ($poolConnectionText -notmatch "Pool valide") {
    throw "Le connecteur de pool VPS n'a pas confirme le pool authentifie:`n$poolConnectionText"
  }

  Write-Host $connectionText
  Write-Host $poolConnectionText
  Write-Host "Smoke test Windows -> OpenSSH -> cst-server Linux valide." -ForegroundColor Green
  Write-Host "Ports ephemeres: SSH=$SshPort, distant=$RemotePort, local=$LocalPort"
}
catch {
  $details = @(
    "Echec du smoke test du tunnel SSH: $($_.Exception.Message)",
    "--- cst-server stderr ---",
    (Read-LogTail $ServerStderr),
    "--- sshd stderr ---",
    (Read-LogTail $SshdStderr)
  ) -join [Environment]::NewLine
  throw $details
}
finally {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $removeRunSshd = $false
    & wsl.exe -d $Distro -u root -e test -f "$WslRoot/remove-run-sshd" 2>$null
    if ($LASTEXITCODE -eq 0) { $removeRunSshd = $true }

    foreach ($pidFile in @("$WslRoot/server.pid", "$WslRoot/sshd.pid")) {
      $linuxPid = (& wsl.exe -d $Distro -u root -e cat $pidFile 2>$null | Out-String).Trim()
      if ($linuxPid -match '^\d+$') {
        & wsl.exe -d $Distro -u root -e kill $linuxPid 2>$null | Out-Null
      }
    }

    foreach ($process in @($ServerProcess, $SshdProcess)) {
      if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $process.Id -ErrorAction SilentlyContinue
      }
    }

    & wsl.exe -d $Distro -u root -e rm -rf -- $WslRoot 2>$null | Out-Null
    if ($removeRunSshd) {
      & wsl.exe -d $Distro -u root -e rmdir /run/sshd 2>$null | Out-Null
    }
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($KeepArtifacts) {
    Write-Host "Artefacts conserves dans $WindowsRoot"
  }
  elseif (Test-Path -LiteralPath $WindowsRoot) {
    Remove-Item -LiteralPath $WindowsRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
