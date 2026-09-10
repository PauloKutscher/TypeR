<#
  runSequence.ps1 — drives diagSequence.jsx: a whole page aligned line by line
  without being put back in between, forwards, backwards, and twice.

  Usage:
    powershell -NoProfile -File scripts/lab/runSequence.ps1 -Root "<repo>" -Page "11.psd" -Label cand [-HostJsx path]
#>
param(
  [Parameter(Mandatory = $true)][string]$Root,
  [Parameter(Mandatory = $true)][string]$Page,
  [string]$Label = "seq",
  [string]$HostJsx = "",
  [switch]$NoSelection
)
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path -LiteralPath $Root).Path
function To-JsxPath([string]$p) { return ($p -replace '\\', '/') }

$source = Join-Path $Root ("psd\" + $Page)
if (-not (Test-Path -LiteralPath $source)) { throw "missing: $source" }
if ($Page -ne [System.IO.Path]::GetFileName($Page) -or $Label -notmatch '^[\w.-]+$' -or $Label -in @('.', '..')) { throw 'invalid page or label' }
$workDir = Join-Path $Root (".centering-lab\sequence\" + $Label)
if (Test-Path -LiteralPath $workDir) { throw 'use a new sequence label' }
New-Item -ItemType Directory -Force -Path $workDir | Out-Null
$copy = Join-Path $workDir $Page
Copy-Item -LiteralPath $source -Destination $copy

$hostJsx = if ($HostJsx) { if ([System.IO.Path]::IsPathRooted($HostJsx)) { $HostJsx } else { Join-Path $Root $HostJsx } } else { Join-Path $Root "app\host.jsx" }
$harness = Join-Path $Root "scripts\lab\diagSequence.jsx"
$outFile = Join-Path $Root (".centering-lab\diag-seq-" + $Label + "-" + [System.IO.Path]::GetFileNameWithoutExtension($Page) + ".json")

$before = (Get-FileHash -Algorithm SHA1 -LiteralPath $source).Hash
$hostHash = (Get-FileHash -Algorithm SHA1 -LiteralPath $hostJsx).Hash
$harnessHash = (Get-FileHash -Algorithm SHA1 -LiteralPath $harness).Hash
$head = (& git -C $Root rev-parse HEAD).Trim()
$noSelectionLiteral = if ($NoSelection) { 'true' } else { 'false' }
$allOriginalsBefore = @(Get-ChildItem -LiteralPath (Join-Path $Root 'psd'),(Join-Path $Root 'true') -File -Filter '*.psd' | Sort-Object FullName | Get-FileHash -Algorithm SHA1 | Select-Object Path,Hash) | ConvertTo-Json -Compress
$js = @"
var LAB = {
  inFile: "$(To-JsxPath $copy)",
  outFile: "$(To-JsxPath $outFile)",
  wandTolerance: 20,
  noSelection: $noSelectionLiteral,
  identity: { head: "$head", inputSha1: "$before", hostSha1: "$hostHash", harnessSha1: "$harnessHash" }
};
`$.evalFile(new File("$(To-JsxPath $hostJsx)"));
LAB.identity.loadedPartition = _splitOutlineAtCusps.toString();
`$.evalFile(new File("$(To-JsxPath $harness)"));
LAB_RESULT;
"@
$ps = New-Object -ComObject Photoshop.Application
Write-Output ("photoshop=" + $ps.Version + " host=" + (Get-FileHash -Algorithm SHA1 -LiteralPath $hostJsx).Hash)
$result = $ps.DoJavaScript($js)
Write-Output $result
if ((Get-FileHash -Algorithm SHA1 -LiteralPath $source).Hash -ne $before) { throw "ground truth changed" }
$allOriginalsAfter = @(Get-ChildItem -LiteralPath (Join-Path $Root 'psd'),(Join-Path $Root 'true') -File -Filter '*.psd' | Sort-Object FullName | Get-FileHash -Algorithm SHA1 | Select-Object Path,Hash) | ConvertTo-Json -Compress
if ($allOriginalsBefore -ne $allOriginalsAfter) { throw 'original manifest changed' }
if ((Get-FileHash -Algorithm SHA1 -LiteralPath $hostJsx).Hash -ne $hostHash -or (Get-FileHash -Algorithm SHA1 -LiteralPath $harness).Hash -ne $harnessHash) { throw 'host or harness changed during run' }
if ($result -notmatch '^layers=\d+ errors=0$') { throw 'sequence diagnostic failed; copy preserved' }
# Keep this run's private copy for diagnosis; never overwrite a previous run.
Write-Output ("wrote " + $outFile)
