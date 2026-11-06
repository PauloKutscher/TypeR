const assert = require('assert');
const path = require('path');
const configure = require('../webpack.uxp.config');

const usesAddon = env => configure(env, { mode: 'production' })[0].plugins.some(plugin =>
  plugin.resourceRegExp && plugin.resourceRegExp.test('./keysHelper') &&
  plugin.newResource === path.resolve(__dirname, '../uxp-src/host/keysAddon.js'));

for (const mode of [{}, { dev: true }, { trace: true }, { diagnostic: true }, { hostTest: true }, { addon: true }]) {
  assert(usesAddon(mode), 'Every Windows build must load the native addon: ' + JSON.stringify(mode));
}
for (const mode of [{ mac: true }, { mac: true, dev: true }, { mac: true, hostTest: true }]) {
  assert.strictEqual(usesAddon(mode), false, 'macOS keeps its own reader');
}
console.log('UXP keyboard builds: native Windows addon in release, dev, trace and diagnostic; macOS unchanged');
