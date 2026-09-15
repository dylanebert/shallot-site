import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { engineCandidate, engineCommit, root } from "../src/engine";
import { ROSTER } from "../src/roster";

// `bun run demos` is the site's display-gated demo gate. It builds ejected consumers through
// `scripts/build-site.ts`, then asks each built page to use Shallot's public `captureFrame` contract
// on a positively identified real adapter. A build, adapter, capture, or contract failure reds.
//
// The gate's unit is a built HTML entry point, not a demo directory. Per demo, the built `*.html` files
// under its output dir are enumerated structurally, and each one that presents a `<canvas>` directly is
// checked through the public capture contract. A page that hosts a canvas only inside an `<iframe>` is
// a link surface, not a frame unit; its target page is checked directly. A demo contributing zero
// entry points is a red, not a skip. The per-demo entry-point count is printed so a gate that silently
// stops finding pages is visible in its own output.
//
// Display-gated on a real display and conformant WebGPU adapter. A missing seat or fallback adapter
// throws and remains inconclusive, never green. A green run is native hardware with every demo captured.
//
// The roster is the single source of truth — imported from `site/roster.ts`, never duplicated. It is
// derived from the engine's tracked examples by enumeration, so a second copy is impossible by
// construction. Ejection and building are not re-implemented: `scripts/build-site.ts` already ejects,
// installs, and builds every roster demo into `out/site/<slug>/`. This script checks those built dirs.

const outDir = resolve(root, "out/site");

const CAPTURE_CONTRACT = "final-canvas 1280x720@1 rgba8-tight";

interface DemoOutcome {
    slug: string;
    result: "pass" | "fail" | "skip";
    entryPoints: number;
    detail?: string;
}

/** Runs one built page in a real browser and asks the page to use Shallot's public `captureFrame`.
 * The browser is closed in the same finally block that owns the verdict; no screenshot transport or
 * consumer-local frame reader survives here. */
async function capture(htmlPath: string, captureScript: string): Promise<number> {
    const browser = await chromium.launch({
        headless: false,
        executablePath:
            process.env.CHROME_PATH ??
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        args: ["--enable-unsafe-webgpu", "--allow-file-access-from-files"],
    });
    try {
        const page = await browser.newPage({
            viewport: { width: 1280, height: 720 },
            deviceScaleFactor: 1,
        });
        await page.goto(pathToFileURL(htmlPath).href, {
            waitUntil: "networkidle",
            timeout: 60_000,
        });
        await page.waitForFunction(
            () => {
                const canvas = document.querySelector("canvas");
                return (
                    canvas instanceof HTMLCanvasElement &&
                    canvas.width === 1280 &&
                    canvas.height === 720
                );
            },
            undefined,
            { timeout: 60_000 },
        );
        await page.addScriptTag({ content: captureScript, type: "module" });
        await page.waitForFunction(
            (contract) =>
                (
                    window as Window & {
                        __shallotCaptureResult?: { adapter: string; capture: string };
                    }
                ).__shallotCaptureResult?.capture === contract,
            CAPTURE_CONTRACT,
            { timeout: 60_000 },
        );
        const value = await page.evaluate(
            () =>
                (
                    window as Window & {
                        __shallotCaptureResult?: { adapter: string; capture: string };
                    }
                ).__shallotCaptureResult,
        );
        console.log(`  PASS: ${value?.capture} on ${value?.adapter}`);
        return 0;
    } finally {
        await browser.close();
    }
}

// A page presents a canvas directly when its own markup contains a `<canvas>` tag. An iframe-hosted
// canvas is captured by capturing the iframe's target page directly; a page whose only canvases live
// behind `<iframe src=...>` (the visualization gallery index) has no `<canvas>` in its own markup and
// is not an entry point. The check is structural — read the built HTML, look for the tag — so it does
// not hardcode any demo's page names and adapts when a multi-page demo adds or renames a page.
function hasDirectCanvas(htmlPath: string): boolean {
    const content = readFileSync(htmlPath, "utf-8");
    return /<canvas[\s>]/i.test(content);
}

// Enumerate every built `*.html` file under a demo's output dir (recursive) and return those that
// present a canvas directly — the verifiable entry points. Structural enumeration from the build
// output, not a hardcoded list: a named list is right today and blind to the next multi-page demo.
function enumerateEntryPoints(demoOut: string): string[] {
    const htmlFiles: string[] = [];
    function walk(dir: string): void {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.name.endsWith(".html")) {
                htmlFiles.push(full);
            }
        }
    }
    walk(demoOut);
    return htmlFiles.filter(hasDirectCanvas);
}

