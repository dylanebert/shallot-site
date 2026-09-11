import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Glob } from "bun";
import {
    checkoutTag,
    enginePackage,
    engineRef,
    engineRoot,
    engineTag,
    engineVersion,
    root,
} from "../src/engine";
import { llmsTxt, siteIndex } from "../src/home";
import { ROSTER } from "../src/roster";
import { datadogInitSnippet } from "../src/rum-config";
import { demoFingerprints, type SiteMode, writeStamp } from "../src/site-stamp";
import { buildBrand, bundleClient } from "./build-pages";
import type { DemoPackage } from "./build-site-logic";
import { rewriteSiteDependencies, workspaceExtensionDependencies } from "./build-site-logic";

export {
    nonWorkspaceShallotDependencies,
    rewriteSiteDependencies,
    shallotDependencies,
    workspaceExtensionDependencies,
} from "./build-site-logic";

// the RUM init snippet lives in `src/rum-config.ts` so the pages build can inject it too;
// re-exported here because the site tests import it from this module
export { datadogInitSnippet };

// `bun run build` — build every showcase demo in the engine checkout (`bun run engine`) as an
// ejected consumer of the *published* package, then assemble the site index. Each demo is copied
// to a scratch tree under /tmp with two files rewritten: a standalone `package.json` pinning
// `@dylanebert/shallot` to the version this repo's `package.json` pins (every other dep carried
// over as authored), and a standalone `tsconfig.json`. The scratch tree installs against npm and
// builds with `shallot build`, so the artifact is a real published-consumer build.
//
// `--staging` is the same pipeline with one pin swapped: `bun pm pack` packs the engine checkout
// once (check out `main` with `bun run engine --ref main`), and every demo's `@dylanebert/shallot`
// dependency is rewritten to `file:<tgz>`. The RUM env constant and the index label switch with it.

/** the literal `PIPELINE_COMPILE_MEASURE_PREFIX` in the engine's `src/engine/runtime/gpu.ts`;
 * the engine exports no subpath for it, and the RUM bundle needs only the string */
const PIPELINE_COMPILE_MEASURE_PREFIX = "shallot:pipeline-compile:";

const showcaseDir = resolve(engineRoot, "examples/showcase");
const outDir = resolve(root, "out/site");

/** Bundles `src/rum-runtime.ts` (which imports the pure sampler) to a single browser-target ESM
 * script — inlined so every demo page, at any output depth, carries it with no relative-path
 * plumbing. `define` inlines the compile-measure prefix as the ambient
 * `__PIPELINE_COMPILE_MEASURE_PREFIX__` global. */
async function buildRumRuntimeBundle(): Promise<string> {
    const result = await Bun.build({
        entrypoints: [resolve(root, "src/rum-runtime.ts")],
        target: "browser",
        minify: false,
        define: {
            __PIPELINE_COMPILE_MEASURE_PREFIX__: JSON.stringify(PIPELINE_COMPILE_MEASURE_PREFIX),
        },
    });
    if (!result.success) {
        for (const log of result.logs) console.error(log);
        throw new Error("failed to bundle src/rum-runtime.ts");
    }
    const output = result.outputs[0];
    if (!output) throw new Error("src/rum-runtime.ts bundle produced no output");
    return await output.text();
}

/** Injects the Datadog init snippet plus the bundled sampler into every `*.html` file under
 * `dir` (recursive — a demo like `visualization` emits nested pages under `demos/`), right
 * before `</body>`. */
