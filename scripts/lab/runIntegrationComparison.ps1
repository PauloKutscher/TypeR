param(
  [string]$Root = (Join-Path $PSScriptRoot '../..'),
  [Parameter(Mandatory = $true)][string]$BaselineHost,
  [Parameter(Mandatory = $true)][string]$CandidateHost,
  [Parameter(Mandatory = $true)][string]$DatasetRun,
  [ValidateSet('none', 'mid', 'full', 'overlap', 'overlapmid')][string]$Scatter = 'full',
  [switch]$Resize,
  [int]$Padding = 0,
  [switch]$LiveSelection,
  [double]$PhantomRatio = 0
)

$ErrorActionPreference = 'Stop'
if ($DatasetRun -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_.-]*$') {
  throw 'DatasetRun must name an existing lab run.'
}
$Root = (Resolve-Path -LiteralPath $Root).Path
$BaselineHost = (Resolve-Path -LiteralPath $BaselineHost).Path
$CandidateHost = (Resolve-Path -LiteralPath $CandidateHost).Path
$runs = Join-Path $Root '.centering-lab/runs'
$datasetPath = Join-Path $runs "$DatasetRun/cases.json"
$dataset = Get-Content -LiteralPath $datasetPath -Raw -Encoding UTF8 | ConvertFrom-Json
$pages = @($dataset.cases | Select-Object -ExpandProperty page -Unique)
if (!$pages.Count) { throw "No pages in $datasetPath" }
$sources = foreach ($page in $pages) {
  if ([IO.Path]::GetFileName($page) -cne $page -or !$page) {
    throw "Invalid page name in $datasetPath"
  }
  Get-Item -LiteralPath (Join-Path $Root "psd/$page.psd")
}
if (-not (Test-Path -LiteralPath (Join-Path $Root '.centering-lab/meta/ground-truth-hashes.json') -PathType Leaf)) {
  throw 'Copy the frozen ground-truth manifest into .centering-lab/meta before measuring.'
}

$prefix = 'integration-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$options = @{
  Root = $Root; Scatter = $Scatter; TraceGeometry = $true; Resize = $Resize
  Padding = $Padding; LiveSelection = $LiveSelection; PhantomRatio = $PhantomRatio
}
foreach ($entry in @(@('fork', $BaselineHost), @('candidate', $CandidateHost))) {
  $run = $prefix + '-' + $entry[0]
  $inputFolder = New-Item -ItemType Directory -Path (Join-Path $runs "$run/in")
  foreach ($source in $sources) {
    Copy-Item -LiteralPath $source.FullName -Destination $inputFolder.FullName
  }
  & (Join-Path $PSScriptRoot 'runMeasure.ps1') @options -Run $run -HostJsx $entry[1]
}

$csv = Join-Path $runs "$prefix-candidate/comparison.csv"
& node (Join-Path $Root 'scripts/lab/compareRuns.js') "$prefix-fork" "$prefix-candidate" $DatasetRun --csv $csv
exit $LASTEXITCODE
