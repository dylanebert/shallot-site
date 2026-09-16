// The shipped icons are generated, so their arms are equality against the engine's canonical
// renderer artifact: a hand edit or half-applied regeneration reads red here.
// These checks require the repository-owned engine checkout because the engine owns the tracked
// showcase population, scaffold and native icon inputs.

import { expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { check } from "@dylanebert/shallot/harness/check";
import { decodePng } from "../src/brand/png";
import { root } from "../src/engine";
import { icon, iconTargets, nativeIcon, ROOT, SCAFFOLD, scaffoldSource } from "./brand-assets";
import { buildBrand } from "./build-pages";

const engine = ROOT;
const CANDIDATE_LAYOUT = !existsSync(resolve(engine, "examples/showcase"));
const CANONICAL_LOGO = CANDIDATE_LAYOUT ? "assets/icon-1024.png" : "assets/logo-1024.png";

function requireEngineCheckout(): void {
    const required = CANDIDATE_LAYOUT
        ? [resolve(engine, ".git"), resolve(engine, "examples"), resolve(engine, CANONICAL_LOGO)]
        : [
              resolve(engine, ".git"),
              resolve(engine, "examples/showcase"),
              resolve(engine, "packages/create-shallot/index.ts"),
              resolve(engine, "packages/shallot/assets/icon-1024.png"),
              resolve(engine, CANONICAL_LOGO),
          ];
    const missing = required.filter((path) => !existsSync(path));
    if (missing.length > 0) {
        throw new Error(
            `refused brand artifact check: missing engine checkout premise (${missing.join(", ")}); run bun run engine`,
        );
    }
}

const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8");

const TEST_PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function independentCrc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function testChunk(type: string, data: Uint8Array, corruptCrc = false): Uint8Array {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    const crc = independentCrc32(out.subarray(4, 8 + data.length));
    view.setUint32(8 + data.length, corruptCrc ? crc ^ 1 : crc);
    return out;
}

function testPng(chunks: Uint8Array[]): Uint8Array {
    const length =
        TEST_PNG_SIGNATURE.length + chunks.reduce((total, chunk) => total + chunk.length, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    out.set(TEST_PNG_SIGNATURE, offset);
    offset += TEST_PNG_SIGNATURE.length;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

function testIhdr(width = 1, height = 1): Uint8Array {
    const data = new Uint8Array(13);
    const view = new DataView(data.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    data.set([8, 6, 0, 0, 0], 8);
    return data;
}

function testIdat(raw = Uint8Array.of(0, 1, 2, 3, 255), split = false): Uint8Array[] {
    const compressed = new Uint8Array(deflateSync(raw));
    if (!split) return [testChunk("IDAT", compressed)];
    const middle = Math.max(1, Math.floor(compressed.length / 2));
    return [
        testChunk("IDAT", compressed.subarray(0, middle)),
        testChunk("IDAT", compressed.subarray(middle)),
    ];
}

function validChunks(
    raw = Uint8Array.of(0, 1, 2, 3, 255),
    header = testIhdr(),
    split = false,
): Uint8Array[] {
    return [
        testChunk("IHDR", header),
        ...testIdat(raw, split),
        testChunk("IEND", new Uint8Array()),
    ];
}

function validPng(
    raw = Uint8Array.of(0, 1, 2, 3, 255),
    header = testIhdr(),
    split = false,
): Uint8Array {
    return testPng(validChunks(raw, header, split));
}

const filterRows = [
    [0, 10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255],
    [1, 11, 22, 33, 254, 33, 33, 33, 255, 33, 33, 33, 255],
    [2, 1, 2, 3, 255, 4, 5, 6, 254, 7, 8, 9, 253],
    [3, 14, 18, 22, 126, 26, 25, 24, 255, 28, 27, 26, 255],
    [4, 5, 5, 5, 255, 15, 15, 15, 255, 25, 25, 25, 255],
];
const filterPixels = [
    10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 11, 22, 33, 254, 44, 55, 66, 253, 77, 88, 99,
    252, 12, 24, 36, 253, 48, 60, 72, 251, 84, 96, 108, 249, 20, 30, 40, 252, 60, 70, 80, 250, 100,
    110, 120, 248, 25, 35, 45, 251, 75, 85, 95, 249, 125, 135, 145, 247,
];
const filterPng = testPng([
    testChunk("IHDR", testIhdr(3, 5)),
    ...testIdat(Uint8Array.from(filterRows.flat()), true),
    testChunk("IEND", new Uint8Array()),
]);

const malformedPngs: ReadonlyArray<readonly [string, Uint8Array]> = [
    [
        "bad IHDR CRC",
        testPng([
            testChunk("IHDR", testIhdr(), true),
            ...testIdat(),
            testChunk("IEND", new Uint8Array()),
        ]),
    ],
    [
        "bad IDAT CRC",
        testPng([
            testChunk("IHDR", testIhdr()),
            testChunk("IDAT", new Uint8Array(deflateSync(Uint8Array.of(0, 1, 2, 3, 255))), true),
            testChunk("IEND", new Uint8Array()),
        ]),
    ],
    [
        "bad IEND CRC",
        testPng([
            testChunk("IHDR", testIhdr()),
            ...testIdat(),
            testChunk("IEND", new Uint8Array(), true),
        ]),
    ],
    [
        "bad ignored ancillary CRC",
        testPng([
            testChunk("IHDR", testIhdr()),
            testChunk("tEXt", Uint8Array.of(1, 2, 3), true),
            ...testIdat(),
            testChunk("IEND", new Uint8Array()),
        ]),
    ],
    ["IHDR not first", testPng([testChunk("tEXt", Uint8Array.of(1)), ...validChunks()])],
    [
        "non-13-byte IHDR",
        testPng([
            testChunk("IHDR", Uint8Array.of(1, 2)),
            ...testIdat(),
            testChunk("IEND", new Uint8Array()),
        ]),
    ],
    [
        "duplicate IHDR",
        testPng([
            testChunk("IHDR", testIhdr()),
            testChunk("IHDR", testIhdr()),
            ...testIdat(),
            testChunk("IEND", new Uint8Array()),
        ]),
    ],
    ["missing IDAT", testPng([testChunk("IHDR", testIhdr()), testChunk("IEND", new Uint8Array())])],
    [
        "IDAT before IHDR",
        testPng([
            ...testIdat(),
            testChunk("IHDR", testIhdr()),
            testChunk("IEND", new Uint8Array()),
        ]),
    ],
    [
        "nonconsecutive IDAT",
        (() => {
            const idat = testIdat(Uint8Array.of(0, 1, 2, 3, 255), true);
            return testPng([
                testChunk("IHDR", testIhdr()),
                idat[0],
                testChunk("tEXt", Uint8Array.of(1)),
                idat[1],
                testChunk("IEND", new Uint8Array()),
            ]);
        })(),
    ],
    ["missing IEND", testPng([testChunk("IHDR", testIhdr()), ...testIdat()])],
    [
        "IEND before IDAT",
        testPng([testChunk("IHDR", testIhdr()), testChunk("IEND", new Uint8Array())]),
    ],
    [
        "nonzero IEND",
        testPng([
            testChunk("IHDR", testIhdr()),
            ...testIdat(),
            testChunk("IEND", Uint8Array.of(1)),
        ]),
    ],
    [
        "duplicate IEND",
        testPng([
            testChunk("IHDR", testIhdr()),
            ...testIdat(),
            testChunk("IEND", new Uint8Array()),
            testChunk("IEND", new Uint8Array()),
        ]),
    ],
    ["chunk after IEND", new Uint8Array([...validPng(), ...testChunk("tEXt", Uint8Array.of(1))])],
    ["trailing byte after IEND", new Uint8Array([...validPng(), 0])],
    ["truncated chunk header", new Uint8Array([...TEST_PNG_SIGNATURE, 0, 0, 0, 0, 73, 68, 65, 84])],
    [
        "oversized chunk length",
        new Uint8Array([...TEST_PNG_SIGNATURE, 0, 0, 0, 1, 73, 68, 65, 84, 0, 0, 0, 0]),
    ],
    [
        "oversized declared dimensions",
        validPng(
            undefined,
            (() => {
                const header = testIhdr(0xffffffff, 1);
                return header;
            })(),
        ),
    ],
    [
        "unsupported bit depth",
        (() => {
            const header = testIhdr();
            header[8] = 16;
            return validPng(undefined, header);
        })(),
    ],
    [
        "unsupported color type",
        (() => {
            const header = testIhdr();
            header[9] = 2;
            return validPng(undefined, header);
        })(),
    ],
    [
        "unsupported compression method",
        (() => {
            const header = testIhdr();
            header[10] = 1;
            return validPng(undefined, header);
        })(),
    ],
    [
        "unsupported filter method",
        (() => {
            const header = testIhdr();
            header[11] = 1;
            return validPng(undefined, header);
        })(),
    ],
    [
        "unsupported interlace",
        (() => {
            const header = testIhdr();
            header[12] = 1;
            return validPng(undefined, header);
        })(),
    ],
    [
        "unknown critical chunk",
        testPng([
            testChunk("IHDR", testIhdr()),
            ...testIdat(),
            testChunk("ABCD", new Uint8Array()),
            testChunk("IEND", new Uint8Array()),
        ]),
    ],
    ["unsupported scanline filter", validPng(Uint8Array.of(5, 1, 2, 3, 255))],
    ["wrong inflated scanline length", validPng(Uint8Array.of(0, 1, 2, 3))],
];

check(
    "brand PNG decoder reconstructs all supported RGBA filters",
    { claim: "reconstructs all supported RGBA filters" },
    () => {
        const decoded = decodePng(filterPng);
        expect(decoded.width).toBe(3);
        expect(decoded.height).toBe(5);
        expect(Array.from(decoded.pixels)).toEqual(filterPixels);
    },
);

check(
    "brand PNG decoder refuses malformed or unsupported narrow inputs",
    { claim: "refuses malformed or unsupported narrow PNG inputs" },
    () => {
        for (const [name, bytes] of malformedPngs) {
            expect(() => decodePng(bytes), name).toThrow();
        }
    },
);

/** Compare the rendered mark while ignoring renderer metadata (titles, ids and blank lines). */
function comparableSvg(source: string): string {
    return source
        .replace(/\s+id="[^"]*"/g, "")
        .replace(/\s*<title>[\s\S]*?<\/title>/g, "")
        .replace(/\n\s*\n/g, "\n")
        .trim();
}

check(
    "the installed brand module owns the displayed source",
    { claim: "installed brand source owns production display" },
    async () => {
        const output = mkdtempSync(join(tmpdir(), "shallot-brand-owner-"));
        try {
            await buildBrand(output);
            const installedBrand = Bun.resolveSync("@dylanebert/shallot/brand", root);
            expect(readFileSync(resolve(output, "brand/mark.ts"), "utf8")).toBe(
                readFileSync(installedBrand, "utf8"),
            );
        } finally {
            rmSync(output, { recursive: true, force: true });
        }
    },
);

check(
    "every default example icon is the rendered mark",
    {
        claim: "tracked default showcase icons remain structurally equal to the engine's rendered mark",
        size: "integration",
        subject: "engine.json",
    },
    () => {
        requireEngineCheckout();
        const targets = iconTargets();
        expect(targets.length).toBeGreaterThan(CANDIDATE_LAYOUT ? 0 : 30);
        const engineIcon = CANDIDATE_LAYOUT
            ? `${icon()}\n`
            : readFileSync(resolve(engine, "assets/icon.svg"), "utf8");
        for (const file of targets) {
            expect(comparableSvg(read(file))).toBe(comparableSvg(engineIcon));
        }
    },
);

check(
    "a project's own icon stays its own",
    {
        claim: "a showcase-owned icon remains excluded from default brand regeneration",
        size: "integration",
        subject: "engine.json",
    },
    () => {
        requireEngineCheckout();
        if (CANDIDATE_LAYOUT) {
            expect(iconTargets().length).toBeGreaterThan(0);
            return;
        }
        const own = "examples/flows/no-walls/public/icon.svg";
        expect(iconTargets()).not.toContain(own);
        expect(read(own)).toContain('fill="#f233b3"');
    },
);

check(
    "the scaffold's icon source remains stable",
    {
        claim: "the create-shallot scaffold keeps its generated icon source internally stable",
        size: "integration",
        subject: "engine.json",
    },
    () => {
        requireEngineCheckout();
        if (CANDIDATE_LAYOUT) {
            expect(existsSync(resolve(engine, SCAFFOLD))).toBe(false);
            return;
        }
        const source = scaffoldSource(read(SCAFFOLD));
        expect(source).toContain(`const ICON = \`${icon()}\n\`;`);
    },
);

check(
    "the native window icon is the canonical square mark",
    {
        claim: "the shipped native icon remains the canonical 960-pixel square mark",
        size: "integration",
        subject: "engine.json",
    },
    () => {
        requireEngineCheckout();
        const native = decodePng(nativeIcon());
        const canonicalLogo = decodePng(readFileSync(resolve(engine, CANONICAL_LOGO)));
        expect(native.width).toBe(CANDIDATE_LAYOUT ? 1024 : 960);
        expect(native.height).toBe(CANDIDATE_LAYOUT ? 1024 : 960);
        expect(canonicalLogo.height).toBe(CANDIDATE_LAYOUT ? 1024 : 960);
        expect(canonicalLogo.width).toBeGreaterThanOrEqual(native.width);
        if (CANDIDATE_LAYOUT) {
            expect(Buffer.from(native.pixels)).toEqual(Buffer.from(canonicalLogo.pixels));
            return;
        }

        // The engine's rendered logo is an independent canonical raster. The logo generator
        // places its wordmark at x=70 in the 80-unit viewBox, so the first 840 rendered columns
        // are the icon and gap; the native 960-square canvas is transparent for the remainder.
        // Compare decoded RGBA pixels, not PNG bytes or only dimensions.
        const canonical = new Uint8Array(native.width * native.height * 4);
        const canonicalLogoStride = canonicalLogo.width * 4;
        const nativeStride = native.width * 4;
        const markColumns = 70 * 12;
        for (let y = 0; y < native.height; y++) {
            canonical.set(
                canonicalLogo.pixels.subarray(
                    y * canonicalLogoStride,
                    y * canonicalLogoStride + markColumns * 4,
                ),
                y * nativeStride,
            );
        }
        expect(Buffer.from(native.pixels)).toEqual(Buffer.from(canonical));
    },
);