function injectRum(dir: string, runtimeBundle: string, mode: "prod" | "staging"): void {
    const snippet = `${datadogInitSnippet(mode)}<script type="module">\n${runtimeBundle}</script>\n`;
    const glob = new Glob("**/*.html");
    for (const path of glob.scanSync({ cwd: dir })) {
        const full = resolve(dir, path);
        const html = readFileSync(full, "utf8");
        const closeBodyRe = /<\/body>/i;
        if (!closeBodyRe.test(html)) {
            console.error(`✗ ${path} has no </body> — cannot inject RUM snippet`);
            process.exit(1);
        }
        writeFileSync(full, html.replace(closeBodyRe, `${snippet}</body>`));
    }
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.includes("--help") || args.includes("-h")) {
        console.log(`Usage: bun run build [--demo <slug>] [--staging]

Builds every showcase demo in .engine/ as an ejected consumer of the published
@dylanebert/shallot, assembles out/site/<slug>/ per demo, and emits out/site/index.html.

Options:
  --demo <slug>   Build a single demo by its roster slug
  --staging       Pin @dylanebert/shallot to a packed tarball of the engine checkout instead
                   of the release version, and tag the RUM env + index label "staging"`);
        process.exit(0);
    }

    const idx = args.indexOf("--demo");
    const only = idx !== -1 ? args[idx + 1] : undefined;

    const staging = args.includes("--staging");
    const mode: "prod" | "staging" = staging ? "staging" : "prod";

    if (!existsSync(showcaseDir)) {
        console.error(`✗ no engine checkout at ${engineRoot} — run \`bun run engine\` first`);
        process.exit(1);
    }
    const version = engineVersion;
    const refShort = engineRef();
    if (!staging) {
        const tag = checkoutTag();
        if (tag !== engineTag) {
            console.error(
                `✗ .engine is at ${tag ?? refShort}, not ${engineTag} — run \`bun run engine\``,
            );
            process.exit(1);
        }
        if (engineTag !== `v${version}`) {
            console.error(
                `✗ engine.json pins ${engineTag} but package.json pins @dylanebert/shallot ${version}`,
            );
            process.exit(1);
        }
    }

    if (only && !ROSTER.some((d) => d.slug === only)) {
        console.error(`no demo "${only}" — one of: ${ROSTER.map((d) => d.slug).join(", ")}`);
        process.exit(2);
    }
    const demos = only ? ROSTER.filter((d) => d.slug === only) : ROSTER;

    // clean + recreate the output dir — a single-demo build only clears that demo's slot,
    // so a prior full build's other demos survive
    if (only) {
        rmSync(resolve(outDir, only), { recursive: true, force: true });
    } else {
        rmSync(outDir, { recursive: true, force: true });
    }
    mkdirSync(outDir, { recursive: true });

    const rumRuntimeBundle = await buildRumRuntimeBundle();

    // Discover and pack workspace extensions once, before any demo is ejected. Unlike the engine,
    // extensions are packed in both modes because unpublished workspace extensions cannot be
    // installed by an outside consumer.
    const extensionNames = new Set<string>();
    for (const demo of demos) {
        const demoPkg = (await Bun.file(
            resolve(showcaseDir, demo.slug, "package.json"),
        ).json()) as DemoPackage;
        for (const name of workspaceExtensionDependencies(demoPkg)) extensionNames.add(name);
    }

    let enginePin = version;
    const packDest = mkdtempSync(join(tmpdir(), "shallot-site-pack-"));
    const extensionPins = new Map<string, string>();
    const pack = (name: string, packageDir: string): string => {
        const destination = resolve(packDest, name.replace("/", "-"));
        mkdirSync(destination, { recursive: true });
        console.log(`\npacking ${name}...`);
        const result = Bun.spawnSync(["bun", "pm", "pack", "--destination", destination], {
            cwd: packageDir,
            stdout: "inherit",
            stderr: "inherit",
        });
        if (result.exitCode !== 0) throw new Error(`\`bun pm pack\` failed for ${packageDir}`);
        const tgz = readdirSync(destination).find((f) => f.endsWith(".tgz") && !f.startsWith("."));
        if (!tgz) throw new Error(`no tarball produced in ${destination}`);
        return `file:${resolve(destination, tgz)}`;
    };
    if (staging) enginePin = pack("@dylanebert/shallot", enginePackage());
    for (const name of [...extensionNames].sort()) {
        const packageDir = resolve(engineRoot, "packages", name.slice("@dylanebert/".length));
        extensionPins.set(name, pack(name, packageDir));
    }

    const sizes: { slug: string; size: string }[] = [];

    try {
        for (const demo of demos) {
            const slug = demo.slug;
            const srcDir = resolve(showcaseDir, slug);
            if (!existsSync(srcDir)) {
                console.error(`✗ showcase dir not found: ${srcDir}`);
                process.exit(1);
            }

            // the demo dir's basename must be the slug: `shallot build` synthesizes the page
            // <title> from it, so a unique parent carries the uniqueness and the leaf stays clean
            const scratchParent = mkdtempSync(join(tmpdir(), `shallot-site-${slug}-`));
            const scratch = join(scratchParent, slug);
            mkdirSync(scratch, { recursive: true });

            try {
                console.log(`\n=== ${slug} ===`);

                const nodeModulesDir = resolve(srcDir, "node_modules");
                const distDir = resolve(srcDir, "dist");
                cpSync(srcDir, scratch, {
                    recursive: true,
                    filter: (s) =>
                        s !== nodeModulesDir &&
                        !s.startsWith(nodeModulesDir + sep) &&
                        s !== distDir &&
                        !s.startsWith(distDir + sep),
                });

                const demoPkg = (await Bun.file(
                    resolve(scratch, "package.json"),
                ).json()) as DemoPackage;
                rewriteSiteDependencies(demoPkg, enginePin, extensionPins);
                writeFileSync(
                    resolve(scratch, "package.json"),
                    `${JSON.stringify(demoPkg, null, 4)}\n`,
                );

                // the in-repo tsconfig extends an engine-root path that doesn't exist outside it
                writeFileSync(resolve(scratch, "tsconfig.json"), `${standaloneTsconfig()}\n`);

                console.log(`  installing...`);
                const install = Bun.spawnSync(["bun", "install"], {
                    cwd: scratch,
                    stdout: "inherit",
                    stderr: "inherit",
                });
                if (install.exitCode !== 0) {
                    console.error(`✗ install failed for ${slug}`);
                    process.exit(1);
                }

                console.log(`  building...`);
                const build = Bun.spawnSync(["bunx", "shallot", "build"], {
                    cwd: scratch,
                    stdout: "inherit",
                    stderr: "inherit",
                });
                if (build.exitCode !== 0) {
                    console.error(`✗ build failed for ${slug}`);
                    process.exit(1);
                }

                const dist = resolve(scratch, "dist");
                if (!existsSync(dist)) {
                    console.error(`✗ no dist/ produced for ${slug}`);
                    process.exit(1);
                }
                const demoOut = resolve(outDir, slug);
                cpSync(dist, demoOut, { recursive: true });
                injectRum(demoOut, rumRuntimeBundle, mode);

                const sizeBytes = dirSize(demoOut);
                sizes.push({ slug, size: formatSize(sizeBytes) });
                console.log(`  done — ${formatSize(sizeBytes)}`);
            } finally {
                rmSync(scratchParent, { recursive: true, force: true });
            }
        }
    } finally {
        rmSync(packDest, { recursive: true, force: true });
    }

    // the site's own pages beside the demos: the index (always the full roster, so a `--demo`
    // build's index still lists the others), llms.txt, and /brand/ with its downloads
    const client = await bundleClient();
    const rum = datadogInitSnippet(mode);
    writeFileSync(
        resolve(outDir, "index.html"),
        siteIndex(ROSTER, version, refShort, mode, client, rum),
    );
    writeFileSync(resolve(outDir, "llms.txt"), llmsTxt(version, refShort, mode));
    await buildBrand(outDir, client, rum);

    // record what each demo was built from, so `check-site.ts` can tell an artifact of *these*
    // sources from an artifact of some other sources. A production build reads an immutable tag,
    // so its entries record the tag rather than a tree fingerprint.
    const siteMode: SiteMode = staging
        ? { kind: "staging", pin: enginePin }
        : { kind: "prod", version, tag: engineTag };
    const fingerprints = staging
        ? demoFingerprints(
              engineRoot,
              demos.map((d) => d.slug),
              root,
          )
        : Object.fromEntries(demos.map((d) => [d.slug, `tag:${engineTag}`]));
    writeStamp(outDir, fingerprints, siteMode);

    const total = sizes.reduce((sum, s) => sum + parseSize(s.size), 0);
    console.log(`\n=== summary ===`);
    for (const { slug, size } of sizes) {
        console.log(`  ${slug}: ${size}`);
    }
    console.log(`  total: ${formatSize(total)}`);
    console.log(`\n  index: ${resolve(outDir, "index.html")}`);
    console.log(
        `  built from: ${staging ? `staging (${enginePin})` : `v${version}`} (engine ${refShort})`,
    );
}

