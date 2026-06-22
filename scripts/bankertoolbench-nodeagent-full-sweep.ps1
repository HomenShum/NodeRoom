param(
  [string]$ConvexRepo = "D:\VSCode Projects\cafecorner_nodebench\nodebench_ai4\nodebench-ai",
  [string[]]$TaskIds = @(),
  [int]$Offset = 0,
  [int]$Limit = 0,
  [string]$JobNamePrefix = "btb-full-nodeagent",
  [string]$ModelId = "z-ai/glm-5.2",
  [string]$CandidateModel = "noderoom/nodeagent-general",
  [ValidateSet("replay", "general-only", "generic-only")]
  [string]$MaterializerMode = "replay",
  [switch]$NoFallbackPlan,
  [switch]$ForceModelPlanner,
  [int]$MaxSteps = 6,
  [int]$PlannerDeadlineMs = 420000,
  [int]$RunnerTimeoutSec = 600,
  [int]$Concurrent = 1,
  [string]$SummaryOut = "docs/eval/bankertoolbench-nodeagent-full-sweep-summary.json",
  [switch]$Resume,
  [switch]$DryRun,
  [switch]$SummaryOnly,
  [switch]$NoSecrets
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).ProviderPath
$envInfo = . (Join-Path $PSScriptRoot "bankertoolbench-d-disk-env.ps1")
$allowFallbackPlan = -not [bool]$NoFallbackPlan
$allowFallbackPlanString = if ($allowFallbackPlan) { "true" } else { "false" }
$forceModelPlannerString = if ($ForceModelPlanner) { "true" } else { "false" }

if (-not $NoSecrets -and -not $DryRun -and -not $SummaryOnly) {
  $secretInfo = . (Join-Path $PSScriptRoot "bankertoolbench-load-secrets-from-convex.ps1") -ConvexRepo $ConvexRepo
  Write-Host ("Convex env loaded names: {0}; missing names: {1}; failed names: {2}" -f $secretInfo.Loaded, $secretInfo.Missing, $secretInfo.Failed)
  $requiredSecretNames = New-Object System.Collections.Generic.List[string]
  $requiredSecretNames.Add("GEMINI_API_KEY") | Out-Null
  if ($ModelId -match '^(gpt-|o[0-9]|chatgpt-)') {
    $requiredSecretNames.Add("OPENAI_API_KEY") | Out-Null
  }
  $unavailableRequiredSecrets = @($requiredSecretNames.ToArray() | Where-Object {
    $envValue = (Get-Item -Path "Env:$_" -ErrorAction SilentlyContinue).Value
    [string]::IsNullOrWhiteSpace($envValue)
  })
  if ($unavailableRequiredSecrets.Count -gt 0) {
    throw ("Required benchmark secret(s) unavailable after Convex env load: {0}" -f ($unavailableRequiredSecrets -join ","))
  }
}

$taskRoot = Join-Path $env:BTB_REPO_ROOT "datasets\btb"
if (-not (Test-Path $taskRoot)) {
  throw "BankerToolBench task root not found: $taskRoot"
}
if (-not (Test-Path (Join-Path $env:BTB_REPO_ROOT "job.yaml"))) {
  throw "BankerToolBench job.yaml not found under $env:BTB_REPO_ROOT"
}

$allTaskIds = Get-ChildItem -Directory $taskRoot |
  Where-Object { $_.Name -like "btb-*" } |
  Sort-Object Name |
  ForEach-Object { $_.Name }

