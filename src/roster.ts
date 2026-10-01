import { existsSync, readdirSync } from "node:fs";
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
    .map((entry) => entry.name)
    .sort();

if (slugs.length === 0) {
    throw new Error(`installed Shallot package has no addable examples: ${shallotExamples}`);
}

/** Every installed example directory is in the site's demo population. */
export const ROSTER: DemoEntry[] = slugs.map((slug) => ({ slug, title: deriveTitle(slug) }));
