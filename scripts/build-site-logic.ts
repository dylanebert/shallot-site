import { existsSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

export type DemoPackage = {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    [key: string]: unknown;
};

export type CandidateInputScope = {
    kind: "demo" | "extension";
    prefix: string;
    demoDirectories?: boolean;
};

const DEMO_COPY_EXCLUDED_DIRS = new Set(["node_modules", ".git", ".cache", ".artifacts", "target"]);
const DEMO_COPY_EXCLUDED_FILES = new Set([".DS_Store", "Thumbs.db"]);
const BUN_PACK_EXCLUDED_DIRS = new Set(["node_modules", ".git"]);

export function candidateInputScopes(
    showcasePrefix: string,
    extensionNames: Iterable<string>,
): CandidateInputScope[] {
    return [
        { kind: "demo", prefix: showcasePrefix, demoDirectories: true },
        ...[...extensionNames].map((name) => ({
            kind: "extension" as const,
            prefix: `packages/${name.slice("@dylanebert/".length)}/`,
        })),
    ];
}

/** The candidate demo copy uses these exact exclusions for both validation and copying. */
export function isDemoCopyInput(path: string, demoDirectories = false): boolean {
    const parts = path.split(/[\\/]/).filter(Boolean);
    if (
        parts.some((part) => DEMO_COPY_EXCLUDED_DIRS.has(part)) ||
        DEMO_COPY_EXCLUDED_FILES.has(parts.at(-1) ?? "")
    ) {
        return false;
    }
    if (parts.at(-1)?.endsWith(".tsbuildinfo")) return false;
    const demoPathOffset = demoDirectories ? 1 : 0;
    if (["dist", "build"].includes(parts[demoPathOffset] ?? "")) return false;
    return true;
}

/**
 * Conservatively guard every extension path except dependency and VCS subtrees. This deliberately
 * avoids mirroring Bun's packlist: generated-looking outputs and pack-control files stay in scope.
 */
export function isExtensionPackInput(path: string): boolean {
    return !path
        .split(/[\\/]/)
        .filter(Boolean)
        .some((part) => BUN_PACK_EXCLUDED_DIRS.has(part));
}

function isScopeInput(path: string, scope: CandidateInputScope): boolean {
    return scope.kind === "demo"
        ? isDemoCopyInput(path, scope.demoDirectories)
        : isExtensionPackInput(path);
}

function listFiles(
    root: string,
    scope: CandidateInputScope,
    demoSlugs: ReadonlySet<string>,
): string[] {
    if (!existsSync(root)) return [];
    const files: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = resolve(dir, entry.name);
            const rel = relative(root, full).split(sep).join("/");
            if (
                (scope.demoDirectories && !demoSlugs.has(rel.split("/")[0] ?? "")) ||
                !isScopeInput(rel, scope)
            )
                continue;
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile() || entry.isSymbolicLink()) files.push(full);
        }
    };
    walk(root);
    return files;
}

/** Refuse candidate inputs that differ from HEAD. Checks tracked edits/deletions and untracked or
 * ignored files under the demo-copy and extension-pack scopes, with each tool's own exclusions. */
