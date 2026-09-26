import { expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
        expect(workflow).toMatch(/DATADOG_API_KEY: \$\{\{ secrets\.DD_API_KEY \}\}/);
        expect(workflow).not.toMatch(/^\s+DD_API_KEY:/m);
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
        expect(workflow).toContain('SITE_OUT_REQUIRED: "1"');
        expect(workflow).toContain("bun run build --candidate");
        expect(workflow).toContain("bun run sourcemaps:upload -- --upload out/site");
        expect(workflow).not.toContain("bun run sourcemaps:prepare");
        expect(workflow).toContain("wrangler pages deploy out/site --project-name=shallot-staging");
        expect(workflow).toContain("path: out/site");
        const archive = workflow.indexOf("name: site-candidate");
        expect(archive).toBeGreaterThan(workflow.indexOf("bun run scripts/check-site.ts"));
        expect(workflow.slice(archive, workflow.indexOf("\n\n", archive))).not.toContain("if:");
        expect(workflow).not.toContain("main.shallot-staging.pages.dev");
    },
);

check(
    "site-staging — required artifact check refuses a missing output directory",
    {
        claim: "SITE_OUT_REQUIRED on the workflow check makes absent output fail rather than pass",
        size: "integration",
        budget: 20_000,
        subject: "scripts/check-site.ts",
    },
    () => {
        const missingOutput = mkdtempSync(join(tmpdir(), "staging-no-artifact-"));
        try {
            const result = Bun.spawnSync([process.execPath, "run", "scripts/check-site.ts"], {
                cwd: resolve(import.meta.dir, ".."),
                env: {
                    ...process.env,
                    SITE_OUT_DIR: join(missingOutput, "absent"),
                    SITE_OUT_REQUIRED: "1",
                },
                stdout: "pipe",
                stderr: "pipe",
            });
            expect(result.exitCode).toBe(1);
            expect(result.stderr.toString()).toContain("out/site/ is absent");
        } finally {
            rmSync(missingOutput, { recursive: true, force: true });
        }
    },
);
