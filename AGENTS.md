# Shallot Site Agent Contract

## Admission

Use Bun **1.4.2** exactly. Set `BUN` to that executable and refuse a different
`$BUN --version`. The site has two roles:

- the installed `shallot` carrier runs `list`, `test`, `check` and `workflow` for
  this repository; the site's TypeScript, Biome and artifact checks remain
  independent;
- the engine identity supplies the demos that the site ejects and builds.

The stable release declaration is `engine.json.release`; production ejection
writes that stable version into every demo manifest and its fresh install lock.
It is separate from the candidate-only carrier dependency so the sanctioned
local link can replace the installed carrier without a duplicate dependency.

Supported package states are local development, immutable candidate staging and
stable published deployment. The unreleased candidate is
`70770cfc34d82fdd19cb705d8753bb6f093748d6`. Stable deployment is the named
release exit: `engine.json.tag` and `engine.json.release` must identify the same
published release. A candidate build must use the same full SHA in the
carrier dev dependency, `engine.json.candidate`, engine checkout, demo
manifest rewrite, and build stamp. A tag, package, checkout or demo mismatch
refuses.

## Entry And Proof

Use the installed bin, never a host checkout or
`node_modules/@dylanebert/shallot/scripts` path:

```sh
"$BUN" run list
"$BUN" run test
"$BUN" run check
"$BUN" run workflow
```

For candidate proof, `"$BUN" run candidate` enters the immutable checkout and
`"$BUN" run build --candidate` ejects each demo with
`github:dylanebert/shallot#70770cfc34d82fdd19cb705d8753bb6f093748d6`, then invokes
the installed `shallot build` bin. `"$BUN" run demos` uses Playwright only to
invoke Shallot's public `captureFrame` contract in the page
(`final-canvas 1280x720@1 rgba8-tight`); diagnostic
artifacts are not verdicts. A real GPU seat is required. Fallback, missing
adapter, missing display, and missing build output refuse.

Record producer and consumer HEAD and dirt, the SHA-256 hashes of `package.json`
and `bun.lock`, the manifest and lock identities, the installed package
metadata, and `realpath node_modules/@dylanebert/shallot`. Local entry uses
`"$BUN" link` in the producer and `"$BUN" link @dylanebert/shallot --no-save`
in this consumer; the realpath must equal the producer and manifest/lock
hashes must not change. Staging and published proof use a newly empty explicit
cache and `"$BUN" install --frozen-lockfile --cache-dir "$CACHE"`; staged
identity carries the complete 40-hex SHA and published identity carries its
stable declaration and exact lock resolution. A saved `link:` or `file:` source,
short or moving ref, mutable tag, or unexplained artifact refuses.

## Exit

Exit local entry with `"$BUN" install --force --frozen-lockfile --cache-dir
"$CACHE"`, prove the installed realpath is no producer path, prove the
candidate or stable manifest, lock and installed metadata identity, and rerun
the focused gate. Run a second fresh-cache frozen install. Leave no producer
symlink or local-directory residue. Do not deploy without the named stable
release, real credentials, fresh artifact, and all product gates; an absent
premise is inconclusive, never green.
