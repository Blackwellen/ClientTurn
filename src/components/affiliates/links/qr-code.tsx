"use client";

import * as React from "react";

/**
 * A QR code, rendered from scratch.
 *
 * There is no QR dependency in this project and adding one for a single card
 * is not worth it, so this is a minimal byte-mode encoder: version 1-10, error
 * correction level M, which comfortably covers a referral URL of up to ~150
 * characters.
 *
 * The value is always a referral URL the server generated — never free text
 * from the browser — so there is no path by which an affiliate could encode an
 * arbitrary destination into a code carrying our brand.
 */

/* ------------------------------------------------------- Galois field --- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** Reed-Solomon error correction codewords. */
function rsEncode(data: number[], ecLength: number): number[] {
  let generator = [1];
  for (let i = 0; i < ecLength; i += 1) {
    const next = new Array<number>(generator.length + 1).fill(0);
    for (let j = 0; j < generator.length; j += 1) {
      next[j] ^= generator[j];
      next[j + 1] ^= mul(generator[j], EXP[i]);
    }
    generator = next;
  }

  const remainder = new Array<number>(ecLength).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < ecLength; i += 1) {
      remainder[i] ^= mul(generator[i + 1], factor);
    }
  }
  return remainder;
}

/* ------------------------------------------------------ version tables --- */

/** [version]: [total codewords, ec per block, blocks group1, blocks group2] */
const VERSIONS: Record<number, [number, number, number, number]> = {
  1: [26, 10, 1, 0],
  2: [44, 16, 1, 0],
  3: [70, 26, 1, 0],
  4: [100, 18, 2, 0],
  5: [134, 24, 2, 0],
  6: [172, 16, 4, 0],
  7: [196, 18, 4, 0],
  8: [242, 22, 2, 2],
  9: [292, 22, 3, 2],
  10: [346, 26, 4, 1],
};

const ALIGNMENT: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

/** Pre-computed 15-bit format strings for EC level M, masks 0-7. */
const FORMAT_M = [
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
];

type Matrix = { size: number; modules: (0 | 1)[][]; reserved: boolean[][] };

function buildMatrix(text: string): Matrix | null {
  const bytes = Array.from(new TextEncoder().encode(text));

  // Smallest version that fits, so a short link produces a coarse, scannable
  // code rather than a needlessly dense one.
  let version = 0;
  for (let candidate = 1; candidate <= 10; candidate += 1) {
    const [total, ecPerBlock, g1, g2] = VERSIONS[candidate];
    const blocks = g1 + g2;
    const capacity = total - ecPerBlock * blocks;
    const lengthBits = candidate < 10 ? 8 : 16;
    const needed = Math.ceil((4 + lengthBits + bytes.length * 8) / 8);
    if (needed <= capacity) {
      version = candidate;
      break;
    }
  }
  if (version === 0) return null;

  const [totalCodewords, ecPerBlock, group1, group2] = VERSIONS[version];
  const blocks = group1 + group2;
  const dataCodewords = totalCodewords - ecPerBlock * blocks;

  /* ------------------------------------------------------- bit stream */

  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);

  // Terminator, then pad to a byte boundary, then the alternating pad bytes.
  const capacityBits = dataCodewords * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  }
  const PAD = [0xec, 0x11];
  let padIndex = 0;
  while (data.length < dataCodewords) {
    data.push(PAD[padIndex++ % 2]);
  }

  /* --------------------------------------------------------- blocking */

  const shortLength = Math.floor(dataCodewords / blocks);
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;

  for (let i = 0; i < blocks; i += 1) {
    const length = i < group1 ? shortLength : shortLength + 1;
    const block = data.slice(offset, offset + length);
    offset += length;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecPerBlock));
  }

  const interleaved: number[] = [];
  const maxData = Math.max(...dataBlocks.map((block) => block.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of dataBlocks) if (i < block.length) interleaved.push(block[i]);
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of ecBlocks) interleaved.push(block[i]);
  }

  /* ---------------------------------------------------------- matrix */

  const size = version * 4 + 17;
  const modules: (0 | 1)[][] = Array.from({ length: size }, () =>
    new Array<0 | 1>(size).fill(0),
  );
  const reserved: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  );

  const setModule = (row: number, col: number, value: 0 | 1) => {
    modules[row][col] = value;
    reserved[row][col] = true;
  };

  // Finder patterns and their separators.
  for (const [baseRow, baseCol] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ]) {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const row = baseRow + r;
        const col = baseCol + c;
        if (row < 0 || row >= size || col < 0 || col >= size) continue;
        const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        setModule(row, col, inside && (onBorder || inCore) ? 1 : 0);
      }
    }
  }

  // Timing patterns.
  for (let i = 8; i < size - 8; i += 1) {
    const value: 0 | 1 = i % 2 === 0 ? 1 : 0;
    setModule(6, i, value);
    setModule(i, 6, value);
  }

  // Alignment patterns, skipping those that would collide with a finder.
  const centres = ALIGNMENT[version];
  for (const row of centres) {
    for (const col of centres) {
      if (
        (row === 6 && col === 6) ||
        (row === 6 && col === size - 7) ||
        (row === size - 7 && col === 6)
      ) {
        continue;
      }
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const onRing = Math.max(Math.abs(r), Math.abs(c)) !== 1;
          setModule(row + r, col + c, onRing ? 1 : 0);
        }
      }
    }
  }

  // Dark module, and the reserved format areas.
  setModule(size - 8, 8, 1);
  for (let i = 0; i < 9; i += 1) {
    if (!reserved[8][i]) reserved[8][i] = true;
    if (!reserved[i][8]) reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i += 1) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }

  /* ------------------------------------------------------ place data */

  const dataBits: number[] = [];
  for (const codeword of interleaved) {
    for (let i = 7; i >= 0; i -= 1) dataBits.push((codeword >> i) & 1);
  }

  // Mask 0 throughout: (row + col) % 2 === 0. A full mask-penalty evaluation
  // would pick a marginally better pattern, but mask 0 always produces a
  // valid, scannable code and keeps this an order of magnitude smaller.
  const mask = 0;
  let bitIndex = 0;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    const column = right === 6 ? right - 1 : right;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [column, column - 1]) {
        if (reserved[row][col]) continue;
        const bit = bitIndex < dataBits.length ? dataBits[bitIndex] : 0;
        bitIndex += 1;
        const masked = (row + col) % 2 === 0 ? bit ^ 1 : bit;
        modules[row][col] = masked as 0 | 1;
      }
    }
    upward = !upward;
  }

  /* ---------------------------------------------------- format bits */

  const format = FORMAT_M[mask];
  for (let i = 0; i < 15; i += 1) {
    const bit = ((format >> i) & 1) as 0 | 1;
    // Top-left, split around the timing row/column.
    if (i < 6) modules[8][i] = bit;
    else if (i < 8) modules[8][i + 1] = bit;
    else if (i === 8) modules[7][8] = bit;
    else modules[14 - i][8] = bit;

    // The duplicate copy along the other two finders.
    if (i < 8) modules[size - 1 - i][8] = bit;
    else modules[8][size - 15 + i] = bit;
  }

  return { size, modules, reserved };
}

