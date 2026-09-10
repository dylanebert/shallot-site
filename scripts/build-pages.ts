import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    DARK,
    fromBlocks,
    LIGHT,
    lockup,
    MARK,
    toCells,
    toSvg,
    toText,
    word,
} from "../src/brand/mark";
import { brandPage } from "../src/brand/page";
import { toPng } from "../src/brand/png";
import { engineRef, engineVersion, root } from "../src/engine";
import { llmsTxt, siteIndex } from "../src/home";
import { ROSTER } from "../src/roster";
import { datadogInitSnippet } from "../src/rum-config";

// `bun run pages` — the site's own pages without the demos: out/site/index.html, llms.txt and
// out/site/brand/ with its downloads. `build-site.ts` calls the same function after the demo
// loop, so this is also how to iterate on the pages locally without a demo build. Run alone it
// builds in staging mode: every link and label names the engine checkout's commit. Production
// labels come from `bun run build`, which pins to the published version.

export async function bundleClient(): Promise<string> {
    const result = await Bun.build({
        entrypoints: [resolve(root, "src/brand/client.ts")],
        target: "browser",
        minify: true,
    });
    if (!result.success) {
        for (const log of result.logs) console.error(log);
        throw new Error("failed to bundle src/brand/client.ts");
    }
    const output = result.outputs[0];
    if (!output) throw new Error("src/brand/client.ts bundle produced no output");
    return await output.text();
}

/** Centre a grid in a square frame; the favicon frame around the 12×14 mark. */
function framed(grid: ReturnType<typeof fromBlocks>, size: number): ReturnType<typeof fromBlocks> {
    const w = grid[0]?.length ?? 0;
    const h = grid.length;
    const ox = Math.floor((size - w) / 2);
    const oy = Math.floor((size - h) / 2);
    return Array.from({ length: size }, (_, y) =>
        Array.from({ length: size }, (_, x) => grid[y - oy]?.[x - ox] ?? null),
    );
}

/** Writes the brand page and every download into `out/brand/`. */
export async function buildBrand(
    outDir: string,
    clientScript?: string,
    rum: string = "",
): Promise<void> {
    const dir = resolve(outDir, "brand");
    mkdirSync(dir, { recursive: true });
    const mark = fromBlocks(MARK.m);
    const lock = lockup();
    const write = (name: string, data: string | Uint8Array) =>
        writeFileSync(resolve(dir, name), data);
    write("index.html", brandPage(clientScript ?? (await bundleClient()), rum));
    write("mark.svg", toSvg(mark, DARK, 1));
    write("mark.png", toPng(mark, DARK, 8));
    write("mark-16.png", toPng(framed(mark, 16), DARK, 1));
    write("mark-32.png", toPng(framed(mark, 16), DARK, 2));
    write("lockup-dark.svg", toSvg(lock, DARK, 1));
    write("lockup-light.svg", toSvg(lock, LIGHT, 1));
    write("lockup-dark.png", toPng(lock, DARK, 4, DARK.bg));
    write("lockup-light.png", toPng(lock, LIGHT, 4, LIGHT.bg));
    write("wordmark.svg", toSvg(word(), DARK, 1));
    write("wordmark.png", toPng(word(), DARK, 8));
    write("mark.txt", `${toText(toCells(mark))}\n`);
    write("mark.ts", readFileSync(resolve(root, "src/brand/mark.ts"), "utf8"));
}

/** Writes the home index, `llms.txt`, and the brand pages. `rumMode` picks the Datadog env
 * derivation the pages carry: the hostname-derived prod snippet tags a localhost preview
 * "local", so a standalone pages build uses it even while labelling itself staging. */
export async function buildPages(
    outDir: string,
    version: string,
    ref: string,
    mode: "prod" | "staging",
    rumMode: "prod" | "staging" = mode,
): Promise<void> {
    mkdirSync(outDir, { recursive: true });
    const client = await bundleClient();
    const rum = datadogInitSnippet(rumMode);
    writeFileSync(
        resolve(outDir, "index.html"),
        siteIndex(ROSTER, version, ref, mode, client, rum),
    );
    writeFileSync(resolve(outDir, "llms.txt"), llmsTxt(version, ref, mode));
    await buildBrand(outDir, client, rum);
}

if (import.meta.main) {
    const refShort = engineRef();
    const outDir = resolve(root, "out/site");
    await buildPages(outDir, engineVersion, refShort, "staging", "prod");
    console.log(
        `pages (staging · ${refShort}): ${outDir}/index.html, ${outDir}/llms.txt, ${outDir}/brand/`,
    );
}
