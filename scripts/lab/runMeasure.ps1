<#
  runMeasure.ps1 — drives Photoshop through COM to measure how the real TypeR
  centering moves text inside balloons.

  The PSDs under psd/ and true/ are ground truth and are never touched: this
  script only ever opens the copies under .centering-lab/runs/<run>/in.

  Usage:
    powershell -NoProfile -File scripts/lab/runMeasure.ps1 `
       -Root "C:\path\to\repo" -Run "000-baseline" [-Only "name.psd"] `
       [-Resize] [-Padding 0] [-WandTolerance 20]
#>
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [string]$Run = "000-baseline",
  [string]$Only = "",
  [switch]$Resize,
  [int]$Padding = 0,
  [int]$WandTolerance = 20,
  [switch]$DumpRaw,
  [switch]$LiveSelection,
  [double]$PhantomRatio = 0
)

$ErrorActionPreference = "Stop"

function To-JsxPath([string]$p) { return ($p -replace '\\', '/') }

$inDir = Join-Path $Root ".centering-lab\runs\$Run\in"
$outDir = Join-Path $Root ".centering-lab\runs\$Run\out"
$hostJsx = Join-Path $Root "app\host.jsx"
$harness = Join-Path $Root "scripts\lab\measureCentering.jsx"

foreach ($required in @($inDir, $hostJsx, $harness)) {
  if (-not (Test-Path $required)) { throw "missing: $required" }
}
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$files = Get-ChildItem $inDir -Filter *.psd | Sort-Object Name
if ($Only -ne "") { $files = $files | Where-Object { $_.Name -eq $Only } }
if ($files.Count -eq 0) { throw "no PSD to measure in $inDir" }

$ps = New-Object -ComObject Photoshop.Application
Write-Output ("photoshop=" + $ps.Version + " files=" + $files.Count)

$resizeLiteral = if ($Resize) { "true" } else { "false" }
$liveLiteral = if ($LiveSelection) { "true" } else { "false" }
$phantomLiteral = $PhantomRatio.ToString([System.Globalization.CultureInfo]::InvariantCulture)
$pageDir = Join-Path $Root ".centering-lab\runs\$Run\pages"
New-Item -ItemType Directory -Force -Path $pageDir | Out-Null

foreach ($f in $files) {
  $outFile = Join-Path $outDir ($f.BaseName + ".json")
  $rawWith = if ($DumpRaw) { Join-Path $pageDir ($f.BaseName + ".withtext.raw") } else { "" }
  $rawNo = if ($DumpRaw) { Join-Path $pageDir ($f.BaseName + ".notext.raw") } else { "" }
  $js = @"
var LAB = {
  inFile: "$(To-JsxPath $f.FullName)",
  outFile: "$(To-JsxPath $outFile)",
  rawWithText: "$(To-JsxPath $rawWith)",
  rawNoText: "$(To-JsxPath $rawNo)",
  resize: $resizeLiteral,
  padding: $Padding,
  wandTolerance: $WandTolerance,
  liveSelection: $liveLiteral,
  phantomRatio: $phantomLiteral
};
`$.evalFile(new File("$(To-JsxPath $hostJsx)"));
`$.evalFile(new File("$(To-JsxPath $harness)"));
LAB_RESULT;
"@
  $started = Get-Date
  try {
    $result = $ps.DoJavaScript($js)
  } catch {
    $result = "COM ERROR: " + $_.Exception.Message
  }
  $secs = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
  Write-Output ("[" + $f.Name + "] " + $result + " (" + $secs + "s)")
}
