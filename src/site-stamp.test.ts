import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mismatchedShallotDemos, readStamp, writeStamp } from "./site-stamp";

test("reviewer mixed-build red: same-version Shallot content hashes catch a partial rebuild", () => {
    const outDir = mkdtempSync(join(tmpdir(), "shallot-mixed-build-"));
    const slugs = ["first-person", "loading-screen"];
    const markerA = { version: "0.10.0-next.2", contentHash: "a".repeat(64) };
    const markerB = { version: "0.10.0-next.2", contentHash: "b".repeat(64) };
    try {
        for (const slug of slugs) mkdirSync(join(outDir, slug));

        writeStamp(
            outDir,
            { "first-person": "source-a", "loading-screen": "source-a" },
            { kind: "prod", version: markerA.version },
            "build-a",
            markerA,
        );
        // Mirrors `build --demo first-person`: the global build advances to B, but the
        // untouched loading-screen slot retains its original per-demo Shallot identity.
        writeStamp(
            outDir,
            { "first-person": "source-b" },
            { kind: "prod", version: markerB.version },
            "build-b",
            markerB,
        );

        const stamp = readStamp(outDir);
        expect(stamp).not.toBeNull();
        expect(stamp?.mode.version).toBe(markerB.version);
        expect(stamp?.shallot["first-person"]).toEqual(markerB);
        expect(stamp?.shallot["loading-screen"]).toEqual(markerA);
        expect(mismatchedShallotDemos(stamp!, outDir, slugs, markerB)).toEqual([
            `loading-screen: built with Shallot 0.10.0-next.2 sha256:${"a".repeat(64)}, site resolves 0.10.0-next.2 sha256:${"b".repeat(64)}`,
        ]);
    } finally {
        rmSync(outDir, { recursive: true, force: true });
    }
}, 250);
