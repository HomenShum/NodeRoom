#!/usr/bin/env node
/**
 * assemble-gif.mjs — turn captured PNG frames into an animated GIF.
 *
 * Uses pngjs (already a dependency here) to decode, then writes GIF89a
 * by hand: a global palette built from the frames themselves, LZW-compressed,
 * with a NETSCAPE2.0 loop block. No ffmpeg, no ImageMagick, no network.
 *
 * Colour is quantised to a 256-entry palette by 3-3-2 bit truncation. That is
 * crude for photographs and perfectly adequate for UI, which is what these are.
 *
 *   node scripts/assemble-gif.mjs <frames-dir> <out.gif> <prefix> [delay-cs]
 */

import { PNG } from "pngjs";
import { readFileSync } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [, , framesDir, outPath, prefix, delayArg] = process.argv;
if (!framesDir || !outPath || !prefix) {
  console.error("usage: assemble-gif.mjs <frames-dir> <out.gif> <prefix> [delay-cs]");
  process.exit(2);
}
const DELAY = Number(delayArg ?? 140); // hundredths of a second per frame

/** 3-3-2 truncation: r>>5 <<5 etc. Deterministic, no dithering, no surprises. */
const quantise = (r, g, b) => ((r & 0xe0) | ((g & 0xe0) >> 3) | (b >> 6)) & 0xff;
const paletteEntry = (i) => [
  (i & 0xe0) | 0x10,
  ((i << 3) & 0xe0) | 0x10,
  ((i << 6) & 0xc0) | 0x20,
];

/** GIF LZW, variable code width, with clear/end codes. */
function lzw(indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let dict = new Map();
  const reset = () => {
    dict = new Map();
    for (let i = 0; i < clear; i++) dict.set(String(i), i);
    return clear + 2;
  };
  let next = reset();
  let codeSize = minCodeSize + 1;
  const out = [];
  let cur = 0;
  let bits = 0;
  const emit = (code) => {
    cur |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.push(cur & 0xff);
      cur >>= 8;
      bits -= 8;
    }
  };

  emit(clear);
  let prev = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const combined = `${prev},${k}`;
    if (dict.has(combined)) {
      prev = combined;
      continue;
    }
    emit(dict.get(prev));
    dict.set(combined, next++);
    if (next > (1 << codeSize) && codeSize < 12) codeSize++;
    else if (next > 4095) {
      emit(clear);
      next = reset();
      codeSize = minCodeSize + 1;
    }
    prev = String(k);
  }
  emit(dict.get(prev));
  emit(end);
  if (bits > 0) out.push(cur & 0xff);
  return out;
}

const blockify = (bytes) => {
  const parts = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    parts.push(Buffer.from([chunk.length]), Buffer.from(chunk));
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
};

const files = (await readdir(framesDir))
  .filter((f) => f.startsWith(prefix) && f.endsWith(".png"))
  .sort();

if (files.length === 0) {
  console.error(`  no frames matching "${prefix}*" in ${framesDir}`);
  process.exit(1);
}

const frames = [];
let w = 0;
let h = 0;
for (const f of files) {
  // Frames are captured at final size, so there is nothing to resize.
  const png = PNG.sync.read(readFileSync(path.join(framesDir, f)));
  w = png.width;
  h = png.height;
  const px = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < png.data.length; i += 4, p++) {
    px[p] = quantise(png.data[i], png.data[i + 1], png.data[i + 2]);
  }
  frames.push(px);
}

const parts = [];
parts.push(Buffer.from("GIF89a", "ascii"));
const lsd = Buffer.alloc(7);
lsd.writeUInt16LE(w, 0);
lsd.writeUInt16LE(h, 2);
lsd[4] = 0xf7; // global colour table, 256 entries, 8 bits per channel
parts.push(lsd);

const pal = Buffer.alloc(768);
for (let i = 0; i < 256; i++) {
  const [r, g, b] = paletteEntry(i);
  pal[i * 3] = r;
  pal[i * 3 + 1] = g;
  pal[i * 3 + 2] = b;
}
parts.push(pal);

// NETSCAPE2.0 — loop forever.
parts.push(Buffer.from([0x21, 0xff, 0x0b]), Buffer.from("NETSCAPE2.0", "ascii"),
           Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]));

for (const px of frames) {
  const gce = Buffer.alloc(8);
  gce[0] = 0x21; gce[1] = 0xf9; gce[2] = 0x04; gce[3] = 0x04;
  gce.writeUInt16LE(DELAY, 4);
  gce[6] = 0x00; gce[7] = 0x00;
  parts.push(gce);

  const desc = Buffer.alloc(10);
  desc[0] = 0x2c;
  desc.writeUInt16LE(0, 1); desc.writeUInt16LE(0, 3);
  desc.writeUInt16LE(w, 5); desc.writeUInt16LE(h, 7);
  desc[9] = 0x00;
  parts.push(desc);

  parts.push(Buffer.from([8]));
  parts.push(blockify(lzw(Array.from(px), 8)));
}
parts.push(Buffer.from([0x3b]));

const gif = Buffer.concat(parts);
await writeFile(outPath, gif);
console.log(`  ${path.basename(outPath)}  ${files.length} frames  ${w}x${h}  ${(gif.length / 1024).toFixed(0)} KB`);
