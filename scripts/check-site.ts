import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { Glob } from "bun";
import { ROSTER } from "../src/roster";
import { applicationBuildId, validateSourceMaps } from "../src/rum-build";
import {
    RUM_ENV_SNIPPET,
    RUM_ENV_SNIPPET_STAGING,
    RUM_ENV_USAGE,
    RUM_INJECTION_MARKER,
} from "../src/rum-config";
import { root, shallotExamples, shallotVersion } from "../src/site";
import { readStamp, STAMP_FILE, staleDemos } from "../src/site-stamp";

const outDir = process.env.SITE_OUT_DIR
    ? resolve(process.env.SITE_OUT_DIR)
    : resolve(root, "out/site");

function fail(message: string): never {
    console.error(message);
    process.exit(1);
}

if (!existsSync(shallotExamples) || ROSTER.length === 0) {
    fail(`✗ installed Shallot examples are missing or empty: ${shallotExamples}`);
}

const missingAppFiles: string[] = [];
for (const { slug } of ROSTER) {
    const dir = resolve(shallotExamples, slug);
    for (const file of ["index.html", "vite.config.ts"]) {
        if (!existsSync(resolve(dir, file))) missingAppFiles.push(`${slug}/${file}`);
    }
}
if (missingAppFiles.length > 0) {
    fail(
        `✗ packaged example(s) missing index.html or vite.config.ts:\n  ${missingAppFiles.join("\n  ")}`,
    );
}

