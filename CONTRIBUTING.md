# Contributing

For anyone changing the site, person or agent. This page holds what the tree, the scripts and a failing check do not say.

- The site carries two engine identities. The installed `shallot` package runs its checks and builds. `engine.json` names the engine the demos come from: `release` is the stable version production writes into every demo manifest and its fresh install lock, `tag` is that release's tag, and `candidate` is the full SHA a candidate build carries in the carrier dev dependency, the engine checkout, the demo manifests and the build stamp. `release` stays separate from the carrier so a local link can replace the carrier without a duplicate dependency.
- `bun run build --candidate` proves one unreleased identity end to end. A candidate build is a proof, never a deploy.
- Demos are captured only through Shallot's public `captureFrame` contract on a real, identified device. A capture is diagnostic; the device seat and capture identity are the evidence.
- A missing checkout, stale output, mismatched identity, fallback hardware or an empty population fails. An absent premise is inconclusive, never green.
- Deploy only the stable build, with real credentials and a fresh artifact, after every gate passes. Cloudflare staging depends on its named credentials and is not local evidence.
- Package states, linking and exit: [Shallot's CONTRIBUTING](https://github.com/dylanebert/shallot/blob/main/CONTRIBUTING.md#pins-and-dependencies).
