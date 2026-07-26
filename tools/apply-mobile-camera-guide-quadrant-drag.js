const fs = require('fs');

const htmlPath = 'makevcf.html';
const specPath = '規格書.MD';
let html = fs.readFileSync(htmlPath, 'utf8');
let spec = fs.readFileSync(specPath, 'utf8');

function replaceOnce(label, oldText, newText) {
  if (!html.includes(oldText)) throw new Error(`Cannot find HTML block: ${label}`);
  html = html.replace(oldText, newText);
}

replaceOnce(
  'camera overlay CSS',
  `.danger-lite {
  color: #a0462a !important;
}
</style>`,
  `.danger-lite {
  color: #a0462a !important;
}
.camera-overlay[hidden] {
  display: none !important;
}
.camera-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: #000;
  overflow: hidden;
}
.camera-stage {
  position: relative;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: #000;
}
#camera-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.camera-guide {
  position: absolute;
  left: 50%;
  top: 50%;
  width: min(84vw, 72vh);
  width: min(84vw, 72dvh);
  aspect-ratio: 1;
  transform: translate(-50%, -54%);
  border: 3px solid rgba(126, 202, 255, 0.98);
  border-radius: 10px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.52), 0 0 18px rgba(70, 170, 255, 0.72);
  pointer-events: none;
}
.camera-guide::before,
.camera-guide::after {
  content: "";
  position: absolute;
  background: rgba(126, 202, 255, 0.62);
}
.camera-guide::before {
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
}
.camera-guide::after {
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
}
.camera-guide-text {
  position: absolute;
  left: 50%;
  top: calc(50% - min(42vw, 36vh) - 48px);
  top: calc(50% - min(42vw, 36dvh) - 48px);
  transform: translateX(-50%);
  width: min(92vw, 560px);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  text-align: center;
  text-shadow: 0 1px 5px #000;
  pointer-events: none;
}
.camera-controls {
  position: absolute;
  left: 0;
  right: 0;
  bottom: max(22px, env(safe-area-inset-bottom));
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 34px;
  padding: 8px 18px;
}
.camera-controls button {
  color: #fff;
  border-color: rgba(255, 255, 255, 0.65);
  background: rgba(20, 20, 20, 0.66);
  backdrop-filter: blur(5px);
}
#btn-camera-capture {
  width: 70px;
  height: 70px;
  padding: 0;
  border: 5px solid rgba(255, 255, 255, 0.92);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.28);
  box-shadow: inset 0 0 0 4px rgba(0, 0, 0, 0.24);
  font-size: 0;
}
#btn-camera-capture:disabled {
  opacity: 0.42;
}
</style>`
);

replaceOnce(
  'camera overlay HTML',
  `  <input id="image-file-input" type="file" accept="image/*" hidden>
  <input id="camera-file-input" type="file" accept="image/*" capture="environment" hidden>
</div>

<script>`,
  `  <input id="image-file-input" type="file" accept="image/*" hidden>
  <input id="camera-file-input" type="file" accept="image/*" capture="environment" hidden>
</div>

<div id="camera-overlay" class="camera-overlay" hidden aria-hidden="true">
  <div class="camera-stage">
    <video id="camera-video" autoplay playsinline muted></video>
    <div class="camera-guide" aria-hidden="true"></div>
    <div class="camera-guide-text">請將棋盤對齊方形框，四邊盡量貼近框線</div>
    <div class="camera-controls">
      <button id="btn-camera-cancel" type="button">取消</button>
      <button id="btn-camera-capture" type="button" aria-label="拍照" disabled></button>
    </div>
  </div>
</div>

<script>`
);

replaceOnce(
  'camera DOM references',
  `  const imageFileInput = document.getElementById("image-file-input");
  const cameraFileInput = document.getElementById("camera-file-input");
  const importStatusEl = document.getElementById("import-status");`,
  `  const imageFileInput = document.getElementById("image-file-input");
  const cameraFileInput = document.getElementById("camera-file-input");
  const cameraOverlayEl = document.getElementById("camera-overlay");
  const cameraVideoEl = document.getElementById("camera-video");
  const btnCameraCancel = document.getElementById("btn-camera-cancel");
  const btnCameraCapture = document.getElementById("btn-camera-capture");
  const importStatusEl = document.getElementById("import-status");`
);

