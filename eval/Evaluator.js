// EvaluatorCore.js retains the engine implementation; this loader applies local fixes.
(function loadEvaluatorCore() {
	// Browser pages may load EvaluatorCore.js explicitly before this patch file.
	if (typeof setGameRules === "function" && typeof findVCF === "function") return;

	if (typeof importScripts === "function") {
		importScripts("EvaluatorCore.js");
		return;
	}

	if (typeof require === "function") {
		const fs = require("fs");
		const path = require("path");
		const vm = require("vm");
		const candidates = [
			path.resolve(process.cwd(), "eval", "EvaluatorCore.js"),
			typeof __dirname === "string" ? path.resolve(__dirname, "..", "eval", "EvaluatorCore.js") : "",
			typeof __dirname === "string" ? path.resolve(__dirname, "EvaluatorCore.js") : ""
		];
		const corePath = candidates.find(candidate => candidate && fs.existsSync(candidate));
		if (!corePath) throw new Error("EvaluatorCore.js not found");
		vm.runInThisContext(fs.readFileSync(corePath, "utf8"), { filename: corePath });
		return;
	}

	// Fallback for a browser page that still loads only Evaluator.js.
	if (typeof document !== "undefined" && typeof XMLHttpRequest === "function") {
		const currentSrc = document.currentScript && document.currentScript.src;
		const coreUrl = new URL("EvaluatorCore.js", currentSrc || document.baseURI).href;
		const request = new XMLHttpRequest();
		request.open("GET", coreUrl, false);
		request.send(null);
		if ((request.status && (request.status < 200 || request.status >= 300)) || !request.responseText) {
			throw new Error(`EvaluatorCore.js load failed: ${request.status || "empty response"}`);
		}
		(0, eval)(`${request.responseText}\n//# sourceURL=${coreUrl}`);
		return;
	}

	throw new Error("EvaluatorCore.js loader is unavailable");
})();

// Each candidate must be removed from the board by the same index that was tested.
excludeBlockVCF = function(points, arr, color, maxVCF, maxDepth, maxNode) {
	let clone = points.slice(0),
		result = [];
	while (clone.length) {
		let i = clone.length - 1,
			idx = clone.splice(i, 1)[0];
		if (arr[idx] == 0) {
			let winMoves;
			arr[idx] = INVERT_COLOR[color];
			winMoves = findVCF(arr, color, maxVCF, maxDepth, maxNode);
			arr[idx] = 0;
			if (winMoves.length) {
				if (winMoves.length < 8) {
					for (i = i - 1; i >= 0; i--) {
						const testIdx = clone[i];
						arr[testIdx] = INVERT_COLOR[color];
						isVCF(color, arr, winMoves) && clone.splice(i, 1);
						arr[testIdx] = 0;
					}
				}
			}
			else {
				result.unshift(idx);
			}
		}
	}
	return result;
};