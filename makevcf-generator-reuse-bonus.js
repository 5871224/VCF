"use strict";

// Apply the reuse preference to both attack stones and existing defender stones.
// Every newly built dead-four candidate must also reserve all of its five points
// as N points for both sides before any validation, auto-blocking, or final fill runs.
(function initGeneratorReuseBonus() {
  if (window.__generatorReuseBonusLoaded) return;
  window.__generatorReuseBonusLoaded = true;

  const bothN = GEN_NO_BLACK | GEN_NO_WHITE;

  function renameReuseControl() {
    const input = genEl("bonus-reuse");
    const label = input?.closest("label");
    if (!label) return;

    for (const node of label.childNodes) {
      if (node === input) break;
      if (node.nodeType === Node.TEXT_NODE) {
        node.nodeValue = "沿用棋子加成 ";
        break;
      }
    }
    label.title = "0% 不加權；攻方棋，以及死四模板 X 點或五點原有的守方棋，每沿用一顆都套用相同加成；100% 時每顆沿用棋使候選權重增加 99";
  }

  function protectCandidateFivePoints(candidate) {
    if (!candidate?.nMask) return;
    const points = new Set([
      candidate.fivePoint,
      ...Array.from(candidate.lineFivePoints || []),
    ]);
    for (const idx of points) {
      if (idx >= 0 && idx < 225) candidate.nMask[idx] |= bothN;
    }
  }

  renameReuseControl();

  const originalBuildLayerCandidates = genBuildLayerCandidates;
  genBuildLayerCandidates = function buildLayerCandidatesWithDefenderReuse(
    base,
    anchor,
    direction,
    sign,
    template,
    anchorSlot,
    attacker,
    rules,
    options
  ) {
    const candidates = originalBuildLayerCandidates(
      base,
      anchor,
      direction,
      sign,
      template,
      anchorSlot,
      attacker,
      rules,
      options
    );

    for (const candidate of candidates) {
      // Mark the current layer's only winning point immediately. For same-line
      // double fours, both winning points are protected. Later defender placement
      // therefore rejects them through the normal genIsNFor() checks.
      protectCandidateFivePoints(candidate);

      const reusedDefenders = new Set();

      // Template X endpoints may reuse defender stones already present on the board.
      for (const idx of candidate.xPoints || []) {
        if (
          idx >= 0 &&
          idx < 225 &&
          base.board[idx] === candidate.defender
        ) {
          reusedDefenders.add(idx);
        }
      }

      // A defender already on the template F (five) point is temporarily removed
      // while validating the route, but is still an existing reused stone.
      if ((candidate.removedDefenders || []).includes(candidate.fivePoint)) {
        reusedDefenders.add(candidate.fivePoint);
      }

      candidate.reusedDefenders = Array.from(reusedDefenders);
      candidate.weight += reusedDefenders.size * Math.max(0, Number(options?.reuseBonus) || 0);
    }

    return candidates;
  };

  const originalLayerRecord = genLayerRecord;
  genLayerRecord = function layerRecordWithDefenderReuse(candidate, step) {
    const record = originalLayerRecord(candidate, step);
    record.reusedDefenders = Array.from(candidate.reusedDefenders || []);
    return record;
  };
})();

// Load the final target-board policy first, then the complete defense-point policy,
// and finally both replay layers so replay records the corrected blocking process.
(function loadGeneratorTargetBoardPolicy() {
  if (window.__generatorTargetBoardPolicyScriptRequested) return;
  window.__generatorTargetBoardPolicyScriptRequested = true;

  const script = document.createElement("script");
  script.src = new URL("makevcf-generator-target-board-v3.js", document.baseURI).href;
  script.async = false;
  script.addEventListener("load", () => {
    if (window.__generatorDefensePointPolicyScriptRequested) return;
    window.__generatorDefensePointPolicyScriptRequested = true;
    const defenseScript = document.createElement("script");
    defenseScript.src = new URL("makevcf-generator-defense-points.js", document.baseURI).href;
    defenseScript.async = false;
    defenseScript.addEventListener("load", () => {
      if (window.__generatorProgressScriptRequested) return;
      window.__generatorProgressScriptRequested = true;
      const progressScript = document.createElement("script");
      progressScript.src = new URL("makevcf-generator-progress.js", document.baseURI).href;
      progressScript.async = false;
      progressScript.addEventListener("load", () => {
        if (window.__generatorCompleteReplayScriptRequested) return;
        window.__generatorCompleteReplayScriptRequested = true;
        const completeReplayScript = document.createElement("script");
        completeReplayScript.src = new URL("makevcf-generator-replay-complete.js", document.baseURI).href;
        completeReplayScript.async = false;
        document.head.appendChild(completeReplayScript);
      });
      document.head.appendChild(progressScript);
    });
    document.head.appendChild(defenseScript);
  });
  document.head.appendChild(script);
})();
