This repository builds and checks the Shallot site from the engine's showcase demos.

Checks: `bun run check` and `bun run test`.

Package states: https://github.com/dylanebert/shallot/blob/main/CONTRIBUTING.md#dependencies

`engine.json` holds the site's engine identity. `release` is the stable version production ejection writes into every demo manifest and its fresh install lock; `tag` is that release's tag; `candidate` is the full SHA that the carrier dev dependency, engine checkout, demo manifest rewrite and build stamp all carry in a candidate build. `release` stays separate from the carrier dev dependency so a local link can replace the installed carrier without a duplicate dependency.

`bun run demos` diagnostic artifacts are not verdicts.

In local development, record producer and consumer HEAD and dirt and the `package.json` and `bun.lock` hashes before linking; the installed `realpath node_modules/@dylanebert/shallot` must equal the producer and those hashes must not change. After leaving local, prove the realpath is no producer path, rerun the focused gate, run a second fresh-cache frozen install, and leave no producer symlink or local-directory residue. Do not deploy without the named stable release, real credentials, a fresh artifact and all product gates; an absent premise is inconclusive, never green.