if ($TaskIds.Count -gt 0) {
  $selectedTaskIds = @($TaskIds | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
} else {
  $selectedTaskIds = @($allTaskIds | Select-Object -Skip $Offset)
  if ($Limit -gt 0) {
    $selectedTaskIds = @($selectedTaskIds | Select-Object -First $Limit)
  }
}

$jobsDir = Join-Path $env:BTB_RUN_ROOT "jobs"
New-Item -ItemType Directory -Force -Path $jobsDir | Out-Null

$summaryPath = Join-Path $repoRoot $SummaryOut
New-Item -ItemType Directory -Force -Path (Split-Path $summaryPath -Parent) | Out-Null

function Get-TaskJobName {
  param([string]$TaskId)
  return "$JobNamePrefix-$TaskId"
}

function Get-NumberOrDefault {
  param(
    [object]$Value,
    [int]$DefaultValue = 0
  )
  if ($null -eq $Value) {
    return $DefaultValue
  }
  return [int]$Value
}

function Read-VerifierInfoSummary {
  param([string]$Path)

  $helperPath = Join-Path $PSScriptRoot "bankertoolbench-read-verifier-info.mjs"
  $json = & node $helperPath $Path
  if ($LASTEXITCODE -ne 0) {
    throw "Node verifier info summary parse failed for $Path with exit code $LASTEXITCODE"
  }
  return ($json | ConvertFrom-Json)
}

function Get-ResultSummary {
  param(
    [string]$TaskId,
    [string]$JobName
  )

  $jobDir = Join-Path $jobsDir $JobName
  $resultPath = Join-Path $jobDir "result.json"
  $trialId = $null
  $reward = $null
  $mean = $null
  $nTrials = 0
  $nErrors = 0
  $rawScore = $null
  $maxScore = $null
  $unmet = $null
  $finished = $false
  $plannerTransport = $null
  $plannerStopReason = $null
  $modelCalls = $null
  $traceAllowFallbackPlan = $null
  $traceFallbackUsed = $null
  $traceForceModelPlanner = $null
  $materializerModeReceipt = $null
  $genericWriterOnly = $null
  $generalFamilyMaterializersEnabled = $null
  $replayMaterializersEnabled = $null
  $boundaryReceiptCount = $null
  $supportedBoundaryReceipts = $null

  if (Test-Path $resultPath) {
    $result = Get-Content $resultPath -Raw | ConvertFrom-Json
    $finished = $null -ne $result.finished_at
    $nTrials = Get-NumberOrDefault -Value $result.stats.n_completed_trials
    $nErrors = Get-NumberOrDefault -Value $result.stats.n_errored_trials

    $evalProp = $result.stats.evals.PSObject.Properties | Select-Object -First 1
    if ($null -ne $evalProp) {
      $evalValue = $evalProp.Value
      if ($evalValue.metrics.Count -gt 0) {
        $mean = $evalValue.metrics[0].mean
      }
      if ($null -ne $evalValue.reward_stats -and $null -ne $evalValue.reward_stats.reward) {
        $rewardProp = $evalValue.reward_stats.reward.PSObject.Properties | Select-Object -First 1
        if ($null -ne $rewardProp) {
          $reward = [double]$rewardProp.Name
          if ($rewardProp.Value.Count -gt 0) {
            $trialId = [string]$rewardProp.Value[0]
          }
        }
      }
    }

    $infoPath = Get-ChildItem -Path $jobDir -Recurse -Filter "info.json" -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -like "*\verifier\info.json" } |
      Select-Object -First 1 -ExpandProperty FullName
    if ($infoPath) {
      $info = Read-VerifierInfoSummary -Path $infoPath
      $rawScore = $info.rawScore
      $maxScore = $info.maximumScore
      $unmet = $info.unmetCriteria
      if ($null -eq $reward -and $null -ne $info.reward) {
        $reward = $info.reward
      }
    }

    $tracePath = Get-ChildItem -Path $jobDir -Recurse -Filter "nodeagent-trace.json" -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -like "*\agent\nodeagent-trace.json" } |
      Select-Object -First 1 -ExpandProperty FullName
    if ($tracePath) {
      $trace = Get-Content $tracePath -Raw | ConvertFrom-Json
      $plannerTransport = $trace.plannerTransport
      $plannerStopReason = $trace.plannerStopReason
      $traceAllowFallbackPlan = $trace.allowFallbackPlan
      $traceFallbackUsed = $trace.fallbackUsed
      $traceForceModelPlanner = $trace.forceModelPlanner
      if ($null -ne $trace.usage -and $null -ne $trace.usage.modelCalls) {
        $modelCalls = $trace.usage.modelCalls
      } elseif ($null -ne $trace.result -and $null -ne $trace.result.usage -and $null -ne $trace.result.usage.modelCalls) {
        $modelCalls = $trace.result.usage.modelCalls
      }
    }

    $materializerModePath = Get-ChildItem -Path $jobDir -Recurse -Filter "materializer_mode.json" -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -like "*\deliverables\materializer_mode.json" } |
      Select-Object -First 1 -ExpandProperty FullName
    if ($materializerModePath) {
      $materializer = Get-Content $materializerModePath -Raw | ConvertFrom-Json
      $materializerModeReceipt = if ($null -ne $materializer.mode) { $materializer.mode } else { $materializer.materializerMode }
      $genericWriterOnly = $materializer.genericWriterOnly
      $generalFamilyMaterializersEnabled = $materializer.generalFamilyMaterializersEnabled
      $replayMaterializersEnabled = $materializer.replayMaterializersEnabled
    }

    $boundaryReceiptPath = Get-ChildItem -Path $jobDir -Recurse -Filter "boundary_box_receipts.json" -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -like "*\deliverables\boundary_box_receipts.json" } |
      Select-Object -First 1 -ExpandProperty FullName
    if ($boundaryReceiptPath) {
      $boundary = Get-Content $boundaryReceiptPath -Raw | ConvertFrom-Json
      $boundaryReceiptCount = $boundary.totalCitations
      $supportedBoundaryReceipts = $boundary.supportedCitations
    }
  }

  $status = if (-not (Test-Path $resultPath)) {
    "missing"
  } elseif ($nErrors -gt 0) {
    "errored"
  } elseif ($finished) {
    "finished"
  } else {
    "running_or_partial"
  }
  $cleanCapabilityRejectionReasons = @()
  if ($status -ne "finished" -or $null -eq $reward) {
    $cleanCapabilityRejectionReasons += "not_finished_with_reward"
  }
  if ($nErrors -gt 0) {
    $cleanCapabilityRejectionReasons += "verifier_exception"
  }
  if ($null -eq $modelCalls -or [int]$modelCalls -le 0) {
    $cleanCapabilityRejectionReasons += "model_not_in_loop"
  }
  if ($traceForceModelPlanner -ne $true) {
    $cleanCapabilityRejectionReasons += "force_model_planner_not_verified"
  }
  if ($traceAllowFallbackPlan -ne $false) {
    $cleanCapabilityRejectionReasons += "fallback_plan_allowed_or_unknown"
  }
  if ($traceFallbackUsed -ne $false) {
    $cleanCapabilityRejectionReasons += "fallback_plan_used_or_unknown"
  }
  if ($materializerModeReceipt -ne "generic-only") {
    $cleanCapabilityRejectionReasons += "not_generic_only_materializer"
  }
  if ($genericWriterOnly -ne $true) {
    $cleanCapabilityRejectionReasons += "generic_writer_only_not_verified"
  }
  if ($generalFamilyMaterializersEnabled -ne $false) {
    $cleanCapabilityRejectionReasons += "family_materializer_enabled_or_unknown"
  }
  if ($replayMaterializersEnabled -ne $false) {
    $cleanCapabilityRejectionReasons += "replay_materializer_enabled_or_unknown"
  }
  if (
    $null -eq $boundaryReceiptCount -or
    $null -eq $supportedBoundaryReceipts -or
    [int]$boundaryReceiptCount -le 0 -or
    [int]$supportedBoundaryReceipts -ne [int]$boundaryReceiptCount
  ) {
    $cleanCapabilityRejectionReasons += "boundary_receipts_not_fully_supported"
  }
  $cleanCapabilityAccepted = @($cleanCapabilityRejectionReasons).Count -eq 0

  [PSCustomObject]@{
    taskId = $TaskId
    jobName = $JobName
    jobDir = $jobDir
    resultPath = if (Test-Path $resultPath) { $resultPath } else { $null }
    status = $status
    trialId = $trialId
    reward = $reward
    mean = $mean
    rawScore = $rawScore
    maximumScore = $maxScore
    unmetCriteria = $unmet
    completedTrials = $nTrials
    erroredTrials = $nErrors
    plannerTransport = $plannerTransport
    plannerStopReason = $plannerStopReason
    modelCalls = $modelCalls
    traceAllowFallbackPlan = $traceAllowFallbackPlan
    traceFallbackUsed = $traceFallbackUsed
    traceForceModelPlanner = $traceForceModelPlanner
    materializerModeReceipt = $materializerModeReceipt
    genericWriterOnly = $genericWriterOnly
    generalFamilyMaterializersEnabled = $generalFamilyMaterializersEnabled
    replayMaterializersEnabled = $replayMaterializersEnabled
    boundaryReceiptCount = $boundaryReceiptCount
    supportedBoundaryReceipts = $supportedBoundaryReceipts
    cleanCapabilityAccepted = $cleanCapabilityAccepted
    cleanCapabilityRejectionReasons = $cleanCapabilityRejectionReasons
  }
}

