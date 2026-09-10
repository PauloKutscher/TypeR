/*
 * ExtendScript never gives a closure back.
 *
 * Measured in Photoshop 2026 (scripts/lab/diagShaperDrift.jsx): a loop that
 * evaluates one function expression per iteration goes from 0.001 to 0.010 us
 * per iteration over 12,000 iterations and stays there, while the same loop
 * building a plain object is flat. $.gc() changes neither. So any function
 * expression on a path the panel walks on a timer leaks for the life of the
 * panel, and the leak is measured in whole seconds by the end of a shift.
 *
 * The path that mattered is the active layer's text: TextShapeR reads it on
 * every poll and every Photoshop event, and jamText.getLayerText() built one
 * closure per nested descriptor. On six manga pages the read went from 16 ms to
 * 192 ms over 48 page open/close cycles, climbing linearly with no plateau —
 * "TypeR starts fast and gets slower as you go through the pages, and it does
 * not happen with TextShapeR off". With both closures hoisted the same soak
 * measures 8 ms flat from the first cycle to the last.
 *
 * These are guards, not measurements: the two functions on that path must stay
 * free of run-time function expressions.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

// The body of a function, from its opening line to the first line that closes
// it at the same indentation. Good enough for jam's fixed formatting.
const bodyOf = (source, header, closer) => {
  const start = source.indexOf(header);
  assert.ok(start >= 0, `${header} must exist`);
  const end = source.indexOf(closer, start);
  assert.ok(end > start, `${header} must be closed by ${JSON.stringify(closer)}`);
  return source.slice(start, end);
};

const engine = read("app_src/lib/jam/jamEngine.jsxinc");
const text = read("app_src/lib/jam/jamText.jsxinc");

const simplifyDesc = bodyOf(engine, "function simplifyDesc (desc, hook)", "\n        }");
assert.ok(
  !/function\s*\(/.test(simplifyDesc),
  "simplifyDesc recurses once per nested descriptor: a function expression here " +
    "leaks hundreds of closures per read of a text layer:\n" + simplifyDesc
);
assert.ok(
  simplifyDesc.indexOf("hook (desc, key, simplifyDefaultValue)") >= 0,
  "the hook must still receive a getDefaultValue, from the shared module-level one"
);

// The shared one resolves the hook through the stack the public entry points
// keep, which is what preserves jam's documented reentrancy
assert.ok(
  /function simplifyDefaultValue \(desc, key\)[\s\S]{0,200}simplifyHooks\[simplifyHooks\.length - 1\]/.test(engine),
  "simplifyDefaultValue must read the innermost running hook"
);
["simplifyObject", "simplifyList"].forEach((name) => {
  const entry = bodyOf(engine, `jamEngine.${name} = function (`, "\n        };");
  assert.ok(
    entry.indexOf("simplifyHooks.push (hookFunction)") >= 0 && entry.indexOf("simplifyHooks.pop ()") >= 0,
    `jamEngine.${name} must push and pop its hook so nested walks resolve their own`
  );
  assert.ok(
    /finally\s*\{[\s\S]{0,120}simplifyHooks\.pop \(\)/.test(entry),
    `jamEngine.${name} must pop in a finally, or one throw unbalances every later walk`
  );
});

const fromLayerTextObject = bodyOf(text, "jamText.fromLayerTextObject = function (layerTextObject)", "\n        };")
  // its own header is the one function expression allowed here
  .split("\n").slice(1).join("\n");
assert.ok(
  !/function\s*\(/.test(fromLayerTextObject) && !/\bfunction\s+\w+\s*\(/.test(fromLayerTextObject),
  "fromLayerTextObject runs on the panel's poll: its units hook must stay hoisted:\n" + fromLayerTextObject
);
assert.ok(
  fromLayerTextObject.indexOf("jamEngine.simplifyObject (layerTextObject, getUnitsHook)") >= 0,
  "it must still pass the units hook, so typeUnit is still reported"
);
// Re-entered through fromPathComponentList when the text sits on a path
assert.ok(
  /saveTypeUnit = unitsHookTypeUnit[\s\S]{0,600}finally[\s\S]{0,200}unitsHookTypeUnit = saveTypeUnit/.test(fromLayerTextObject),
  "the hoisted units state must be saved and restored around the walk"
);

console.log("jam closure-leak guards passed");
