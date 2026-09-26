import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { check } from "@dylanebert/shallot/harness/check";

const workflow = readFileSync(
    resolve(import.meta.dir, "../.github/workflows/site-staging.yml"),
    "utf8",
);

check(
    "site-staging — push builds and archives, but cannot deploy",
    { claim: "only an opted-in manual run with both credentials can deploy staging" },
    () => {
        expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
        expect(workflow).toMatch(
            /workflow_dispatch:\s*\n\s*inputs:\s*\n\s*deploy_staging:[\s\S]*?type: boolean\s*\n\s*default: false/,
        );
        expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
        expect(workflow).toContain("inputs.deploy_staging");
        expect(workflow).toContain("secrets.CLOUDFLARE_API_TOKEN != ''");
        expect(workflow).toContain("secrets.CLOUDFLARE_ACCOUNT_ID != ''");
        expect(workflow).toContain(
            "name: Deploy candidate to Cloudflare Pages\n        if: $" +
                "{{ env.CF_DEPLOY_READY == 'true' }}",
        );
        expect(workflow).toContain("name: site-candidate");
        expect(workflow).toContain("path: out/site");
    },
);
