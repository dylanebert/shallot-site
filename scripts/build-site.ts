import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { Glob } from "bun";
import { build as viteBuild } from "vite";
import { llmsTxt, siteIndex } from "../src/home";
import { ROSTER } from "../src/roster";
import { applicationBuildId } from "../src/rum-build";
import { datadogInitSnippet } from "../src/rum-config";
import { installedShallotIdentity, root, shallotExamples, shallotPackage } from "../src/site";
import { demoFingerprints, writeStamp } from "../src/site-stamp";
import { buildBrand, bundleClient } from "./build-pages";

// the RUM init snippet lives in `src/rum-config.ts` so the pages build can inject it too;
// re-exported here because the site tests import it from this module
export { datadogInitSnippet };

// `bun run build` ejects every example from the Shallot package installed by this site. `--staging`
// changes only the RUM environment and source-map output; each demo uses the same installed package
// path the site itself resolves, including a staged package overlay or a live link.

/** the literal `PIPELINE_COMPILE_MEASURE_PREFIX` in the engine's `src/engine/runtime/gpu.ts`;
 * the engine exports no subpath for it, and the RUM bundle needs only the string */
const PIPELINE_COMPILE_MEASURE_PREFIX = "shallot:pipeline-compile:";

const showcaseDir = shallotExamples;
const outDir = resolve(root, "out/site");

/** Bundles `src/rum-runtime.ts` (which imports the pure sampler) to a single browser-target ESM
 * script with an external map, so the staging fixture's stack resolves to its TypeScript source.
 * `define` inlines the compile-measure prefix as the ambient
 * `__PIPELINE_COMPILE_MEASURE_PREFIX__` global. */
async function buildRumRuntimeBundle(
    outputPath: string,
    mode: "prod" | "staging",
    slug: string,
    buildId: string,
): Promise<string> {
    await viteBuild({
        configFile: false,
        root,
        logLevel: "error",
        define: {
            __PIPELINE_COMPILE_MEASURE_PREFIX__: JSON.stringify(PIPELINE_COMPILE_MEASURE_PREFIX),
            __SHALLOT_RUM_MODE__: JSON.stringify(mode),
            __SHALLOT_DEMO_SLUG__: JSON.stringify(slug),
            __SHALLOT_BUILD_ID__: JSON.stringify(buildId),
        },
        build: {
            outDir: dirname(outputPath),
            emptyOutDir: false,
            sourcemap: mode === "staging",
            rollupOptions: {
                input: resolve(root, "src/rum-runtime.ts"),
                output: { entryFileNames: basename(outputPath) },
            },
        },
    });
    if (!existsSync(outputPath)) throw new Error("RUM runtime bundle was not emitted");
    if (mode === "staging") {
        if (!existsSync(`${outputPath}.map`))
            throw new Error("RUM runtime source map was not emitted");
        const parsedMap = JSON.parse(readFileSync(`${outputPath}.map`, "utf8")) as {
            sources?: string[];
            sourcesContent?: unknown[];
        };
        const runtimeSource = parsedMap.sources?.findIndex((source) =>
            source.endsWith("src/rum-runtime.ts"),
        );
        if (
            runtimeSource === undefined ||
            runtimeSource < 0 ||
            typeof parsedMap.sourcesContent?.[runtimeSource] !== "string"
        ) {
            throw new Error("RUM runtime source map does not contain src/rum-runtime.ts");
        }
    }
    return outputPath;
}

/** Injects the Datadog init snippet plus the bundled sampler into every `*.html` file under
 * `dir` (recursive — a demo like `visualization` emits nested pages under `demos/`), right
 * before `</body>`. */
