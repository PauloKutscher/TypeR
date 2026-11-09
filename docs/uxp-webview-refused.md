# "No response from the WebView": Photoshop refuses the WebView, TypeR runs without it

Fix shipped in 3.0.2. Investigated and verified on 2026-11-07 on a Windows 11 VM (build 26300)
where the bug reproduced every time: Photoshop 2026 **27.9.1**, UXP **9.3.0**, Microsoft Edge
WebView2 Evergreen 156/157 installed, Adobe's own WebView2 copy 140.0.3485.94.

## Symptom

The new (UXP) TypeR panel stays empty, then shows after 15 s:

```
TypeR could not display its interface.
No response from the WebView (15 s).
Photoshop 27.9.1 / UXP uxp-9.3.0-uxp / win32
WebView load: start=false, stop=false, bridge=false
```

Not a single load event reaches the host page, and Reload TypeR or restarting Photoshop never helps.
The Legacy (CEP) panel works on the same computer.

## Root cause

UXP **never creates any third-party WebView** in such a Photoshop. Its UXP log
(`%APPDATA%\Adobe\Adobe Photoshop 2026\Logs\UXPLogs_<date>_<time>_<n>.log`) says, at each
attempt, the instant TypeR's `<webview>` asks for one:

```
[Warn] [general] WebViewManager::createWebView() failed to create WebView because webViewDataStorage_ is not available
```

`webViewDataStorage_` is the WebView data storage UXP keeps per Adobe user for third-party plugins,
`%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\<major>\WebView\<user hash>\3P`. UXP builds it from the
**signed-in Adobe user's id**. A Photoshop without an Adobe user never gets it, so every
third-party WebView is refused for the whole session.

Such Photoshops: **Feature Restricted Licensing** (FRL: enterprise/education offline, isolated or
LAN licences), and offline or modified ("repacked") installations. The same UXP log says so through
Photoshop's own panels:

```
[console] ... [HS] [imsBridge] FRL user. No access token present
[console] [DP] UXP-IMS Error: Error fetching IMS access token {"message":"There is no valid user profile to get an access token"}
```

A signed-in user whose identity arrives a few seconds after Photoshop starts can hit the same refusal
for a WebView asked for in those seconds (the user's log of 2026-11-04: refused 4 s after launch, a
reload later worked). That variant could not be reproduced here (no Adobe account on the VM).

### Evidence