replaceOnce(
  'camera stream state',
  `  const importState = {
    mode: "idle",`,
  `  let cameraStream = null;

  const importState = {
    mode: "idle",`
);

replaceOnce(
  'touch quadrant helpers and begin drag',
  `  function beginCornerDrag(evt) {
    if (!importState.boardCorners.length) return;
    const idx = pickCorner(getCanvasPoint(evt, sourceCanvas));
    if (idx >= 0) {
      importState.dragCorner = idx;
      drawSource();
      evt.preventDefault();
    }
  }`,
  `  function isTouchCornerEvent(evt) {
    return !!(evt.touches || evt.changedTouches || evt.pointerType === "touch");
  }

  function pickCornerByQuadrant(pt) {
    const rect = importState.sourceRect || { x: 0, y: 0, w: sourceCanvas.width, h: sourceCanvas.height };
    const left = pt.x < rect.x + rect.w * 0.5;
    const top = pt.y < rect.y + rect.h * 0.5;
    if (top) return left ? 0 : 1;
    return left ? 3 : 2;
  }

  function beginCornerDrag(evt) {
    if (!importState.boardCorners.length || isPreviewMode()) return;
    const point = getCanvasPoint(evt, sourceCanvas);
    const idx = isTouchCornerEvent(evt) ? pickCornerByQuadrant(point) : pickCorner(point);
    if (idx >= 0) {
      importState.dragCorner = idx;
      drawSource();
      evt.preventDefault();
    }
  }`
);

replaceOnce(
  'camera functions before file list',
  `  async function loadFromFileList(files) {
    if (!files || !files[0]) return;
    await loadImageFromBlob(files[0]);
  }`,
  `  function stopCameraPreview() {
    if (cameraStream) {
      for (const track of cameraStream.getTracks()) track.stop();
      cameraStream = null;
    }
    cameraVideoEl.pause();
    cameraVideoEl.srcObject = null;
    btnCameraCapture.disabled = true;
    cameraOverlayEl.hidden = true;
    cameraOverlayEl.setAttribute("aria-hidden", "true");
  }

  async function openCameraPreview() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setImportStatus("此瀏覽器不支援即時相機框線，已改用系統拍照。");
      cameraFileInput.click();
      return;
    }
    stopCameraPreview();
    try {
      setImportStatus("正在開啟相機，請準備將棋盤對齊方形框...");
      cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1920 },
        },
      });
      cameraOverlayEl.hidden = false;
      cameraOverlayEl.setAttribute("aria-hidden", "false");
      cameraVideoEl.srcObject = cameraStream;
      await new Promise((resolve, reject) => {
        if (cameraVideoEl.readyState >= 1) {
          resolve();
          return;
        }
        const timeout = setTimeout(() => reject(new Error("相機預覽載入逾時")), 10000);
        cameraVideoEl.addEventListener("loadedmetadata", () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });
      });
      await cameraVideoEl.play();
      btnCameraCapture.disabled = false;
      setImportStatus("請將棋盤對齊方形框後拍照；拍下後只會匯入框內範圍。");
    } catch (error) {
      console.error("即時相機開啟失敗", error);
      stopCameraPreview();
      setImportStatus("無法開啟即時相機，已改用系統拍照。", true);
      cameraFileInput.click();
    }
  }

  async function captureCameraPreview() {
    if (!cameraStream || !cameraVideoEl.videoWidth || !cameraVideoEl.videoHeight) return;
    btnCameraCapture.disabled = true;
    try {
      const videoRect = cameraVideoEl.getBoundingClientRect();
      const guideRect = cameraOverlayEl.querySelector(".camera-guide").getBoundingClientRect();
      const sourceWidth = cameraVideoEl.videoWidth;
      const sourceHeight = cameraVideoEl.videoHeight;
      const coverScale = Math.max(videoRect.width / sourceWidth, videoRect.height / sourceHeight);
      const renderedWidth = sourceWidth * coverScale;
      const renderedHeight = sourceHeight * coverScale;
      const offsetX = (videoRect.width - renderedWidth) * 0.5;
      const offsetY = (videoRect.height - renderedHeight) * 0.5;
      const guideX = guideRect.left - videoRect.left;
      const guideY = guideRect.top - videoRect.top;
      let sx = (guideX - offsetX) / coverScale;
      let sy = (guideY - offsetY) / coverScale;
      let side = guideRect.width / coverScale;
      side = Math.min(side, sourceWidth, sourceHeight);
      sx = clamp(sx, 0, sourceWidth - side);
      sy = clamp(sy, 0, sourceHeight - side);
      const outputSize = Math.max(720, Math.min(1600, Math.round(side)));
      const captureCanvas = document.createElement("canvas");
      captureCanvas.width = outputSize;
      captureCanvas.height = outputSize;
      captureCanvas.getContext("2d").drawImage(
        cameraVideoEl,
        sx, sy, side, side,
        0, 0, outputSize, outputSize
      );
      const blob = await new Promise((resolve, reject) => {
        captureCanvas.toBlob(result => result ? resolve(result) : reject(new Error("照片轉換失敗")), "image/jpeg", 0.94);
      });
      stopCameraPreview();
      await loadImageFromBlob(blob);
    } catch (error) {
      console.error("拍照擷取失敗", error);
      btnCameraCapture.disabled = false;
      setImportStatus("拍照擷取失敗，請再試一次。", true);
    }
  }

  async function loadFromFileList(files) {
    if (!files || !files[0]) return;
    await loadImageFromBlob(files[0]);
  }`
);

