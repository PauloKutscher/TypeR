<#
  runDiag.ps1 — runs scripts/lab/diagProbeText.jsx on one page of a run.

  Usage:
    powershell -NoProfile -File scripts/lab/runDiag.ps1 -Root "<repo>" `
      -Run "000-baseline" -Page "<psd base name>" -Index 1
#>
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [string]$Run = "000-baseline",
  [Parameter(Mandatory = $true)][string]$Page,
  [int]$Index = 0,
  [int]$WandTolerance = 20
)

$ErrorActionPreference = "Stop"
function To-JsxPath([string]$p) { return ($p -replace '\\', '/') }

# A finished run no longer keeps its copies, so fall back to the ground truth.
# Opening it is safe: every diagnostic closes with DONOTSAVECHANGES.
$inFile = Join-Path $Root ".centering-lab\runs\$Run\in\$Page.psd"
if (-not (Test-Path $inFile)) { $inFile = Join-Path $Root "psd\$Page.psd" }
$outFile = Join-Path $Root ".centering-lab\probe-$Page.json"
$hostJsx = Join-Path $Root "app\host.jsx"
$diag = Join-Path $Root "scripts\lab\diagProbeText.jsx"

foreach ($required in @($inFile, $hostJsx, $diag)) {
  if (-not (Test-Path $required)) { throw "missing: $required" }
}

$ps = New-Object -ComObject Photoshop.Application
$js = @"
var LAB = {
  inFile: "$(To-JsxPath $inFile)",
  outFile: "$(To-JsxPath $outFile)",
  index: $Index,
  wandTolerance: $WandTolerance
};
`$.evalFile(new File("$(To-JsxPath $hostJsx)"));
`$.evalFile(new File("$(To-JsxPath $diag)"));
LAB_RESULT;
"@
Write-Output ("photoshop=" + $ps.Version)
Write-Output ($ps.DoJavaScript($js))
Write-Output ("out=" + $outFile)
