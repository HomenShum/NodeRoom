param(
  [Parameter(Mandatory = $true)][string]$WorkbookPath,
  [Parameter(Mandatory = $true)][string]$PlanPath
)

$ErrorActionPreference = 'Stop'
$plan = Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
if ($plan.schema -ne 1 -or @($plan.repairs).Count -lt 1) {
  throw 'Structural repair plan must contain at least one schema-1 repair.'
}

$excel = $null
$workbook = $null
$insertedRows = 0
$formulaReplacements = 0
$explicitFormulaRepairs = 0
$repairIds = @()
$calculationPasses = 6

try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AskToUpdateLinks = $false
  $excel.EnableEvents = $false
  $excel.AutomationSecurity = 3
  $workbook = $excel.Workbooks.Open((Resolve-Path -LiteralPath $WorkbookPath).Path, 0, $false)

  foreach ($repair in @($plan.repairs)) {
    if ($repair.status -ne 'complete' -or $repair.basis -ne 'visible_workbook_invariants') {
      throw "Repair $($repair.repairId) is not a complete visible-invariant contract."
    }
    if ($repair.kind -ne 'insert_missing_selector_row') {
      throw "Unsupported structural repair kind $($repair.kind)."
    }
    $sheet = $workbook.Worksheets.Item([string]$repair.sheet)
    try {
      $row = $sheet.Rows.Item([int]$repair.insertRow)
      try { [void]$row.Insert(-4121) } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($row) }
      $insertedRows += 1
      $sheet.Range([string]$repair.labelCell).Value2 = [string]$repair.label
      $sheet.Range([string]$repair.selectorCell).Value2 = [double]$repair.selectorValue

      $replaced = 0
      $used = $sheet.UsedRange
      try {
        foreach ($cell in $used.Cells) {
          try {
            if ($cell.HasFormula -and ([string]$cell.Formula).Contains([string]$repair.formulaSearch)) {
              $cell.Formula = ([string]$cell.Formula).Replace(
                [string]$repair.formulaSearch,
                [string]$repair.formulaReplace
              )
              $replaced += 1
            }
          } finally {
            [void][Runtime.InteropServices.Marshal]::ReleaseComObject($cell)
          }
        }
      } finally {
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($used)
      }
      if ($replaced -ne [int]$repair.expectedFormulaReplacementCount) {
        throw "Repair $($repair.repairId) expected $($repair.expectedFormulaReplacementCount) formula replacements but applied $replaced."
      }
      $formulaReplacements += $replaced

      foreach ($formulaRepair in @($repair.formulaRepairs)) {
        $formulaSheet = $workbook.Worksheets.Item([string]$formulaRepair.sheet)
        try {
          $formulaSheet.Range([string]$formulaRepair.cell).Formula = [string]$formulaRepair.formula
          $explicitFormulaRepairs += 1
        } finally {
          [void][Runtime.InteropServices.Marshal]::ReleaseComObject($formulaSheet)
        }
      }
      $repairIds += [string]$repair.repairId
    } finally {
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($sheet)
    }
  }

  $excel.Calculation = -4105
  $excel.Iteration = $true
  $excel.MaxIterations = 1000
  $excel.MaxChange = 0.000001
  $workbook.ForceFullCalculation = $true
  foreach ($sheet in $workbook.Worksheets) {
    try {
      $sheet.EnableCalculation = $false
      $sheet.EnableCalculation = $true
      try { $sheet.UsedRange.Dirty() } catch {}
    } finally {
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($sheet)
    }
  }
  for ($pass = 0; $pass -lt $calculationPasses; $pass += 1) {
    $excel.CalculateFullRebuild()
  }
  [void]$workbook.Save()
  [void]$workbook.Close($true)
  $workbook = $null
} finally {
  if ($workbook -ne $null) {
    try { [void]$workbook.Close($false) } catch {}
  }
  if ($excel -ne $null) {
    try { [void]$excel.Quit() } catch {}
  }
  if ($workbook -ne $null) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) }
  if ($excel -ne $null) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}

[pscustomobject]@{
  schema = 1
  backend = 'excel_com'
  status = 'completed'
  workbookPath = (Resolve-Path -LiteralPath $WorkbookPath).Path
  repairIds = @($repairIds)
  insertedRowCount = $insertedRows
  formulaReplacementCount = $formulaReplacements
  explicitFormulaRepairCount = $explicitFormulaRepairs
  calculationPasses = $calculationPasses
} | ConvertTo-Json -Compress
