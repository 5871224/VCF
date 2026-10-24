"use strict";
(function initVCFStaticAnnotations(global) {
  const COLORS = Object.freeze(["#E53935", "#F57C00", "#FBC02D", "#43A047", "#00ACC1", "#1E88E5", "#8E24AA", "#EC407A", "#212121", "#FFFFFF"]);
  const KEY = "vcf_static_annotations_v1";
  const MAX_ANNOTATIONS = 50000;
  let routes = Object.create(null);

  const coord = n => Number.isInteger(n) && n >= 0 && n < 15;
  const validColor = c => Number.isInteger(c) && c >= 0 && c < COLORS.length;
  const singleChar = value => {
    const chars = Array.from(String(value || ""));
    return chars.length === 1 && chars[0] !== "\n" && chars[0] !== "\r" ? chars[0] : null;
  };
  function normalize(item) {
    if (!item || typeof item !== "object" || !validColor(item.color) || !coord(item.x) || !coord(item.y)) return null;
    if (item.type === "circle") return { type: "circle", x: item.x, y: item.y, color: item.color, filled: item.filled === true };
    if (item.type === "text") {
      const text = singleChar(item.text);
      return text ? { type: "text", x: item.x, y: item.y, color: item.color, text } : null;
    }
    if ((item.type === "line" || item.type === "arrow") && coord(item.tx) && coord(item.ty) && (item.x !== item.tx || item.y !== item.ty)) {
      return { type: item.type, x: item.x, y: item.y, tx: item.tx, ty: item.ty, color: item.color };
    }
    return null;
  }
  function validateRoutes(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("標記資料必須是局面索引");
    const result = Object.create(null);
    let total = 0;
    for (const [key, list] of Object.entries(raw)) {
      if (key.length > 4096 || !/^[012]:((record)|(puzzle)):(?:-?\d+(?:,-?\d+)*)?$/.test(key) || !Array.isArray(list)) throw new Error("標記的棋譜路線格式錯誤");
      if (list.length > 225 * 10) throw new Error("單一局面的標記數量過多");
      const cleaned = [];
      for (const item of list) {
        const mark = normalize(item);
        if (!mark) throw new Error("標記包含無效座標、文字或顏色");
        cleaned.push(mark);
      }
      total += cleaned.length;
      if (total > MAX_ANNOTATIONS) throw new Error("標記數量超出上限");
      if (cleaned.length) result[key] = cleaned;
    }
    return result;
  }
  function persist() {
    try { global.localStorage?.setItem(KEY, JSON.stringify(routes)); }
    catch (error) { console.warn("標記自動保存失敗", error); }
    global.dispatchEvent?.(new Event("vcf-static-annotations-changed"));
  }
  try {
    const saved = global.localStorage?.getItem(KEY);
    if (saved) routes = validateRoutes(JSON.parse(saved));
  } catch (error) {
    console.warn("標記暫存格式錯誤，已忽略", error);
    routes = Object.create(null);
  }
  const route = () => String(global.VCFWorkbenchRecord?.annotationRoute?.() || "");
  const list = () => routes[route()] ? routes[route()].map(item => ({ ...item })) : [];
  function setMark(value) {
    const key = route();
    const mark = normalize(value);
    if (!key || !mark) return false;
    const existing = routes[key] || [];
    const same = other => other.type === mark.type && other.x === mark.x && other.y === mark.y
      && (mark.type !== "line" && mark.type !== "arrow" || (other.tx === mark.tx && other.ty === mark.ty));
    routes[key] = existing.filter(item => !same(item)).concat(mark);
    persist();
    return true;
  }
  function eraseAt(x, y) {
    const key = route();
    if (!key || !routes[key]) return false;
    const next = routes[key].filter(item => {
      const start = item.x === x && item.y === y;
      const end = (item.type === "line" || item.type === "arrow") && item.tx === x && item.ty === y;
      return !start && !end;
    });
    if (next.length === routes[key].length) return false;
    if (next.length) routes[key] = next;
    else delete routes[key];
    persist();
    return true;
  }
  function reset() { routes = Object.create(null); persist(); }
  function exportData() { return JSON.parse(JSON.stringify(routes)); }
  function importData(raw) { routes = validateRoutes(raw); persist(); }
  function count() { return Object.values(routes).reduce((sum, values) => sum + values.length, 0); }
  function transform(t) {
    if (!Number.isInteger(t) || t < 0 || t > 7) return false;
    const transformXY = (x, y) => {
      const n = 14;
      switch (t) {
        case 1: return [n-y,x];
        case 2: return [n-x,n-y];
        case 3: return [y,n-x];
        case 4: return [n-x,y];
        case 5: return [n-y,n-x];
        case 6: return [x,n-y];
        case 7: return [y,x];
        default: return [x,y];
      }
    };
    const move = m => {
      const n = Number(m);
      if (n < 0 || n >= 225) return n;
      const [x,y] = transformXY(n % 15, Math.floor(n / 15));
      return y*15+x;
    };
    const updated = Object.create(null);
    for (const [key, values] of Object.entries(routes)) {
      const [rule, mode, history] = key.split(":");
      const path = history ? history.split(",").map(move).join(",") : "";
      const nextKey = rule + ":" + mode + ":" + path;
      updated[nextKey] = values.map(item => {
        const [x,y] = transformXY(item.x,item.y);
        const result = { ...item, x, y };
        if (item.type === "line" || item.type === "arrow") [result.tx,result.ty] = transformXY(item.tx,item.ty);
        return result;
      });
    }
    routes = updated;
    persist();
    return true;
  }
  global.VCFStaticAnnotations = Object.freeze({
    COLORS, route, list, setMark, eraseAt, reset, exportData, importData, validateData: validateRoutes, count, transform,
  });
})(window);
