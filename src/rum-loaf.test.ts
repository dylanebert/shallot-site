import { expect } from "bun:test";
import { check } from "@dylanebert/shallot/harness/check";
import {
    attributeSlowFrame,
    type LoAFEntry,
    type LoAFScript,
    unsupportedLoafAttribution,
} from "./rum-loaf";

// Red-first: an inclusive-boundary `overlaps` (`<=`/`>=`) failed both boundary-exclusion arms below
// — "an entry ending exactly at the window's start does not overlap" and "...starting exactly at
// the window's end..." each read `received loafEntryCount 1` against `expected 0` — before the
// strict-inequality comparison (`<`/`>`) was restored.

function script(overrides: Partial<LoAFScript> = {}): LoAFScript {
    return {
        sourceURL: "https://example.com/app.js",
        sourceFunctionName: "warm",
        invoker: "https://example.com/app.js",
        duration: 10,
        ...overrides,
    };
}

function entry(overrides: Partial<LoAFEntry> = {}): LoAFEntry {
    return {
        startTime: 0,
        duration: 60,
        blockingDuration: 20,
        scripts: [script()],
        ...overrides,
    };
}

check(
    "zero-overlap path: no entry overlapping the window reports an idle main thread",
    { claim: "zero-overlap path: no entry overlapping the window reports an idle main thread" },
    () => {
        const attribution = attributeSlowFrame(1000, 80, [entry({ startTime: 0, duration: 60 })]);
        expect(attribution.loafSupported).toBe(true);
        expect(attribution.loafEntryCount).toBe(0);
        expect(attribution.loafOverlapDurationMs).toBe(0);
        expect(attribution.loafOverlapBlockingMs).toBe(0);
        expect(attribution.topScript).toBeNull();
    },
);

check(
    "an entry ending exactly at the window's start does not overlap",
    { claim: "an entry ending exactly at the window's start does not overlap" },
    () => {
        // window [100, 180]; entry spans [20, 100]
        const attribution = attributeSlowFrame(100, 80, [entry({ startTime: 20, duration: 80 })]);
        expect(attribution.loafEntryCount).toBe(0);
    },
);

check(
    "an entry starting exactly at the window's end does not overlap",
    { claim: "an entry starting exactly at the window's end does not overlap" },
    () => {
        // window [100, 180]; entry spans [180, 220]
        const attribution = attributeSlowFrame(100, 80, [entry({ startTime: 180, duration: 40 })]);
        expect(attribution.loafEntryCount).toBe(0);
    },
);

check(
    "an entry starting exactly at the window's start overlaps",
    { claim: "an entry starting exactly at the window's start overlaps" },
    () => {
        // window [100, 180]; entry spans [100, 130]
        const attribution = attributeSlowFrame(100, 80, [entry({ startTime: 100, duration: 30 })]);
        expect(attribution.loafEntryCount).toBe(1);
    },
);

check(
    "an entry ending exactly at the window's end overlaps",
    { claim: "an entry ending exactly at the window's end overlaps" },
    () => {
        // window [100, 180]; entry spans [150, 180]
        const attribution = attributeSlowFrame(100, 80, [entry({ startTime: 150, duration: 30 })]);
        expect(attribution.loafEntryCount).toBe(1);
    },
);

check(
    "multiple overlapping entries: durations and blocking durations sum",
    { claim: "multiple overlapping entries: durations and blocking durations sum" },
    () => {
        const entries = [
            entry({
                startTime: 100,
                duration: 40,
                blockingDuration: 10,
                scripts: [script({ duration: 5 })],
            }),
            entry({
                startTime: 130,
                duration: 50,
                blockingDuration: 15,
                scripts: [script({ duration: 30 })],
            }),
        ];
        const attribution = attributeSlowFrame(100, 80, entries);
        expect(attribution.loafEntryCount).toBe(2);
        expect(attribution.loafOverlapDurationMs).toBe(90);
        expect(attribution.loafOverlapBlockingMs).toBe(25);
    },
);

check(
    "top script is the longest-running script across every overlapping entry",
    { claim: "top script is the longest-running script across every overlapping entry" },
    () => {
        const entries = [
            entry({
                startTime: 100,
                duration: 40,
                scripts: [script({ sourceFunctionName: "small", duration: 5 })],
            }),
            entry({
                startTime: 130,
                duration: 50,
                scripts: [
                    script({ sourceFunctionName: "medium", duration: 12 }),
                    script({ sourceFunctionName: "biggest", duration: 30 }),
                ],
            }),
        ];
        const attribution = attributeSlowFrame(100, 80, entries);
        expect(attribution.topScript?.sourceFunctionName).toBe("biggest");
        expect(attribution.topScript?.duration).toBe(30);
    },
);

check(
    "an overlapping entry with an empty scripts array leaves topScript null when no other entry has scripts",
    {
        claim: "an overlapping entry with an empty scripts array leaves topScript null when no other entry has scripts",
    },
    () => {
        const attribution = attributeSlowFrame(100, 80, [
            entry({ startTime: 100, duration: 40, scripts: [] }),
        ]);
        expect(attribution.loafEntryCount).toBe(1);
        expect(attribution.topScript).toBeNull();
    },
);

check(
    "an empty entries list is the same as no overlap",
    { claim: "an empty entries list is the same as no overlap" },
    () => {
        const attribution = attributeSlowFrame(100, 80, []);
        expect(attribution.loafEntryCount).toBe(0);
        expect(attribution.topScript).toBeNull();
    },
);

check(
    "unsupportedLoafAttribution carries loafSupported: false and no attribution fields",
    { claim: "unsupportedLoafAttribution carries loafSupported: false and no attribution fields" },
    () => {
        const attribution = unsupportedLoafAttribution();
        expect(attribution.loafSupported).toBe(false);
        expect(attribution.loafEntryCount).toBe(0);
        expect(attribution.loafOverlapDurationMs).toBe(0);
        expect(attribution.loafOverlapBlockingMs).toBe(0);
        expect(attribution.topScript).toBeNull();
    },
);
