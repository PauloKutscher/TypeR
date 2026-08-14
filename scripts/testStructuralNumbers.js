const assert = require("assert");
const path = require("path");
const { loadAppModule } = require("./loadAppModule");

const { convertDomToMarkdownDetailed } = loadAppModule(
  path.resolve(__dirname, "../app_src/markdownConvert.js")
);
const { analyzeStructuralNumbers } = loadAppModule(
  path.resolve(__dirname, "../app_src/structuralNumbers.js")
);

// --- tiny hand-rolled DOM node builders (no jsdom/DOMParser needed in Node) ---
const tx = (value) => ({ nodeType: 3, nodeValue: value });
const el = (tag, style, children = []) => ({
  nodeType: 1,
  tagName: tag,
  getAttribute: (name) => (name === "style" ? style || null : null),
  childNodes: children,
});

const run = (nodes) => {
  const { lines } = convertDomToMarkdownDetailed(nodes);
  const analysis = analyzeStructuralNumbers(lines);
  return { analysis, kept: analysis.keep.map((line) => line.text) };
};

// Spacer cell shape seen in the real paste: a cell holding only newlines.
const spacer = () => el("td", null, [tx("\n\n")]);
const cell = (text) => el("td", null, [tx(text)]);

// 1. The reported real-world shape: sibling <td>s, each holding
// "dialogue\nnumber". The trailing numbers are the auxiliary numbering and
// must go; the dialogue and the "Pg43" marker must stay.
{
  const { analysis, kept } = run([
    cell("Pg43\n1"),
    spacer(),
    cell("Oh, the clock's fixed.\n1"),
    spacer(),
    cell("TK TK\n2"),
    spacer(),
    cell("Ever since he came here, stuff started working again.\n2"),
    spacer(),
    cell("TK TK\n2"),
    spacer(),
    cell("Even though it never budged after I replaced the batteries...\n3"),
    spacer(),
    cell("Jimmy, I brought some food.\n4"),
    spacer(),
    cell("Jimmy?\n5"),
  ]);
  assert.deepStrictEqual(kept, [
    "Pg43",
    "Oh, the clock's fixed.",
    "TK TK",
    "Ever since he came here, stuff started working again.",
    "TK TK",
    "Even though it never budged after I replaced the batteries...",
    "Jimmy, I brought some food.",
    "Jimmy?",
  ]);
  assert.strictEqual(analysis.dropped, 8);
  const marker = analysis.report.find((entry) => entry.text === "Pg43");
  assert.strictEqual(marker.action, "page");
  assert.strictEqual(marker.page, 43);
  assert.ok(analysis.report.some((entry) => entry.action === "drop" && /counter/.test(entry.reason)));
}

// 2. A real <tr>/<td> grid whose first column is nothing but numbers: the
// whole column is metadata and goes, the dialogue column stays.
{
  const row = (num, text) => el("tr", null, [cell(num), cell(text)]);
  const { kept } = run([
    el("table", null, [
      row("1", "Page 43"),
      row("2", "Final Chapter"),
      row("3", "Graduation Ceremony"),
      row("4", "Tsukiya Noah!"),
      row("5", "Here!"),
    ]),
  ]);
  assert.deepStrictEqual(kept, [
    "Page 43",
    "Final Chapter",
    "Graduation Ceremony",
    "Tsukiya Noah!",
    "Here!",
  ]);
}

// 3. Lines that are only a number but sit in single-line cells are real
// dialogue: no rule may claim them.
{
  const { analysis, kept } = run([
    cell("Page 25"),
    cell("1"),
    cell("2"),
    cell("100"),
    cell("2026"),
    cell("Here!"),
  ]);
  assert.deepStrictEqual(kept, ["Page 25", "1", "2", "100", "2026", "Here!"]);
  assert.strictEqual(analysis.dropped, 0);
  const one = analysis.report.find((entry) => entry.text === "1");
  assert.strictEqual(one.action, "keep");
  assert.ok(/no counter claims it/.test(one.reason));
}

// 4. Only two numbers is not a counter, whatever they look like.
{
  const { kept } = run([
    cell("Page 25"),
    cell("1"),
    cell("Hello"),
    cell("2"),
    cell("How are you?"),
  ]);
  assert.deepStrictEqual(kept, ["Page 25", "1", "Hello", "2", "How are you?"]);
}

// 5. A lone number after real dialogue is a line of dialogue.
{
  const { kept } = run([cell("Pg25"), cell("Hello"), cell("1"), cell("Here!")]);
  assert.deepStrictEqual(kept, ["Pg25", "Hello", "1", "Here!"]);
}

// 6. Trailing numbers that don't behave like a counter are content, not
// metadata: the sequence guard blocks the rule.
{
  const { analysis, kept } = run([
    cell("How many?\n5"),
    cell("And then?\n2"),
    cell("Finally\n9"),
    cell("Yes\n1"),
  ]);
  assert.deepStrictEqual(kept, ["How many?", "5", "And then?", "2", "Finally", "9", "Yes", "1"]);
  assert.strictEqual(analysis.dropped, 0);
}

// 7. Two multi-line cells are not enough evidence.
{
  const { kept } = run([cell("Hello\n1"), cell("World\n2")]);
  assert.deepStrictEqual(kept, ["Hello", "1", "World", "2"]);
}

