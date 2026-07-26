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
  'initial source hint',
  '<p id="source-hint">支援上傳、貼上截圖、手機拍照；可拖曳四角點修正棋盤區域。</p>',
  '<p id="source-hint">支援上傳、貼上截圖、手機拍照；桌機拖角點，手機可從對應象限任意位置拖曳該角。</p>'
);

replaceOnce(
  'dynamic source hint',
  ': "支援上傳、貼上截圖、手機拍照；可拖曳四角點修正棋盤區域。";',
  ': "支援上傳、貼上截圖、手機拍照；桌機拖角點，手機可從對應象限任意位置拖曳該角。";'
);

replaceOnce(
  'loaded source hint',
  'sourceHintEl.textContent = "若棋盤框不準，可直接拖曳四個角點修正。";',
  'sourceHintEl.textContent = "若棋盤框不準：桌機拖角點；手機從對應象限任意位置拖曳，角點會依手指位移相對移動。";'
);

replaceOnce(
  'drag offset state',
  `    boardCorners: [],
    dragCorner: -1,
    warpedIntersections: [],`,
  `    boardCorners: [],
    dragCorner: -1,
    dragOffset: null,
    warpedIntersections: [],`
);

replaceOnce(
  'reset drag offset',
  `    importState.boardCorners = [];
    importState.dragCorner = -1;
    importState.warpedIntersections = [];`,
  `    importState.boardCorners = [];
    importState.dragCorner = -1;
    importState.dragOffset = null;
    importState.warpedIntersections = [];`
);

replaceOnce(
  'relative drag start',
  `  function beginCornerDrag(evt) {
    if (!importState.boardCorners.length || isPreviewMode()) return;
    const point = getCanvasPoint(evt, sourceCanvas);
    const idx = isTouchCornerEvent(evt) ? pickCornerByQuadrant(point) : pickCorner(point);
    if (idx >= 0) {
      importState.dragCorner = idx;
      drawSource();
      evt.preventDefault();
    }
  }`,
  `  function beginCornerDrag(evt) {
    if (!importState.boardCorners.length || isPreviewMode()) return;
    const point = getCanvasPoint(evt, sourceCanvas);
    const idx = isTouchCornerEvent(evt) ? pickCornerByQuadrant(point) : pickCorner(point);
    if (idx >= 0) {
      const corner = importState.boardCorners[idx];
      importState.dragCorner = idx;
      importState.dragOffset = {
        x: corner.x - point.x,
        y: corner.y - point.y,
      };
      drawSource();
      evt.preventDefault();
    }
  }`
);

replaceOnce(
  'relative drag move and end',
  `  function moveCornerDrag(evt) {
    if (importState.dragCorner < 0) return;
    const pt = getCanvasPoint(evt, sourceCanvas);
    const r = importState.sourceRect;
    importState.boardCorners[importState.dragCorner] = {
      x: clamp(pt.x, r.x, r.x + r.w),
      y: clamp(pt.y, r.y, r.y + r.h),
    };
    drawSource();
    evt.preventDefault();
  }

  function endCornerDrag() {
    if (importState.dragCorner >= 0) {
      importState.dragCorner = -1;
      drawSource();
    }
  }`,
  `  function moveCornerDrag(evt) {
    if (importState.dragCorner < 0) return;
    const pt = getCanvasPoint(evt, sourceCanvas);
    const offset = importState.dragOffset || { x: 0, y: 0 };
    const r = importState.sourceRect;
    importState.boardCorners[importState.dragCorner] = {
      x: clamp(pt.x + offset.x, r.x, r.x + r.w),
      y: clamp(pt.y + offset.y, r.y, r.y + r.h),
    };
    drawSource();
    evt.preventDefault();
  }

  function endCornerDrag() {
    if (importState.dragCorner >= 0) {
      importState.dragCorner = -1;
      importState.dragOffset = null;
      drawSource();
    }
  }`
);

replaceOnce(
  'back reset offset',
  `    importState.mode = "cornersEditing";
    importState.dragCorner = -1;
    drawSource();`,
  `    importState.mode = "cornersEditing";
    importState.dragCorner = -1;
    importState.dragOffset = null;
    drawSource();`
);

const oldSpec = '- 手機觸控調整棋盤四角時，不要求按中角點；以原圖顯示區中央分成左上、右上、右下、左下四個象限，手指從哪個象限開始拖曳，就移動對應角點。角點視覺大小維持不變；桌機滑鼠仍須拖曳實際角點。';
const newSpec = '- 手機觸控調整棋盤四角時，不要求按中角點；以原圖顯示區中央分成左上、右上、右下、左下四個象限，手指從哪個象限開始拖曳，就選取對應角點。開始拖曳時必須保留角點與手指之間的原始偏移，角點不得跳到手指位置，只能依手指後續移動量做相對位移，避免角點被手指遮住。角點視覺大小維持不變；桌機滑鼠仍須拖曳實際角點。';
if (!spec.includes(oldSpec)) throw new Error('Cannot find quadrant drag requirement');
spec = spec.replace(oldSpec, newSpec);

for (const token of [
  'dragOffset: null',
  'x: corner.x - point.x',
  'y: corner.y - point.y',
  'x: clamp(pt.x + offset.x',
  'y: clamp(pt.y + offset.y',
]) {
  if (!html.includes(token)) throw new Error(`Missing generated token: ${token}`);
}
if (!spec.includes('角點不得跳到手指位置')) throw new Error('Missing updated specification');

fs.writeFileSync(htmlPath, html, 'utf8');
fs.writeFileSync(specPath, spec, 'utf8');
console.log('Applied relative quadrant corner dragging.');
