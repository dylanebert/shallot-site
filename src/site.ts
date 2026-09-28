import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

/** The site repo root. */
export const root = resolve(import.meta.dir, "..");

/** The package directory Bun installed for the site's Shallot dependency. */
export const shallotPackage = resolve(root, "node_modules/@dylanebert/shallot");

if (!existsSync(resolve(shallotPackage, "package.json"))) {
    throw new Error("@dylanebert/shallot is not installed; run `bun install`");
}

const manifest = JSON.parse(readFileSync(resolve(shallotPackage, "package.json"), "utf8")) as {
    version?: unknown;
};

if (typeof manifest.version !== "string") {
    throw new Error("the installed @dylanebert/shallot package has no version");
}

/** Version of the package this site actually resolves; labels and source links use this identity. */
export const shallotVersion = manifest.version;

/** Content identity for the exact installed Shallot tree, including same-version live edits. */
export interface ShallotIdentity {
    version: string;
    contentHash: string;
}

/** Examples shipped in that exact installed package. */
export const shallotExamples = resolve(shallotPackage, "examples");

/** Hash installed package files, not its version alone: live edits may retain the same version. */
export function installedShallotIdentity(packageRoot = shallotPackage): ShallotIdentity {
    const hash = new Bun.CryptoHasher("sha256");
    const files: string[] = [];
    const walk = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if ([".git", "node_modules", "target"].includes(entry.name)) continue;
            const path = resolve(directory, entry.name);
            if (entry.isDirectory()) walk(path);
            else if (entry.isFile()) files.push(path);
        }
    };
    walk(packageRoot);
    for (const path of files.sort()) {
        const rel = relative(packageRoot, path).split(sep).join("/");
        hash.update(`\0${rel}\0`);
        hash.update(readFileSync(path));
    }
    return { version: shallotVersion, contentHash: hash.digest("hex") };
}
