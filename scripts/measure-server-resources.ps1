[CmdletBinding(DefaultParameterSetName = "ByName")]
param(
  [Parameter(Mandatory = $true, ParameterSetName = "ById")]
  [ValidateRange(1, [int]::MaxValue)]
  [int]$RootProcessId,

  [Parameter(ParameterSetName = "ByName")]
  [ValidateNotNullOrEmpty()]
  [string]$ProcessName = "cst-server",

  [ValidateRange(2, 3600)]
  [int]$DurationSeconds = 30,

  [ValidateRange(250, 60000)]
  [int]$SampleIntervalMilliseconds = 1000,

  [ValidateRange(250, 60000)]
  [int]$ProcessTreeRefreshMilliseconds = 5000,

  [ValidateNotNullOrEmpty()]
  [string]$Label = "live-observation"
)

# Mesure l'arbre complet d'un serveur sans inclure le PowerShell qui effectue
# la mesure. La sortie JSON est volontairement autonome afin que deux captures
# puissent etre comparees sans outil ni dependance supplementaire.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not ("CstPerformance.ProcessSnapshot" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace CstPerformance
{
    public sealed class ProcessLink
    {
        public int ProcessId { get; set; }
        public int ParentProcessId { get; set; }
        public int ThreadCount { get; set; }
    }

    public static class ProcessSnapshot
    {
        private const uint TH32CS_SNAPPROCESS = 0x00000002;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct PROCESSENTRY32
        {
            public uint dwSize;
            public uint cntUsage;
            public uint th32ProcessID;
            public UIntPtr th32DefaultHeapID;
            public uint th32ModuleID;
            public uint cntThreads;
            public uint th32ParentProcessID;
            public int pcPriClassBase;
            public uint dwFlags;

            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
            public string szExeFile;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool Process32FirstW(IntPtr snapshot, ref PROCESSENTRY32 entry);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool Process32NextW(IntPtr snapshot, ref PROCESSENTRY32 entry);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        public static ProcessLink[] Capture()
        {
            IntPtr snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if (snapshot == new IntPtr(-1))
                throw new Win32Exception(Marshal.GetLastWin32Error());

            try
            {
                var links = new List<ProcessLink>();
                var entry = new PROCESSENTRY32();
                entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
                if (!Process32FirstW(snapshot, ref entry))
                    throw new Win32Exception(Marshal.GetLastWin32Error());

                do
                {
                    links.Add(new ProcessLink
                    {
                        ProcessId = unchecked((int)entry.th32ProcessID),
                        ParentProcessId = unchecked((int)entry.th32ParentProcessID),
                        ThreadCount = unchecked((int)entry.cntThreads)
                    });
                    entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
                }
                while (Process32NextW(snapshot, ref entry));

                return links.ToArray();
            }
            finally
            {
                CloseHandle(snapshot);
            }
        }
    }
}
"@
}

function Resolve-RootProcess {
  if ($PSCmdlet.ParameterSetName -eq "ById") {
    return Get-Process -Id $RootProcessId -ErrorAction Stop
  }

  $matches = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)
  if ($matches.Count -eq 0) {
    throw "Aucun processus '$ProcessName' n'est actif. Passe -RootProcessId pour cibler une instance precise."
  }
  if ($matches.Count -gt 1) {
    $ids = ($matches | Sort-Object Id | ForEach-Object { $_.Id }) -join ", "
    throw "Plusieurs processus '$ProcessName' sont actifs (PID: $ids). Passe -RootProcessId."
  }

  return $matches[0]
}

function Get-DescendantIds {
  param(
    [Parameter(Mandatory = $true)]
    [int]$RootId,

    [Parameter(Mandatory = $true)]
    [object[]]$ProcessRows
  )

  $childrenByParent = @{}
  foreach ($row in $ProcessRows) {
    $parentId = [int]$row.ParentProcessId
    if (-not $childrenByParent.ContainsKey($parentId)) {
      $childrenByParent[$parentId] = [System.Collections.Generic.List[int]]::new()
    }
    $childrenByParent[$parentId].Add([int]$row.ProcessId)
  }

  $seen = [System.Collections.Generic.HashSet[int]]::new()
  $pending = [System.Collections.Generic.Queue[int]]::new()
  [void]$seen.Add($RootId)
  $pending.Enqueue($RootId)

  while ($pending.Count -gt 0) {
    $parentId = $pending.Dequeue()
    if (-not $childrenByParent.ContainsKey($parentId)) {
      continue
    }

    foreach ($childId in $childrenByParent[$parentId]) {
      if ($seen.Add($childId)) {
        $pending.Enqueue($childId)
      }
    }
  }

  return $seen
}

