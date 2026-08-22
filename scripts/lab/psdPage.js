/*
 * psdPage.js — reads a PSD in Node and gives the lab what Photoshop used to
 * have to be opened for: the page composited without its text layers, and the
 * ink box of every text layer.
 *
 * Why it exists: measuring one page through the Photoshop harness costs minutes
 * (COM round trip, document open, duplicate, flatten, save). Reading the same
 * page here costs seconds, so a candidate rule can be scored over all 14 pages
 * without Photoshop running at all. The harness stays the source of truth for
 * the error the engine really produces — this only replaces the *inputs*.
 *
 * Scope is the material in psd/: 8-bit grayscale pages, one channel plus alpha,
 * normal blending. See the `ponytail:` notes below for the ceilings.
 *
 * Usage:
 *   node scripts/lab/psdPage.js --verify [run]   composite vs the run's .notext.raw
 *   node scripts/lab/psdPage.js <file.psd>       summary of one page
 */

const fs = require("fs");
const path = require("path");
const { inflateSync } = require("fflate");

const ROOT = path.resolve(__dirname, "..", "..");

/* ---------- byte reader ---------- */

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }
  u8() { return this.buf[this.pos++]; }
  u16() { const v = this.buf.readUInt16BE(this.pos); this.pos += 2; return v; }
  i16() { const v = this.buf.readInt16BE(this.pos); this.pos += 2; return v; }
  u32() { const v = this.buf.readUInt32BE(this.pos); this.pos += 4; return v; }
  i32() { const v = this.buf.readInt32BE(this.pos); this.pos += 4; return v; }
  ascii(n) { const v = this.buf.toString("latin1", this.pos, this.pos + n); this.pos += n; return v; }
  bytes(n) { const v = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return v; }
  skip(n) { this.pos += n; }
}

/* ---------- channel decompression ---------- */

/*
 * PackBits, the run-length encoding PSD uses for compression 1. Row byte counts
 * come first, one 2-byte count per row, then the rows back to back.
 */
function unpackBits(src, expected) {
  const out = Buffer.alloc(expected);
  let s = 0;
  let d = 0;
  while (d < expected && s < src.length) {
    const n = src.readInt8(s++);
    if (n >= 0) {
      const count = n + 1;
      src.copy(out, d, s, s + count);
      s += count;
      d += count;
    } else if (n !== -128) {
      const count = 1 - n;
      out.fill(src[s++], d, d + count);
      d += count;
    }
  }
  return out;
}

function readChannel(reader, width, height, byteLength) {
  const end = reader.pos + byteLength;
  const expected = width * height;
  if (expected === 0) {
    reader.pos = end;
    return Buffer.alloc(0);
  }
  const compression = reader.u16();
  let data;
  if (compression === 0) {
    data = Buffer.from(reader.bytes(expected));
  } else if (compression === 1) {
    reader.skip(height * 2); // row byte counts; unpackBits stops on the expected size
    data = unpackBits(reader.buf.subarray(reader.pos, end), expected);
  } else if (compression === 2 || compression === 3) {
    // ZIP, with and without prediction. Grayscale 8-bit has no prediction step,
    // so both decode the same way here.
    // ponytail: 8-bit only; 16/32-bit ZIP-with-prediction would need the
    // per-row delta undone. Add it when a 16-bit page shows up.
    data = Buffer.from(inflateSync(new Uint8Array(reader.buf.subarray(reader.pos, end))));
  } else {
    throw new Error("unknown channel compression " + compression);
  }
  reader.pos = end;
  return data.length === expected ? data : Buffer.concat([data], expected);
}

/* ---------- layer records ---------- */

