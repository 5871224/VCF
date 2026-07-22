"use strict";

let engineInstance = null;
let engineBaseURL = null;
let patternBenchmark = null;

function post(type, data) {
  self.postMessage({ type, data });
}

self.onmessage = async (event) => {
  const { type, data } = event.data || {};

  if (type === "init") {
    try {
      engineBaseURL = new URL("./", data.engineURL).href;
      self.importScripts(data.engineURL);
      if (typeof self.Rapfi !== "function") throw new Error("找不到 Rapfi 模組工廠");

      engineInstance = await self.Rapfi({
        locateFile: (url) => new URL(url, engineBaseURL).href,
        onReceiveStdout: (output) => post("stdout", output),
        onReceiveStderr: (output) => post("stderr", output),
        onExit: (code) => post("exit", code),
        setStatus: (status) => post("status", status),
        wasmMemory: new WebAssembly.Memory({
          initial: 1024,
          maximum: 8192,
        }),
      });

      patternBenchmark = engineInstance.cwrap(
        "vcfPatternBenchmark",
        "number",
        ["number", "number", "number"],
      );
      post("ready", true);
    } catch (error) {
      post("error", error?.stack || error?.message || String(error));
    }
    return;
  }

  if (type === "command") {
    if (!engineInstance) {
      post("error", "Rapfi 尚未完成載入");
      return;
    }
    engineInstance.sendCommand(String(data || ""));
    return;
  }

  if (type === "benchmark") {
    if (!engineInstance || !patternBenchmark) {
      post("benchmarkError", "Rapfi 棋型基準尚未完成載入");
      return;
    }
    try {
      const rule = Number(data?.rule ?? 2);
      const directionIterations = Number(data?.directionIterations ?? 20000000);
      const pointIterations = Number(data?.pointIterations ?? 5000000);
      const directionNs = patternBenchmark(rule, 0, directionIterations);
      const pointNs = patternBenchmark(rule, 1, pointIterations);
      post("benchmark", {
        rule,
        directionIterations,
        pointIterations,
        directionNs,
        pointNs,
      });
    } catch (error) {
      post("benchmarkError", error?.stack || error?.message || String(error));
    }
    return;
  }

  if (type === "terminate") {
    try {
      engineInstance?.terminate?.();
    } finally {
      self.close();
    }
  }
};
