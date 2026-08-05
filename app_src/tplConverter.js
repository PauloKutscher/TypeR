const TPL_HEADER = "8BTP";
const PHOTOSHOP_SIGNATURE = "8BIM";
const TOOL_DATA_SIGNATURE_HEX = "3842494d74707470"; // 8BIMtptp

class TplParseError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "TplParseError";
    this.code = code;
  }
}

class HexReader {
  constructor(hex, offset = 0) {
    this.hex = hex;
    this.offset = offset;
    this.length = hex.length / 2;
  }

  remaining() {
    return this.length - this.offset;
  }

  ensure(byteCount) {
    if (!Number.isInteger(byteCount) || byteCount < 0 || this.offset + byteCount > this.length) {
      throw new TplParseError("TPL_TRUNCATED_DATA", `Unexpected end of TPL data at byte ${this.offset}.`);
    }
  }

  skip(byteCount) {
    this.ensure(byteCount);
    this.offset += byteCount;
  }

  readUint8() {
    this.ensure(1);
    const value = parseInt(this.hex.slice(this.offset * 2, this.offset * 2 + 2), 16);
    this.offset += 1;
    return value;
  }

  readUint16() {
    return this.readUint8() * 0x100 + this.readUint8();
  }

  readUint32() {
    return this.readUint8() * 0x1000000
      + this.readUint8() * 0x10000
      + this.readUint8() * 0x100
      + this.readUint8();
  }

  readInt32() {
    const value = this.readUint32();
    return value > 0x7fffffff ? value - 0x100000000 : value;
  }

  readInt64() {
    const high = this.readInt32();
    const low = this.readUint32();
    return high * 0x100000000 + low;
  }

  readAscii(byteCount) {
    this.ensure(byteCount);
    let value = "";
    for (let index = 0; index < byteCount; index++) {
      value += String.fromCharCode(this.readUint8());
    }
    return value;
  }

  readHex(byteCount) {
    this.ensure(byteCount);
    const start = this.offset * 2;
    this.offset += byteCount;
    return this.hex.slice(start, start + byteCount * 2);
  }

  readDouble() {
    this.ensure(8);
    const bytes = new Uint8Array(8);
    for (let index = 0; index < 8; index++) bytes[index] = this.readUint8();
    return new DataView(bytes.buffer).getFloat64(0, false);
  }

  readUnicodeString() {
    const length = this.readUint32();
    if (length > Math.floor(this.remaining() / 2)) {
      throw new TplParseError("TPL_TRUNCATED_DATA", `Invalid Unicode string length at byte ${this.offset - 4}.`);
    }
    let value = "";
    for (let index = 0; index < length; index++) {
      const codeUnit = this.readUint16();
      if (codeUnit !== 0) value += String.fromCharCode(codeUnit);
    }
    return value;
  }

  readId() {
    let length = this.readUint32();
    if (length === 0) length = 4;
    if (length > 1024 || length > this.remaining()) {
      throw new TplParseError("TPL_TRUNCATED_DATA", `Invalid descriptor identifier length at byte ${this.offset - 4}.`);
    }
    return this.readAscii(length);
  }
}

const cleanId = (value) => String(value || "").replace(/\0+$/g, "").trim();

const readClass = (reader) => ({
  name: reader.readUnicodeString(),
  id: cleanId(reader.readId()),
});

const readReference = (reader) => {
  const count = reader.readUint32();
  const items = [];
  for (let index = 0; index < count; index++) {
    const form = reader.readAscii(4);
    const desiredClass = readClass(reader);
    let value = null;
    if (form === "prop") value = cleanId(reader.readId());
    else if (form === "Enmr") value = { type: cleanId(reader.readId()), value: cleanId(reader.readId()) };
    else if (["rele", "Idnt", "indx"].includes(form)) value = reader.readInt32();
    else if (form === "name") value = reader.readUnicodeString();
    else if (form !== "Clss") throw new TplParseError("TPL_UNSUPPORTED_DATA", `Unsupported reference form ${form}.`);
    items.push({ form, desiredClass, value });
  }
  return items;
};

