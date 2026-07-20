"use strict";

(function initOptimizedWorker(exports) {
    if (typeof importScripts !== "function") {
        throw new Error('"importScripts" not found');
    }

    if (typeof WebAssembly !== "undefined" && typeof WebAssembly.instantiate === "function") {
        importScripts("../emoji/emoji.js", "EvaluatorWebassembly.js", "Evaluator.js", "EvaluatorOptimized.js");
    } else {
        importScripts("../emoji/emoji.js", "EvaluatorJScript.js", "Evaluator.js", "EvaluatorOptimized.js");
    }

    let busy = false;

    function resolve(param) {
        postMessage({ cmd: "resolve", param });
    }

    const commands = {
        setGameRules({ rules }) {
            busy = true;
            setGameRules(rules);
            busy = false;
            resolve({ rules });
        },

        findVCFOptimized({ arr, color, maxDepth = 200, maxNode = 5000000 }) {
            busy = true;
            try {
                resolve(findVCFOptimized(arr, color, maxDepth, maxNode));
            } finally {
                busy = false;
            }
        },
    };

    exports.onmessage = event => {
        const { cmd, param } = event.data || {};
        if (busy) throw new Error("Optimized worker is busy");
        if (typeof commands[cmd] !== "function") {
            throw new Error(`Optimized worker command not found: ${cmd}`);
        }
        commands[cmd](param || {});
    };
})(self);
