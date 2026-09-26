# shallot-site

the demos at [dylanebert.com/shallot](https://dylanebert.com/shallot/), built from the examples in the engine checkout.

```bash
bun install --frozen-lockfile
bun run check
bun run test
bun run build      # the stable release named in engine.json
bun run demos      # capture each demo on a real device
```

production deploys the stable build only, after the tag and package name the same release and the artifact checks pass. github pages publishes `out/site` through `site.yml`.

A candidate build includes staging-only `clean` and synthetic `error` observations in `first-person`. The local browser checks cover their run/case markers and the explicit named Pages host gate; they do not establish hosted collection or source resolution. `bun run sourcemaps:prepare` locally validates a candidate artifact and prints matching upload commands; it never uploads, regardless of `DD_API_KEY`. Only the opted-in manual `site-staging` workflow invokes the separately named uploader and deploys, using GitHub Actions secrets.

changing it: [`CONTRIBUTING.md`](CONTRIBUTING.md).
