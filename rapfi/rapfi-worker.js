"use strict";

let engineInstance = null;
let engineBaseURL = null;

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

  if (type === "terminate") {
    try {
      engineInstance?.terminate?.();
    } finally {
      self.close();
    }
  }
};