const readDescriptor = (reader) => {
  const descriptorClass = readClass(reader);
  const count = reader.readUint32();
  if (count > 100000) throw new TplParseError("TPL_UNSUPPORTED_DATA", "Descriptor contains too many properties.");
  const value = {};
  for (let index = 0; index < count; index++) {
    const key = cleanId(reader.readId());
    value[key] = readTypedValue(reader);
  }
  Object.defineProperty(value, "__class", { value: descriptorClass, enumerable: false });
  return value;
};

const readObjectArray = (reader) => {
  const objectCount = reader.readUint32();
  const objectClass = readClass(reader);
  const itemCount = reader.readUint32();
  const items = {};
  for (let index = 0; index < itemCount; index++) {
    const key = cleanId(reader.readId());
    const itemType = reader.readAscii(4);
    const unit = reader.readAscii(4);
    const valueCount = reader.readUint32();
    const values = [];
    for (let valueIndex = 0; valueIndex < valueCount; valueIndex++) values.push(reader.readDouble());
    items[key] = { type: itemType, unit, values };
  }
  return { objectCount, objectClass, items };
};

function readTypedValue(reader) {
  const type = reader.readAscii(4);
  switch (type) {
    case "Objc":
    case "GlbO":
      return readDescriptor(reader);
    case "VlLs": {
      const count = reader.readUint32();
      if (count > 100000) throw new TplParseError("TPL_UNSUPPORTED_DATA", "Descriptor list is too large.");
      const values = [];
      for (let index = 0; index < count; index++) values.push(readTypedValue(reader));
      return values;
    }
    case "doub":
      return reader.readDouble();
    case "UntF":
      return { unit: reader.readAscii(4), value: reader.readDouble() };
    case "TEXT":
      return reader.readUnicodeString();
    case "enum":
      return { enumType: cleanId(reader.readId()), value: cleanId(reader.readId()) };
    case "long":
      return reader.readInt32();
    case "comp":
      return reader.readInt64();
    case "bool":
      return reader.readUint8() !== 0;
    case "type":
    case "GlbC":
      return readClass(reader);
    case "obj ":
      return readReference(reader);
    case "alis":
    case "Pth ":
    case "tdta": {
      const length = reader.readUint32();
      return { type, data: reader.readHex(length) };
    }
    case "ObAr":
      return readObjectArray(reader);
    default:
      throw new TplParseError("TPL_UNSUPPORTED_DATA", `Unsupported descriptor value type ${JSON.stringify(type)} at byte ${reader.offset - 4}.`);
  }
}

function parseTplHex(hexData) {
  const cleanHex = String(hexData || "").replace(/\s+/g, "").toLowerCase();
  if (!cleanHex || cleanHex.length % 2 || !/^[0-9a-f]+$/.test(cleanHex)) {
    throw new TplParseError("TPL_INVALID_FILE", "TPL data is not valid binary hex data.");
  }

  const reader = new HexReader(cleanHex);
  if (reader.remaining() < 16 || reader.readAscii(4) !== TPL_HEADER) {
    throw new TplParseError("TPL_INVALID_FILE", "Invalid Photoshop TPL header.");
  }
  reader.skip(8);
  if (reader.readAscii(4) !== PHOTOSHOP_SIGNATURE) {
    throw new TplParseError("TPL_INVALID_FILE", "Missing Photoshop resource signature.");
  }

  const toolSectionIndex = cleanHex.lastIndexOf(TOOL_DATA_SIGNATURE_HEX);
  if (toolSectionIndex < 0) {
    throw new TplParseError("TPL_MISSING_TOOL_DATA", "Missing Photoshop tool preset data section.");
  }

  const toolsReader = new HexReader(cleanHex, toolSectionIndex / 2 + 16);
  const tools = [];
  while (toolsReader.remaining() >= 4) {
    const remainingHex = cleanHex.slice(toolsReader.offset * 2);
    if (!/[1-9a-f]/.test(remainingHex)) break;

    const name = toolsReader.readUnicodeString();
    toolsReader.skip(10);
    const type = cleanId(toolsReader.readId());
    const propertyCount = toolsReader.readUint32();
    if (propertyCount > 100000) throw new TplParseError("TPL_UNSUPPORTED_DATA", "Tool preset contains too many properties.");
    const properties = {};
    for (let index = 0; index < propertyCount; index++) {
      const key = cleanId(toolsReader.readId());
      properties[key] = readTypedValue(toolsReader);
    }
    tools.push({ name, type, properties });
  }
  return tools;
}