function readLayerRecord(reader) {
  const top = reader.i32();
  const left = reader.i32();
  const bottom = reader.i32();
  const right = reader.i32();
  const channelCount = reader.u16();
  const channelInfo = [];
  for (let i = 0; i < channelCount; i++) {
    channelInfo.push({ id: reader.i16(), length: reader.u32() });
  }
  const blendSignature = reader.ascii(4);
  if (blendSignature !== "8BIM") throw new Error("bad blend signature " + blendSignature);
  const blendKey = reader.ascii(4);
  const opacity = reader.u8();
  const clipping = reader.u8();
  const flags = reader.u8();
  reader.skip(1); // filler

  const extraLength = reader.u32();
  const extraEnd = reader.pos + extraLength;

  const maskLength = reader.u32();
  const maskEnd = reader.pos + maskLength;
  let mask = null;
  if (maskLength >= 16) {
    mask = {
      top: reader.i32(),
      left: reader.i32(),
      bottom: reader.i32(),
      right: reader.i32(),
      defaultColor: reader.u8(),
      flags: reader.u8(),
    };
  }
  reader.pos = maskEnd;

  reader.skip(reader.u32()); // blending ranges

  const nameLength = reader.u8();
  const name = reader.ascii(nameLength);
  reader.skip((4 - ((nameLength + 1) % 4)) % 4);

  const layer = {
    top, left, bottom, right,
    width: right - left,
    height: bottom - top,
    channelInfo,
    blendKey,
    opacity,
    clipping,
    // Bit 1 of the flags is "transparency protected"; bit 2 is hidden.
    visible: (flags & 0x02) === 0,
    name,
    mask,
    id: null,
    isText: false,
    sectionType: 0,
  };

  // Additional layer information: the keys that say what this layer *is*.
  while (reader.pos + 12 <= extraEnd) {
    const signature = reader.ascii(4);
    if (signature !== "8BIM" && signature !== "8B64") break;
    const key = reader.ascii(4);
    const length = reader.u32();
    const blockEnd = reader.pos + length + (length % 2);
    if (key === "lyid") {
      layer.id = reader.u32();
    } else if (key === "luni") {
      const chars = reader.u32();
      let unicode = "";
      for (let i = 0; i < chars; i++) unicode += String.fromCharCode(reader.u16());
      layer.name = unicode;
    } else if (key === "TySh") {
      layer.isText = true;
    } else if (key === "lsct" || key === "lsdk") {
      layer.sectionType = reader.u32();
    }
    reader.pos = blockEnd;
  }

  reader.pos = extraEnd;
  return layer;
}

function readPsd(filePath) {
  const reader = new Reader(fs.readFileSync(filePath));
  if (reader.ascii(4) !== "8BPS") throw new Error("not a PSD: " + filePath);
  const version = reader.u16();
  if (version !== 1) throw new Error("PSB (version 2) not supported: " + filePath);
  reader.skip(6);
  const channels = reader.u16();
  const height = reader.u32();
  const width = reader.u32();
  const depth = reader.u16();
  const colorMode = reader.u16();
  if (depth !== 8) throw new Error("only 8-bit pages are read here, got " + depth);
  if (colorMode !== 1) throw new Error("only grayscale pages are read here, got mode " + colorMode);

  reader.skip(reader.u32()); // colour mode data
  reader.skip(reader.u32()); // image resources

  const layerMaskLength = reader.u32();
  const layerMaskEnd = reader.pos + layerMaskLength;
  const layerInfoLength = reader.u32();
  const layerInfoEnd = reader.pos + layerInfoLength;

  let layerCount = reader.i16();
  if (layerCount < 0) layerCount = -layerCount; // negative means the first alpha is transparency

  const layers = [];
  for (let i = 0; i < layerCount; i++) layers.push(readLayerRecord(reader));

  // Channel pixels follow all the records, in the same order.
  for (const layer of layers) {
    layer.channels = {};
    for (const info of layer.channelInfo) {
      const isMask = info.id === -2 || info.id === -3;
      const rect = isMask && layer.mask ? layer.mask : layer;
      const w = Math.max(0, rect.right - rect.left);
      const h = Math.max(0, rect.bottom - rect.top);
      layer.channels[info.id] = readChannel(reader, w, h, info.length);
    }
  }
  reader.pos = layerInfoEnd;
  reader.pos = layerMaskEnd;

  resolveGroupVisibility(layers);
  return { width, height, channels, layers, file: filePath };
}

