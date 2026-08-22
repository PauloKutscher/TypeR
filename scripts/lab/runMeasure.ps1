<#
  runMeasure.ps1 — drives Photoshop through COM to measure how the real TypeR
  centering moves text inside balloons.

  The PSDs under psd/ and true/ are ground truth and are never touched: this
  script only ever opens the copies under .centering-lab/runs/<run>/in.

  Usage:
    powershell -NoProfile -File scripts/lab/runMeasure.ps1 `
       -Root "C:\path\to\repo" -Run "000-baseline" [-Only "name.psd"] `
       [-Resize] [-Padding 0] [-WandTolerance 20] [-Scatter none|mid|full|overlap] `
       [-HostJsx "path\\to\\host.jsx"] [-TraceGeometry]

  -Scatter throws every text layer somewhere inside its own balloon before the
  align, which is the page the typesetter really presses the button on. Without
  it the neighbours sit on their ground truth and the bench flatters any rule
  that reads them.

  -Scatter overlap does the other half: it leaves every line at home and drops
  the nearest one on top of the line being centred, one line at a time. none,
  mid and full all fence each line inside its own balloon, so none of them ever
  makes the page where one line lies across another.
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
  [double]$PhantomRatio = 0,
  [string]$HostJsx = "",
  [switch]$TraceGeometry,
  [ValidateSet("none", "mid", "full", "overlap")][string]$Scatter = "none"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path -LiteralPath $Root).Path

function To-JsxPath([string]$p) { return ($p -replace '\\', '/') }

function Get-GroundTruthSnapshot([string]$root) {
  $snapshot = [ordered]@{ psd = [ordered]@{}; true = [ordered]@{} }
  foreach ($folder in @("psd", "true")) {
    Get-ChildItem -LiteralPath (Join-Path $root $folder) -File -Filter *.psd |
      Sort-Object Name |
      ForEach-Object { $snapshot[$folder][$_.Name] = (Get-FileHash -Algorithm SHA1 -LiteralPath $_.FullName).Hash }
  }
  return $snapshot
}

function Snapshot-Json($snapshot) { return ($snapshot | ConvertTo-Json -Depth 4 -Compress) }

# The PSDs a run measures are a copy of psd/, made because Photoshop opens them
# and psd/ is read-only ground truth. They are deleted when the run finishes: at
# half a gigabyte a run they were most of a 40 GB lab directory, and nothing
# reads them afterwards.
$inDir = Join-Path $Root ".centering-lab\runs\$Run\in"
$outDir = Join-Path $Root ".centering-lab\runs\$Run\out"
$runDir = Join-Path $Root ".centering-lab\runs\$Run"
$hostJsx = if ($HostJsx) {
  if ([System.IO.Path]::IsPathRooted($HostJsx)) { $HostJsx } else { Join-Path $Root $HostJsx }
} else { Join-Path $Root "app\host.jsx" }
$harness = Join-Path $Root "scripts\lab\measureCentering.jsx"

foreach ($required in @($inDir, $hostJsx, $harness)) {
  if (-not (Test-Path $required)) { throw "missing: $required" }
}
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$hashFile = Join-Path $Root ".centering-lab\meta\ground-truth-hashes.json"
$groundTruthBefore = Get-GroundTruthSnapshot $Root
$groundTruthBeforeJson = Snapshot-Json $groundTruthBefore
$baselineCount = 0
if (Test-Path -LiteralPath $hashFile) {
  $oldHashes = Get-Content -Raw -LiteralPath $hashFile | ConvertFrom-Json
  $baselineCount = @($oldHashes.psd.PSObject.Properties).Count
}
if ($baselineCount -ne @($groundTruthBefore.psd.Keys).Count) {
  New-Item -ItemType Directory -Force -Path (Split-Path $hashFile) | Out-Null
  $groundTruthBefore | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 -LiteralPath $hashFile
} elseif ((Snapshot-Json $oldHashes) -ne $groundTruthBeforeJson) {
  throw "ground truth differs from $hashFile"
}

$files = @(Get-ChildItem $inDir -Filter *.psd | Sort-Object Name)
if ($Only -ne "") { $files = @($files | Where-Object { $_.Name -eq $Only }) }
if ($files.Count -eq 0) { throw "no PSD to measure in $inDir" }

$ps = New-Object -ComObject Photoshop.Application
Write-Output ("photoshop=" + $ps.Version + " files=" + $files.Count)

$resizeLiteral = if ($Resize) { "true" } else { "false" }
$liveLiteral = if ($LiveSelection) { "true" } else { "false" }
$traceLiteral = if ($TraceGeometry) { "true" } else { "false" }
$phantomLiteral = $PhantomRatio.ToString([System.Globalization.CultureInfo]::InvariantCulture)
# The page composites are the same for every run — they come from the same 14
# PSDs — so they live once, outside the runs, instead of being copied into each.
$pageDir = Join-Path $Root ".centering-lab\pages"
New-Item -ItemType Directory -Force -Path $pageDir | Out-Null
$runStarted = Get-Date
$pageTimings = @()

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
  traceGeometry: $traceLiteral,
  phantomRatio: $phantomLiteral,
  scatter: "$Scatter"
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
  $pageTimings += [ordered]@{ file = $f.Name; seconds = $secs; result = $result }
  Write-Output ("[" + $f.Name + "] " + $result + " (" + $secs + "s)")
}

$groundTruthAfterJson = Snapshot-Json (Get-GroundTruthSnapshot $Root)
if ($groundTruthAfterJson -ne $groundTruthBeforeJson) { throw "ground truth changed during run $Run" }

$runFinished = Get-Date
[ordered]@{
  run = $Run
  hostJsx = $hostJsx
  hostSha1 = (Get-FileHash -Algorithm SHA1 -LiteralPath $hostJsx).Hash
  harnessSha1 = (Get-FileHash -Algorithm SHA1 -LiteralPath $harness).Hash
  photoshop = $ps.Version
  startedAt = $runStarted.ToUniversalTime().ToString("o")
  finishedAt = $runFinished.ToUniversalTime().ToString("o")
  seconds = [math]::Round(($runFinished - $runStarted).TotalSeconds, 1)
  options = [ordered]@{
    resize = [bool]$Resize
    padding = $Padding
    wandTolerance = $WandTolerance
    liveSelection = [bool]$LiveSelection
    phantomRatio = $PhantomRatio
    scatter = $Scatter
    traceGeometry = [bool]$TraceGeometry
  }
  pages = $pageTimings
} | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $runDir "run.json")

# Photoshop is done with them. buildCases.js reads out/ and the shared pages/.
Remove-Item -Recurse -Force $inDir
Write-Output ("copies removed: " + $inDir)
