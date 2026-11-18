// Run ALL test suites independently, so an upstream-only centering expectation
// does not mask unrelated integration regressions. Never suppress failures.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const suites = fs.readdirSync(__dirname)
  .filter(name => /^test.*\.js$/.test(name) && !["testBuildArtifacts.js", "testTask33.js"].includes(name))
  .sort();
const results = [];
for (const suite of suites) {
  const run = spawnSync(process.execPath, [path.join(__dirname, suite)], {
    cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024,
  });
  const passed = run.status === 0 && !run.error;
  results.push({
    suite, passed, exitCode: run.status, error: run.error && String(run.error),
    stdoutTail: (run.stdout || "").slice(-1500),
    stderrTail: (run.stderr || "").slice(-2500),
  });
  console.log((passed ? "PASS " : "FAIL ") + suite);
  if (!passed) {
    console.log((run.stdout || "").slice(-1200));
    console.error((run.stderr || "").slice(-2000));
  }
}
const output = path.join(root, ".native-build", "integration-audit.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({
  branch: process.env.GITHUB_REF_NAME || null,
  note: "Unit tests only. A passing report is not Photoshop/CEP/UXP runtime validation.",
  platform: process.platform, node: process.version,
  passed: results.filter(r => r.passed).length,
  failed: results.filter(r => !r.passed).length,
  results,
}, null, 2));
console.log("Integration audit:", results.filter(r => r.passed).length, "passed,",
  results.filter(r => !r.passed).length, "failed. Details:", output);
if (results.some(r => !r.passed)) process.exitCode = 1;