/*
 * A hidden group hides its contents, and the group's own header sits *above* its
 * children in the file (layers are stored bottom to top). So visibility is
 * resolved walking the stack downwards, pushing on a group header and popping on
 * the `</Layer group>` divider that closes it.
 */
function resolveGroupVisibility(layers) {
  const hiddenStack = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const hiddenByParent = hiddenStack.length > 0 && hiddenStack[hiddenStack.length - 1];
    if (layer.sectionType === 1 || layer.sectionType === 2) {
      hiddenStack.push(hiddenByParent || !layer.visible);
      layer.effectiveVisible = false; // the header itself paints nothing
      continue;
    }
    if (layer.sectionType === 3) {
      hiddenStack.pop();
      layer.effectiveVisible = false;
      continue;
    }
    layer.effectiveVisible = layer.visible && !hiddenByParent;
  }
}

/* ---------- compositing ---------- */

/*
 * Alpha-over composite of the visible pixel layers onto white, in document
 * order. Grayscale, one byte per pixel — the same headerless layout
 * labImage.readRaw already consumes.
 *
 * ponytail: normal blending only, and live layer effects are not rendered. The
 * pages in psd/ are flattened manga art where every pixel layer is `norm`, and
 * --verify is what proves it page by page. If a page ever fails the byte
 * comparison, read it through the Photoshop harness instead of widening this.
 */
function composite(psd, options) {
  const skipText = !options || options.skipText !== false;
  // Align hides only the layer it is centring, so the glyphs of every other text
  // are still painted when the magic wand samples the page. `hideText` is how the
  // lab reproduces that exact page.
  const hideText = (options && options.hideText) || null;
  const out = Buffer.alloc(psd.width * psd.height, 255);

  for (const layer of psd.layers) {
    if (!layer.effectiveVisible) continue;
    if (skipText && layer.isText) continue;
    if (hideText && layer.isText && hideText(layer)) continue;
    if (layer.width <= 0 || layer.height <= 0) continue;
    const gray = layer.channels[0];
    if (!gray || !gray.length) continue;
    const alpha = layer.channels[-1];
    const maskAlpha = layerMaskSampler(layer);
    const layerOpacity = layer.opacity / 255;

    for (let y = 0; y < layer.height; y++) {
      const docY = layer.top + y;
      if (docY < 0 || docY >= psd.height) continue;
      for (let x = 0; x < layer.width; x++) {
        const docX = layer.left + x;
        if (docX < 0 || docX >= psd.width) continue;
        const src = y * layer.width + x;
        let a = (alpha && alpha.length ? alpha[src] / 255 : 1) * layerOpacity;
        if (maskAlpha) a *= maskAlpha(docX, docY);
        if (a <= 0) continue;
        const dst = docY * psd.width + docX;
        out[dst] = a >= 1 ? gray[src] : Math.round(gray[src] * a + out[dst] * (1 - a));
      }
    }
  }
  return out;
}

/* A layer mask is its own rectangle with its own default colour outside it. */
function layerMaskSampler(layer) {
  const mask = layer.mask;
  const data = layer.channels[-2];
  if (!mask || !data || !data.length) return null;
  if (mask.flags & 0x02) return null; // mask disabled
  const width = mask.right - mask.left;
  const height = mask.bottom - mask.top;
  const outside = (mask.defaultColor === undefined ? 255 : mask.defaultColor) / 255;
  return function (docX, docY) {
    const mx = docX - mask.left;
    const my = docY - mask.top;
    if (mx < 0 || my < 0 || mx >= width || my >= height) return outside;
    return data[my * width + mx] / 255;
  };
}

/* ---------- text ink boxes ---------- */

/*
 * The tight box of the layer's own alpha, not the record rectangle: the record
 * grows to hold a layer effect's margin, and the harness measures the ink. The
 * two disagree on a couple of layers per page, and only on the margin — the
 * centre is the same, which is what centring is scored on.
 */
