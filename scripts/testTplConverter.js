const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const babel = require("@babel/core");

const loadAppModule = (relativePath) => {
  const filePath = path.resolve(__dirname, relativePath);
  const source = fs.readFileSync(filePath, "utf8");
  const { code } = babel.transformSync(source, {
    filename: filePath,
    babelrc: false,
    configFile: false,
    plugins: ["@babel/plugin-transform-modules-commonjs"],
  });
  const mod = new Module(filePath, module);
  mod.filename = filePath;
  mod.paths = Module._nodeModulePaths(path.dirname(filePath));
  mod._compile(code, filePath);
  return mod.exports;
};

const { convertTplHexToTypeRFormat, parseTplHex } = loadAppModule("../app_src/tplConverter.js");

const ascii = (value) => Buffer.from(value, "ascii");
const u8 = (value) => Buffer.from([value & 0xff]);
const u32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
};
const i32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value);
  return buffer;
};
const double = (value) => {
  const buffer = Buffer.alloc(8);
  buffer.writeDoubleBE(value);
  return buffer;
};
const unicode = (value) => {
  const buffer = Buffer.alloc((value.length + 1) * 2);
  for (let index = 0; index < value.length; index++) buffer.writeUInt16BE(value.charCodeAt(index), index * 2);
  return Buffer.concat([u32(value.length + 1), buffer]);
};
const id = (value) => value.length === 4
  ? Buffer.concat([u32(0), ascii(value)])
  : Buffer.concat([u32(value.length), ascii(value)]);

const typed = (type, value) => Buffer.concat([ascii(type), value]);
const text = (value) => typed("TEXT", unicode(value));
const unit = (unitId, value) => typed("UntF", Buffer.concat([ascii(unitId), double(value)]));
const enumerated = (typeId, valueId) => typed("enum", Buffer.concat([id(typeId), id(valueId)]));
const integer = (value) => typed("long", i32(value));
const boolean = (value) => typed("bool", u8(value ? 1 : 0));
const number = (value) => typed("doub", double(value));
const descriptor = (classId, properties) => Buffer.concat([
  unicode(""),
  id(classId),
  u32(properties.length),
  ...properties.map(([key, value]) => Buffer.concat([id(key), value])),
]);
const object = (classId, properties) => typed("Objc", descriptor(classId, properties));

const tool = (name, type, properties) => Buffer.concat([
  unicode(name),
  Buffer.alloc(10),
  id(type),
  u32(properties.length),
  ...properties.map(([key, value]) => Buffer.concat([id(key), value])),
]);

const tpl = (...tools) => Buffer.concat([
  ascii("8BTP"),
  Buffer.alloc(8),
  ascii("8BIM"),
  Buffer.alloc(4),
  ascii("8BIMtptp"),
  Buffer.alloc(8),
  ...tools,
]);

const textStyleProperties = [
  ["fontPostScriptName", text("CafeNihon-Bold")],
  ["FntN", text("Écriture 日本")],
  ["FntS", text("Gras")],
  ["Sz  ", unit("#Pnt", 37.5)],
  ["HrzS", number(92)],
  ["VrtS", number(108)],
  ["Trck", integer(125)],
  ["Bsln", unit("#Pnt", 2.25)],
  ["AtKr", enumerated("AtKr", "opticalKern")],
  ["textLanguage", enumerated("textLanguage", "frenchLanguage")],
  ["Clr ", object("RGBC", [["Rd  ", number(12)], ["Grn ", number(34)], ["Bl  ", number(56)]])],
  ["strokeColor", object("RGBC", [["Rd  ", number(78)], ["Grn ", number(90)], ["Bl  ", number(123)]])],
  ["Strk", boolean(true)],
  ["lineWidth", unit("#Pnt", 3)],
  ["AntA", integer(4)],
];

const textPreset = tool("$$$/Presets/Text=Café 日本 😀", "typeCreateOrEditTool", [
  ["textToolParagraphOptions", object("textToolParagraphOptions", [
    ["paragraphStyle", object("paragraphStyle", [
      ["Algn", enumerated("Alg ", "Rght")],
      ["firstLineIndent", unit("#Pnt", 4)],
      ["autoLeadingPercentage", number(1.35)],
    ])],
    ["Ornt", enumerated("Ornt", "Vrtc")],
  ])],
  ["textToolCharacterOptions", object("textToolCharacterOptions", [
    ["TxtS", object("TxtS", textStyleProperties)],
    ["textGridding", enumerated("textGridding", "None")],
  ])],
]);

const fixture = tpl(textPreset);
const parsed = parseTplHex(fixture.toString("hex"));
assert.strictEqual(parsed.length, 1);
assert.strictEqual(parsed[0].name, "$$$/Presets/Text=Café 日本 😀");
assert.strictEqual(parsed[0].properties.textToolCharacterOptions.TxtS.FntN, "Écriture 日本");

const converted = convertTplHexToTypeRFormat(fixture.toString("hex"), "Styles internationaux.tpl");
assert.strictEqual(converted.folders[0].name, "Styles internationaux");
assert.strictEqual(converted.styles.length, 1);
assert.strictEqual(converted.styles[0].name, "Café 日本 😀");

const style = converted.styles[0];
const character = style.textProps.layerText.textStyleRange[0].textStyle;
const paragraph = style.textProps.layerText.paragraphStyleRange[0].paragraphStyle;
assert.strictEqual(character.fontPostScriptName, "CafeNihon-Bold");
assert.strictEqual(character.fontName, "Écriture 日本");
assert.strictEqual(character.fontStyleName, "Gras");
assert.strictEqual(character.size, 37.5);
assert.strictEqual(character.impliedFontSize, 37.5);
assert.strictEqual(character.horizontalScale, 92);
assert.strictEqual(character.verticalScale, 108);
assert.strictEqual(character.tracking, 125);
assert.strictEqual(character.baselineShift, 2.25);
assert.strictEqual(character.autoKern, "opticalKern");
assert.strictEqual(character.textLanguage, "frenchLanguage");
assert.deepStrictEqual(character.color, { red: 12, green: 34, blue: 56 });
assert.deepStrictEqual(character.strokeColor, { red: 78, green: 90, blue: 123 });
assert.strictEqual(character.stroke, true);
assert.strictEqual(character.lineWidth, 3);
assert.strictEqual(paragraph.alignment, "right");
assert.strictEqual(paragraph.firstLineIndent, 4);
assert.strictEqual(paragraph.autoLeadingPercentage, 1.35);
assert.strictEqual(style.textProps.layerText.orientation, "vertical");
assert.strictEqual(style.textProps.layerText.antiAlias, "antiAliasSmooth");
assert.strictEqual(style.textProps.typeUnit, "pointsUnit");
assert.deepStrictEqual(style.stroke, {
  enabled: false,
  size: 0,
  opacity: 100,
  position: "outer",
  color: { r: 255, g: 255, b: 255 },
});

assert.throws(
  () => parseTplHex(Buffer.from("not a tpl").toString("hex")),
  (error) => error.code === "TPL_INVALID_FILE"
);

const brushPreset = tool("Brush", "paintbrushTool", []);
assert.throws(
  () => convertTplHexToTypeRFormat(tpl(brushPreset).toString("hex"), "Brushes.tpl"),
  (error) => error.code === "TPL_NO_TEXT_PRESETS"
);

console.log("TPL converter tests passed");
