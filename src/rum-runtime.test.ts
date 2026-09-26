import { expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { check } from "@dylanebert/shallot/harness/check";
import { build as viteBuild } from "vite";

check(
    "RUM runtime — missing SDK leaves the game runtime running",
    { claim: "a missing browser SDK is a no-op for the game and the staging fixture" },
    async () => {
        const outDir = mkdtempSync(join(tmpdir(), "rum-runtime-offline-"));
        try {
            await viteBuild({
                configFile: false,
                root: resolve(import.meta.dir, ".."),
                logLevel: "silent",
                define: {
                    __PIPELINE_COMPILE_MEASURE_PREFIX__: JSON.stringify(
                        "shallot:pipeline-compile:",
                    ),
                    __SHALLOT_RUM_MODE__: JSON.stringify("staging"),
                    __SHALLOT_DEMO_SLUG__: JSON.stringify("first-person"),
                    __SHALLOT_BUILD_ID__: JSON.stringify("offline-test"),
                },
                build: {
                    outDir,
                    emptyOutDir: true,
                    rollupOptions: {
                        input: resolve(import.meta.dir, "rum-runtime.ts"),
                        output: { entryFileNames: "runtime.js" },
                    },
                },
            });
            const runtime = readFileSync(resolve(outDir, "runtime.js"), "utf8");
            const fakeWindow = {};
            const fakeDocument = { hidden: false, addEventListener() {} };
            const fakePerformance = { timeOrigin: 0, clearMeasures() {} };
            const frameLoopContinues: number[] = [];
            const fakeRequestAnimationFrame = (_callback: (time: number) => void) => {
                frameLoopContinues.push(1);
                // Do not recurse; the first requested frame demonstrates the running loop.
            };
            expect(() =>
                new Function(
                    "window",
                    "document",
                    "performance",
                    "requestAnimationFrame",
                    "setTimeout",
                    "PerformanceObserver",
                    "location",
                    runtime,
                )(
                    fakeWindow,
                    fakeDocument,
                    fakePerformance,
                    fakeRequestAnimationFrame,
                    () => 0,
                    undefined,
                    { search: "?rum_run=offline-test" },
                ),
            ).not.toThrow();
            expect(frameLoopContinues).toEqual([1]);

            let reported: { message: string; context?: Record<string, unknown> } | undefined;
            const readyWindow = {
                DD_RUM: {
                    onReady(callback: () => void) {
                        callback();
                    },
                    addError(error: Error, context?: Record<string, unknown>) {
                        reported = { message: error.message, context };
                    },
                },
            };
            new Function(
                "window",
                "document",
                "performance",
                "requestAnimationFrame",
                "setTimeout",
                "PerformanceObserver",
                "location",
                runtime,
            )(
                readyWindow,
                fakeDocument,
                fakePerformance,
                fakeRequestAnimationFrame,
                () => 0,
                undefined,
                { search: "?rum_run=qualification-42" },
            );
            expect(reported?.message).toBe("Shallot synthetic RUM source-map fixture");
            expect(reported?.context).toEqual({
                synthetic: true,
                demo: "first-person",
                rum_run: "qualification-42",
                application_build: "offline-test",
            });
        } finally {
            rmSync(outDir, { recursive: true, force: true });
        }
    },
);
