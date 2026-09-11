import { deflateSync, inflateSync } from "node:zlib";
import type { Grid, Palette } from "./mark";

// Minimal PNG writer for pixel-art exports: 8-bit RGBA, no filtering, one IDAT. Enough for a
// few-kilobyte mark; a general encoder would be a dependency for nothing.

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(
        [...type].map((ch) => ch.charCodeAt(0)),
        4,
    );
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
}

export type DecodedPng = {
    width: number;
    height: number;
    pixels: Uint8Array;
};

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const DECODER_CAPACITY = 64 * 1024 * 1024;

/** Decode the 8-bit RGBA PNGs used by the engine's canonical brand assets. */
export function decodePng(bytes: Uint8Array): DecodedPng {
    if (bytes.byteLength > DECODER_CAPACITY)
        throw new Error("brand PNG: input exceeds decoder capacity");
    if (
        bytes.byteLength < PNG_SIGNATURE.length ||
        !PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)
    ) {
        throw new Error("brand PNG: invalid signature");
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = PNG_SIGNATURE.length;
    let width = 0;
    let height = 0;
    let stride = 0;
    let expected = 0;
    let sawIhdr = false;
    let sawIdat = false;
    let idatClosed = false;
    let sawIend = false;
    let compressedLength = 0;
    const idat: Uint8Array[] = [];

    while (offset < bytes.byteLength) {
        const remaining = bytes.byteLength - offset;
        if (remaining < 12) throw new Error("brand PNG: truncated chunk");
        const length = view.getUint32(offset);
        if (length > remaining - 12) throw new Error("brand PNG: truncated chunk");
        const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        const end = dataEnd + 4;
        const storedCrc = view.getUint32(dataEnd);
        const actualCrc = crc32(bytes.subarray(offset + 4, dataEnd));
        if (storedCrc !== actualCrc) throw new Error(`brand PNG: invalid ${type} CRC`);

        if (!sawIhdr && type !== "IHDR") throw new Error("brand PNG: IHDR must be first");
        if (type !== "IDAT" && sawIdat) idatClosed = true;
        if (type !== "IHDR" && type !== "IDAT" && type !== "IEND" && type.charCodeAt(0) < 97) {
            throw new Error(`brand PNG: unsupported critical chunk ${type}`);
        }

        if (type === "IHDR") {
            if (sawIhdr || length !== 13) throw new Error("brand PNG: invalid IHDR");
            sawIhdr = true;
            width = view.getUint32(dataStart);
            height = view.getUint32(dataStart + 4);
            const bitDepth = bytes[dataStart + 8];
            const colorType = bytes[dataStart + 9];
            const compression = bytes[dataStart + 10];
            const filterMethod = bytes[dataStart + 11];
            const interlace = bytes[dataStart + 12];
            if (
                width === 0 ||
                height === 0 ||
                bitDepth !== 8 ||
                colorType !== 6 ||
                compression !== 0 ||
                filterMethod !== 0 ||
                interlace !== 0
            ) {
                throw new Error("brand PNG: expected a non-interlaced 8-bit RGBA image");
            }
            if (width > Math.floor((DECODER_CAPACITY - 1) / 4)) {
                throw new Error("brand PNG: dimensions exceed decoder capacity");
            }
            stride = width * 4;
            if (height > Math.floor(DECODER_CAPACITY / (stride + 1))) {
                throw new Error("brand PNG: dimensions exceed decoder capacity");
            }
            expected = height * (stride + 1);
        } else if (type === "IDAT") {
            if (!sawIhdr || idatClosed) throw new Error("brand PNG: invalid IDAT order");
            sawIdat = true;
            if (compressedLength > DECODER_CAPACITY - length) {
                throw new Error("brand PNG: compressed data exceeds decoder capacity");
            }
            compressedLength += length;
            idat.push(bytes.slice(dataStart, dataEnd));
        } else if (type === "IEND") {
            if (!sawIhdr || !sawIdat || length !== 0 || sawIend || end !== bytes.byteLength) {
                throw new Error("brand PNG: invalid IEND");
            }
            sawIend = true;
        }
        offset = end;
    }

    if (!sawIhdr || !sawIdat || !sawIend) throw new Error("brand PNG: incomplete image");

    let inflated: Buffer;
    try {
        inflated = inflateSync(Buffer.concat(idat.map((part) => Buffer.from(part))), {
            maxOutputLength: expected,
        });
    } catch {
        throw new Error("brand PNG: invalid compressed image");
    }
    if (inflated.length !== expected) throw new Error("brand PNG: unexpected scanline length");

    const pixels = new Uint8Array(width * height * 4);
    const prior = new Uint8Array(stride);
    for (let y = 0; y < height; y++) {
        const rowStart = y * (stride + 1);
        const filter = inflated[rowStart];
        if (filter > 4) throw new Error(`brand PNG: unsupported filter ${filter}`);
        const row = inflated.subarray(rowStart + 1, rowStart + 1 + stride);
        const decoded = pixels.subarray(y * stride, (y + 1) * stride);
        for (let i = 0; i < stride; i++) {
            const left = i >= 4 ? decoded[i - 4] : 0;
            const up = prior[i] ?? 0;
            const upperLeft = i >= 4 ? (prior[i - 4] ?? 0) : 0;
            const predictor =
                filter === 0
                    ? 0
                    : filter === 1
                      ? left
                      : filter === 2
                        ? up
                        : filter === 3
                          ? Math.floor((left + up) / 2)
                          : paeth(left, up, upperLeft);
            decoded[i] = (row[i] as number) + predictor;
        }
        prior.set(decoded);
    }
    return { width, height, pixels };
}

function paeth(left: number, up: number, upperLeft: number): number {
    const p = left + up - upperLeft;
    const pa = Math.abs(p - left);
    const pb = Math.abs(p - up);
    const pc = Math.abs(p - upperLeft);
    return pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft;
}

const hexToRgb = (hex: string): [number, number, number] => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
];

/** Pixel grid → PNG bytes at `scale` pixels per cell. Transparent where the grid is null unless `ground` is set. */
export function toPng(grid: Grid, palette: Palette, scale: number, ground?: string): Uint8Array {
    const height = grid.length * scale;
    const width = (grid[0]?.length ?? 0) * scale;
    const raw = new Uint8Array(height * (1 + width * 4));
    const bg = ground ? hexToRgb(ground) : null;
    for (let y = 0; y < height; y++) {
        const row = grid[Math.floor(y / scale)] ?? [];
        const offset = y * (1 + width * 4);
        raw[offset] = 0;
        for (let x = 0; x < width; x++) {
            const tone = row[Math.floor(x / scale)] ?? null;
            const i = offset + 1 + x * 4;
            const rgb = tone ? hexToRgb(palette[tone]) : bg;
            if (!rgb) continue;
            raw[i] = rgb[0];
            raw[i + 1] = rgb[1];
            raw[i + 2] = rgb[2];
            raw[i + 3] = 255;
        }
    }
    const ihdr = new Uint8Array(13);
    const view = new DataView(ihdr.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    ihdr.set([8, 6, 0, 0, 0], 8);
    const parts = [
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk("IHDR", ihdr),
        chunk("IDAT", new Uint8Array(deflateSync(raw))),
        chunk("IEND", new Uint8Array(0)),
    ];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}
