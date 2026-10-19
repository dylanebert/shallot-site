import { statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { ROSTER } from "../src/roster";
import { applicationBuildId } from "../src/rum-build";
import { installedShallotIdentity, root, shallotExamples } from "../src/site";
import { mismatchedShallotDemos, readStamp, staleDemos } from "../src/site-stamp";

const out = resolve(process.env.SITE_TEST_OUT ?? resolve(root, "out/site"));
const slugs = ROSTER.map(({ slug }) => slug);
const stamp = readStamp(out);
const identity = installedShallotIdentity();
if (
    !stamp ||
    stamp.buildId !== applicationBuildId(identity) ||
    stamp.mode.version !== identity.version ||
    mismatchedShallotDemos(stamp, out, slugs, identity).length ||
    staleDemos(shallotExamples, out, slugs, root).length ||
    ["", "brand", ...slugs].some((slug) => !Bun.file(resolve(out, slug, "index.html")).size)
) {
    throw new Error(`Missing or stale site artifact at ${out}; run bun scripts/build-site.ts`);
}

Bun.serve({
    hostname: "127.0.0.1",
    port: 4175,
    async fetch(request) {
        const url = new URL(request.url);
        if (!url.pathname.startsWith("/shallot/"))
            return new Response("Not found", { status: 404 });
        const path = resolve(out, decodeURIComponent(url.pathname.slice("/shallot/".length)));
        if (path !== out && !path.startsWith(`${out}${sep}`))
            return new Response("Not found", { status: 404 });
        let file = path;
        try {
            if (statSync(path).isDirectory()) {
                if (!url.pathname.endsWith("/")) return Response.redirect(`${url.pathname}/`, 301);
                file = resolve(path, "index.html");
            }
        } catch {
            return new Response("Not found", { status: 404 });
        }
        const body = Bun.file(file);
        return (await body.exists())
            ? new Response(body)
            : new Response("Not found", { status: 404 });
    },
});
