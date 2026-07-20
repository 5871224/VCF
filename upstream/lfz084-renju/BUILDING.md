# Rebuilding the upstream evaluator

This directory contains an unmodified snapshot of `lfz084/renju` at the commit
recorded in `SOURCE_MANIFEST.txt`.

The production evaluator under the repository root `eval/` is intentionally kept
separate. Build and optimisation work should happen here first.

## Included upstream files

The imported `eval/` directory contains:

- `Evaluator.cpp` — original C++ evaluator source.
- `Evaluator.wasm` — upstream compiled reference module.
- `Evaluator.wat` — upstream text-format WebAssembly reference.
- `EvaluatorWebassembly.js` — browser wrapper and expected export interface.
- `EvaluatorJScript.js` — JavaScript fallback implementation.
- `Evaluator.js`, `worker.js`, `engine.js` — integration and worker code.
- `Evaluator.html` — upstream test page.

## Recommended build environment

The upstream head commit is labelled `emcc 3.1.74`, so the helpers pin the Docker
image `emscripten/emsdk:3.1.74`.

### Windows / PowerShell with Docker

From the repository root:

```powershell
.\upstream\lfz084-renju\build-with-docker.ps1
```

### Activated Emscripten SDK

With Emscripten 3.1.74 already activated:

```bash
bash upstream/lfz084-renju/build-evaluator.sh
```

The output is written to:

```text
upstream/lfz084-renju/build/Evaluator.wasm
upstream/lfz084-renju/build/Evaluator.wat  # when wasm-dis or wasm2wat is available
```

## Important compatibility checks

Before connecting a rebuilt module to the web page, compare it with the imported
reference `eval/Evaluator.wat` and verify at least:

1. The module exports `memory`.
2. The C++ mangled exports used by `EvaluatorWebassembly.js` still exist.
3. Required `env` imports are supplied by the wrapper.
4. `getInBuffer()` and `getOutBuffer()` return valid offsets.
5. Existing VCF, foul, level and block-point regression boards return identical
   results.

Do not overwrite the root production `eval/Evaluator.wasm` during experiments.
Use a separate filename such as `EvaluatorOptimized.wasm` and a separate worker.

## Build-command provenance

The upstream repository contains source and generated WASM/WAT files but no build
script. `build-evaluator.sh` is a local reproducibility helper inferred from the
module shape expected by `EvaluatorWebassembly.js`; it is not claimed to be the
original author's exact command. Its output must be verified before deployment.

## Licence

See `UPSTREAM.md`. No root-level licence file was present in the imported upstream
snapshot, so confirm permission before redistributing modified source or compiled
derivatives.
