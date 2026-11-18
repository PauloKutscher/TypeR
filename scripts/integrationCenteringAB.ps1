<#
  Controlled A/B for TypeR's Photoshop-native text centering.
  Runs the existing, read-only-on-ground-truth centering lab twice per scatter
  condition, against explicitly supplied compiled CEP host.jsx files.
  The PSDs under psd/ and true/ are never edited: runMeasure uses copies.

  Example:
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/integrationCenteringAB.ps1 `
    -Root "C:\TypeR-candidate" `
    -BaselineHostJsx "C:\TypeR-original\app\host.jsx" `
    -CandidateHostJsx "C:\TypeR-candidate\app\host.jsx" `
    -RunPrefix "review-01" -Padding 0 -WandTolerance 20
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Root,
  [Parameter(Mandatory=$true)][string]$BaselineHostJsx,
  [Parameter(Mandatory=$true)][string]$CandidateHostJsx,
  [Parameter(Mandatory=$true)][string]$RunPrefix,
  [ValidateSet('none','mid','full','overlap','overlapmid')]
  [string[]]$Scatters = @('none','mid','full','overlap'),
  [int]$Padding = 0,
  [int]$WandTolerance = 20,
  [switch]$Resize,
  [string]$Only = ''
)
$ErrorActionPreference = 'Stop'
if ($RunPrefix -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]*$') { throw 'RunPrefix must be a safe run ID' }
$rootPath = (Resolve-Path -LiteralPath $Root).Path
$baselinePath = (Resolve-Path -LiteralPath $BaselineHostJsx).Path
$candidatePath = (Resolve-Path -LiteralPath $CandidateHostJsx).Path
$runner = Join-Path $rootPath 'scripts\lab\runMeasure.ps1'
$comparer = Join-Path $rootPath 'scripts\lab\compareRuns.js'
foreach ($file in @($runner,$comparer)) { if (-not (Test-Path -LiteralPath $file)) { throw "Required lab file missing: $file" } }
if ($baselinePath -eq $candidatePath) {
  Write-Warning 'Both host paths point to the same file; this is a repeatability check, not an algorithm comparison.'
}
$baseHash = (Get-FileHash -LiteralPath $baselinePath -Algorithm SHA256).Hash
$candidateHash = (Get-FileHash -LiteralPath $candidatePath -Algorithm SHA256).Hash
if ($baseHash -eq $candidateHash) {
  Write-Warning 'Host binaries are identical; centering in the CEP host is unchanged. This does NOT validate merged panel or UXP behavior.'
}
foreach ($scatter in $Scatters) {
  $baseRun = "$RunPrefix-$scatter-fork"
  $candidateRun = "$RunPrefix-$scatter-candidate"
  foreach ($entry in @(@($baseRun,$baselinePath),@($candidateRun,$candidatePath))) {
    $args = @('-NoProfile','-ExecutionPolicy','Bypass','-File', $runner,
      '-Root', $rootPath, '-Run', $entry[0], '-HostJsx', $entry[1],
      '-Padding', [string]$Padding, '-WandTolerance', [string]$WandTolerance,
      '-Scatter', $scatter)
    if ($Resize) { $args += '-Resize' }
    if ($Only) { $args += @('-Only',$Only) }
    & powershell.exe @args
    if ($LASTEXITCODE -ne 0) { throw "Photoshop run failed for $($entry[0]): $LASTEXITCODE" }
  }
  & node $comparer $baseRun $candidateRun
  if ($LASTEXITCODE -ne 0) { throw "Regression gate failed: $scatter (see the lab reports before accepting any centering change)" }
}
Write-Host 'A/B regression checks passed for every requested scatter condition.'
Write-Host 'This validates CEP positioning only; test UXP and interactive editing manually inside Photoshop.'