export function candidateInputChanges(engineRoot: string, scopes: CandidateInputScope[]): string[] {
    if (scopes.length === 0) return [];
    const prefixes = scopes.map(({ prefix }) => prefix);
    const tracked = Bun.spawnSync(
        ["git", "ls-tree", "-r", "-z", "--name-only", "HEAD", "--", ...prefixes],
        {
            cwd: engineRoot,
        },
    );
    const indexed = Bun.spawnSync(["git", "ls-files", "-z", "--", ...prefixes], {
        cwd: engineRoot,
    });
    const diff = Bun.spawnSync(["git", "diff", "--name-only", "-z", "HEAD", "--", ...prefixes], {
        cwd: engineRoot,
    });
    if (!tracked.success || !indexed.success || !diff.success) {
        throw new Error("could not inspect candidate engine source inputs against HEAD");
    }
    const headFiles = new Set(tracked.stdout.toString().split("\0").filter(Boolean));
    const indexedFiles = indexed.stdout.toString().split("\0").filter(Boolean);
    const demoScope = scopes.find(
        ({ kind, demoDirectories }) => kind === "demo" && demoDirectories,
    );
    const demoSlugs = new Set(
        [...headFiles, ...indexedFiles].flatMap((path) => {
            if (!demoScope || !path.startsWith(demoScope.prefix)) return [];
            const parts = path.slice(demoScope.prefix.length).split("/");
            return parts.length > 1 ? [parts[0]] : [];
        }),
    );
    const changed = new Set<string>();
    for (const path of diff.stdout.toString().split("\0").filter(Boolean)) {
        const scope = scopes.find(({ prefix }) => path.startsWith(prefix));
        const inScope = scope ? path.slice(scope.prefix.length) : "";
        if (
            scope &&
            !(scope.kind === "demo" && scope.demoDirectories && inScope.split("/").length < 2) &&
            !(
                scope.kind === "demo" &&
                scope.demoDirectories &&
                !demoSlugs.has(inScope.split("/")[0] ?? "")
            ) &&
            isScopeInput(inScope, scope)
        ) {
            changed.add(path);
        }
    }
    for (const scope of scopes) {
        const base = resolve(engineRoot, scope.prefix);
        for (const full of listFiles(base, scope, demoSlugs)) {
            const path = relative(engineRoot, full).split(sep).join("/");
            const inScope = path.slice(scope.prefix.length);
            if (
                !headFiles.has(path) &&
                !(
                    scope.kind === "demo" &&
                    scope.demoDirectories &&
                    inScope.split("/").length < 2
                ) &&
                !(
                    scope.kind === "demo" &&
                    scope.demoDirectories &&
                    !demoSlugs.has(inScope.split("/")[0] ?? "")
                ) &&
                isScopeInput(inScope, scope)
            ) {
                changed.add(path);
            }
        }
    }
    return [...changed].sort();
}

export function assertPinnedCandidateInputs(
    engineRoot: string,
    commit: string,
    scopes: CandidateInputScope[],
): void {
    const changes = candidateInputChanges(engineRoot, scopes);
    if (changes.length > 0) {
        throw new Error(
            `candidate engine inputs differ from pinned ${commit}; restore these paths or update the pinned candidate:\n${changes.map((path) => `  ${path}`).join("\n")}`,
        );
    }
}

/** Workspace dependency decisions shared by the build and its source-free checks. */
export function shallotDependencies(pkg: DemoPackage): [string, string][] {
    return Object.entries(pkg.dependencies ?? {})
        .filter(
            ([name]) => name === "@dylanebert/shallot" || name.startsWith("@dylanebert/shallot-"),
        )
        .sort(([a], [b]) => a.localeCompare(b));
}

export function nonWorkspaceShallotDependencies(pkg: DemoPackage): [string, string][] {
    return shallotDependencies(pkg).filter(([, pin]) => pin !== "workspace:*");
}

export function workspaceExtensionDependencies(pkg: DemoPackage): string[] {
    return shallotDependencies(pkg)
        .filter(([name, pin]) => name !== "@dylanebert/shallot" && pin === "workspace:*")
        .map(([name]) => name);
}

export function rewriteSiteDependencies(
    pkg: DemoPackage,
    enginePin: string,
    extensionPins: ReadonlyMap<string, string>,
): DemoPackage {
    const dependencies = (pkg.dependencies ??= {});
    dependencies["@dylanebert/shallot"] = enginePin;
    for (const name of workspaceExtensionDependencies(pkg)) {
        const pin = extensionPins.get(name);
        if (!pin) throw new Error(`no packed tarball for workspace extension ${name}`);
        dependencies[name] = pin;
    }
    return pkg;
}
