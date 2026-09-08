<#
  runDpiSplit.ps1 — drives diagDpiSplit.jsx: the same page aligned at its own
  resolution and again at another one, with the pixels untouched.

  Usage:
    powershell -NoProfile -File scripts/lab/runDpiSplit.ps1 -Root "<repo>" -Page "13.psd" [-Dpi 300] [-Label at300]
#>
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [Parameter(Mandatory = $true)][string]$Page,
  [int]$Dpi = 300,
  [string]$Label = "dpi",
  [string]$HostJsx = ""
)
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path -LiteralPath $Root).Path
function To-JsxPath([string]$p) { return ($p -replace '\\', '/') }

$source = Join-Path $Root ("psd\" + $Page)
if (-not (Test-Path -LiteralPath $source)) { throw "missing: $source" }
$workDir = Join-Path $Root ".centering-lab\dpi"
New-Item -ItemType Directory -Force -Path $workDir | Out-Null
$copy = Join-Path $workDir $Page
Copy-Item -LiteralPath $source -Destination $copy -Force

$hostJsx = if ($HostJsx) { $HostJsx } else { Join-Path $Root "app\host.jsx" }
$harness = Join-Path $Root "scripts\lab\diagDpiSplit.jsx"
$outFile = Join-Path $Root (".centering-lab\diag-dpi-" + $Label + ".json")

$before = (Get-FileHash -Algorithm SHA1 -LiteralPath $source).Hash
$js = @"
var LAB = {
  inFile: "$(To-JsxPath $copy)",
  outFile: "$(To-JsxPath $outFile)",
  dpi: $Dpi,
  wandTolerance: 20
};
`$.evalFile(new File("$(To-JsxPath $hostJsx)"));
`$.evalFile(new File("$(To-JsxPath $harness)"));
LAB_RESULT;
"@
$ps = New-Object -ComObject Photoshop.Application
Write-Output ("photoshop=" + $ps.Version + " host=" + (Get-FileHash -Algorithm SHA1 -LiteralPath $hostJsx).Hash)
Write-Output ($ps.DoJavaScript($js))
if ((Get-FileHash -Algorithm SHA1 -LiteralPath $source).Hash -ne $before) { throw "ground truth changed" }
Remove-Item -LiteralPath $copy -Force
Write-Output ("wrote " + $outFile)
