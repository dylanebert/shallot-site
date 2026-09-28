# shallot-site

the demos at [dylanebert.com/shallot](https://dylanebert.com/shallot/), built from the examples shipped by the site's installed Shallot package.

```bash
bun install --frozen-lockfile
bun run check
bun run test
bun run build      # package pinned in package.json and bun.lock
bun run demos      # capture each demo on a real device
```

`bun run build --staging` uses the same installed package and additionally emits staging RUM configuration and source maps. Production deploys the regular build after the package version and artifact checks pass. GitHub Pages publishes `out/site` through `site.yml`.

`bun run sourcemaps:prepare` locally validates a staging artifact and prints matching upload commands; it never uploads, regardless of `DD_API_KEY`. Only the opted-in manual `site-staging` workflow invokes the separately named uploader and deploys, using GitHub Actions secrets.

Changing it: [`CONTRIBUTING.md`](CONTRIBUTING.md).
