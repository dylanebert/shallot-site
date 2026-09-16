// The site's narrow PNG decoder, proved over independently encoded bytes: every supported RGBA
// filter reconstructs, and malformed or unsupported inputs refuse.

import { expect } from "bun:test";
import { deflateSync } from "node:zlib";
import { check } from "@dylanebert/shallot/harness/check";
import { decodePng } from "./png";

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
