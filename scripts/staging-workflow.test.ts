import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { check } from "@dylanebert/shallot/harness/check";

const workflow = readFileSync(
    resolve(import.meta.dir, "../.github/workflows/site-staging.yml"),
    "utf8",
);

check(
    "site-staging — push and unapproved manual runs cannot perform external work",
    { claim: "only an opted-in manual run with all required credentials reaches staging setup" },
    () => {
        expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
        expect(workflow).toMatch(
            /workflow_dispatch:\s*\n\s*inputs:\s*\n\s*deploy_staging:[\s\S]*?type: boolean\s*\n\s*default: false/,
        );
        expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
        expect(workflow).toContain("inputs.deploy_staging");
        for (const name of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "DD_API_KEY"])
            expect(workflow).toContain(`secrets.${name} != ''`);
        for (const title of [
            "Create or verify named staging project",
            "Upload source maps for this build",
            "Deploy the same identified build to Cloudflare Pages",
        ]) {
            const start = workflow.indexOf(`name: ${title}`);
            expect(start).toBeGreaterThanOrEqual(0);
            expect(workflow.slice(start, workflow.indexOf("\n\n", start))).toContain(
                "if: $" + "{{ env.CF_DEPLOY_READY == 'true' }}",
            );
        }
        expect(workflow).toContain("bun run build --candidate");
        expect(workflow).toContain("bun run sourcemaps:prepare -- out/site");
        expect(workflow).toContain("wrangler pages deploy out/site --project-name=shallot-staging");
        expect(workflow).toContain("path: out/site");
        expect(workflow).not.toContain("main.shallot-staging.pages.dev");
    },
);
