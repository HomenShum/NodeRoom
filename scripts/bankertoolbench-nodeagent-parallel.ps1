<#
Parallel BTB sweep launcher — runs (model x task) pairs concurrently with a throttle.

The base wrapper (bankertoolbench-nodeagent-full-sweep.ps1) loops tasks sequentially
(one harbor job per task). This launcher fans those out across background jobs so wall-clock
is ~ ceil(pairs / Throttle) * per-task instead of sum-of-all.

Each pair runs as its own harbor job (unique JobNamePrefix+TaskId -> unique container + job dir),
so there are no collisions. Throttle bounds concurrent Docker containers + API rate-limit pressure.

Usage:
  pwsh scripts/bankertoolbench-nodeagent-parallel.ps1 `
    -TaskIds btb-129ab204,btb-1306dbd8,btb-17d8c86f `
    -ModelIds z-ai/glm-5.2,deepseek/deepseek-v4-pro `
    -Throttle 3 -JobNamePrefix btb-par
#>
param(
  [Parameter(Mandatory = $true)][string[]]$TaskIds,
  [string[]]$ModelIds = @("z-ai/glm-5.2", "deepseek/deepseek-v4-pro"),
  [int]$Throttle = 3,
  [string]$JobNamePrefix = "btb-par"
)

$repo = (Get-Location).Path
$pairs = foreach ($m in $ModelIds) { foreach ($t in $TaskIds) { [pscustomobject]@{ Model = $m; Task = $t } } }
Write-Host "Launching $($pairs.Count) runs ($($ModelIds.Count) models x $($TaskIds.Count) tasks), throttle=$Throttle"
$started = Get-Date

foreach ($p in $pairs) {
  while (@(Get-Job -State Running).Count -ge $Throttle) { Start-Sleep -Seconds 5 }
  $null = Start-Job -Name "$($p.Model)|$($p.Task)" -ScriptBlock {
    param($repo, $task, $model, $prefix)
    Set-Location $repo
    . ".\scripts\bankertoolbench-d-disk-env.ps1" | Out-Null
    $slug = ($model -replace '[^A-Za-z0-9]', '-')
    & ".\scripts\bankertoolbench-nodeagent-full-sweep.ps1" `
      -TaskIds $task -ModelId $model `
      -JobNamePrefix "$prefix-$slug" `
      -SummaryOut "docs/eval/$prefix-$slug-$task.json"
  } -ArgumentList $repo, $p.Task, $p.Model, $JobNamePrefix
  Write-Host "  queued: $($p.Model) / $($p.Task)"
}

Write-Host "All $($pairs.Count) jobs launched; waiting for completion..."
Get-Job | Wait-Job | Out-Null
foreach ($j in (Get-Job | Sort-Object Name)) {
  Write-Host "=== $($j.Name)  [$($j.State)] ==="
  Receive-Job $j 2>&1 | Select-String -Pattern "Reward|Mean|Exceptions|status:|error" | Select-Object -Last 6 | ForEach-Object { Write-Host "   $_" }
}
Get-Job | Remove-Job -Force
Write-Host ("PARALLEL_DONE elapsed={0:n1} min" -f ((Get-Date) - $started).TotalMinutes)
