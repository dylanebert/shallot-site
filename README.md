# shallot-site

This repository publishes the Shallot demo site. It carries two identities:
the installed `shallot` package is the site's carrier, while the selected engine
identity supplies the demos it ejects and builds.

## Build And Check

Use Bun 1.4.2 and the installed carrier:

```bash
bun install --frozen-lockfile
bun run list
bun run test
bun run check
bun run workflow
```

The stable path builds the engine tag in `engine.json` and rewrites each ejected
demo to the stable published version declared in `engine.json.release`:

```bash
bun run engine
bun run build
bun run pages
bun run demos
```

The unreleased path proves one qualified identity end to end:

```bash
bun run candidate
bun run build --candidate
bun run scripts/check-site.ts
```

The candidate is Shallot commit
`0664218f465224397b80aeb604b51178ac71cfb2`. The carrier dev dependency, engine
checkout, ejected demo dependency and build stamp must agree on that full SHA.
The stable release is deliberately separate from the candidate carrier: production
writes `engine.json.release` into each ejected demo manifest and fresh install lock.
The build installs the candidate from its immutable Git source and runs the
installed `shallot build` bin. `bun run demos` uses Playwright only to invoke
Shallot's public `captureFrame` contract in the page. Captures are diagnostic;
the fixed real-device seat and capture identity are the evidence.

Missing checkout, stale output, mismatched identities, fallback hardware or a
zero discovered population refuses. `bun run list` and `bun run test` are
non-vacuous when their changed-subject integration selector is used. The
site's TypeScript, Biome, roster, artifact and RUM checks remain independent of
the installed carrier.

## Deployment

Production deploys only the stable published-range build after the tag and
package name the same release, the fresh artifact checks pass, and real RUM
credentials are present. Candidate staging is a proof artifact; Cloudflare
deployment is conditional on its named credentials and is not part of local
done evidence. GitHub Pages publishes `out/site` to the engine repository's
`gh-pages` branch through `site.yml`.

For the full local-entry, identity, realpath and clean-exit contract, read
[`AGENTS.md`](AGENTS.md).