// The standalone tsconfig — the engine's compilerOptions inlined, minus the workspace-only
// `paths` mapping. `@webgpu/types` is a dependency of the published package, so it resolves in
// the ejected install.
function standaloneTsconfig(): string {
    return JSON.stringify(
        {
            compilerOptions: {
                lib: ["ESNext", "DOM"],
                target: "ESNext",
                module: "ESNext",
                moduleDetection: "force",
                allowJs: true,
                moduleResolution: "bundler",
                verbatimModuleSyntax: true,
                resolveJsonModule: true,
                noEmit: true,
                strict: true,
                skipLibCheck: true,
                noFallthroughCasesInSwitch: true,
                noImplicitOverride: true,
                noUnusedLocals: false,
                noUnusedParameters: false,
                noPropertyAccessFromIndexSignature: false,
                types: ["@webgpu/types"],
            },
        },
        null,
        4,
    );
}

function dirSize(dir: string): number {
    let total = 0;
    const glob = new Glob("**/*");
    for (const path of glob.scanSync({ cwd: dir, onlyFiles: true })) {
        total += Bun.file(join(dir, path)).size;
    }
    return total;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

function parseSize(s: string): number {
    const m = s.match(/^([\d.]+)([KMB]?)$/);
    if (!m) return 0;
    const n = Number(m[1]);
    const unit = m[2];
    if (unit === "K") return n * 1024;
    if (unit === "M") return n * 1024 * 1024;
    return n;
}

if (import.meta.main) {
    main().catch((err) => {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    });
}
