# Contributing

For anyone changing the site, person or agent. This page holds what the tree, the scripts and a failing check do not say.

- The site's Shallot identity is the installed `@dylanebert/shallot` package. `package.json` and `bun.lock` are the only records of which package the site uses; labels and source links use its installed version.
- The demo roster comes from the examples shipped by that installed package. `bun run build` uses `shallot add` to eject each example, then installs the same package tree the site resolved. A staged package overlay or live link therefore reaches each demo without another version lookup.
- `bun run build --staging` uses the same installed package identity as a regular build; it only selects staging RUM configuration and source maps. It is for the staging workflow, never a production deploy.
- Demos are captured only through Shallot's public `captureFrame` contract on a real, identified device. A capture is diagnostic; the device seat and capture identity are the evidence.
- A missing package, stale output, mismatched package version, fallback hardware or an empty population fails. An absent premise is inconclusive, never green.
- Deploy only the production build, with real credentials and a fresh artifact, after every gate passes. Cloudflare staging depends on its named credentials and is not local evidence.
- Package states, linking and exit: [Shallot's CONTRIBUTING](https://github.com/dylanebert/shallot/blob/main/CONTRIBUTING.md#pins-and-dependencies).
