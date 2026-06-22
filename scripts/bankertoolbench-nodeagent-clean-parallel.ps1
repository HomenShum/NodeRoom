param(
  [string]$ConvexRepo = "D:\VSCode Projects\cafecorner_nodebench\nodebench_ai4\nodebench-ai",
  [string[]]$TaskIds = @(),
  [int]$Offset = 0,
  [int]$Limit = 0,
  [string]$JobNamePrefix = "btb-clean-capability-full100-parallel-v3-gpt41mini",
  [string]$ModelId = "gpt-4.1-mini",
  [string]$CandidateModel = "noderoom/nodeagent-general",
  [int]$MaxSteps = 6,
  [int]$PlannerDeadlineMs = 180000,
  [int]$RunnerTimeoutSec = 600,
  [int]$Throttle = 2,
  [string]$SummaryOut = "docs/eval/btb-clean-capability-full100-parallel-v3-gpt41mini.json",
  [switch]$DryRun,
  [switch]$NoSecrets
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).ProviderPath
. (Join-Path $PSScriptRoot "bankertoolbench-d-disk-env.ps1") | Out-Null

$taskRoot = Join-Path $env:BTB_REPO_ROOT "datasets\btb"
if (-not (Test-Path $taskRoot)) {
  throw "BankerToolBench task root not found: $taskRoot"
}

$allTaskIds = Get-ChildItem -Directory $taskRoot |
  Where-Object { $_.Name -like "btb-*" } |
  Sort-Object Name |
  ForEach-Object { $_.Name }

if ($TaskIds.Count -gt 0) {
  $selectedTaskIds = @($TaskIds | ForEach-Object { $_.Trim() } | Where-Object { $_ })
} else {
  $selectedTaskIds = @($allTaskIds | Select-Object -Skip $Offset)
  if ($Limit -gt 0) {
    $selectedTaskIds = @($selectedTaskIds | Select-Object -First $Limit)
  }
}

foreach ($taskId in $selectedTaskIds) {
  if (-not ($allTaskIds -contains $taskId)) {
    throw "Task id is not present under ${taskRoot}: $taskId"
  }
}

$Throttle = [Math]::Max(1, $Throttle)
$taskLogDir = Join-Path $env:BTB_RUN_ROOT "parallel-logs\$JobNamePrefix"
$taskSummaryDir = Join-Path $env:BTB_RUN_ROOT "parallel-summaries\$JobNamePrefix"
New-Item -ItemType Directory -Force -Path $taskLogDir, $taskSummaryDir | Out-Null

function Receive-FinishedJobs {
  param([System.Collections.ArrayList]$Jobs)
  $finished = @($Jobs | Where-Object { $_.State -in @("Completed", "Failed", "Stopped") })
  foreach ($job in $finished) {
    $result = Receive-Job $job -Keep
    if ($result) {
      foreach ($line in @($result)) {
        if ($line.TaskId) {
          Write-Host ("PARALLEL_TASK_DONE task={0} exit={1} log={2}" -f $line.TaskId, $line.ExitCode, $line.LogPath)
        }
      }
    }
    if ($job.State -eq "Failed") {
      Write-Host ("PARALLEL_TASK_FAILED name={0}" -f $job.Name)
    }
    Remove-Job $job -Force
    [void]$Jobs.Remove($job)
  }
}

