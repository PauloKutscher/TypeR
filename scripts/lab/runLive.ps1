<#
  runLive.ps1 — runs scripts/lab/diagLiveCost.jsx against the document and the
  selection that are open in Photoshop right now. Nothing is opened or closed.

  Open the page, enter the smart object, make the selection, then:
    powershell -NoProfile -File scripts/lab/runLive.ps1 -Root "<repo>" -Label crash-pants
#>
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [string]$Label = "current",
  [string]$HostJsx = "",
  [int]$AnchorCap = 200000,
  [int]$DomProbeAnchors = 200
)

$ErrorActionPreference = "Stop"
function To-JsxPath([string]$p) { return ($p -replace '\\', '/') }

$outFile = Join-Path $Root ".centering-lab\diag-live-$Label.json"
$hostJsx = if ($HostJsx) { $HostJsx } else { Join-Path $Root "app\host.jsx" }
$diag = Join-Path $Root "scripts\lab\diagLiveCost.jsx"

foreach ($required in @($hostJsx, $diag)) {
  if (-not (Test-Path $required)) { throw "missing: $required" }
}
$outDir = Split-Path $outFile -Parent
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

$ps = New-Object -ComObject Photoshop.Application
$js = @"
var LAB = {
  outFile: "$(To-JsxPath $outFile)",
  anchorCap: $AnchorCap,
  domProbeAnchors: $DomProbeAnchors
};
`$.evalFile(new File("$(To-JsxPath $hostJsx)"));
`$.evalFile(new File("$(To-JsxPath $diag)"));
LAB_RESULT;
"@
Write-Output ("photoshop=" + $ps.Version)
Write-Output ($ps.DoJavaScript($js))
Write-Output ("out=" + $outFile)
