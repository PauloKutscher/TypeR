const assert = require("assert");
const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const hostSource = fs.readFileSync(path.join(rootDir, "app_src", "host.js"), "utf8");
const utilsSource = fs.readFileSync(path.join(rootDir, "app_src", "utils.js"), "utf8");
const previewSource = fs.readFileSync(
  path.join(rootDir, "app_src", "components", "previewBlock", "previewBlock.jsx"),
  "utf8"
);

// --- host: "no selection" must be its own state, not the ambiguous noChange ---

const clearedHelperMatch = hostSource.match(
  /function _selectionClearedResult\(monitor, shiftPressed\) \{([\s\S]*?)\r?\n\}/
);
assert.ok(clearedHelperMatch, "Host must report the cleared selection state");
const clearedHelperBody = clearedHelperMatch[1];
assert.ok(/monitor\.lastBounds = null/.test(clearedHelperBody), "Clearing must forget the last bounds");
assert.ok(/monitor\.lastBoundsKey = null/.test(clearedHelperBody), "Clearing must forget the last bounds key");
assert.ok(/monitor\.multiWarnBounds = null/.test(clearedHelperBody), "Clearing must forget the Shift warning bounds");
assert.ok(/cleared: true/.test(clearedHelperBody), "Cleared selections must be flagged for the panel");

const getSelectionChangedSource = hostSource.match(
  /function getSelectionChanged\(\) \{[\s\S]*?\n\}/
)[0];
assert.strictEqual(
  (getSelectionChangedSource.match(/_selectionClearedResult\(monitor, shiftPressed\)/g) || []).length,
  2,
  "Both empty-selection exits must report the cleared state"
);
assert.ok(
  /if \(isSame && !shiftPressed\) \{\s*return jamJSON\.stringify\(\{ noChange: true/.test(getSelectionChangedSource),
  "An unchanged selection must still report noChange, never cleared"
);

// --- utils: the cleared state reaches the panel, our own deselects do not ---

const bridgeSource = utilsSource.match(
  /let selectionResultsSuppressedUntil = 0;[\s\S]*?const getSelectionChanged = \(callback = \(\) => \{\}\) => \{[\s\S]*?\n\};/
);
assert.ok(bridgeSource, "Selection bridge must be extractable from utils.js");

const queue = [];
const fakeCsInterface = {
  evalScript: (script, callback = () => {}) => {
    if (script.indexOf("deselectDocumentSelection") === 0) return callback("");
    callback(JSON.stringify(queue.shift() || { error: true }));
  },
};
const bridge = new Function(
  "csInterface",
  "safeJsonParse",
  "trackHostAction",
  `${bridgeSource[0]}\nreturn { getSelectionChanged, deselectDocument };`
)(fakeCsInterface, JSON.parse, (fn) => fn);

const A = { multiSelection: [{ left: 0, top: 0, right: 100, bottom: 50, width: 100, height: 50 }], width: 100 };
const B = { multiSelection: [{ left: 200, top: 0, right: 300, bottom: 50, width: 100, height: 50 }], width: 100 };
const CLEARED = { cleared: true, shiftKey: false };

const poll = (payload) => {
  queue.push(payload);
  let received;
  bridge.getSelectionChanged((selection) => {
    received = selection;
  });
  return received;
};
const isCleared = (result) => !!(result && result.cleared);

// Cases 1-3: selections keep flowing, a real deselect reports the reset, and
// the next selection is reported again
assert.ok(poll(A), "First selection must be reported");
assert.ok(poll(B), "Second selection must be reported");
assert.ok(isCleared(poll(CLEARED)), "A user deselect must be reported as cleared");
assert.ok(poll(A) && !isCleared(poll(B)), "Selections after a reset must be reported normally");

// Case 4: no reset while selections keep coming
assert.ok(![A, B, A].some((payload) => isCleared(poll(payload))), "Changing selection must never report cleared");
assert.strictEqual(poll({ noChange: true }), null, "An unchanged selection must not report cleared");
assert.strictEqual(poll({ error: true }), null, "Host errors must not report cleared");

// Panel-initiated deselect (clear button, remove-last, paste): the empty
// document is ours, so it must stay silent until a real selection returns
poll(A);
bridge.deselectDocument();
assert.strictEqual(poll(CLEARED), null, "Our own deselect must not reset the stored selections");
assert.strictEqual(poll(CLEARED), null, "The guard must hold for every later poll too");
assert.ok(poll(B), "A new selection must be reported after our own deselect");
assert.ok(isCleared(poll(CLEARED)), "The guard must disarm once a real selection appears");

// --- panel: the cleared state empties the stored selections ---

const handlerSource = previewSource.match(
  /getSelectionChanged\(\(selection\) => \{[\s\S]*?\n {4}\}\);/
)[0];
const clearedBranch = handlerSource.match(/if \(selection\.cleared\) \{[\s\S]*?\n {8}\}/);
assert.ok(clearedBranch, "The panel must handle the cleared selection state");
assert.ok(
  /type: "clearSelections"/.test(clearedBranch[0]),
  "A cleared selection must reset the multi-bubble selections"
);
assert.ok(
  !/deselectDocument/.test(clearedBranch[0]),
  "The auto reset must not deselect again: the document is already empty"
);
assert.ok(
  /storedSelections \|\| \[\]\)\.length > 0/.test(clearedBranch[0]),
  "The reset must only dispatch when there is something stored"
);

console.log("multi-bubble auto reset tests passed");
