"use strict";

(function initVCFGooglePopupAuth(global) {
  if (typeof document === "undefined") return;

  const LOGIN_URL = "api/google-login.php";
  const LOGIN_ORIGIN = global.location.origin;
  const TOKEN_KEY = "vcf_google_auth_token_v1";
  let popup = null;

  function setStatus(message) {
    const node = document.getElementById("bb-export-status");
    if (node) node.textContent = message;
  }

  function openLogin() {
    const width = 480;
    const height = 620;
    const left = Math.max(0, Math.round((global.screen.width - width) / 2));
    const top = Math.max(0, Math.round((global.screen.height - height) / 2));
    popup = global.open(
      LOGIN_URL,
      "vcfGoogleLogin",
      `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
    if (!popup) {
      setStatus("瀏覽器阻擋了 Google 登入視窗，請允許此網站開啟彈出式視窗。");
      return;
    }
    popup.focus();
    setStatus("請在登入視窗完成 Google 登入。");
  }

  function installButton() {
    const target = document.getElementById("vcf-google-login");
    if (!target || target.dataset.popupAuthReady === "1") return false;
    target.dataset.popupAuthReady = "1";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bb-cloud-btn";
    button.textContent = "使用 Google 登入";
    button.addEventListener("click", openLogin);
    target.replaceChildren(button);
    return true;
  }

  global.addEventListener("message", event => {
    if (event.origin !== LOGIN_ORIGIN) return;
    if (popup && event.source !== popup) return;
    const data = event.data;
    if (!data || data.type !== "vcf-google-auth") return;
    const token = String(data.token || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(token)) {
      setStatus("登入回傳 Token 格式無效。");
      return;
    }
    try {
      global.localStorage.setItem(TOKEN_KEY, token);
    } catch (_) {
      setStatus("瀏覽器無法保存登入狀態。");
      return;
    }
    setStatus("Google 登入成功，正在重新載入你的雲端棋譜……");
    if (popup && !popup.closed) popup.close();
    global.location.reload();
  });

  installButton();
  global.addEventListener("load", installButton, { once: true });
})(typeof window !== "undefined" ? window : globalThis);
