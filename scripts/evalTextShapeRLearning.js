// Offline evaluation harness for the TextShapeR learning algorithm.
// Simulates a typesetter with a fixed style (an oracle that always keeps the
// same kind of shape), trains a tuning through repeated feedback on training
// texts, then measures on held-out texts how high the oracle's favourite
// shape ranks in the suggestions. Lower mean rank and higher top-1 hit rate
// mean the learning generalizes better. Run with a git ref as argument to
// evaluate that revision's algorithm instead of the working tree:
//   node scripts/evalTextShapeRLearning.js            (working tree)
//   node scripts/evalTextShapeRLearning.js develop    (committed baseline)
const path = require("path");
const fs = require("fs");
const Module = require("module");
const { execSync } = require("child_process");
process.env.BROWSERSLIST_IGNORE_OLD_DATA = "1";
const babel = require("@babel/core");

const rootDir = path.resolve(__dirname, "..");
const gitRef = process.argv[2] && process.argv[2] !== "wt" ? process.argv[2] : null;

const loadTextShapeR = () => {
  const fp = path.resolve(rootDir, "app_src/textShapeR.js");
  const src = gitRef
    ? execSync(`git show ${gitRef}:app_src/textShapeR.js`, { cwd: rootDir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
    : fs.readFileSync(fp, "utf8");
  const { code } = babel.transformSync(src, {
    filename: fp, babelrc: false, configFile: false,
    plugins: [
      "@babel/plugin-transform-modules-commonjs",
      "@babel/plugin-proposal-optional-chaining",
      "@babel/plugin-proposal-class-properties",
    ],
  });
  const m = new Module(fp, module);
  m.filename = fp;
  m.paths = Module._nodeModulePaths(path.dirname(fp));
  m._compile(code, fp);
  return m.exports;
};

const api = loadTextShapeR();
const { generateTextShapeRVariants, recordTextShapeRFeedback, setTextShapeRTuning, visibleWidth } = api;

// Simulated typesetter personas: each oracle scores every variant the way
// that user would, and always keeps its favourite. "tall" wants compact
// stacks (low density per line), hyphen-free, round edges; "wide" wants
// few long lines and tolerates césures.
const PERSONAS = {
  tall: (variant) => {
    const widths = variant.lines.map(visibleWidth);
    const total = widths.reduce((a, b) => a + b, 0);
    const density = total / widths.length;
    let score = Math.abs(density - 11) * 3;
    score += variant.hyphenCount * 25;
    const peak = Math.max(...widths);
    if (widths.length >= 3) {
      score += (widths[0] / peak) * 8 + (widths[widths.length - 1] / peak) * 8;
    }
    return score;
  },
  wide: (variant) => {
    const widths = variant.lines.map(visibleWidth);
    const total = widths.reduce((a, b) => a + b, 0);
    const density = total / widths.length;
    let score = Math.abs(density - 24) * 3;
    score -= variant.hyphenCount * 4;
    return score;
  },
};
const personaName = process.argv[3] || "tall";
const oracleScore = PERSONAS[personaName];

const TRAIN_TEXTS = [
  "Je crois que nous devrions vraiment partir avant que la nuit tombe sur la ville.",
  "Il faudra bien finir par leur dire ce qui est arrivé cette nuit-là dans la forêt.",
  "On ne peut pas rester ici toute la nuit sans savoir ce qui nous attend dehors.",
  "Tu devrais lui parler avant qu'il ne soit trop tard pour changer d'avis.",
  "Personne n'avait remarqué la porte entrouverte au fond du couloir sombre.",
  "Quand le soleil se couche derrière les collines, tout le village retient son souffle.",
  "Elle avait promis de revenir avant la fin de l'été, mais personne ne l'a revue.",
  "Les rues étaient désertes et seul le bruit de nos pas résonnait entre les murs.",
  "Je ne comprends pas pourquoi tu refuses toujours de me dire la vérité en face.",
  "Le vieux marchand souriait en regardant les enfants courir sur la place du marché.",
];

const TEST_TEXTS = [
  "Nous avons cherché partout mais la clé du grenier reste introuvable depuis hier.",
  "Si tu savais tout ce que j'ai dû abandonner pour arriver jusqu'ici ce soir.",
  "La lettre était posée sur la table comme si quelqu'un venait de la déposer.",
  "Il paraît que la maison au bout du chemin est restée vide pendant vingt ans.",
  "Chaque matin elle ouvrait la fenêtre pour écouter le chant des oiseaux du parc.",
  "Un jour tu comprendras pourquoi j'ai gardé ce secret pendant toutes ces années.",
];

const OPTIONS = { limit: 12, profile: "balanced", allowHyphenation: true };

const evaluate = (tuning) => {
  setTextShapeRTuning(tuning);
  let rankSum = 0;
  let top1 = 0;
  let regretSum = 0;
  TEST_TEXTS.forEach((text) => {
    const variants = generateTextShapeRVariants(text, OPTIONS);
    let bestIndex = 0;
    let bestScore = Infinity;
    variants.forEach((variant, index) => {
      const score = oracleScore(variant);
      if (score < bestScore) { bestScore = score; bestIndex = index; }
    });
    rankSum += bestIndex + 1;
    if (bestIndex === 0) top1++;
    // Regret: how much worse (in the user's own terms) the #1 suggestion is
    // than the best shape anywhere in the list — the cost of trusting the top
    regretSum += oracleScore(variants[0]) - bestScore;
  });
  return {
    meanRank: rankSum / TEST_TEXTS.length,
    top1Rate: top1 / TEST_TEXTS.length,
    regret: regretSum / TEST_TEXTS.length,
  };
};

const before = evaluate(null);

let tuning = null;
TRAIN_TEXTS.forEach((text) => {
  setTextShapeRTuning(tuning);
  const variants = generateTextShapeRVariants(text, OPTIONS);
  let favourite = variants[0];
  let bestScore = Infinity;
  variants.forEach((variant) => {
    const score = oracleScore(variant);
    if (score < bestScore) { bestScore = score; favourite = variant; }
  });
  const result = recordTextShapeRFeedback(favourite.text, OPTIONS, tuning);
  if (result) tuning = result.tuning;
});

const after = evaluate(tuning);
setTextShapeRTuning(null);

const label = `[${gitRef || "working tree"} / ${personaName}]`;
console.log(`${label} untrained: meanRank=${before.meanRank.toFixed(2)} top1=${(before.top1Rate * 100).toFixed(0)}% regret=${before.regret.toFixed(1)}`);
console.log(`${label} trained:   meanRank=${after.meanRank.toFixed(2)} top1=${(after.top1Rate * 100).toFixed(0)}% regret=${after.regret.toFixed(1)}`);
if (tuning && tuning.pairAccuracy != null) {
  console.log(`${label} pairAccuracy=${tuning.pairAccuracy} consistency=${tuning.style && tuning.style.consistency != null ? tuning.style.consistency.toFixed(2) : "n/a"}`);
}
