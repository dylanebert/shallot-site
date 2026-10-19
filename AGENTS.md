Checks: `bun check`, `bun run lint` and `bun run test`; then `bun scripts/build-site.ts`, after which `bun scripts/check-site.ts` and `bunx playwright test` read `out/site`, refusing a missing or stale build.

The site uses exactly the Shallot that `package.json` and `bun.lock` pin; staging and linking follow [Shallot's CONTRIBUTING](https://github.com/dylanebert/shallot/blob/main/CONTRIBUTING.md#using-the-package).