replaceOnce(
  'camera event listeners',
  `  btnImportImage.addEventListener("click", () => imageFileInput.click());
  btnImportCamera.addEventListener("click", () => cameraFileInput.click());
  btnImportReset.addEventListener("click", () => resetImportState(true));`,
  `  btnImportImage.addEventListener("click", () => imageFileInput.click());
  btnImportCamera.addEventListener("click", () => openCameraPreview());
  btnCameraCancel.addEventListener("click", () => {
    stopCameraPreview();
    setImportStatus("已取消拍照。");
  });
  btnCameraCapture.addEventListener("click", () => captureCameraPreview());
  window.addEventListener("pagehide", () => stopCameraPreview());
  document.addEventListener("keydown", evt => {
    if (evt.key === "Escape" && !cameraOverlayEl.hidden) {
      stopCameraPreview();
      setImportStatus("已取消拍照。");
    }
  });
  btnImportReset.addEventListener("click", () => resetImportState(true));`
);

const specAnchor = '- 「原圖與棋盤框」及「辨識預覽」共用同一張可見畫布；確認棋盤區域後切換為預覽，並提供「返回調整棋盤」回到上一步。';
const specReplacement = `${specAnchor}\n- 手機拍照應優先使用瀏覽器即時相機預覽，畫面中央顯示方形棋盤對齊框並壓暗框外區域；拍照後只匯入方框內的正方形影像。不支援 getUserMedia 或相機權限失敗時，才退回系統拍照欄位。\n- 手機觸控調整棋盤四角時，不要求按中角點；以原圖顯示區中央分成左上、右上、右下、左下四個象限，手指從哪個象限開始拖曳，就移動對應角點。角點視覺大小維持不變；桌機滑鼠仍須拖曳實際角點。`;
if (!spec.includes(specAnchor)) throw new Error('Cannot find specification anchor');
spec = spec.replace(specAnchor, specReplacement);

for (const token of [
  'id="camera-overlay"',
  'navigator.mediaDevices?.getUserMedia',
  'function captureCameraPreview()',
  'function pickCornerByQuadrant(pt)',
  'isTouchCornerEvent(evt) ? pickCornerByQuadrant(point) : pickCorner(point)',
]) {
  if (!html.includes(token)) throw new Error(`Missing generated token: ${token}`);
}

fs.writeFileSync(htmlPath, html, 'utf8');
fs.writeFileSync(specPath, spec, 'utf8');
console.log('Applied mobile camera guide and touch quadrant corner dragging.');