function inkBox(layer) {
  const alpha = layer.channels[-1];
  const source = alpha && alpha.length ? alpha : layer.channels[0];
  if (!source || !source.length || layer.width <= 0 || layer.height <= 0) return null;
  const opaque = alpha && alpha.length
    ? (i) => source[i] > 0
    // No alpha means the layer fills its rectangle; in grayscale art the ink is
    // the dark part, so anything that is not paper counts.
    : (i) => source[i] < 255;

  let top = Infinity, left = Infinity, bottom = -Infinity, right = -Infinity;
  for (let y = 0; y < layer.height; y++) {
    for (let x = 0; x < layer.width; x++) {
      if (!opaque(y * layer.width + x)) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (top > bottom) return null;
  return makeBox(layer.left + left, layer.top + top, layer.left + right + 1, layer.top + bottom + 1);
}

function makeBox(left, top, right, bottom) {
  return {
    top, left, right, bottom,
    width: right - left,
    height: bottom - top,
    xMid: (left + right) / 2,
    yMid: (top + bottom) / 2,
  };
}

function textLayers(psd) {
  const out = [];
  for (const layer of psd.layers) {
    if (!layer.isText || !layer.effectiveVisible) continue;
    const box = inkBox(layer);
    if (box) out.push({ id: layer.id, name: layer.name, box });
  }
  return out;
}

/* ---------- CLI ---------- */

function verify(run) {
  const runDir = path.join(ROOT, ".centering-lab", "runs", run);
  const inDir = path.join(runDir, "in");
  const pageDir = path.join(runDir, "pages");
  if (!fs.existsSync(pageDir)) {
    console.error("no pages/ in " + run + " — the run was measured without -DumpRaw");
    process.exitCode = 1;
    return;
  }
  let checked = 0;
  let failed = 0;
  for (const file of fs.readdirSync(inDir).filter((f) => f.toLowerCase().endsWith(".psd")).sort()) {
    const stem = path.basename(file, path.extname(file));
    const rawPath = path.join(pageDir, stem + ".notext.raw");
    if (!fs.existsSync(rawPath)) continue;
    const psd = readPsd(path.join(inDir, file));
    const mine = composite(psd, { skipText: true });
    const theirs = fs.readFileSync(rawPath);
    checked++;
    if (mine.length !== theirs.length) {
      failed++;
      console.log("SIZE  " + stem + ": " + mine.length + " != " + theirs.length);
      continue;
    }
    let diff = 0;
    let worst = 0;
    for (let i = 0; i < mine.length; i++) {
      const d = Math.abs(mine[i] - theirs[i]);
      if (d) { diff++; if (d > worst) worst = d; }
    }
    if (diff) {
      failed++;
      console.log("DIFF  " + stem + ": " + diff + " px (" + (100 * diff / mine.length).toFixed(3) + "%), maior desvio " + worst);
    } else {
      console.log("OK    " + stem + ": " + mine.length + " bytes idênticos, " + textLayers(psd).length + " camadas de texto");
    }
  }
  console.log("\n" + (checked - failed) + "/" + checked + " páginas idênticas byte a byte");
  if (failed) process.exitCode = 1;
}

function describe(file) {
  const psd = readPsd(file);
  console.log(path.basename(file) + ": " + psd.width + "x" + psd.height + ", " + psd.layers.length + " camadas");
  for (const t of textLayers(psd)) {
    console.log("  #" + t.id + " " + JSON.stringify(t.name.slice(0, 30)) + " ink " + t.box.left + "," + t.box.top + " " + t.box.width + "x" + t.box.height + " centro " + t.box.xMid + "," + t.box.yMid);
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === "--verify") verify(args[1] || "000-baseline");
  else if (args.length) describe(args[0]);
  else console.log("uso: node scripts/lab/psdPage.js --verify [run] | <arquivo.psd>");
}

module.exports = { readPsd, composite, textLayers, inkBox, makeBox };