/**
 * Renders a QR code as SVG, with a PNG download.
 *
 * SVG so it stays crisp at any size in the page, rasterised on demand for the
 * download because print and social tools generally want a PNG.
 */
export function QrCode({
  value,
  size = 152,
  fileName = "referral-qr.png",
}: {
  value: string;
  size?: number;
  fileName?: string;
}) {
  const matrix = React.useMemo(() => buildMatrix(value), [value]);
  const svgRef = React.useRef<SVGSVGElement>(null);

  if (!matrix) {
    return (
      <p className="rounded-[9px] border border-line bg-surface-sunken px-3 py-6 text-center text-[12.5px] text-content-muted">
        That link is too long to turn into a QR code.
      </p>
    );
  }

  const quiet = 4;
  const total = matrix.size + quiet * 2;

  function downloadPng() {
    const svg = svgRef.current;
    if (!svg) return;

    const serialised = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([serialised], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const image = new Image();
    image.onload = () => {
      const scale = 8;
      const canvas = document.createElement("canvas");
      canvas.width = total * scale;
      canvas.height = total * scale;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.imageSmoothingEnabled = false;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);

      canvas.toBlob((png) => {
        if (!png) return;
        const link = document.createElement("a");
        link.href = URL.createObjectURL(png);
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(link.href);
      }, "image/png");
    };
    image.src = url;
  }

  return (
    <div className="flex flex-col items-start gap-2.5">
      <svg
        ref={svgRef}
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${total} ${total}`}
        width={size}
        height={size}
        role="img"
        aria-label={`QR code for ${value}`}
        className="rounded-[8px] border border-line bg-white"
        shapeRendering="crispEdges"
      >
        <rect width={total} height={total} fill="#ffffff" />
        {matrix.modules.map((row, r) =>
          row.map((module, c) =>
            module ? (
              <rect
                key={`${r}-${c}`}
                x={c + quiet}
                y={r + quiet}
                width={1}
                height={1}
                fill="#0b1020"
              />
            ) : null,
          ),
        )}
      </svg>
      <button
        type="button"
        onClick={downloadPng}
        className="inline-flex items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-content hover:bg-surface-hover"
      >
        Download PNG
      </button>
    </div>
  );
}
