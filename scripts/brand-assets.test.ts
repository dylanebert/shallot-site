// The shipped icons are generated, so their arms are equality against the engine's canonical
// renderer artifact: a hand edit or half-applied regeneration reads red here.
// These checks require the repository-owned engine checkout because the engine owns the tracked
// showcase population, scaffold and native icon inputs.

import { expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { check } from "@dylanebert/shallot/harness/check";
import { decodePng } from "../src/brand/png";
import { root } from "../src/engine";
import { icon, iconTargets, nativeIcon, ROOT } from "./brand-assets";
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
        const own = "examples/flows/no-walls/public/icon.svg";
        expect(iconTargets()).not.toContain(own);
        expect(read(own)).toContain('fill="#f233b3"');
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