function Write-SweepSummary {
  param([object[]]$Rows)

  $completed = @($Rows | Where-Object { $_.status -eq "finished" -and $null -ne $_.reward })
  $errored = @($Rows | Where-Object { $_.status -eq "errored" })
  $missing = @($Rows | Where-Object { $_.status -eq "missing" })
  $meanReward = $null
  if ($completed.Count -gt 0) {
    $meanReward = ($completed | Measure-Object -Property reward -Average).Average
  }
  $cleanAccepted = @($Rows | Where-Object { $_.cleanCapabilityAccepted -eq $true -and $null -ne $_.reward })
  $cleanCapabilityMeanReward = $null
  if ($cleanAccepted.Count -gt 0) {
    $cleanCapabilityMeanReward = ($cleanAccepted | Measure-Object -Property reward -Average).Average
  }

  $summary = [PSCustomObject]@{
    schema = "noderoom-btb-nodeagent-full-sweep-summary-v1"
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    repoRoot = $repoRoot
    btbRepoRoot = $env:BTB_REPO_ROOT
    runRoot = $env:BTB_RUN_ROOT
    taskRoot = $taskRoot
    jobNamePrefix = $JobNamePrefix
    modelId = $ModelId
    candidateModel = $CandidateModel
    materializerMode = $MaterializerMode
    allowFallbackPlan = $allowFallbackPlan
    forceModelPlanner = [bool]$ForceModelPlanner
    totalAvailableTasks = @($allTaskIds).Count
    selectedTasks = @($selectedTaskIds).Count
    completedTasks = $completed.Count
    erroredTasks = $errored.Count
    missingTasks = $missing.Count
    meanReward = $meanReward
    cleanCapabilityAcceptedTasks = $cleanAccepted.Count
    cleanCapabilityMeanReward = $cleanCapabilityMeanReward
    cleanCapabilityGate = [PSCustomObject]@{
      requiresForceModelPlanner = $true
      requiresModelCallsGreaterThanZero = $true
      requiresNoFallbackPlan = $true
      requiresGenericWriterOnly = $true
      requiresNoFamilyOrReplayMaterializers = $true
      requiresFullySupportedBoundaryReceipts = $true
    }
    dryRun = [bool]$DryRun
    summaryOnly = [bool]$SummaryOnly
    tasks = $Rows
  }
  $summary | ConvertTo-Json -Depth 12 | Set-Content -Path $summaryPath -Encoding utf8
  Write-Host "Wrote sweep summary: $summaryPath"
}