const enumValueMap = {
  Nrml: "normal",
  Left: "left",
  Rght: "right",
  Cntr: "center",
  JstA: "justifyAll",
  JstF: "justifyFull",
  Hrzn: "horizontal",
  Vrtc: "vertical",
  None: "none",
};

const unwrapValue = (value) => {
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "unit")) return value.value;
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "enumType")) {
    return enumValueMap[value.value] || value.value;
  }
  return value;
};

const normalizeColor = (value, fallback = { red: 0, green: 0, blue: 0 }) => {
  if (!value || typeof value !== "object") return { ...fallback };
  const numberOr = (candidate, defaultValue) => Number.isFinite(Number(candidate)) ? Number(candidate) : defaultValue;
  return {
    red: numberOr(unwrapValue(value.Rd ?? value.red), fallback.red),
    green: numberOr(unwrapValue(value.Grn ?? value.green), fallback.green),
    blue: numberOr(unwrapValue(value.Bl ?? value.blue), fallback.blue),
  };
};

const createDefaultTextStyle = () => ({
  styleSheetHasParent: true,
  fontPostScriptName: "MyriadPro-Regular",
  fontName: "Myriad Pro",
  fontStyleName: "Regular",
  fontScript: 0,
  fontTechnology: 0,
  fontAvailable: true,
  size: 12,
  impliedFontSize: 12,
  horizontalScale: 100,
  verticalScale: 100,
  characterRotation: 0,
  syntheticBold: false,
  syntheticItalic: false,
  autoLeading: true,
  tracking: 0,
  baselineShift: 0,
  impliedBaselineShift: 0,
  autoKern: "metricsKern",
  fontCaps: "normal",
  digitSet: "defaultDigits",
  kashidas: "kashidaDefault",
  diacXOffset: 0,
  diacYOffset: 0,
  markYDistFromBaseline: 100,
  baseline: "normal",
  otbaseline: "normal",
  strikethrough: "strikethroughOff",
  underline: "underlineOff",
  underlineOffset: 0,
  ligature: true,
  altligature: true,
  contextualLigatures: false,
  alternateLigatures: false,
  oldStyle: false,
  fractions: false,
  ordinals: false,
  swash: false,
  titling: false,
  connectionForms: false,
  stylisticAlternates: false,
  ornaments: false,
  justificationAlternates: false,
  figureStyle: "normal",
  proportionalMetrics: false,
  kana: false,
  italics: false,
  ruby: false,
  baselineDirection: "withStream",
  textLanguage: "englishLanguage",
  japaneseAlternate: "defaultForm",
  mojiZume: 0,
  gridAlignment: "roman",
  enableWariChu: false,
  wariChuCount: 2,
  wariChuLineGap: 0,
  wariChuScale: 0.5,
  wariChuWidow: 2,
  wariChuOrphan: 2,
  wariChuJustification: "wariChuAutoJustify",
  tcyUpDown: 0,
  tcyLeftRight: 0,
  leftAki: -1,
  rightAki: -1,
  jiDori: 0,
  noBreak: false,
  color: { red: 0, green: 0, blue: 0 },
  strokeColor: { red: 0, green: 0, blue: 0 },
  fill: true,
  stroke: false,
  fillFirst: true,
  fillOverPrint: false,
  strokeOverPrint: false,
  lineCap: "buttCap",
  lineJoin: "miterJoin",
  lineWidth: 1,
  miterLimit: 4,
  lineDashoffset: 0,
});

