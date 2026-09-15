import { CAPTURE_CONTRACT, captureFrame } from "@dylanebert/shallot/harness/capture";

const canvas = document.querySelector("canvas");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("demo capture refused: no canvas");
const adapter = await navigator.gpu?.requestAdapter();
if (!adapter) throw new Error("demo capture refused: no WebGPU adapter");
const info = adapter.info ?? {};
const label = `${info.vendor ?? "unknown"} ${info.architecture ?? "unknown"} ${info.description ?? ""}`;
if (/swiftshader|software|llvmpipe|lavapipe/i.test(label)) {
    throw new Error(`demo capture refused fallback adapter: ${label}`);
}
const image = await captureFrame(canvas);
if (
    image.width !== CAPTURE_CONTRACT.width ||
    image.height !== CAPTURE_CONTRACT.height ||
    image.identity.surface !== CAPTURE_CONTRACT.surface ||
    image.identity.encoding !== CAPTURE_CONTRACT.encoding
) {
    throw new Error("demo capture refused: frame is outside the public capture contract");
}
(window as Window & { __shallotCaptureResult?: unknown }).__shallotCaptureResult = {
    adapter: label,
    capture: `${image.identity.surface} ${image.width}x${image.height}@${image.identity.deviceScale} ${image.identity.encoding}`,
};
