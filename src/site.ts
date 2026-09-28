import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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

/** Examples shipped in that exact installed package. */
export const shallotExamples = resolve(shallotPackage, "examples");
