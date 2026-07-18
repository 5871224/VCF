"use strict";

// ---------------- SVG board ----------------
(function initGeneratorBoard() {
  const svg = document.getElementById("board-svg");
  const ns = "http://www.w3.org/2000/svg";
  const cell = 34;
  const pad = 22;
  const px = pad * 2 + cell * 14;
  svg.setAttribute("viewBox", `0 0 ${px} ${px}`);

  function element(tag, attrs, parent) {
    const node = document.createElementNS(ns, tag);
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
    if (parent) parent.appendChild(node);
    return node;
  }

  for (let i = 0; i < 15; i++) {
    const p = pad + i * cell;
    element("line", { x1: p, y1: pad, x2: p, y2: pad + cell * 14, stroke: "#333", "stroke-width": 1 }, svg);
    element("line", { x1: pad, y1: p, x2: pad + cell * 14, y2: p, stroke: "#333", "stroke-width": 1 }, svg);
  }
  for (const row of [3, 7, 11]) for (const col of [3, 7, 11]) {
    element("circle", { cx: pad + col * cell, cy: pad + row * cell, r: 3, fill: "#333" }, svg);
  }

  const stoneLayer = element("g", {}, svg);
  const nLayer = element("g", { "pointer-events": "none" }, svg);
  const answerLayer = element("g", { "pointer-events": "none" }, svg);

  function position(idx) {
    return { cx: pad + genX(idx) * cell, cy: pad + genY(idx) * cell };
  }

  window.genDraw = function draw(result) {
    while (stoneLayer.firstChild) stoneLayer.firstChild.remove();
    while (nLayer.firstChild) nLayer.firstChild.remove();
    while (answerLayer.firstChild) answerLayer.firstChild.remove();
    if (!result) return;

    for (let idx = 0; idx < 225; idx++) {
      const color = result.board[idx];
      if (!color) continue;
      const { cx, cy } = position(idx);
      element("circle", {
        cx, cy, r: cell * 0.46,
        fill: color === GEN_BLACK ? "#111" : "#f5f5f5",
        stroke: color === GEN_BLACK ? "#000" : "#555",
        "stroke-width": 1,
      }, stoneLayer);
    }

    if (genShowNPoints) {
      for (let idx = 0; idx < 225; idx++) {
        const mask = result.nMask[idx];
        if (!mask) continue;
        const { cx, cy } = position(idx);
        const both = mask === (GEN_NO_BLACK | GEN_NO_WHITE);
        element("rect", {
          x: cx - cell * 0.17,
          y: cy - cell * 0.17,
          width: cell * 0.34,
          height: cell * 0.34,
          rx: 2,
          fill: both ? "#2e9f45" : mask & GEN_NO_BLACK ? "#222" : "#f8f8f8",
          stroke: both ? "#176729" : "#d02020",
          "stroke-width": 2,
          opacity: 0.9,
        }, nLayer);
      }
    }

    if (genShowAnswer && result.moves) {
      for (let i = 0; i < result.moves.length; i++) {
        const idx = result.moves[i];
        const color = i % 2 === 0 ? result.attacker : genOther(result.attacker);
        const { cx, cy } = position(idx);
        const group = element("g", {}, answerLayer);
        element("circle", {
          cx, cy, r: cell * 0.46,
          fill: color === GEN_BLACK ? "#222" : "#f0f0f0",
          stroke: "#e07000",
          "stroke-width": 2.5,
        }, group);
        const text = element("text", {
          x: cx, y: cy,
          "text-anchor": "middle",
          "dominant-baseline": "central",
          "font-size": cell * 0.38,
          "font-weight": "bold",
          fill: color === GEN_BLACK ? "#fff" : "#000",
        }, group);
        text.textContent = String(i + 1);
      }
    }
  };
})();