function Get-TreeInventory {
  param(
    [Parameter(Mandatory = $true)]
    [int]$RootId,

    [Parameter(Mandatory = $true)]
    [int]$SamplerId,

    [Parameter(Mandatory = $true)]
    [object[]]$ProcessRows
  )

  $targetIds = @(Get-DescendantIds -RootId $RootId -ProcessRows $ProcessRows)
  $samplerIds = @(
    Get-DescendantIds -RootId $SamplerId -ProcessRows $ProcessRows
  )
  $targetLookup = [System.Collections.Generic.HashSet[int]]::new()
  $samplerLookup = [System.Collections.Generic.HashSet[int]]::new()
  foreach ($id in $targetIds) {
    [void]$targetLookup.Add([int]$id)
  }
  foreach ($id in $samplerIds) {
    [void]$samplerLookup.Add([int]$id)
  }

  $ids = [System.Collections.Generic.List[int]]::new()
  $threadCountsByProcess = @{}
  foreach ($row in $ProcessRows) {
    $id = [int]$row.ProcessId
    if ($targetLookup.Contains($id) -and -not $samplerLookup.Contains($id)) {
      $ids.Add($id)
      $threadCountsByProcess[$id] = [int]$row.ThreadCount
    }
  }

  if ($ids.Count -eq 0) {
    return [pscustomobject]@{
      ProcessIds = @()
      ThreadCountsByProcess = $threadCountsByProcess
    }
  }

  return [pscustomobject]@{
    ProcessIds = @($ids)
    ThreadCountsByProcess = $threadCountsByProcess
  }
}

function Get-Distribution {
  param(
    [Parameter(Mandatory = $true)]
    [double[]]$Values,

    [int]$Decimals = 2
  )

  if ($Values.Count -eq 0) {
    return $null
  }

  $sorted = @($Values | Sort-Object)
  $p95Index = [Math]::Max(0, [Math]::Ceiling($sorted.Count * 0.95) - 1)
  $average = ($Values | Measure-Object -Average).Average

  return [ordered]@{
    initial = [Math]::Round($Values[0], $Decimals)
    average = [Math]::Round($average, $Decimals)
    p95 = [Math]::Round($sorted[$p95Index], $Decimals)
    peak = [Math]::Round($sorted[-1], $Decimals)
    final = [Math]::Round($Values[-1], $Decimals)
  }
}

$root = Resolve-RootProcess
$rootId = [int]$root.Id
$rootStartedAt = $root.StartTime.ToUniversalTime()
$samplerId = [int]$PID
if ($rootId -eq $samplerId) {
  throw "Le processus mesure ne peut pas etre le sampler lui-meme."
}

$startedAt = [DateTime]::UtcNow
$clock = [System.Diagnostics.Stopwatch]::StartNew()
$samples = [System.Collections.Generic.List[object]]::new()
$lastCpuByProcess = @{}
$cpuSecondsByName = @{}
$observedNames = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$cpuSeconds = 0.0
$endedEarly = $false
$endReason = "duration-complete"
$nextSampleAtMilliseconds = 0.0
$nextTreeRefreshAtMilliseconds = 0.0
$treeInventory = $null
$treeRefreshCount = 0

