# Manga typesetting heuristics

## Contents

- Reading order
- Dialogue mapping
- Style selection
- Shape and centering
- Size harmony
- Confidence and escalation

## Reading order

For Japanese manga, traverse panels right-to-left and top-to-bottom, then traverse bubbles within each panel the same way. Geometry alone is insufficient when tails establish a back-and-forth conversation: use tails, speaker position, and dialogue continuity to refine the order.

For western comics and most webtoons, traverse left-to-right and top-to-bottom. Webtoons often have a single vertical flow; large vertical gaps can separate beats but do not necessarily mark a new page.

Treat connected lobes as two bubbles when each lobe has its own visual center or tail and the detector returns separate children. Treat them as one when the shape is merely decorative and contains one continuous dialogue.

## Dialogue mapping

Use TypeR metadata first. Style prefixes, stored line styles, Page markers, and the current cursor are stronger evidence than semantic guesses.

Then use:

- dialogue continuity and reply structure;
- speaker tails and character positions;
- bubble size versus dialogue length;
- punctuation such as interrupted speech, ellipses, and follow-on fragments;
- narration versus spoken wording.

Do not force every usable line onto the current page. Stop at the next Page marker or when every intended target is filled.

## Style selection

Common semantic roles include dialogue, thought, narration, whisper, shout, radio/phone, annotation, and SFX. Prefer the project's named TypeR style. When names are generic, use line prefixes and already used styles on neighboring lines.

Choose a new font only when the user asks or no project style represents the role. Preserve consistency across the chapter. Shouts may justify heavier weight or larger size; whispers may justify a smaller or lighter style, but neither should override explicit project metadata.

Before choosing a new face, render a contact sheet with `typer_preview_fonts` using actual dialogue from the page. Compare at least four credible candidates when available. Prefer the face whose visual voice matches the speaker and bubble role while remaining readable at the intended size. Check width and x-height against the available bubble space, accents and punctuation against the script language, and weight/contrast against the artwork. Font names and metadata are discovery signals, not visual evidence.

## Shape and centering

Aim for a compact diamond/oval text silhouette:

- shorter first and last lines;
- longest lines near the vertical center;
- no orphaned punctuation or tiny edge word;
- balanced negative space on all sides.

TextShapeR provides ranked candidates. Use `typer_preview_text_shapes` to compare them in the real font over the actual bubble crop. Scores rank algorithmic plausibility; `fits` detects measured overflow; the image decides optical balance. Reject red overflow. For tall narrow bubbles, accept more shorter lines. For wide balloons, accept fewer longer lines.

Optical centering can differ from geometric centering because tails and irregular outlines distort the bounding box. Keep the block centered in the main balloon body. Re-align after any size or line-break change.

## Size harmony

Establish a reference size from the project's normal-dialogue style and neighboring finished pages. Bubbles with the same semantic role should have a similar apparent text size even when their shapes and line counts differ. Judge this from the full-page view, not only from isolated bubble crops.

The target is comfortable readability with deliberate negative space. Do not maximize occupancy: a short reply does not need to be enlarged to fill its balloon, and a long reply should not be reduced until its line shape, bounds, padding, and centering have been improved.

Use this correction order:

1. confirm the dialogue-to-bubble mapping and usable bounds;
2. choose a better TextShapeR line-break variant;
3. adjust padding and optical centering;
4. change size only if the block still cannot achieve a readable, balanced fit.

Keep size changes small and reversible, then compare every ordinary-dialogue bubble together before saving. Correct accidental jumps between neighboring bubbles. Explicit bold or emphatic text may intentionally break the normal-dialogue baseline; do not treat ordinary fitting pressure as emphasis.

## Confidence and escalation

Proceed autonomously when bubble order, line count, and styles agree. Record a concise note for low-impact uncertainty.

Ask the user before saving only when ambiguity can materially swap dialogue between speakers, overwrite an existing intended layer, or choose between incompatible project fonts/styles with no metadata. Do not pause for small line-shape preferences that can be resolved through visual review.
