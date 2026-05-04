# TypeR Photoshop QA Checklist

Use this checklist before calling a build release-ready. Test in Photoshop CC 2015+ and note the exact Photoshop version, OS, and sample pages used.

## Startup and Panel

- Open Photoshop, launch TypeR, and confirm the panel appears without console errors.
- Confirm the first open shows Help only for a new storage file.
- Open Help, Settings, Edit Style, Edit Folder, Export, and Update modals at least once. Confirm lazy-loaded modals appear and close correctly.
- Resize the panel down to a compact manga typeset size around 500 x 700 and confirm text, buttons, and badges do not overlap.

## Text Parsing

- Paste a script with normal dialogue, empty lines, ignored prefixes, ignored tags, and `Page 1` / `Page 2` markers.
- Confirm ignored lines are skipped by Previous/Next.
- Confirm `Page X` markers make Next Page jump to the first non-ignored line of the next page.
- Confirm style prefixes are highlighted, removed from inserted text, and select the expected style.
- Confirm `//` and `//:` repeat the previous line style.
- Confirm markdown paste keeps bold/italic preview when markdown is enabled and behaves as plain text when disabled.

## Styles and Folders

- Create, edit, duplicate, delete, and reorder styles.
- Create nested folders, move styles between folders, duplicate folders, delete folders with and without Shift.
- Confirm the quick font-size badge is visible, compact, and does not hide long style names.
- Use the quick size plus/minus controls and direct number input; confirm the style updates and persists after restart.
- Toggle automatic style prefixes on/off and confirm matching changes immediately.

## Photoshop Text Actions

- Select a bubble and click Paste. Confirm a new text layer appears centered in the selection and the current line advances.
- Click Align on an existing text layer. Confirm centering works with and without resize-text-box enabled.
- Apply text+style to an existing text layer and confirm line advance.
- Insert text only into an existing text layer and confirm style is not changed.
- Increase/decrease active layer font size using the panel controls and configured shortcuts.
- Test text scale with 50%, 100%, and 150% and confirm style data itself is not permanently changed.

## Multi-Bubble

- Enable Multi-Bubble from footer and Settings.
- Capture several single selections one by one; confirm the selection count increases and lines advance.
- Insert stored selections and confirm each bubble gets the correct text and style.
- Confirm one click on the minus button removes the last stored selection.
- Hold the minus button for one second and confirm all stored selections are cleared.
- Confirm Shift-selection warning appears only when tips are enabled.

## PSD Directory Sync

- Open a PSD directory from the footer.
- Confirm `Page X` markers open the matching PSD file.
- Confirm auto-close PSD works when enabled.
- Desync PSDs and confirm page switching stops opening files.

## Import, Export, and Storage

- Export settings and style folders as JSON.
- Import a full settings export and confirm styles, folders, shortcuts, direction, markdown, and behavior settings are restored.
- Import a style-folder export and confirm a new folder is created with the expected styles.
- Save a named state, load it, delete it, then restart TypeR and confirm storage is consistent.
- Reset shortcuts and reset storage, then confirm the panel reloads cleanly.

## Shortcuts

- Confirm shortcuts do not fire while typing in the text area, Settings fields, or any modal field.
- Confirm shortcuts do not fire while any modal is open.
- Confirm Paste, Apply, Align, Previous, Next, Next Page, Insert Text, Increase, Decrease, and Toggle Multi-Bubble work after closing Settings.

## Build Gates

- Run `npm run verify` for the full automated gate, or run the following commands individually while diagnosing failures.
- Run `npm test`.
- Confirm `textLayerPayload tests passed`.
- Confirm `line numbering tests passed`.
- Confirm `locale key tests passed`.
- Run `npm run build`.
- Confirm build exits with code 0.
- Run `npm run test:build`.
- Confirm `build artifact tests passed`.
- Record any warnings. Current expected warnings are old Browserslist data, Sass legacy JS API, and Webpack size warnings for `index.js`.

## Automated Coverage Notes

`npm test` currently verifies pure logic only:

- text size scaling does not mutate source style objects;
- multi-bubble payload creation skips ignored/exhausted lines correctly and preserves tagged line styles;
- line numbering resets correctly after `Page N` markers when that setting is enabled;
- locale files have matching keys, no duplicate keys, and matching placeholders such as `{count}` and `{version}`.
- `npm run test:build` verifies the generated `app/` contains the required CEP entry files, lazy modal chunks, and copied Topcoat theme CSS files after a build.

These tests do not validate CEP or Photoshop behavior. Always run the manual Photoshop sections above before treating a build as release-ready.