$rows = New-Object System.Collections.Generic.List[object]

foreach ($taskId in $selectedTaskIds) {
  if (-not ($allTaskIds -contains $taskId)) {
    throw "Task id is not present under ${taskRoot}: $taskId"
  }
  $jobName = Get-TaskJobName -TaskId $taskId
  $existing = Get-ResultSummary -TaskId $taskId -JobName $jobName

  if ($SummaryOnly) {
    $rows.Add($existing) | Out-Null
    continue
  }

  if ($Resume -and $existing.status -eq "finished") {
    Write-Host "Skipping completed task on resume: $taskId ($jobName)"
    $rows.Add($existing) | Out-Null
    continue
  }

  $displayCommand = @(
    "harbor", "run", "-c", "job.yaml", "-p", "datasets/btb", "-i", $taskId,
    "--job-name", $jobName,
    "--jobs-dir", $jobsDir,
    "--yes",
    "--n-concurrent", $Concurrent,
    "--environment-build-timeout-multiplier", "4",
    "--agent-import-path", "btb_noderoom_agent.harbor_adapter:NodeRoomNodeAgent",
    "--agent-kwarg", "noderoom_repo=`$env:NODEROOM_REPO_ROOT",
    "--agent-kwarg", "mode=general",
    "--agent-kwarg", "model_id=$ModelId",
    "--agent-kwarg", "materializer_mode=$MaterializerMode",
    "--agent-kwarg", "allow_fallback_plan=$allowFallbackPlanString",
    "--agent-kwarg", "force_model_planner=$forceModelPlannerString",
    "--agent-kwarg", "max_steps=$MaxSteps",
    "--agent-kwarg", "planner_deadline_ms=$PlannerDeadlineMs",
    "--agent-kwarg", "runner_timeout_sec=$RunnerTimeoutSec",
    "--model", $CandidateModel,
    "--verifier-env", "LLM_API_KEY=`$env:GEMINI_API_KEY"
  )

  if ($DryRun) {
    Write-Host ("DRY RUN {0}: {1}" -f $taskId, ($displayCommand -join " "))
    $rows.Add($existing) | Out-Null
    continue
  }

  if ([string]::IsNullOrWhiteSpace($env:GEMINI_API_KEY)) {
    throw "GEMINI_API_KEY is required for the Gandalf verifier. Load it through Convex env or set it before running."
  }

  $env:PYTHONUTF8 = "1"
  $env:PYTHONIOENCODING = "utf-8"
  $env:NODEROOM_REPO_ROOT = $repoRoot
  if ($env:PYTHONPATH) {
    $env:PYTHONPATH = "$env:NODEROOM_REPO_ROOT$([System.IO.Path]::PathSeparator)$env:PYTHONPATH"
  } else {
    $env:PYTHONPATH = $env:NODEROOM_REPO_ROOT
  }

  $harborArgs = @(
    "run", "-c", "job.yaml", "-p", "datasets/btb", "-i", $taskId,
    "--job-name", $jobName,
    "--jobs-dir", $jobsDir,
    "--yes",
    "--n-concurrent", "$Concurrent",
    "--environment-build-timeout-multiplier", "4",
    "--agent-import-path", "btb_noderoom_agent.harbor_adapter:NodeRoomNodeAgent",
    "--agent-kwarg", "noderoom_repo=$env:NODEROOM_REPO_ROOT",
    "--agent-kwarg", "mode=general",
    "--agent-kwarg", "model_id=$ModelId",
    "--agent-kwarg", "materializer_mode=$MaterializerMode",
    "--agent-kwarg", "allow_fallback_plan=$allowFallbackPlanString",
    "--agent-kwarg", "force_model_planner=$forceModelPlannerString",
    "--agent-kwarg", "max_steps=$MaxSteps",
    "--agent-kwarg", "planner_deadline_ms=$PlannerDeadlineMs",
    "--agent-kwarg", "runner_timeout_sec=$RunnerTimeoutSec",
    "--model", $CandidateModel,
    "--verifier-env", "LLM_API_KEY=$env:GEMINI_API_KEY"
  )

  Write-Host "Running actual BTB task: $taskId -> $jobName"
  Push-Location $env:BTB_REPO_ROOT
  try {
    & harbor @harborArgs
    if ($LASTEXITCODE -ne 0) {
      throw "harbor run failed for $taskId with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }

  $rows.Add((Get-ResultSummary -TaskId $taskId -JobName $jobName)) | Out-Null
  Write-SweepSummary -Rows $rows.ToArray()
}

if ($rows.Count -eq 0) {
  foreach ($taskId in $selectedTaskIds) {
    $rows.Add((Get-ResultSummary -TaskId $taskId -JobName (Get-TaskJobName -TaskId $taskId))) | Out-Null
  }
}

Write-SweepSummary -Rows $rows.ToArray()

$finished = @($rows | Where-Object { $_.status -eq "finished" }).Count
$errored = @($rows | Where-Object { $_.status -eq "errored" }).Count
$missing = @($rows | Where-Object { $_.status -eq "missing" }).Count
Write-Host ("BTB NodeAgent sweep status: selected={0} finished={1} errored={2} missing={3}" -f $rows.Count, $finished, $errored, $missing)