// 8. The reported Jagdpanther page: the numbers arrive as sibling lines
// interleaved with the dialogue, with no cell shape to key off. The counter
// itself is the evidence.
{
  const source = [
    "Page 10", "1",
    "At first, I was planning to build a regular tank, but then...", "2",
    "The Jagdpanther crossed my mind.", "3",
    "Chatter x3", "4",
    "...Uh, right.", "5",
    "It kinda looks like a military version of a fire truck.", "6",
    "What's that long-barrel anti-aircraft flak gun designed to take on anyway?", "7",
    "It's not like it can track enemies, right?", "8",
    "Ha ha ha!", "9",
    "But seriously, if something like this spreads across the world...", "10",
    "Then you're my accomplice.", "11",
    "Why would I be one...?", "12",
    "...So, who exactly are you planning to go to war with?",
  ];
  const { analysis, kept } = run(source.map((text) => cell(text)));
  assert.strictEqual(analysis.dropped, 12);
  assert.deepStrictEqual(kept, source.filter((text) => !/^[0-9]+$/.test(text)));
}

// 9. No cell structure at all (plain-text paste): there is no evidence to go
// on, and a lone number is dialogue. Nothing is ever dropped.
{
  const asLines = (texts) =>
    texts.map((text) => ({ text, cellId: null, colIndex: null, rowId: null, posInCell: 0, cellLineCount: 1 }));
  const analysis = analyzeStructuralNumbers(asLines(["Page 43", "1", "Hello", "2", "World", "3", "Bye"]));
  assert.strictEqual(analysis.dropped, 0);
  assert.deepStrictEqual(analysis.keep.map((line) => line.text), [
    "Page 43",
    "1",
    "Hello",
    "2",
    "World",
    "3",
    "Bye",
  ]);
}

// 10. A counter spread thin across a wall of dialogue is not a numbering
// column — the distance guard blocks it.
{
  const { analysis } = run([
    cell("1"),
    cell("a"), cell("b"), cell("c"), cell("d"), cell("e"), cell("f"),
    cell("2"),
    cell("g"), cell("h"), cell("i"), cell("j"), cell("k"), cell("l"),
    cell("3"),
  ]);
  assert.strictEqual(analysis.dropped, 0);
}

// 11. Two pages pasted together: the numbering restarts at each page, so
// "…12, 13, 1, 2…" is two counters, not one broken one. Both must go.
{
  const page = (marker, count, prefix) => {
    const out = [marker];
    for (let i = 1; i <= count; i += 1) {
      out.push(String(i));
      out.push(`${prefix} line ${i}`);
    }
    return out;
  };
  const source = page("Page 10", 13, "Ten").concat(page("Page 11", 6, "Eleven"));
  const { analysis, kept } = run(source.map((text) => cell(text)));
  assert.strictEqual(analysis.dropped, 19);
  assert.deepStrictEqual(kept, source.filter((text) => !/^[0-9]+$/.test(text)));
  assert.strictEqual(analysis.checks.filter((check) => /^counter /.test(check)).length, 2);
}

// 12. A stray number outside every counter is kept, while the counters go.
{
  const source = [
    "Page 1", "1", "a", "2", "b", "3", "c",
    "2026",
    "Page 2", "1", "d", "2", "e", "3", "f",
  ];
  const { analysis, kept } = run(source.map((text) => cell(text)));
  assert.strictEqual(analysis.dropped, 6);
  assert.ok(kept.includes("2026"));
  const stray = analysis.report.find((entry) => entry.text === "2026");
  assert.strictEqual(stray.action, "keep");
}

// 13. The reported shape verbatim: a real grid where col 0 holds the
// numbering (with "Page N" sharing the first cell) and col 2 holds the
// dialogue. A line of dialogue that is itself the number "6" sits in col 2 and
// must survive, even though col 0 shows "6" on the row before it.
{
  const row = (a, b) => el("tr", null, [cell(a), cell(""), cell(b)]);
  const { analysis, kept } = run([
    el("table", null, [
      el("tr", null, [el("td", null, [tx("Page 10\n1")]), cell(""), cell("Did you get that from Duke Delsasis?")]),
      row("2", "As you know, the Beastfolk have already begun their invasion..."),
      row("3", "With the Isaras Kingdom joining in, the X-day is around the corner."),
      row("4", "Plus, other small neighboring countries look ready to move."),
      row("5", "Did you get that information from a reliable source?"),
      row("6", "6"),
      row("7", "Have you read today's paper?"),
    ]),
  ]);
  assert.deepStrictEqual(kept, [
    "Page 10",
    "Did you get that from Duke Delsasis?",
    "As you know, the Beastfolk have already begun their invasion...",
    "With the Isaras Kingdom joining in, the X-day is around the corner.",
    "Plus, other small neighboring countries look ready to move.",
    "Did you get that information from a reliable source?",
    "6",
    "Have you read today's paper?",
  ]);
  assert.strictEqual(analysis.dropped, 7);
  const survivor = analysis.report.filter((entry) => entry.text === "6").find((entry) => entry.action === "keep");
  assert.ok(/outside the numbering column/.test(survivor.reason));
  assert.ok(analysis.checks.some((check) => /^numbering column: col 0/.test(check)));
}

// 14. The column is evidence on its own: a numbering column that isn't in
// order is still a numbering column.
{
  const row = (a, b) => el("tr", null, [cell(a), cell(b)]);
  const { kept } = run([
    el("table", null, [row("3", "Hello"), row("1", "World"), row("7", "Bye"), row("2", "Again")]),
  ]);
  assert.deepStrictEqual(kept, ["Hello", "World", "Bye", "Again"]);
}

// 15. Empty / malformed input doesn't throw.
assert.strictEqual(analyzeStructuralNumbers([]).dropped, 0);
assert.strictEqual(analyzeStructuralNumbers(null).keep.length, 0);

console.log("testStructuralNumbers: all assertions passed");
