[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$')]
  [string]$SshTarget,
  [string]$IdentityFile = "",
  [string]$KnownHostsFile = "",
  [ValidateRange(1, 65535)]
  [int]$SshPort = 22,
  [ValidateRange(512, 1048576)]
  [int]$MinimumMemoryMiB = 2048,
  [ValidateRange(5, 10240)]
  [int]$MinimumDiskGiB = 8,
  [switch]$AcceptNewHostKey
)

$ErrorActionPreference = "Stop"

$ssh = Get-Command ssh -ErrorAction SilentlyContinue
if (-not $ssh) {
  throw "Commande requise introuvable: ssh"
}

$resolvedIdentity = ""
if ($IdentityFile.Trim()) {
  $resolvedIdentity = (Resolve-Path -LiteralPath $IdentityFile).Path
}
$resolvedKnownHostsFile = ""
if ($KnownHostsFile.Trim()) {
  $resolvedKnownHostsFile = (Resolve-Path -LiteralPath $KnownHostsFile).Path
}
if ($resolvedKnownHostsFile -and $AcceptNewHostKey) {
  throw "-KnownHostsFile et -AcceptNewHostKey sont mutuellement exclusifs."
}

$sshArgs = @(
  "-p", [string]$SshPort,
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=15",
  "-o", "ServerAliveInterval=15",
  "-o", "ServerAliveCountMax=2"
)
if ($resolvedIdentity) {
  $sshArgs += @("-i", $resolvedIdentity)
}
if ($resolvedKnownHostsFile) {
  $sshArgs += @(
    "-o", "UserKnownHostsFile=$resolvedKnownHostsFile",
    "-o", "StrictHostKeyChecking=yes"
  )
}
if ($AcceptNewHostKey) {
  $sshArgs += @("-o", "StrictHostKeyChecking=accept-new")
}

$remoteProbe = @'
set -eu

if ! command -v apt-get >/dev/null 2>&1; then
  echo "Le noeud doit utiliser Ubuntu ou Debian (apt-get absent)." >&2
  exit 20
fi
if ! command -v systemctl >/dev/null 2>&1; then
  echo "Le noeud doit utiliser systemd (systemctl absent)." >&2
  exit 21
fi
if [ "$(id -u)" -ne 0 ]; then
  if ! command -v sudo >/dev/null 2>&1 || ! sudo -n true >/dev/null 2>&1; then
    echo "L'utilisateur SSH doit disposer de sudo sans mot de passe." >&2
    exit 22
  fi
fi

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64|aarch64|arm64) ;;
  *) echo "Architecture non prise en charge: $arch" >&2; exit 23 ;;
esac

os_id="unknown"
os_version="unknown"
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  os_id="${ID:-unknown}"
  os_version="${VERSION_ID:-unknown}"
fi
case "$os_id" in
  ubuntu|debian) ;;
  *) echo "Distribution non prise en charge: $os_id" >&2; exit 24 ;;
esac

cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc)"
memory_kib="$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)"
swap_kib="$(awk '/^SwapTotal:/ { print $2 }' /proc/meminfo)"
disk_kib="$(df -Pk / | awk 'NR == 2 { print $4 }')"

printf 'CST_PREFLIGHT\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
  "$os_id" "$os_version" "$arch" "$cpu_count" \
  "$memory_kib" "$swap_kib" "$disk_kib"
'@

Write-Host "Verification du VPS $SshTarget..." -ForegroundColor Cyan
$probeOutput = @(& $ssh.Source @sshArgs $SshTarget $remoteProbe 2>&1)
$probeExitCode = $LASTEXITCODE
if ($probeExitCode -ne 0) {
  $details = ($probeOutput | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
  throw "Le precontrole distant a echoue (code $probeExitCode).`n$details"
}

$probeLine = $probeOutput |
  ForEach-Object { [string]$_ } |
  Where-Object { $_.StartsWith("CST_PREFLIGHT`t") } |
  Select-Object -Last 1
if (-not $probeLine) {
  throw "Le VPS a repondu, mais le resultat du precontrole est illisible."
}

$parts = $probeLine.Split("`t")
if ($parts.Count -ne 8) {
  throw "Le resultat du precontrole est incomplet."
}

$osId = $parts[1]
$osVersion = $parts[2]
$architecture = $parts[3]
$cpuCount = [int]$parts[4]
$memoryMiB = [math]::Floor(([int64]$parts[5]) / 1024)
$swapMiB = [math]::Floor(([int64]$parts[6]) / 1024)
$diskGiB = [math]::Floor(([int64]$parts[7]) / 1024 / 1024)
$buildMemoryMiB = $memoryMiB + $swapMiB

if ($diskGiB -lt $MinimumDiskGiB) {
  throw "Espace disque insuffisant: ${diskGiB} Gio libres; ${MinimumDiskGiB} Gio requis."
}
if ($buildMemoryMiB -lt $MinimumMemoryMiB) {
  throw "Memoire insuffisante pour compiler le serveur: ${memoryMiB} Mio de RAM + ${swapMiB} Mio de swap; ${MinimumMemoryMiB} Mio requis."
}
if ($memoryMiB -lt $MinimumMemoryMiB) {
  Write-Warning "La compilation peut utiliser le swap, mais ${memoryMiB} Mio de RAM laisse peu de marge aux chats."
}
if ($cpuCount -lt 2) {
  Write-Warning "Un seul processeur est visible; la compilation et les chats concurrents seront lents."
}

Write-Host "VPS compatible avec le deploiement." -ForegroundColor Green
[pscustomobject]@{
  Target = $SshTarget
  System = "$osId $osVersion"
  Architecture = $architecture
  Cpu = $cpuCount
  MemoryMiB = $memoryMiB
  SwapMiB = $swapMiB
  FreeDiskGiB = $diskGiB
} | Format-List