const importRe = /(?:from\s+["']|import\s+["']|import\s*\(\s*["'])([^"']+)["']/g;
const escaped: string[] = [];
for (const { slug } of ROSTER) {
    const dir = resolve(shallotExamples, slug);
    const glob = new Glob("**/*.{ts,svelte,js,mjs}");
    for await (const path of glob.scan({ cwd: dir })) {
        if (path.includes("node_modules") || path.includes("dist")) continue;
        if (path === "playwright.config.ts" || /\.(?:test|gpu|node|oracle|e2e)\.ts$/.test(path))
            continue;
        const full = resolve(dir, path);
        const lines = (await Bun.file(full).text()).split("\n");
        for (let index = 0; index < lines.length; index++) {
            for (const match of lines[index]!.matchAll(importRe)) {
                const specifier = match[1]!;
                if (!specifier.startsWith(".")) continue;
                const resolved = resolve(dirname(full), specifier);
                if (resolved !== dir && !resolved.startsWith(`${dir}${sep}`)) {
                    escaped.push(`${slug}/${path}:${index + 1} imports ${specifier}`);
                }
            }
        }
    }
}
if (escaped.length > 0) {
    fail(`✗ packaged example imports escape their directory:\n  ${escaped.join("\n  ")}`);
}

if (!existsSync(outDir)) {
    if (process.env.SITE_OUT_REQUIRED === "1") fail("✗ out/site/ is absent — run `bun run build`");
    console.log(
        `✓ site inputs clean (${ROSTER.length} packaged examples); out/site/ not built yet`,
    );
    process.exit(0);
}
if (process.env.SITE_OUT_REQUIRED === "1" && readdirSync(outDir).length === 0) {
    fail("✗ out/site/ is empty — run `bun run build`");
}

const stamp = readStamp(outDir);
if (!stamp) {
    if (process.env.SITE_OUT_REQUIRED === "1") fail(`✗ no valid ${STAMP_FILE} in out/site/`);
    console.log(`✓ site inputs clean; no valid ${STAMP_FILE}, skipping artifact checks`);
    process.exit(0);
}
if (stamp.mode.version !== shallotVersion) {
    fail(
        `✗ build stamp uses Shallot ${stamp.mode.version}, but this site resolves ${shallotVersion}`,
    );
}
if (stamp.buildId !== applicationBuildId(shallotVersion)) {
    fail("✗ build stamp does not match the current site inputs and installed Shallot version");
}

const slugs = ROSTER.map(({ slug }) => slug);
const stale = staleDemos(shallotExamples, outDir, slugs, root);
if (stale.length > 0) {
    if (process.env.SITE_OUT_REQUIRED === "1") {
        fail(
            `✗ stale built demos:\n  ${stale.map(({ slug, reason }) => `${slug}: ${reason}`).join("\n  ")}`,
        );
    }
    console.log(`✓ site inputs clean; stale demos (${stale.map(({ slug }) => slug).join(", ")})`);
    process.exit(0);
}

const mode = stamp.mode.kind;
const ownEnv = mode === "staging" ? RUM_ENV_SNIPPET_STAGING : RUM_ENV_SNIPPET;
const otherEnv = mode === "staging" ? RUM_ENV_SNIPPET : RUM_ENV_SNIPPET_STAGING;
const rootAbsRe = /(?:href|src)\s*=\s*["']\/(?!\/)/g;
const defects: string[] = [];

for (const { slug } of ROSTER) {
    const demoDir = resolve(outDir, slug);
    if (!existsSync(demoDir)) continue;
    const htmlFiles = new Glob("**/*.html").scanSync({ cwd: demoDir });
    for (const path of htmlFiles) {
        const html = readFileSync(resolve(demoDir, path), "utf8");
        const file = `${slug}/${path}`;
        if (!html.includes(RUM_INJECTION_MARKER)) defects.push(`${file}: missing RUM injection`);
        if (!html.includes(ownEnv)) defects.push(`${file}: missing ${mode} env snippet`);
        if (html.includes(otherEnv)) defects.push(`${file}: has the other mode's env snippet`);
        if (!html.includes(RUM_ENV_USAGE)) defects.push(`${file}: RUM env is not wired into init`);
        const marker = html.indexOf(RUM_INJECTION_MARKER);
        const script = html.slice(marker).match(/<script>([\s\S]*?)<\/script>/)?.[1];
        if (!script) defects.push(`${file}: missing inline RUM init`);
        else {
            try {
                new Function(script);
            } catch (error) {
                defects.push(
                    `${file}: invalid RUM init (${error instanceof Error ? error.message : error})`,
                );
            }
        }
        if (rootAbsRe.test(html)) defects.push(`${file}: root-absolute generated path`);
        rootAbsRe.lastIndex = 0;
    }

    const index = resolve(demoDir, "index.html");
    if (existsSync(index)) {
        const html = readFileSync(index, "utf8");
        const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
        if (title.includes("shallot-site-")) defects.push(`${slug}: scratch-shaped title`);
        if (!html.includes(`"version":"${stamp.buildId}"`))
            defects.push(`${slug}: RUM version differs from build stamp`);
        if (mode === "staging") {
            const runtimeName = `shallot-rum-${stamp.buildId}.js`;
            if (!html.includes(runtimeName))
                defects.push(`${slug}: missing runtime ${runtimeName}`);
            try {
                const maps = validateSourceMaps(resolve(demoDir, "assets"));
                if (!maps.includes(`${runtimeName}.map`))
                    defects.push(`${slug}: missing ${runtimeName}.map`);
            } catch (error) {
                defects.push(`${slug}: ${error instanceof Error ? error.message : error}`);
            }
        }
    }
}

for (const rel of ["index.html", "brand/index.html"]) {
    const path = resolve(outDir, rel);
    if (!existsSync(path)) continue;
    const html = readFileSync(path, "utf8");
    if (!html.includes(RUM_INJECTION_MARKER)) defects.push(`${rel}: missing RUM injection`);
    if (!html.includes(ownEnv)) defects.push(`${rel}: missing ${mode} env snippet`);
    if (html.includes(otherEnv)) defects.push(`${rel}: has the other mode's env snippet`);
    if (!html.includes(RUM_ENV_USAGE)) defects.push(`${rel}: RUM env is not wired into init`);
    if (html.includes("slow_frame")) defects.push(`${rel}: page carries the frame sampler`);
    const marker = html.indexOf(RUM_INJECTION_MARKER);
    const script = html.slice(marker).match(/<script>([\s\S]*?)<\/script>/)?.[1];
    if (!script) defects.push(`${rel}: missing inline RUM init`);
    else {
        try {
            new Function(script);
        } catch (error) {
            defects.push(
                `${rel}: invalid RUM init (${error instanceof Error ? error.message : error})`,
            );
        }
    }
}

for (const path of new Glob("**/*.{js,css}").scanSync({ cwd: outDir })) {
    const lines = readFileSync(resolve(outDir, path), "utf8").split("\n");
    lines.forEach((line, index) => {
        if (rootAbsRe.test(line))
            defects.push(`${path}:${index + 1}: root-absolute generated path`);
        rootAbsRe.lastIndex = 0;
    });
}

if (process.env.RUM_CONFIG_REQUIRED === "1") {
    for (const path of new Glob("**/*.html").scanSync({ cwd: outDir })) {
        const lines = readFileSync(resolve(outDir, path), "utf8").split("\n");
        lines.forEach((line, index) => {
            if (line.includes("PLACEHOLDER_"))
                defects.push(`${path}:${index + 1}: placeholder credential`);
        });
    }
}

if (defects.length > 0) fail(`✗ site artifact defects:\n  ${defects.join("\n  ")}`);
console.log(`✓ site roster clean (${ROSTER.length} examples from Shallot ${shallotVersion})`);