| Check | Result |
| --- | --- |
| Photoshop restarted normally, TypeR open at launch | Refused at once and at TypeR's +5 s retry; no `WebView2BrowserVersion` line in the whole session (no WebView started); no `msedgewebview2.exe` child of Photoshop |
| Previous session left running for 17 hours | Never a single `createWebView() create new for thirdparty plugin`: not a race, the storage never comes |
| Photoshop started with `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` on Microsoft's Evergreen 157 | Same refusal, same timing: **not** a WebView2 runtime problem, the check happens before any runtime is touched |
| `%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\27\` | Only `External` and `Internal`: the `WebView` folder is never created |
| UXP log of the session | `FRL user. No access token present`, `There is no valid user profile` |
| A working machine's log (`.update-test/webview-storage-baseline`) | `WebView2BrowserVersion: 156.0.4314.58` then `createWebView() create new for thirdparty plugin`, 6 s after launch |

In `dynamic-torqnative.dll` 9.3.0.0 (Photoshop 27.9.1), disassembled:

- `WebViewManager::createWebView` (RVA `0x23edc00`) starts with `cmp qword ptr [this+0x50], 0`:
  when the storage member is null, it logs the line above, **queues the request** (vector at
  `this+0x150`) and returns no WebView. Nothing is sent back to the plugin: no `loaderror`, no event,
  hence `start=false, stop=false, bridge=false`.
- The storage path is built from `"WebView"`, a user hash and `"/1P"` / `"/3P/"` (RVA `0x23e8d80`,
  `0x23ed780`). The DLL exports `UserInfoController::hashUserId` and logs
  `UserId is not available from the UserInfoProvider.` when there is no user.
- UXP 9.3 gives third-party plugins no `uxp.userInfo`, so a plugin can neither read the user id
  nor provide one.

No manifest setting, environment variable, runtime or folder tested here makes unmodified UXP create
the WebView. TypeR can work without it. The native storage repair below additionally fixes the
initialization on one verified Windows DLL; it is not a universal UXP binary patch.

The earlier causes stay what `docs/uxp.md` says (no WebView2 runtime Photoshop can start:
`Failed to create WebView for plugin: com.scanr.typer`). The fix below covers them too.

## The fix: TypeR in the panel itself

The panel's application never depended on the WebView as such. It talks to the plugin host only
through `uxp-src/web/bridge.js` (JSON messages). UXP's own panel DOM can run React. So the same
application is built a second time for that DOM and started in the panel when the WebView is
refused.

### How it switches

`uxp-src/host/main.js`:

1. The WebView is asked for as before (`attachView`, `showPanelPage`).
2. **Windows:** `watchWebViewRefusal` reads the running session's UXP log 1.5 s, 3.5 s and 7 s later
   (`panelStart.findWebViewRefusalSince`). It looks for the storage refusal or
   `Failed to create WebView for plugin: com.scanr.typer`, written at or after the request (one second
   of tolerance; `[console]` lines ignored). Found, and no load event yet: `enterInPanel`. On the VM, the switch
   came **about 2 s after the refusal** was logged.
3. **Every platform:** when the 15 s deadline passes without any load event of the WebView,
   `reportPanelStartFailure` calls `enterInPanel` instead of showing the notice. This replaces the
   three automatic re-creations of the WebView, which could not help here. A WebView that loaded
   something and then failed still gets the notice.
4. `enterInPanel` removes the `<webview>`, bumps the view generation (late WebView messages are
   ignored) and calls `inPanel.startInPanel`. From then on `post()` delivers to the application
   directly, and its messages go through the same `handlePanelMessage` as the WebView's (requests,
   ready, appReady, errors, de-duplication of request ids).
5. Once in the panel, TypeR stays there for the life of the plugin. When Photoshop destroys and
   recreates the panel, a new instance starts in it (`restartInPanel`) without asking for a WebView
   again. `window.location.reload()` (Reload, after an update) reloads the plugin page: the host
   starts over and switches again within seconds (checked).

### The second build

`webpack.uxp.config.js`, `inPanelConfig` → `uxp/inpanel/inpanel.js` + `inpanel.css` (Windows and
macOS packages alike; `scripts/buildUxp.js` requires both in the .ccx):

- Entry `uxp-src/web/inpanel/entry.js` = the WebView entry, plus the stylesheet for UXP's layout
  engine and the element replacements.
- **One file**: lazy chunks folded in (`LimitChunkCountPlugin`). UXP's `require()` loads it.
- **Re-runnable**: wrapped as `module.exports = function startTypeRInPanel() { ... }`, because
  `require()` caches. Each call is a fresh webpack runtime.
- `window.require` is defined as `undefined` for the application. In the panel, the global `require`
  is UXP's, and the application would otherwise take it for CEP's Node (storage writes through
  `openSync` failed and showed "TypeR could not safely read or save your data").
- `exportsPresence: "error"`: an icon imported by `app_src` without its replacement fails the build.
- No `eval` and no `new Function` reached: the release manifest does not allow code generation.

`uxp-src/host/inPanel.js` inserts the stylesheet, the page elements the application expects
(`#topcoat`, `#hostStyle`, `#app`) and the channel `window.__typerInPanel`. It requires the bundle and
runs it. Both directions go through `setTimeout(0)`, like postMessage.

`uxp-src/web/bridge.js` uses that channel when it exists (`runsInPanel`). `entry.js` marks
`html.typer-inpanel` and skips the fetch fallback (UXP's fetch has no CORS, and the host's `fetchUrl`
uses it: the fallback would call itself).

### What UXP's panel DOM does differently (measured in Photoshop 27.9.1)

