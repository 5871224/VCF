"use strict";

(function initFirstVCFWorker(exports) {
    if (typeof importScripts !== "function") throw new Error('"importScripts" not found');

    if (typeof WebAssembly !== "undefined" && typeof WebAssembly.instantiate === "function") {
        importScripts("../emoji/emoji.js", "EvaluatorWebassembly.js", "Evaluator.js", "EvaluatorFirstVCF.js");
    } else {
        importScripts("../emoji/emoji.js", "EvaluatorJScript.js", "Evaluator.js", "EvaluatorFirstVCF.js");
    }

    let busy = false;
    const resolve = param => postMessage({ cmd: "resolve", param });

    const commands = {
        setGameRules({ rules }) {
            busy = true;
            try {
                setGameRules(rules);
                resolve({ rules });
            } finally {
                busy = false;
            }
        },

        findFirstVCF({ arr, color, maxDepth = 200, maxNode = 5000000 }) {
            busy = true;
            try {
                resolve(findFirstVCF(arr, color, maxDepth, maxNode));
            } finally {
                busy = false;
            }
        },
    };

    exports.onmessage = event => {
        const { cmd, param } = event.data || {};
        if (busy) throw new Error("First VCF worker is busy");
        if (typeof commands[cmd] !== "function") throw new Error(`Unknown command: ${cmd}`);
        commands[cmd](param || {});
    };
})(self);
