# shallot-site

The source for [dylanebert.com/shallot](https://dylanebert.com/shallot/), the demo site for the [Shallot](https://github.com/dylanebert/shallot) engine: the index, `llms.txt`, the brand page, and every showcase demo built as a consumer of the published package.

## How It Builds

The showcases stay in the engine repo. `bun run engine` clones `dylanebert/shallot` into `.engine/` at the tag in `engine.json`, and `bun run build` copies each showcase out, pins `@dylanebert/shallot` to the version in this repo's `package.json`, installs from npm and runs `shallot build`. The tag and the npm version must name the same release; the build refuses otherwise.

```bash
bun install
bun run engine    # clone the engine at engine.json's tag
bun run build     # out/site
bun run pages     # just the index, llms.txt and brand page
bun run check     # tsc, biome, check-site
bun run demos     # build, then `shallot verify` each demo page (needs a GPU and a display)
```

To move to a new release, bump `engine.json` and the `@dylanebert/shallot` pin together.

## How It Deploys

GitHub serves a project site at its repo's name, so the `/shallot/` URL belongs to the engine repo's Pages slot. `site.yml` builds on every push to `main` and pushes `out/site` to the `gh-pages` branch of `dylanebert/shallot`.

That push uses the `SHALLOT_PAGES_TOKEN` secret: a fine-grained personal access token scoped to `dylanebert/shallot` with Contents read and write. One-time setup on the engine repo: Settings → Pages → Source → "Deploy from a branch", branch `gh-pages`, folder `/`.

`site-staging.yml` builds the same site against the engine's `main` and deploys it to Cloudflare Pages at [shallot-staging.pages.dev](https://shallot-staging.pages.dev/) when `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set.