async function runDemo(slug: string, captureScript: string): Promise<DemoOutcome> {
    console.log(`\n--- ${slug} ---`);

    const demoOut = resolve(outDir, slug);
    if (!existsSync(demoOut)) {
        console.log(`FAIL: ${slug} — no build at out/site/${slug}/ (run \`bun run site\` first)`);
        return { slug, result: "fail", entryPoints: 0, detail: "no build output" };
    }

    // Enumerate built HTML entry points that present a canvas directly. The gallery index
    // (iframe-only, no direct canvas) is a link surface, not a verifiable unit — an iframe-hosted
    // canvas is verified by verifying the iframe's target page directly.
    const entryPoints = enumerateEntryPoints(demoOut);
    console.log(`  entry points: ${entryPoints.length}`);

    // A demo contributing zero verified entry points is a red, not a skip — the cheapest "fix" for a
    // false red is a false green, so this arm makes a gate that silently stops finding pages visible.
    if (entryPoints.length === 0) {
        console.log(
            `FAIL: ${slug} — zero verifiable entry points (no built HTML page presents a canvas directly)`,
        );
        return { slug, result: "fail", entryPoints: 0, detail: "zero entry points" };
    }

    let allPass = true;
    for (const entryHtml of entryPoints) {
        const label = entryHtml.slice(demoOut.length + 1);
        try {
            const code = await capture(entryHtml, captureScript);
            console.log(code === 0 ? `  PASS: ${label}` : `  FAIL: ${label} (exit ${code})`);
            if (code !== 0) allPass = false;
        } catch (error) {
            console.error(`  FAIL: ${label} — ${error instanceof Error ? error.message : error}`);
            allPass = false;
        }
    }

    return { slug, result: allPass ? "pass" : "fail", entryPoints: entryPoints.length };
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.includes("--help") || args.includes("-h")) {
        console.log(`Usage: bun run demos [--demo <slug>]

Builds every showcase demo (via \`bun run build\`) and runs the public \`captureFrame\` contract over each
built HTML entry point that presents a canvas directly — display-gated, on real hardware. A missing
seat or off-contract frame refuses; it is not green.

Options:
  --demo <slug>   Build and capture a single demo by its roster slug
  --candidate     Use the qualified full-SHA candidate for both build and capture`);
        process.exit(0);
    }

    const idx = args.indexOf("--demo");
    const only = idx !== -1 ? args[idx + 1] : undefined;
    const candidate = args.includes("--candidate");
    if (candidate && engineCommit() !== engineCandidate) {
        console.error(`✗ .engine is at ${engineCommit()}, not candidate ${engineCandidate}`);
        process.exit(1);
    }
    if (only && !ROSTER.some((d) => d.slug === only)) {
        console.error(`no demo "${only}" — one of: ${ROSTER.map((d) => d.slug).join(", ")}`);
        process.exit(2);
    }

    const demos = only ? ROSTER.filter((d) => d.slug === only) : ROSTER;

    const capture = await Bun.build({
        entrypoints: [resolve(root, "scripts/demos-capture.ts")],
        target: "browser",
        minify: true,
    });
    if (!capture.success) {
        for (const log of capture.logs) console.error(log);
        process.exit(1);
    }
    const captureScript = await capture.outputs[0]!.text();

    // --- build ---
    console.log("Building site demos...");
    const buildArgs = only ? ["run", "build", "--demo", only] : ["run", "build"];
    if (candidate) buildArgs.push("--candidate");
    const build = Bun.spawnSync(["bun", ...buildArgs], {
        cwd: root,
        stdout: "inherit",
        stderr: "inherit",
    });
    if (build.exitCode !== 0) {
        console.error("\nFAIL: site build failed — demos gate cannot proceed");
        process.exit(1);
    }

    // --- capture ---
    console.log("\nCapturing site demos (display-gated)...");
    const outcomes: DemoOutcome[] = [];
    for (const demo of demos) {
        outcomes.push(await runDemo(demo.slug, captureScript));
    }

    const passed = outcomes.filter((o) => o.result === "pass").length;
    const failed = outcomes.filter((o) => o.result === "fail").length;
    const skipped = outcomes.filter((o) => o.result === "skip").length;
    const total = outcomes.length;

    console.log(`\n=== summary ===`);
    console.log(`  ${passed}/${total} verified, ${failed} failed, ${skipped} skipped`);
    for (const o of outcomes) {
        console.log(
            `  ${o.slug}: ${o.result} (${o.entryPoints} entry point${o.entryPoints === 1 ? "" : "s"})`,
        );
    }

    if (failed > 0) {
        console.error("\nFAIL: demos gate failed");
        process.exit(1);
    }
    if (skipped > 0) {
        console.error(`\nSKIPPED: demos gate skipped (${skipped}/${total} demos) — not green`);
        process.exit(1);
    }
    console.log(`\nPASS: demos green (${passed}/${total} verified)`);
    process.exit(0);
}

if (import.meta.main) {
    main().catch((err) => {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    });
}
