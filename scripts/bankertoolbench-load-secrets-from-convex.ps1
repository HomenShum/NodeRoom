param(
  [string]$ConvexRepo = (Resolve-Path (Join-Path $PSScriptRoot "..")).ProviderPath,
  [string[]]$Names = @("OPENAI_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "HF_TOKEN"),
  [switch]$Prod,
  [string]$Deployment = "",
  [int]$RetryCount = 3,
  [int]$RetryDelayMs = 2000
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path (Join-Path $ConvexRepo "package.json"))) {
  throw "Convex repo not found or missing package.json: $ConvexRepo"
}

$loaded = New-Object System.Collections.Generic.List[string]
$missing = New-Object System.Collections.Generic.List[string]
$failed = New-Object System.Collections.Generic.List[string]

Push-Location $ConvexRepo
try {
  foreach ($name in $Names) {
    $inherited = (Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue).Value
    if (-not [string]::IsNullOrWhiteSpace($inherited)) {
      $loaded.Add($name) | Out-Null
      continue
    }

    $convexArgs = @("convex", "env", "get")
    if ($Prod) {
      $convexArgs += "--prod"
    }
    if (-not [string]::IsNullOrWhiteSpace($Deployment)) {
      $convexArgs += @("--deployment", $Deployment)
    }
    $convexArgs += $name

    $loadedThisName = $false
    $missingThisName = $false
    $attempts = [Math]::Max(1, $RetryCount)
    for ($attempt = 1; $attempt -le $attempts; $attempt++) {
      $previousErrorActionPreference = $ErrorActionPreference
      $previousNativeErrorPreference = $null
      if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -ErrorAction SilentlyContinue) {
        $previousNativeErrorPreference = $global:PSNativeCommandUseErrorActionPreference
        $global:PSNativeCommandUseErrorActionPreference = $false
      }
      $ErrorActionPreference = "Continue"
      try {
        $value = (& npx @convexArgs 2>&1)
        $exitCode = $LASTEXITCODE
      } finally {
        $ErrorActionPreference = $previousErrorActionPreference
        if ($null -ne $previousNativeErrorPreference) {
          $global:PSNativeCommandUseErrorActionPreference = $previousNativeErrorPreference
        }
      }

      $text = (($value | Out-String).Trim())
      $isMissingMessage = $text -match 'Environment variable ".+" not found'
      if ($exitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($text) -and -not $isMissingMessage) {
        Set-Item -Path "Env:$name" -Value $text
        $loaded.Add($name) | Out-Null
        $loadedThisName = $true
        break
      }
      if ($isMissingMessage) {
        $missing.Add($name) | Out-Null
        $missingThisName = $true
        break
      }
      if ($attempt -lt $attempts -and $RetryDelayMs -gt 0) {
        Start-Sleep -Milliseconds $RetryDelayMs
      }
    }

    if (-not $loadedThisName -and -not $missingThisName) {
      $failed.Add($name) | Out-Null
    }
  }
} finally {
  Pop-Location
}

[PSCustomObject]@{
  ConvexRepo = $ConvexRepo
  Source = if ($Prod) { "prod" } elseif (-not [string]::IsNullOrWhiteSpace($Deployment)) { $Deployment } else { "dev" }
  Loaded = ($loaded.ToArray() -join ",")
  Missing = ($missing.ToArray() -join ",")
  Failed = ($failed.ToArray() -join ",")
}
