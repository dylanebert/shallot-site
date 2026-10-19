# shallot-site

the demos at [dylanebert.com/shallot](https://dylanebert.com/shallot/), built from the examples shipped by the site's installed Shallot package.

```bash
bun install --frozen-lockfile
bun check
bun run lint
bun run test
bun scripts/build-site.ts # package pinned in package.json and bun.lock
bunx playwright test     # existing artifact starts headlessly under /shallot/
```

`bun scripts/build-site.ts --staging` uses the same installed package and additionally emits staging RUM configuration and source maps. Production deploys the regular build after the package version and artifact checks pass. GitHub Pages publishes `out/site` through `site.yml`.

`bun scripts/prepare-sourcemaps.ts` locally validates a staging artifact and prints matching upload commands; it never uploads, regardless of `DD_API_KEY`. Only the opted-in manual `site-staging` workflow invokes `bun scripts/upload-sourcemaps.ts --upload out/site <hostname>` and deploys, using GitHub Actions secrets.

Changing it: [`CONTRIBUTING.md`](CONTRIBUTING.md).
