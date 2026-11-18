const fs = require("node:fs");
const path = require("node:path");

const [exchange, panelRoot, readingOrder, mode, forkRoot] = process.argv.slice(2);
const load = require(path.join(panelRoot, "scripts/helpers/loadAppModule.js"))();
const { planAlignment } = load("app_src/oneClick/alignPlan.js");
const forkPlan = forkRoot ? require(path.join(forkRoot, "scripts/helpers/loadAppModule.js"))()("app_src/oneClick/alignPlan.js").planAlignment : null;
const request = path.join(exchange, "align-request.json");
const response = path.join(exchange, "align-response.json");
const temporary = response + ".tmp";

setInterval(() => {
  if (!fs.existsSync(request)) return;
  let result;
  try {
    const capture = JSON.parse(fs.readFileSync(request, "utf8").replace(/^\uFEFF/, ""));
    const plans = mode === "product" ? planAlignment(capture, readingOrder) : planAlignment(capture, readingOrder, mode === "optical");
    let placements = mode === "single" ? plans.filter(({ id }) => {
      const bubbles = capture.bubbles.filter(bubble => bubble.textIds.some(textId => String(textId) === String(id)));
      return bubbles.length === 1 && bubbles[0].textIds.length === 1;
    }) : plans;
    if (mode === "guarded") {
      if (!forkPlan) throw new Error("Guarded comparison requires a fork planner");
      placements = forkPlan(capture, readingOrder).map(original => {
        const alternative = plans.find(plan => plan.id === original.id);
        if (!alternative) return original;
        const a = original.rect;
        const b = alternative.rect;
        const maxShift = Math.min(a.right - a.left, a.bottom - a.top) * 0.05;
        const shift = Math.hypot(a.xMid - b.xMid, a.yMid - b.yMid);
        if (shift > maxShift || b.xMid < a.left || b.xMid > a.right || b.yMid < a.top || b.yMid > a.bottom) return original;
        return { ...original, rect: { ...a, xMid: (a.xMid + b.xMid) / 2, yMid: (a.yMid + b.yMid) / 2 } };
      });
    }
    result = { placements };
  } catch (error) {
    result = { error: error.message };
  }
  fs.unlinkSync(request);
  fs.writeFileSync(temporary, JSON.stringify(result));
  fs.renameSync(temporary, response);
}, 20);
