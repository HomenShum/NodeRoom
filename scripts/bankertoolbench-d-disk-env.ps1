$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).ProviderPath
$repoDrive = ([System.IO.Path]::GetPathRoot($repoRoot)).TrimEnd("\")

if ($repoDrive.ToUpperInvariant() -ne "D:") {
  throw "BankerToolBench runs must stay on D:. Current repo root is $repoRoot."
}

$btbRoot = Join-Path $repoRoot ".tmp\official-benchmarks\bankertoolbench-repo"
$cacheRoot = Join-Path $repoRoot ".tmp\btb-cache"
$hfHome = Join-Path $cacheRoot "hf"
$hfHubCache = Join-Path $hfHome "hub"
$uvCache = Join-Path $cacheRoot "uv"
$uvToolDir = Join-Path $cacheRoot "uv-tools"
$uvToolBinDir = Join-Path $cacheRoot "uv-tool-bin"
$uvPythonDir = Join-Path $cacheRoot "uv-python"
$pipCache = Join-Path $cacheRoot "pip"
$xdgCache = Join-Path $cacheRoot "xdg"
$runRoot = Join-Path $repoRoot ".tmp\btb-runs"
$tempRoot = Join-Path $repoRoot ".tmp\btb-temp"

foreach ($path in @($cacheRoot, $hfHome, $hfHubCache, $uvCache, $uvToolDir, $uvToolBinDir, $uvPythonDir, $pipCache, $xdgCache, $runRoot, $tempRoot)) {
  New-Item -ItemType Directory -Force -Path $path | Out-Null
}

$env:BTB_REPO_ROOT = $btbRoot
$env:BTB_RUN_ROOT = $runRoot
$env:HF_HOME = $hfHome
$env:HF_HUB_CACHE = $hfHubCache
$env:UV_CACHE_DIR = $uvCache
$env:UV_TOOL_DIR = $uvToolDir
$env:UV_TOOL_BIN_DIR = $uvToolBinDir
$env:UV_PYTHON_INSTALL_DIR = $uvPythonDir
$env:PIP_CACHE_DIR = $pipCache
$env:XDG_CACHE_HOME = $xdgCache
$env:TEMP = $tempRoot
$env:TMP = $tempRoot
$env:TMPDIR = $tempRoot

if (($env:PATH -split [System.IO.Path]::PathSeparator) -notcontains $uvToolBinDir) {
  $env:PATH = "$uvToolBinDir$([System.IO.Path]::PathSeparator)$env:PATH"
}

[PSCustomObject]@{
  RepoRoot = $repoRoot
  BankerToolBenchRepo = $env:BTB_REPO_ROOT
  RunRoot = $env:BTB_RUN_ROOT
  HuggingFaceHome = $env:HF_HOME
  HuggingFaceHubCache = $env:HF_HUB_CACHE
  UvCache = $env:UV_CACHE_DIR
  UvToolDir = $env:UV_TOOL_DIR
  UvToolBinDir = $env:UV_TOOL_BIN_DIR
  UvPythonDir = $env:UV_PYTHON_INSTALL_DIR
  PipCache = $env:PIP_CACHE_DIR
  TempRoot = $env:TEMP
}