| UXP behaviour | Consequence | Handling |
| --- | --- | --- |
| `<button>` is a native widget showing only its text: an `<svg>` child is laid out at 0×0, and it is drawn above the page | Every icon button empty | `uxp-src/web/inpanel/elements.js` renders the application's buttons as `<div role="button" class="typer-button">` (click, Enter/Space, `disabled`, `type="submit"`); `scripts/inPanelCss.js` rewrites `button` selectors to `.typer-button` and `:disabled` to `[disabled]` |
| A `<div>` standing for a button has none of Chromium's button defaults: centred text and content, inline-block, 13.33 px system font | Icons above their label and to the left, labels in Tahoma | `style.scss` starts with Chromium's button defaults on `.typer-button` (one class: the application's rules, later, win as they win over a browser's) |
| `<svg>` is `display: block`, and an inline one sits at the top of its line, where a browser's button centres its content; an 18 px icon overflowing a 27 px padded square starts on the left instead of centred | Paste, Align, Add folder, Add style: icon over the label; arrow buttons off centre | `svg { display: inline-block; vertical-align: middle }` (element selector); no side padding on the square icon buttons |
| SVG: no strokes at all, `fill="none"` ignored on the `<svg>` root (shapes filled black), `currentColor` is black; `fill` from a stylesheet rule, `var()` included, works | Feather (`fi`), Tabler (`tb`) and the Font FindeR logo turn into black blobs; one fixed icon colour is invisible on the white sheet (line icons) | Aliased to Remix "Line" fill icons (`iconsFi.js`, `iconsTb.js`, `fontFinderLogo.jsx`). `svg[fill="currentColor"] { fill: var(--typer-icon) }`, and `currentColor` is emulated: every `color` of the stylesheet sets `--typer-icon` too (`inPanelCss.js`), as do the theme's colours (`themeManager.js`) and inline colours (`elements.js`); a custom property inherits as the colour does. Material's empty `fill="none"` framing path renders correctly |
| A native field paints any background that is not opaque — `rgba(0,0,0,.22)` of the dark theme, `transparent` of fields drawn inside a frame — in **black**; an inline `!important` loses to a stylesheet `!important` | Black boxes: size field, searches of Settings and Help, style editor fields | `elements.js` composes, at run time, the field's translucent background over the backgrounds under it up to the first opaque one (as a browser shows it) and sets that colour inline; on render, focus changes and once a second (theme). The fields' background rules lose `!important` (`inPanelCss.js`) |
| A flex item does not shrink to its min-content width | The line arrows side by side instead of one above the other | `.preview-nav` is a column |
| `mouseout`/`mouseover` carry no `relatedTarget` (the `pointerout`/`pointerover` UXP sends just before them do): React takes every `mouseout` for the pointer leaving the window and fires `onMouseLeave` on every ancestor | Dragging a divider (text/styles, preview) stopped at once: the panel body ends the drag on `mouseleave`; hover states flickered | `elements.js` gives each `mouseout`/`mouseover`, in place, the `relatedTarget` of the pointer event of the same move, before React reads it. Nothing is dispatched again: **a synthetic event's dispatch is asynchronous in UXP and sometimes throws inside it** (`dispatchNativeEvent … reading 'detail'`, a first version that re-sent `mouseout` did that at every hover) |
| `window` gets a trusted `resize` at every layout change, the panel's size unchanged | During a divider's drag the blocks jumped back to their saved size at each hover (the application lays its blocks out again on `resize`) | Dropped while a mouse button is held. The others go through on purpose: UXP lays a page out after the script that changed it (a new element measures 0×0), and those events make the application measure again what it measured too early (dropping them all left the footer in its compact, labelless mode) |
| `click` goes to the element the button was released over, wherever it was pressed (a browser sends it to the nearest element holding both) | A divider dragged and released over a folder's title folded the folder; any drag ending on a button pressed it | `elements.js` retargets the `click` in place to the nearest common ancestor of the press and the release, before React reads it. A click that slides within a button stays a click on it |
| `<input>`, `<textarea>`, `<select>` are native fields, opaque, drawn above every element (windows included); they ignore `left`/`right` with `width: auto` | The script editor's transparent textarea hides the highlighted lines; fields of the panel show through windows | The editor shows its lines and opens a plain textarea over the visible sheet on click (`textBlock.jsx`, `IN_PANEL`), with its box set in pixels; `modal.jsx` sets `body.typer-modal-open` and the panel's own fields are hidden under a window |
| Hit testing goes to the sheet, not to the layers drawn over it | A click on the text did not start editing | The `mousedown` is listened to on the sheet itself |
| No CSSOM (`style.sheet` undefined) | `themeManager.addRule` threw at startup | Rules rewritten into the `<style>` text, one value per selector and property, only when it changes |
| No `MutationObserver`; `Range` without `selectNodeContents` | The bold/italic toolbar's position threw | Guarded; falls back to the selected span's box |
| No sibling combinator (`~`) | | Body class instead |
| React's development build cannot report component errors (its fake-event trick) | Only in dev builds | Test with `--mode=production --env dev` |
| **Crash:** an empty `<input type="number" class="topcoat-text-input--large" placeholder="…">` with the application's `::placeholder` rules brings Photoshop down a few seconds later (access violation `0xc0000005`, `dynamic-torqnative.dll+0x433f94`). Found by bisecting the style editor's leading field | Opening **Add style** killed Photoshop | `scripts/inPanelCss.js` drops every rule about placeholders from the in-panel stylesheet (only the hint text's colour is lost). Proven on the real stylesheet: same field, rules removed → no crash |

`scripts/legacyCss.js` (gaps for old Chromium) runs on the in-panel stylesheet too.

### What is different for the user in that mode

Everything works the same: script, lines, pages, styles, folders, Paste, Align, TextShapeR, smart
paste, settings, keyboard shortcuts (TypeR Shortcuts.exe; Settings > Debug shows the samples),
storage, reload. Differences:

- The script is edited in a plain field that opens on a click on the sheet (caret on the clicked
  line) and closes when it loses focus. The coloured lines are shown the rest of the time.
- Text fields, number fields and lists are Photoshop's native ones: the same colours, but UXP draws
  its own frame around every field (the size field next to Paste/Align shows one where the WebView
  shows none) and lists are a little taller.
- Some icons are their Remix equivalents. Placeholders keep their default colour.

The panel was compared with the WebView panel of a real Windows (same theme): buttons, icons,
arrows, line icons, style list, footer, settings match; the differences left are the ones above.

## Verified on the VM (release package `UXP-Windows.ccx`, the build that ships)

- Start with Photoshop: refusal in the log, switch to the panel about 2 s later, application ready.
- Script pasted with Ctrl+V into the editor, parsed (page markers, comment prefix, numbering),
  kept across a Photoshop restart.
- Line selected, **Paste** with a selection: `smartPaste` → `createTextLayerInSelection`, the text
  layer "And here is a second line of dialogue." created, TypeR moves to the next line.
- TextShapeR previews, tooltips, feature tips, Did-you-know notices.
- **Add style** (whole window, including the field that used to crash), **Settings** (all 9 tabs:
  themes, interface layout, sliders, toggles, Debug with the keyboard reader running), Close.
- `location.reload()` → host restarted → back in the panel with the same state.
- Dragging the divider between the script and the styles (300 px kept after a restart); style
  created in the editor and shown in its folder; side by side with the WebView panel of a real
  Windows.
- Development builds: dev channel `.update-test/dev-eval.ps1`, panel target included.

`npm test`: 81 suites, including `scripts/testUxpStartup.js` (log refusal → panel; 15 s without a
sign of life → panel; a refusal older than the WebView ignored; messages, requests run once,
replies, visibility; destroyed and recreated panel; a WebView that loaded keeps the notice; a late
report cannot replace a recovered WebView) and `scripts/testUxpInPanel.js` (log line times, refusal
detection, stylesheet rewrite including the placeholder rules, every stroke icon of `app_src`
replaced by an existing Remix icon).

## Not verified

- **macOS**: same UXP code and the same in-panel build in `TypeR-UXP.ccx`, but not run on a Mac.
  There, without the log reading, the switch happens at the 15 s deadline.
- The signed-in user whose identity arrives late: TypeR switches to the panel instead of waiting
  for a WebView that might come a few seconds later. It works, in the panel mode, for that session.
- Windows other than the ones the application opens in this check (font viewer, FontScanR, export,
  folder editor, update): they rendered as part of the same components, without crash, but were not
  each opened by hand. Any new crash found in UXP's DOM is handled like the placeholder one: bisect
  with CSS (`display: none`) in a development build, then reproduce with a single element.

## Fork integration

This fork uses the in-panel fallback only. It does not ship or automatically run the upstream DLL patch, request elevation for it, or modify Photoshop binaries. Kaspersky's File Monitoring report confirmed that it detected and deleted `repair_uxp_webview_win.ps1` as `HEUR:Trojan.PowerShell.Kryptik.gen` during integration on 2026-11-08. The heuristic detection does not establish that the script is malicious, but the blocked script is excluded from this build.

## Reproduce / investigate

The VM tooling used (`.update-test/dev-eval.ps1` runs code in the host or the panel of a development
build):

```powershell
# Development build with production React (React's dev build hides component errors in UXP)
npx webpack --config webpack.uxp.config.js --mode=production --env dev
node scripts/buildUxp.js --dev
# Mirror uxp\ over the installed plugin folder, restart Photoshop, then:
.\.update-test\dev-eval.ps1 -Id 1 -Target panel -Code "return document.documentElement.className"
# → "typer-uxp typer-inpanel" when TypeR runs without its WebView
```

The UXP log lines that tell the state of a session:

| Line | Meaning |
| --- | --- |
| `WebViewManager::createWebView() failed to create WebView because webViewDataStorage_ is not available` | No WebView storage (no Adobe user): every third-party WebView refused |
| `Failed to create WebView for plugin: com.scanr.typer` | No WebView2 runtime Photoshop can start |
| `WebView2BrowserVersion: …` then `createWebView() create new for thirdparty plugin` | WebViews work |
| `TypeR: no WebView (…), running in the panel itself` | TypeR switched, with the reason |
