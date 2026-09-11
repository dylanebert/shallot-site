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

/** Decode the 8-bit RGBA PNGs used by the engine's canonical brand assets. */
export function decodePng(bytes: Uint8Array): DecodedPng {
    if (!bytes.subarray(0, PNG_SIGNATURE.length).every((byte, i) => byte === PNG_SIGNATURE[i])) {
        throw new Error("brand PNG: invalid signature");
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = PNG_SIGNATURE.length;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    const idat: Uint8Array[] = [];
    while (offset < bytes.byteLength) {
        if (offset + 12 > bytes.byteLength) throw new Error("brand PNG: truncated chunk");
        const length = view.getUint32(offset);
        const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        if (dataEnd + 4 > bytes.byteLength) throw new Error(`brand PNG: truncated ${type}`);
        if (type === "IHDR") {
            if (length !== 13) throw new Error("brand PNG: invalid IHDR");
            width = view.getUint32(dataStart);
            height = view.getUint32(dataStart + 4);
            bitDepth = bytes[dataStart + 8] as number;
            colorType = bytes[dataStart + 9] as number;
            interlace = bytes[dataStart + 12] as number;
        } else if (type === "IDAT") {
            idat.push(bytes.slice(dataStart, dataEnd));
        } else if (type === "IEND") {
            break;
        }
        offset = dataEnd + 4;
    }
    if (!width || !height || bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
        throw new Error("brand PNG: expected a non-interlaced 8-bit RGBA image");
    }
    if (idat.length === 0) throw new Error("brand PNG: missing IDAT");

    const stride = width * 4;
    const filtered = new Uint8Array(
        inflateSync(Buffer.concat(idat.map((chunk) => Buffer.from(chunk)))),
    );
    const expected = height * (stride + 1);
    if (filtered.length !== expected) throw new Error("brand PNG: unexpected scanline length");
    const pixels = new Uint8Array(width * height * 4);
    const prior = new Uint8Array(stride);
    for (let y = 0; y < height; y++) {
        const rowStart = y * (stride + 1);
        const filter = filtered[rowStart];
        const row = filtered.subarray(rowStart + 1, rowStart + 1 + stride);
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
                          : filter === 4
                            ? paeth(left, up, upperLeft)
                            : -1;
            if (predictor < 0) throw new Error(`brand PNG: unsupported filter ${filter}`);
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
