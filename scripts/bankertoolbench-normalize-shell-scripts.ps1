param(
  [string]$BtbRepoRoot = $env:BTB_REPO_ROOT
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($BtbRepoRoot)) {
  $BtbRepoRoot = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")) ".tmp\official-benchmarks\bankertoolbench-repo"
}

$resolvedRoot = (Resolve-Path $BtbRepoRoot).ProviderPath
$repoDrive = ([System.IO.Path]::GetPathRoot($resolvedRoot)).TrimEnd("\")

if ($repoDrive.ToUpperInvariant() -ne "D:") {
  throw "BTB shell normalization must stay on D:. Current BTB root is $resolvedRoot."
}

$changed = New-Object System.Collections.Generic.List[string]

Get-ChildItem -Path $resolvedRoot -Recurse -File -Filter "*.sh" |
  Where-Object { $_.FullName -notmatch "\\.venv\\" } |
  ForEach-Object {
    $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
    $text = [System.Text.Encoding]::UTF8.GetString($bytes)
    if ($text.Contains("`r`n")) {
      $normalized = $text.Replace("`r`n", "`n")
      [System.IO.File]::WriteAllText($_.FullName, $normalized, [System.Text.UTF8Encoding]::new($false))
      $changed.Add($_.FullName) | Out-Null
    }
  }

[PSCustomObject]@{
  BtbRepoRoot = $resolvedRoot
  NormalizedCount = $changed.Count
  NormalizedFiles = ($changed.ToArray() -join ";")
}