while ($true) {
  $sampleClock = [System.Diagnostics.Stopwatch]::StartNew()
  $liveRoot = Get-Process -Id $rootId -ErrorAction SilentlyContinue
  if (-not $liveRoot -or $liveRoot.StartTime.ToUniversalTime() -ne $rootStartedAt) {
    $endedEarly = $true
    $endReason = "root-process-exited"
    break
  }

  $treeRefreshed = $false
  if (
    $null -eq $treeInventory -or
    $clock.Elapsed.TotalMilliseconds -ge $nextTreeRefreshAtMilliseconds
  ) {
    $processRows = @([CstPerformance.ProcessSnapshot]::Capture())
    $treeInventory = Get-TreeInventory `
      -RootId $rootId `
      -SamplerId $samplerId `
      -ProcessRows $processRows
    $treeRefreshCount += 1
    $treeRefreshed = $true
    $nextTreeRefreshAtMilliseconds = `
      $clock.Elapsed.TotalMilliseconds + $ProcessTreeRefreshMilliseconds
  }

  # Une expression `if` deroule le tableau renvoye par sa branche. Sans
  # l'enveloppe exterieure, un arbre reduit a son seul processus racine devient
  # un scalaire et `$tree.Count` echoue sous StrictMode.
  $tree = @(
    if ($treeInventory.ProcessIds.Count -gt 0) {
      Get-Process -Id $treeInventory.ProcessIds -ErrorAction SilentlyContinue
    }
  )
  $threadCountsByProcess = $treeInventory.ThreadCountsByProcess
  $workingSetBytes = [long]0
  $privateMemoryBytes = [long]0
  $threadCount = 0
  $handleCount = 0
  $sampleByProcessName = @{}

  foreach ($process in $tree) {
    try {
      $processName = [string]$process.ProcessName
      if ([string]::IsNullOrWhiteSpace($processName)) {
        continue
      }

      $processStartedAt = $process.StartTime.ToUniversalTime()
      $key = "{0}:{1}" -f $process.Id, $processStartedAt.Ticks
      $currentCpu = [double]$process.CPU
      $cpuDelta = 0.0

      if ($lastCpuByProcess.ContainsKey($key)) {
        $cpuDelta = $currentCpu - [double]$lastCpuByProcess[$key]
        if ($cpuDelta -gt 0) {
          $cpuSeconds += $cpuDelta
        }
      }
      elseif ($processStartedAt -ge $startedAt) {
        # Pour un descendant cree pendant la fenetre, toute sa CPU appartient
        # a cette mesure. Les processus preexistants partent, eux, de zero.
        $cpuDelta = [Math]::Max(0.0, $currentCpu)
        $cpuSeconds += $cpuDelta
      }

      $lastCpuByProcess[$key] = $currentCpu
      if ($cpuDelta -gt 0) {
        if (-not $cpuSecondsByName.ContainsKey($processName)) {
          $cpuSecondsByName[$processName] = 0.0
        }
        $cpuSecondsByName[$processName] = [double]$cpuSecondsByName[$processName] + $cpuDelta
      }

      $processWorkingSetBytes = [long]$process.WorkingSet64
      $processPrivateMemoryBytes = [long]$process.PrivateMemorySize64
      $processThreadCount = if ($threadCountsByProcess.ContainsKey([int]$process.Id)) {
        [int]$threadCountsByProcess[[int]$process.Id]
      }
      else {
        0
      }
      $processHandleCount = [int]$process.HandleCount

      [void]$observedNames.Add($processName)
      $workingSetBytes += $processWorkingSetBytes
      $privateMemoryBytes += $processPrivateMemoryBytes
      $threadCount += $processThreadCount
      $handleCount += $processHandleCount

      if (-not $sampleByProcessName.ContainsKey($processName)) {
        $sampleByProcessName[$processName] = @{
          processCount = 0
          workingSetMiB = 0.0
          privateMemoryMiB = 0.0
          threadCount = 0
          handleCount = 0
        }
      }
      $nameSample = $sampleByProcessName[$processName]
      $nameSample.processCount += 1
      $nameSample.workingSetMiB += [double]($processWorkingSetBytes / 1MB)
      $nameSample.privateMemoryMiB += [double]($processPrivateMemoryBytes / 1MB)
      $nameSample.threadCount += $processThreadCount
      $nameSample.handleCount += $processHandleCount
    }
    catch {
      # Un descendant court peut disparaitre entre l'inventaire CIM et la
      # lecture des compteurs. Le prochain echantillon reste exploitable.
    }
  }

  $sampleClock.Stop()
  $samples.Add([pscustomobject]@{
    elapsedSeconds = [Math]::Round($clock.Elapsed.TotalSeconds, 3)
    collectionMilliseconds = $sampleClock.Elapsed.TotalMilliseconds
    treeRefreshed = $treeRefreshed
    processCount = $tree.Count
    workingSetMiB = [double]($workingSetBytes / 1MB)
    privateMemoryMiB = [double]($privateMemoryBytes / 1MB)
    threadCount = $threadCount
    handleCount = $handleCount
    byProcessName = $sampleByProcessName
  })

  if (
    $clock.Elapsed.TotalSeconds -ge $DurationSeconds -and
    $samples.Count -ge 2
  ) {
    break
  }

  # L'intervalle represente une cadence, pas une pause ajoutee au cout de
  # collecte. Les ticks manques sont sautes afin que le sampler ne tente pas
  # de rattraper son retard par une rafale de mesures.
  do {
    $nextSampleAtMilliseconds += $SampleIntervalMilliseconds
  }
  while ($nextSampleAtMilliseconds -le $clock.Elapsed.TotalMilliseconds)
  $wakeAtMilliseconds = [Math]::Min(
    $DurationSeconds * 1000,
    $nextSampleAtMilliseconds
  )
  $sleepMilliseconds = [int][Math]::Max(
    0,
    $wakeAtMilliseconds - $clock.Elapsed.TotalMilliseconds
  )
  if ($sleepMilliseconds -gt 0) {
    Start-Sleep -Milliseconds $sleepMilliseconds
  }
}