function Start-BtbTaskJob {
  param([string]$TaskId)

  $safeTask = $TaskId -replace '[^A-Za-z0-9_-]', '-'
  $logPath = Join-Path $taskLogDir "$safeTask.log"
  $summaryOutForTask = Join-Path $taskSummaryDir "$safeTask.json"
  $summaryOutRelative = $summaryOutForTask
  if ($summaryOutForTask.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    $summaryOutRelative = $summaryOutForTask.Substring($repoRoot.Length).TrimStart("\", "/")
  }
  return Start-Job -Name $TaskId -ScriptBlock {
    param(
      [string]$RepoRoot,
      [string]$TaskId,
      [string]$ConvexRepo,
      [string]$JobNamePrefix,
      [string]$ModelId,
      [string]$CandidateModel,
      [int]$MaxSteps,
      [int]$PlannerDeadlineMs,
      [int]$RunnerTimeoutSec,
      [string]$SummaryOutRelative,
      [string]$LogPath,
      [string]$DryRunFlag,
      [string]$NoSecretsFlag
    )

    Set-Location $RepoRoot
    $childArgs = @(
      "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", "scripts\bankertoolbench-nodeagent-full-sweep.ps1",
      "-ConvexRepo", $ConvexRepo,
      "-TaskIds", $TaskId,
      "-JobNamePrefix", $JobNamePrefix,
      "-ModelId", $ModelId,
      "-CandidateModel", $CandidateModel,
      "-MaterializerMode", "generic-only",
      "-NoFallbackPlan",
      "-ForceModelPlanner",
      "-Resume",
      "-SummaryOut", $SummaryOutRelative,
      "-RunnerTimeoutSec", [string]$RunnerTimeoutSec,
      "-PlannerDeadlineMs", [string]$PlannerDeadlineMs,
      "-MaxSteps", [string]$MaxSteps
    )
    if ($DryRunFlag -eq "true") {
      $childArgs += "-DryRun"
    }
    if ($NoSecretsFlag -eq "true") {
      $childArgs += "-NoSecrets"
    }

    $exitCode = 0
    try {
      & powershell.exe @childArgs *> $LogPath
      $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
    } catch {
      $_ | Out-String | Add-Content -Path $LogPath
      $exitCode = 1
    }

    [PSCustomObject]@{
      TaskId = $TaskId
      ExitCode = $exitCode
      LogPath = $LogPath
      SummaryOut = $SummaryOutRelative
    }
  } -ArgumentList $repoRoot, $TaskId, $ConvexRepo, $JobNamePrefix, $ModelId, $CandidateModel, $MaxSteps, $PlannerDeadlineMs, $RunnerTimeoutSec, $summaryOutRelative, $logPath, ([bool]$DryRun).ToString().ToLowerInvariant(), ([bool]$NoSecrets).ToString().ToLowerInvariant()
}

$started = Get-Date
$jobs = New-Object System.Collections.ArrayList
$launched = 0

Write-Host ("PARALLEL_START tasks={0} throttle={1} prefix={2}" -f $selectedTaskIds.Count, $Throttle, $JobNamePrefix)

foreach ($taskId in $selectedTaskIds) {
  while ($jobs.Count -ge $Throttle) {
    Receive-FinishedJobs -Jobs $jobs
    Write-Host ("PARALLEL_PROGRESS launched={0}/{1} active={2}" -f $launched, $selectedTaskIds.Count, $jobs.Count)
    Start-Sleep -Seconds 15
  }
  $job = Start-BtbTaskJob -TaskId $taskId
  [void]$jobs.Add($job)
  $launched += 1
  Write-Host ("PARALLEL_TASK_START task={0} launched={1}/{2}" -f $taskId, $launched, $selectedTaskIds.Count)
}

while ($jobs.Count -gt 0) {
  Receive-FinishedJobs -Jobs $jobs
  if ($jobs.Count -gt 0) {
    Write-Host ("PARALLEL_PROGRESS launched={0}/{1} active={2}" -f $launched, $selectedTaskIds.Count, $jobs.Count)
    Start-Sleep -Seconds 30
  }
}

Write-Host "PARALLEL_CONSOLIDATE starting summary-only pass"
$consolidateArgs = @(
  "-NoProfile", "-ExecutionPolicy", "Bypass",
  "-File", "scripts\bankertoolbench-nodeagent-full-sweep.ps1",
  "-ConvexRepo", $ConvexRepo,
  "-JobNamePrefix", $JobNamePrefix,
  "-ModelId", $ModelId,
  "-CandidateModel", $CandidateModel,
  "-MaterializerMode", "generic-only",
  "-NoFallbackPlan",
  "-ForceModelPlanner",
  "-SummaryOnly",
  "-NoSecrets",
  "-SummaryOut", $SummaryOut
)
if ($TaskIds.Count -gt 0) {
  $consolidateArgs += "-TaskIds"
  $consolidateArgs += $selectedTaskIds
} else {
  $consolidateArgs += "-Offset"
  $consolidateArgs += [string]$Offset
  if ($Limit -gt 0) {
    $consolidateArgs += "-Limit"
    $consolidateArgs += [string]$Limit
  }
}

& powershell.exe @consolidateArgs
if ($LASTEXITCODE -ne 0) {
  throw "summary-only consolidation failed with exit code $LASTEXITCODE"
}

Write-Host ("PARALLEL_DONE elapsed={0:n1}min summary={1}" -f ((Get-Date) - $started).TotalMinutes, $SummaryOut)
