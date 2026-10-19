import { TIMEOUT } from "@dylanebert/shallot/testing";
import { test } from "playwright/test";
import { ROSTER } from "../src/roster";

for (const slug of ["", "brand", ...ROSTER.map(({ slug }) => slug)]) {
    const path = `/shallot/${slug ? `${slug}/` : ""}`;
    test(`${path} starts`, async ({ page }) => {
        let fail!: (error: Error) => void;
        const failure = new Promise<never>((_, reject) => {
            fail = (error) => reject(error);
        });
        const report = (cause: string) => fail(new Error(`${path}: ${cause}`));
        page.on("pageerror", (error) => report(`page error: ${error.message}`));
        page.on("console", (message) => {
            if (message.type() === "error") report(`console error: ${message.text()}`);
        });
        page.on("requestfailed", (request) =>
            report(`failed request: ${request.url()} (${request.failure()?.errorText})`),
        );
        page.on("response", (response) => {
            if (response.status() >= 400) report(`HTTP ${response.status()}: ${response.url()}`);
        });

        await Promise.race([
            failure,
            (async () => {
                await page.addInitScript(() => {
                    const state = {
                        bootstrap: null as Element | null,
                        loadingSeen: false,
                        error: "",
                    };
                    Object.assign(window, { siteStartup: state });
                    const inspect = (records: MutationRecord[]) => {
                        for (const record of records) {
                            for (const node of record.addedNodes) {
                                if (
                                    node instanceof Element &&
                                    node.matches("[data-shallot-bootstrap]")
                                )
                                    state.bootstrap ??= node;
                                if (
                                    node instanceof Element &&
                                    (node.matches("[data-shallot-loading]") ||
                                        node.querySelector("[data-shallot-loading]"))
                                )
                                    state.loadingSeen = true;
                            }
                        }
                        state.bootstrap ??= document.querySelector("[data-shallot-bootstrap]");
                        if (document.querySelector("[data-shallot-loading]"))
                            state.loadingSeen = true;
                        if (state.bootstrap?.getAttribute("data-state") === "error")
                            state.error = state.bootstrap.textContent ?? "bootstrap error";
                    };
                    new MutationObserver(inspect).observe(document, {
                        childList: true,
                        subtree: true,
                        attributes: true,
                    });
                });
                await page.goto(path, { waitUntil: "load" });
                if (slug && slug !== "brand") {
                    await page.waitForFunction(
                        () => {
                            const state = (
                                window as unknown as {
                                    siteStartup: {
                                        bootstrap: Element | null;
                                        loadingSeen: boolean;
                                        error: string;
                                    };
                                }
                            ).siteStartup;
                            if (state.error) throw new Error(state.error);
                            return (
                                (state.bootstrap
                                    ? !state.bootstrap.isConnected
                                    : state.loadingSeen) &&
                                !document.querySelector("[data-shallot-loading]")
                            );
                        },
                        undefined,
                        { timeout: TIMEOUT.browser },
                    );
                }
            })(),
        ]);
    });
}