$clock.Stop()
$endedAt = [DateTime]::UtcNow
$observedDuration = [Math]::Max(0.001, $clock.Elapsed.TotalSeconds)
$logicalProcessors = [Environment]::ProcessorCount
$cpuCorePercent = ($cpuSeconds / $observedDuration) * 100
$cpuMachinePercent = $cpuCorePercent / [Math]::Max(1, $logicalProcessors)
$byProcessName = @(
  foreach ($name in @($observedNames | Sort-Object)) {
    $nameCpuSeconds = if ($cpuSecondsByName.ContainsKey($name)) {
      [double]$cpuSecondsByName[$name]
    }
    else {
      0.0
    }
    [ordered]@{
      processName = $name
      cpuSeconds = [Math]::Round($nameCpuSeconds, 3)
      cpuCorePercent = [Math]::Round(($nameCpuSeconds / $observedDuration) * 100, 2)
      cpuMachinePercent = [Math]::Round(
        (($nameCpuSeconds / $observedDuration) * 100) / [Math]::Max(1, $logicalProcessors),
        2
      )
      processCount = Get-Distribution -Values @($samples | ForEach-Object {
        if ($_.byProcessName.ContainsKey($name)) { [double]$_.byProcessName[$name].processCount } else { 0.0 }
      }) -Decimals 2
      workingSetMiB = Get-Distribution -Values @($samples | ForEach-Object {
        if ($_.byProcessName.ContainsKey($name)) { [double]$_.byProcessName[$name].workingSetMiB } else { 0.0 }
      }) -Decimals 2
      privateMemoryMiB = Get-Distribution -Values @($samples | ForEach-Object {
        if ($_.byProcessName.ContainsKey($name)) { [double]$_.byProcessName[$name].privateMemoryMiB } else { 0.0 }
      }) -Decimals 2
      threadCount = Get-Distribution -Values @($samples | ForEach-Object {
        if ($_.byProcessName.ContainsKey($name)) { [double]$_.byProcessName[$name].threadCount } else { 0.0 }
      }) -Decimals 2
      handleCount = Get-Distribution -Values @($samples | ForEach-Object {
        if ($_.byProcessName.ContainsKey($name)) { [double]$_.byProcessName[$name].handleCount } else { 0.0 }
      }) -Decimals 2
    }
  }
)

$result = [ordered]@{
  schemaVersion = 1
  label = $Label
  root = [ordered]@{
    processName = $root.ProcessName
    processId = $rootId
    startedAtUtc = $rootStartedAt.ToString("o")
  }
  window = [ordered]@{
    startedAtUtc = $startedAt.ToString("o")
    endedAtUtc = $endedAt.ToString("o")
    requestedDurationSeconds = $DurationSeconds
    observedDurationSeconds = [Math]::Round($observedDuration, 3)
    sampleIntervalMilliseconds = $SampleIntervalMilliseconds
    processTreeRefreshMilliseconds = $ProcessTreeRefreshMilliseconds
    sampleCount = $samples.Count
    processTreeRefreshCount = $treeRefreshCount
    logicalProcessorCount = $logicalProcessors
    endedEarly = $endedEarly
    endReason = $endReason
  }
  aggregate = [ordered]@{
    cpuSeconds = [Math]::Round($cpuSeconds, 3)
    cpuCorePercent = [Math]::Round($cpuCorePercent, 2)
    cpuMachinePercent = [Math]::Round($cpuMachinePercent, 2)
    collectionMilliseconds = Get-Distribution -Values @($samples | ForEach-Object { [double]$_.collectionMilliseconds }) -Decimals 2
    processCount = Get-Distribution -Values @($samples | ForEach-Object { [double]$_.processCount }) -Decimals 2
    workingSetMiB = Get-Distribution -Values @($samples | ForEach-Object { [double]$_.workingSetMiB }) -Decimals 2
    privateMemoryMiB = Get-Distribution -Values @($samples | ForEach-Object { [double]$_.privateMemoryMiB }) -Decimals 2
    threadCount = Get-Distribution -Values @($samples | ForEach-Object { [double]$_.threadCount }) -Decimals 2
    handleCount = Get-Distribution -Values @($samples | ForEach-Object { [double]$_.handleCount }) -Decimals 2
  }
  byProcessName = $byProcessName
  observedProcessNames = @($observedNames | Sort-Object)
  methodology = @(
    "Windows parent-process tree and thread counts sampled through Toolhelp32 snapshots.",
    "The process tree is refreshed independently from metric samples to bound sampler overhead.",
    "The sampler process and its descendants are excluded from every sample.",
    "CPU is the cumulative delta for observed processes; a process shorter than one sample interval can be missed.",
    "Per-name resource distributions include zero when that process name is absent from a sample.",
    "Collection duration reports sampler cost without adding it to the measured process tree.",
    "100 cpuCorePercent means one logical processor was fully used; cpuMachinePercent is normalized by logical processor count."
  )
}

$result | ConvertTo-Json -Depth 8
