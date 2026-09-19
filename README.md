# shallot-site

the demos at [dylanebert.com/shallot](https://dylanebert.com/shallot/), built from the engine's showcase examples.

```bash
bun install --frozen-lockfile
bun run check
bun run test
bun run build      # the stable release named in engine.json
bun run demos      # capture each demo on a real device
```

production deploys the stable build only, after the tag and package name the same release and the artifact checks pass. github pages publishes `out/site` through `site.yml`.

changing it: [`CONTRIBUTING.md`](CONTRIBUTING.md).
