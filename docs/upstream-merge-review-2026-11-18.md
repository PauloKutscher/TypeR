# Upstream integration — review candidate, NOT approved for production

- Fork baseline: `290180400263643ab86415145cbd4e90cc056e4d`
- Upstream ScanR/TypeR develop: `d7a34296dc92c7a81bbe8f4774a0bcd39ff5af90`
- Destination is an isolated candidate branch; original develop is unchanged.
- This is an AUTOMATIC THREE-WAY DRAFT. Git's `-X ours` chose fork hunks on conflicts.
- Unresolved structural conflicts preserved the fork's file (see below).
- Photoshop-facing centering/Smart Paste paths listed below were restored exactly
  from the fork, regardless of non-conflicting upstream edits.
- DO NOT MERGE until code review, automated checks, and Photoshop benchmarks pass.

## Structural conflicts needing review

- installer/repair_uxp_webview_win.ps1
- scripts/testUxpWebViewRepair.js
- scripts/testUxpWebViewRepair.ps1
- uxp-src/host/webViewRepair.js

## Required checks before merge

1. Inspect `git diff develop...integration/upstream-develop-2026-11-18-candidate`
   including the settings, style import, installer and CEP/UXP service call paths.
2. Run `npm ci && npm run verify && npm run package:uxp` on Windows.
3. Run `node scripts/testAlignPlan.js`,
   `node scripts/testSmartPasteEngine.js`,
   `node scripts/testSmartPasteClient.js`,
   `node scripts/testUxpHost.js` and the TextShapeR tests.
4. In Photoshop on Windows, compare the original fork and the candidate
   on the SAME PSDs with matching text, fonts, padding and settings.
   Cover single/irregular/tail balloons, double/triple bubbles,
   overlapping text, small shapes, rotated layers, style strokes,
   resizing, missing fonts and UXP versus CEP.
5. To capture real-world centering results, use the existing
   `scripts/lab/runMeasure.ps1` and `scripts/lab/compareRuns.js`
   with identical options (`-Scatter none/mid/full/overlap`,
   `-Padding`, `-WandTolerance` and `-Resize`).
   The existing compareRuns.js requires the SAME experiment population
   and rejects missing cases or regressions.
6. Do not adopt any upstream/hybrid alignment logic until measured
   improvement without regression is established. If inconclusive,
   retain the fork's algorithm.

Automated tests and packaging do not replace real Photoshop validation.

## Protected implementation files
- `app_src/host.js`
- `app_src/bubbleGeometry.jsxinc`
- `app_src/oneClick/alignPlan.js`
- `app_src/oneClick/geometry.js`
- `app_src/oneClick/bubblePlan.js`
- `app_src/oneClick/connected.js`
- `app_src/oneClick/layout.js`
- `app_src/oneClick/solver.js`
- `app_src/oneClick/measureSpec.js`
- `app_src/oneClick/openBubble.js`
- `app_src/oneClick/smartPaste.js`
- `app_src/oneClick/textGraph.js`
- `app_src/smartPasteClient.js`
- `uxp-src/host/smartPaste.js`
- `uxp-src/host/photoshop.js`
- `scripts/testAlignPlan.js`