const textStyleKeyMap = {
  FntN: "fontName",
  FntS: "fontStyleName",
  Scrp: "fontScript",
  FntT: "fontTechnology",
  Sz: "size",
  HrzS: "horizontalScale",
  VrtS: "verticalScale",
  Trck: "tracking",
  Bsln: "baselineShift",
  AtKr: "autoKern",
  Undl: "underline",
  Clr: "color",
  Ldng: "leading",
  Fl: "fill",
  Strk: "stroke",
};

const normalizeTextStyle = (rawStyle = {}) => {
  const textStyle = createDefaultTextStyle();
  Object.keys(rawStyle).forEach((rawKey) => {
    const key = textStyleKeyMap[rawKey] || rawKey;
    if (key === "color" || key === "strokeColor") {
      textStyle[key] = normalizeColor(rawStyle[rawKey], textStyle[key]);
    } else if (Object.prototype.hasOwnProperty.call(textStyle, key) || key === "leading") {
      textStyle[key] = unwrapValue(rawStyle[rawKey]);
    }
  });

  textStyle.fontPostScriptName = textStyle.fontPostScriptName || `${textStyle.fontName}-${textStyle.fontStyleName}`;
  textStyle.impliedFontSize = textStyle.size;
  textStyle.impliedBaselineShift = textStyle.baselineShift;
  return textStyle;
};

const createDefaultParagraphStyle = () => ({
  styleSheetHasParent: true,
  alignment: "left",
  firstLineIndent: 0,
  impliedFirstLineIndent: 0,
  startIndent: 0,
  impliedStartIndent: 0,
  endIndent: 0,
  impliedEndIndent: 0,
  spaceBefore: 0,
  impliedSpaceBefore: 0,
  spaceAfter: 0,
  impliedSpaceAfter: 0,
  autoLeadingPercentage: 1.2,
  leadingType: "leadingBelow",
  directionType: "dirLeftToRight",
  kashidaWidthType: "kashidaWidthMedium",
  hyphenate: false,
  dropCapMultiplier: 1,
  hyphenateWordSize: 6,
  hyphenatePreLength: 2,
  hyphenatePostLength: 2,
  hyphenateLimit: 0,
  hyphenationZone: 36,
  hyphenateCapitalized: true,
  hyphenationPreference: 0.5,
  justificationWordMinimum: 0.8,
  justificationWordDesired: 1,
  justificationWordMaximum: 1.33,
  justificationLetterMinimum: 0,
  justificationLetterDesired: 0,
  justificationLetterMaximum: 0,
  justificationGlyphMinimum: 1,
  justificationGlyphDesired: 1,
  justificationGlyphMaximum: 1,
  hangingRoman: false,
  autoTCY: 0,
  keepTogether: true,
  burasagari: "burasagariNone",
  preferredKinsokuOrder: "pushIn",
  kurikaeshiMojiShori: false,
  textEveryLineComposer: false,
  defaultTabWidth: 36,
  textComposerEngine: "textLatinCJKComposer",
  singleWordJustification: "justifyAll",
  justificationMethodType: "justifMethodAutomatic",
});

