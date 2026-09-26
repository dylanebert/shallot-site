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

A candidate build includes a staging-only synthetic error fixture in `first-person`; visit it with `?rum_run=<marker>` to report the marked error after RUM initializes. Local and unapproved hosts do not load the RUM SDK. `bun run sourcemaps:prepare` validates a fresh staging artifact and prints service/version/path-matched upload commands; it does not upload anything. Local map checks do not establish Datadog receipt or source resolution.

changing it: [`CONTRIBUTING.md`](CONTRIBUTING.md).
