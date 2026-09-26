const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) throw new Error("Cloudflare Pages credentials are required");
const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/pages/projects`;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
async function request(url: string, init?: RequestInit): Promise<any> {
    const response = await fetch(url, { ...init, headers: { ...headers, ...init?.headers } });
    const body = (await response.json()) as { success?: boolean; errors?: unknown[]; result?: any };
    if (!response.ok || body.success !== true) {
        throw new Error(`Cloudflare Pages API failed (${response.status}); refusing staging setup`);
    }
    return body.result;
}
const projects = await request(base);
let project = projects.find((item: any) => item.name === "shallot-staging");
if (!project) {
    project = await request(base, {
        method: "POST",
        body: JSON.stringify({ name: "shallot-staging", production_branch: "main" }),
    });
}
if (project.name !== "shallot-staging") {
    throw new Error("Cloudflare returned a different Pages project; refusing to deploy");
}
if (project.subdomain !== "shallot-staging.pages.dev") {
    throw new Error(
        `Cloudflare project conflict: expected hostname shallot-staging.pages.dev, got ${String(project.subdomain)}; refusing to upload or deploy`,
    );
}
if (project.production_branch !== "main") {
    throw new Error(
        `Cloudflare project conflict: expected production branch main, got ${String(project.production_branch)}; refusing to change existing settings`,
    );
}
if (project.source?.type) {
    throw new Error(
        `Cloudflare project conflict: project is Git-integrated (${String(project.source.type)}), not Direct Upload; refusing to change existing settings`,
    );
}
const customDomains = (project.domains ?? []).filter(
    (domain: unknown) => typeof domain === "string" && !domain.endsWith(".pages.dev"),
);
if (customDomains.length > 0) {
    throw new Error(
        `Cloudflare project conflict: custom domains are configured (${customDomains.join(", ")}); refusing to change existing settings`,
    );
}
console.log(`hostname=${project.subdomain}`);
if (process.env.GITHUB_OUTPUT) {
    await Bun.write(process.env.GITHUB_OUTPUT, `hostname=${project.subdomain}\n`);
}
