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
const defaultKeys = defaultLocale.keys;
const localeNames = fs.readdirSync(path.resolve(rootDir, "locale"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

assert.deepStrictEqual([...defaultLocale.duplicates], [], `Duplicate default keys: ${[...defaultLocale.duplicates].join(", ")}`);

localeNames.forEach((localeName) => {
  const locale = readLocale(`locale/${localeName}/messages.properties`);
  const missing = [...defaultKeys].filter((key) => !locale.keys.has(key));
  const extra = [...locale.keys].filter((key) => !defaultKeys.has(key));
  const placeholderMismatches = [...defaultKeys].filter((key) => {
    if (!locale.keys.has(key)) return false;
    const expected = getPlaceholders(defaultLocale.values.get(key));
    const actual = getPlaceholders(locale.values.get(key));
    return expected.join("|") !== actual.join("|");
  });
  const invalidValues = [...locale.values]
    .filter(([, value]) => !value.trim() || value === "undefined")
    .map(([key]) => key);

  assert.deepStrictEqual([...locale.duplicates], [], `Duplicate ${localeName} keys: ${[...locale.duplicates].join(", ")}`);
  assert.deepStrictEqual(missing, [], `Missing ${localeName} keys: ${missing.join(", ")}`);
  assert.deepStrictEqual(extra, [], `Extra ${localeName} keys: ${extra.join(", ")}`);
  assert.deepStrictEqual(placeholderMismatches, [], `${localeName} placeholder mismatches: ${placeholderMismatches.join(", ")}`);
  assert.deepStrictEqual(invalidValues, [], `Invalid ${localeName} values: ${invalidValues.join(", ")}`);
});

console.log("locale key tests passed");
