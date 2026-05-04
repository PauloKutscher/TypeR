const assert = require("assert");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");

const getPlaceholders = (value = "") => {
  const matches = value.match(/\{[^}]+\}/g);
  return matches ? [...new Set(matches)].sort() : [];
};

const readLocale = (relativePath) => {
  const filePath = path.resolve(rootDir, relativePath);
  const content = fs.readFileSync(filePath, "utf8");
  const keys = new Set();
  const duplicates = new Set();
  const values = new Map();

  content.split(/\r?\n/).forEach((line) => {
    if (!line || line.startsWith("#") || line.startsWith(" ")) return;
    const match = line.match(/^([^=]+)=/);
    if (match) {
      const key = match[1];
      if (keys.has(key)) duplicates.add(key);
      keys.add(key);
      values.set(key, line.slice(key.length + 1));
    }
  });

  return { keys, duplicates, values };
};

const defaultLocale = readLocale("locale/messages.properties");
const frenchLocale = readLocale("locale/fr_FR/messages.properties");
const defaultKeys = defaultLocale.keys;
const frenchKeys = frenchLocale.keys;

const missingFrench = [...defaultKeys].filter((key) => !frenchKeys.has(key));
const extraFrench = [...frenchKeys].filter((key) => !defaultKeys.has(key));
const placeholderMismatches = [...defaultKeys].filter((key) => {
  if (!frenchKeys.has(key)) return false;
  const defaultPlaceholders = getPlaceholders(defaultLocale.values.get(key));
  const frenchPlaceholders = getPlaceholders(frenchLocale.values.get(key));
  return defaultPlaceholders.join("|") !== frenchPlaceholders.join("|");
});

assert.deepStrictEqual([...defaultLocale.duplicates], [], `Duplicate default keys: ${[...defaultLocale.duplicates].join(", ")}`);
assert.deepStrictEqual([...frenchLocale.duplicates], [], `Duplicate fr_FR keys: ${[...frenchLocale.duplicates].join(", ")}`);
assert.deepStrictEqual(missingFrench, [], `Missing fr_FR keys: ${missingFrench.join(", ")}`);
assert.deepStrictEqual(extraFrench, [], `Extra fr_FR keys: ${extraFrench.join(", ")}`);
assert.deepStrictEqual(placeholderMismatches, [], `Locale placeholder mismatches: ${placeholderMismatches.join(", ")}`);

console.log("locale key tests passed");
