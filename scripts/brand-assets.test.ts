// The shipped icons are generated, so their arms are equality against the engine's canonical
// renderer artifact: a hand edit or half-applied regeneration reads red here.
// These checks require the repository-owned engine checkout because the engine owns the tracked
// showcase population, scaffold and native icon inputs.

import { expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { check } from "@dylanebert/shallot/harness/check";
import {
    icon,
    iconTargets,
    NATIVE_ICON,
    nativeIcon,
    ROOT,
    SCAFFOLD,
    scaffoldSource,
} from "./brand-assets";

const engine = ROOT;

function requireEngineCheckout(): void {
    const required = [
        resolve(engine, ".git"),
        resolve(engine, "examples/showcase"),
        resolve(engine, "packages/create-shallot/index.ts"),
        resolve(engine, "packages/shallot/assets/icon-1024.png"),
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
    "every default example icon is the rendered mark",
    {
        claim: "tracked default showcase icons remain structurally equal to the engine's rendered mark",
        size: "integration",
        subject: "engine.json",
    },
    () => {
        requireEngineCheckout();
        const targets = iconTargets();
        expect(targets.length).toBeGreaterThan(30);
        const engineIcon = readFileSync(resolve(engine, "assets/icon.svg"), "utf8");
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
    "the scaffold's icon source remains stable",
    {
        claim: "the create-shallot scaffold keeps its generated icon source internally stable",
        size: "integration",
        subject: "engine.json",
    },
    () => {
        requireEngineCheckout();
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
        const bytes = nativeIcon();
        const header = new DataView(bytes.buffer, bytes.byteOffset);
        expect(header.getUint32(16)).toBe(960);
        expect(header.getUint32(20)).toBe(960);
        expect(readFileSync(resolve(ROOT, NATIVE_ICON))).toEqual(Buffer.from(bytes));
    },
);