const normalizeParagraphStyle = (rawStyle = {}) => {
  const paragraphStyle = createDefaultParagraphStyle();
  Object.keys(rawStyle).forEach((rawKey) => {
    const key = rawKey === "Algn" ? "alignment" : rawKey;
    if (Object.prototype.hasOwnProperty.call(paragraphStyle, key)) {
      paragraphStyle[key] = unwrapValue(rawStyle[rawKey]);
    }
  });
  paragraphStyle.impliedFirstLineIndent = paragraphStyle.firstLineIndent;
  paragraphStyle.impliedStartIndent = paragraphStyle.startIndent;
  paragraphStyle.impliedEndIndent = paragraphStyle.endIndent;
  paragraphStyle.impliedSpaceBefore = paragraphStyle.spaceBefore;
  paragraphStyle.impliedSpaceAfter = paragraphStyle.spaceAfter;
  return paragraphStyle;
};

const unitName = (rawStyle) => {
  const unit = rawStyle?.Sz?.unit;
  if (unit === "#Pnt") return "pointsUnit";
  if (unit === "#Pxl") return "pixelsUnit";
  return "pointsUnit";
};

const antiAliasName = (value) => {
  const names = ["antiAliasNone", "antiAliasSharp", "antiAliasCrisp", "antiAliasStrong", "antiAliasSmooth"];
  return names[Number(value)] || "antiAliasSmooth";
};

const generateId = () => Math.random().toString(36).substring(2, 10);

const styleFromTool = (tool, folderId, now) => {
  const paragraphOptions = tool.properties.textToolParagraphOptions || {};
  const characterOptions = tool.properties.textToolCharacterOptions || {};
  const rawTextStyle = characterOptions.TxtS || paragraphOptions.paragraphStyle?.defaultStyle;
  if (!rawTextStyle || typeof rawTextStyle !== "object") return null;

  const rawParagraphStyle = paragraphOptions.paragraphStyle || {};
  const textStyle = normalizeTextStyle(rawTextStyle);
  const paragraphStyle = normalizeParagraphStyle(rawParagraphStyle);
  const orientationValue = unwrapValue(paragraphOptions.Ornt)
    || (tool.properties.textToolOptions?.textNewTextOrientation === 1 ? "vertical" : "horizontal");
  const presetName = String(tool.name || "").split("=").pop().trim();

  return {
    name: presetName || `${textStyle.fontName} ${textStyle.fontStyleName}`,
    folder: folderId,
    textType: "inherit",
    textProps: {
      layerText: {
        textGridding: unwrapValue(characterOptions.textGridding) || "none",
        orientation: orientationValue,
        antiAlias: antiAliasName(rawTextStyle.AntA),
        textStyleRange: [{ from: 0, to: 100, textStyle }],
        paragraphStyleRange: [{ from: 0, to: 100, paragraphStyle }],
        kerningRange: [],
      },
      typeUnit: unitName(rawTextStyle),
    },
    prefixes: [],
    prefixColor: "#FFF3B0",
    id: generateId(),
    edited: now,
    chosen: false,
    selected: false,
    stroke: {
      enabled: false,
      size: 0,
      opacity: 100,
      position: "outer",
      color: { r: 255, g: 255, b: 255 },
    },
  };
};

function convertTplHexToTypeRFormat(hexData, rawFileName = "TPL") {
  const cleanFolderName = String(rawFileName || "").replace(/\.tpl$/i, "").trim() || "TPL";
  const tools = parseTplHex(hexData);
  const textTools = tools.filter((tool) => tool.type === "typeCreateOrEditTool" || tool.type.startsWith("typeCreateOrEdit"));
  const folderId = generateId();
  const now = Date.now();
  const styles = textTools.map((tool) => styleFromTool(tool, folderId, now)).filter(Boolean);

  if (!styles.length) {
    throw new TplParseError("TPL_NO_TEXT_PRESETS", "No Photoshop text tool presets were found.");
  }

  return {
    folders: [{
      name: cleanFolderName,
      id: folderId,
      chosen: false,
      selected: false,
      parentId: null,
      order: 0,
    }],
    styles,
  };
}

export {
  TplParseError,
  convertTplHexToTypeRFormat,
  parseTplHex,
};
