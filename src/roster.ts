import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { shallotExamples } from "./site";

export interface DemoEntry {
    slug: string;
    title: string;
}

function deriveTitle(slug: string): string {
    return slug
        .split("-")
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(" ");
}

if (!existsSync(shallotExamples)) {
    throw new Error(`installed Shallot package has no examples directory: ${shallotExamples}`);
}

const slugs = readdirSync(shallotExamples, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
        const manifest = resolve(shallotExamples, entry.name, "shallot.json");
        if (!existsSync(manifest)) return false;
        const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { kind?: unknown };
        return parsed.kind === "recipe";
    })
    .map((entry) => entry.name)
    .sort();

if (slugs.length === 0) {
    throw new Error(`installed Shallot package has no addable examples: ${shallotExamples}`);
}

/** Every packaged recipe is in the site's demo population. */
export const ROSTER: DemoEntry[] = slugs.map((slug) => ({ slug, title: deriveTitle(slug) }));