function injectRum(
    dir: string,
    runtimePath: string,
    mode: "prod" | "staging",
    buildId: string,
): void {
    const glob = new Glob("**/*.html");
    for (const path of glob.scanSync({ cwd: dir })) {
        const full = resolve(dir, path);
        const runtimeUrl = relative(dirname(full), runtimePath).split(sep).join("/");
        const snippet = `${datadogInitSnippet(mode, buildId)}<script type="module" src="./${runtimeUrl}"></script>\n`;
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

Builds every example shipped by the installed @dylanebert/shallot package and emits out/site/.

Options:
  --demo <slug>   Build a single demo by its roster slug
  --staging       Use the staging RUM environment and emit source maps`);
        process.exit(0);
    }

    const idx = args.indexOf("--demo");
    const only = idx !== -1 ? args[idx + 1] : undefined;

    const mode: "prod" | "staging" = args.includes("--staging") ? "staging" : "prod";
    const shallot = installedShallotIdentity();
    const version = shallot.version;

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

    const buildId = applicationBuildId(shallot);

    const sizes: { slug: string; size: string }[] = [];

    for (const demo of demos) {
        const slug = demo.slug;
        const srcDir = resolve(showcaseDir, slug);
        if (!existsSync(srcDir)) {
            console.error(`✗ installed example not found: ${srcDir}`);
            process.exit(1);
        }

        // Keep the scratch leaf at the slug so Vite's own page/build artifacts retain the
        // project identity; the parent carries only the unique temporary name.
        const scratchParent = mkdtempSync(join(tmpdir(), `shallot-site-${slug}-`));
        const scratch = join(scratchParent, slug);

        try {
            console.log(`\n=== ${slug} ===`);
            const add = Bun.spawnSync(
                [process.execPath, resolve(shallotPackage, "bin/shallot.ts"), "add", slug, scratch],
                { cwd: root, stdout: "inherit", stderr: "inherit" },
            );
            if (add.exitCode !== 0) throw new Error(`shallot add failed for ${slug}`);

            const packagePath = resolve(scratch, "package.json");
            const demoPkg = (await Bun.file(packagePath).json()) as {
                dependencies?: Record<string, string>;
            };
            demoPkg.dependencies ??= {};
            // shallot add writes the installed version. Install the resolved package directory
            // locally, then point the demo at that same tree so staged overlays and live links are
            // preserved without another registry lookup or a separate checkout.
            demoPkg.dependencies["@dylanebert/shallot"] = `file:${shallotPackage}`;
            writeFileSync(packagePath, `${JSON.stringify(demoPkg, null, 4)}\n`);

            for (const file of ["index.html", "vite.config.ts"]) {
                if (!existsSync(resolve(scratch, file))) {
                    throw new Error(`${slug} must own ${file}; build will not synthesize it`);
                }
            }
            console.log(`  installing...`);
            const install = Bun.spawnSync(["bun", "install"], {
                cwd: scratch,
                stdout: "inherit",
                stderr: "inherit",
            });
            if (install.exitCode !== 0) throw new Error(`install failed for ${slug}`);

            const demoShallot = resolve(scratch, "node_modules/@dylanebert/shallot");
            rmSync(demoShallot, { recursive: true, force: true });
            symlinkSync(shallotPackage, demoShallot, "dir");
            if (realpathSync(demoShallot) !== realpathSync(shallotPackage)) {
                throw new Error(`${slug} resolved a different Shallot package: ${demoShallot}`);
            }
            console.log(
                `  shallot: ${version} sha256:${shallot.contentHash} (${realpathSync(demoShallot)})`,
            );

            console.log(`  building...`);
            const buildArgs = ["bunx", "vite", "build", "--base", "./"];
            if (mode === "staging" && slug === "first-person") buildArgs.push("--sourcemap");
            const build = Bun.spawnSync(buildArgs, {
                cwd: scratch,
                stdout: "inherit",
                stderr: "inherit",
            });
            if (build.exitCode !== 0) throw new Error(`build failed for ${slug}`);

            const dist = resolve(scratch, "dist");
            if (!existsSync(dist)) throw new Error(`no dist/ produced for ${slug}`);
            const demoOut = resolve(outDir, slug);
            cpSync(dist, demoOut, { recursive: true });
            const runtimeDir = resolve(demoOut, "assets");
            mkdirSync(runtimeDir, { recursive: true });
            const runtimePath = resolve(runtimeDir, `shallot-rum-${buildId}.js`);
            await buildRumRuntimeBundle(runtimePath, mode, slug, buildId);
            injectRum(demoOut, runtimePath, mode, buildId);

            const sizeBytes = dirSize(demoOut);
            sizes.push({ slug, size: formatSize(sizeBytes) });
            console.log(`  done — ${formatSize(sizeBytes)}`);
        } finally {
            rmSync(scratchParent, { recursive: true, force: true });
        }
    }

    // the site's own pages beside the demos: the index (always the full roster, so a `--demo`
    // build's index still lists the others), llms.txt, and /brand/ with its downloads
    const client = await bundleClient();
    const rum = datadogInitSnippet(mode, buildId);
    writeFileSync(resolve(outDir, "index.html"), siteIndex(ROSTER, version, mode, client, rum));
    writeFileSync(resolve(outDir, "llms.txt"), llmsTxt(version));
    await buildBrand(outDir, client, rum);

    const fingerprints = demoFingerprints(
        showcaseDir,
        demos.map((d) => d.slug),
        root,
    );
    writeStamp(outDir, fingerprints, { kind: mode, version }, buildId, shallot);

    const total = sizes.reduce((sum, s) => sum + parseSize(s.size), 0);
    console.log(`\n=== summary ===`);
    for (const { slug, size } of sizes) {
        console.log(`  ${slug}: ${size}`);
    }
    console.log(`  total: ${formatSize(total)}`);
    console.log(`\n  index: ${resolve(outDir, "index.html")}`);
    console.log(
        `  built from: @dylanebert/shallot@${version} sha256:${shallot.contentHash} (${realpathSync(shallotPackage)})`,
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
