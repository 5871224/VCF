"use strict";

// White forbidden-capture generator for Renju.
// This file is loaded after the generator core, validation, main flow and unique-mode patches,
// so it can extend the existing generator without duplicating the VCF search engine.
(function installWhiteForbiddenCaptureGenerator() {
  const FORBIDDEN_KINDS = ["overline", "doubleFour", "doubleThree"];
  const FORBIDDEN_LABELS = {
    overline: "長連",
    doubleFour: "四四",
    doubleThree: "三三",
  };
  const BOTH_N = GEN_NO_BLACK | GEN_NO_WHITE;

  let overlineSkeletons = null;
  let doubleThreeEntries = null;
  let blackDeadFourBases = null;

  // The evaluator reports a white dead four whose only block is a black foul as level 9.
  // Normal free fours store the 0x80 mark, while catch-foul stores no four mark.
  // For generator board matching, catch-foul completes after White's move, not before it.
  const baseAnalyzeVCFGroup = genAnalyzeVCFGroup;
  genAnalyzeVCFGroup = function analyzeForbiddenCaptureGroup(initialBoard, moves, attacker) {
    const analysis = baseAnalyzeVCFGroup(initialBoard, moves, attacker);
    const rawLevel = analysis?.rawLevels?.at(-1);
    const isWhiteCatchFoul =
      analysis?.valid &&
      attacker === GEN_WHITE &&
      (rawLevel & 0x0f) === GEN_FOUR_FREE &&
      (rawLevel & 0xe0) === 0;

    if (isWhiteCatchFoul) {
      const foulPoint = (rawLevel >>> 8) & 0xff;
      if (
        foulPoint >= 0 &&
        foulPoint < 225 &&
        analysis.completedBoard[foulPoint] === GEN_EMPTY &&
        isFoul(foulPoint, analysis.completedBoard)
      ) {
        analysis.standardBoard = genCloneBoard(analysis.completedBoard);
      }
    }
    return analysis;
  };

  // Keep the forbidden-capture metadata while the normal reverse layer generator
  // extends the one-step seed to two or more steps.
  const baseBuildLayerCandidates = genBuildLayerCandidates;
  genBuildLayerCandidates = function buildLayerCandidatesWithForbiddenMetadata(...args) {
    const base = args[0];
    const source = base?.captureForbidden
      ? base
      : base?.rootBase?.captureForbidden ? base.rootBase : null;
    const candidates = baseBuildLayerCandidates(...args);
    if (!source) return candidates;

    for (const candidate of candidates) {
      candidate.captureForbidden = true;
      candidate.forbiddenPoint = source.forbiddenPoint;
      candidate.forbiddenKind = source.forbiddenKind;
      candidate.forbiddenLabel = source.forbiddenLabel;
      candidate.forbiddenPatternText = source.forbiddenPatternText || source.patternText;
    }
    return candidates;
  };

  function cloneNMask(source) {
    return source instanceof Uint8Array ? source.slice() : Uint8Array.from(source || []);
  }

  function makeSkeleton(kind, point, board, nMask, patternText, weight = 1) {
    const mask = cloneNMask(nMask);
    mask[point] |= BOTH_N;
    return {
      kind,
      label: FORBIDDEN_LABELS[kind],
      point,
      board: genCloneBoard(board),
      nMask: mask,
      patternText,
      weight,
    };
  }

  function dedupeSkeletons(items) {
    const map = new Map();
    for (const item of items) {
      const key = `${item.point}|${item.board.slice(0, 225).join("")}|${Array.from(item.nMask).join("")}`;
      if (!map.has(key)) map.set(key, item);
    }
    return Array.from(map.values());
  }

  function buildOverlineSkeletons() {
    if (overlineSkeletons) return overlineSkeletons;

    const patterns = [
      {
        id: "closed",
        text: "黑 A 黑 黑 黑 黑 X",
        cells: ["B", "A", "B", "B", "B", "B", "X"],
        anchorSlot: 1,
      },
      {
        id: "protected",
        text: "黑 黑 A 黑 黑 黑 N N",
        cells: ["B", "B", "A", "B", "B", "B", "N", "N"],
        anchorSlot: 2,
      },
    ];
    const results = [];

    for (const pattern of patterns) {
      for (const direction of GEN_DIRECTIONS) {
        for (const sign of [-1, 1]) {
          for (let forbiddenPoint = 0; forbiddenPoint < 225; forbiddenPoint++) {
            const mapped = pattern.cells.map((_, slot) =>
              genPointFrom(forbiddenPoint, slot - pattern.anchorSlot, direction, sign)
            );

            let valid = true;
            for (let slot = 0; slot < pattern.cells.length; slot++) {
              const type = pattern.cells[slot];
              if ((type === "B" || type === "A") && mapped[slot] === GEN_OUT) {
                valid = false;
                break;
              }
            }
            if (!valid) continue;

            const board = genBoard();
            const nMask = new Uint8Array(225);
            for (let slot = 0; slot < pattern.cells.length; slot++) {
              const type = pattern.cells[slot];
              const idx = mapped[slot];
              if (type === "B") board[idx] = GEN_BLACK;
              else if (type === "X" && idx !== GEN_OUT) board[idx] = GEN_WHITE;
              else if (type === "N" && idx !== GEN_OUT) nMask[idx] |= GEN_NO_BLACK;
            }
            nMask[forbiddenPoint] |= BOTH_N;

            if (!isFoul(forbiddenPoint, board)) continue;
            results.push(makeSkeleton(
              "overline",
              forbiddenPoint,
              board,
              nMask,
              pattern.text,
              genBaseWeight(mapped),
            ));
          }
        }
      }
    }

    overlineSkeletons = dedupeSkeletons(results);
    return overlineSkeletons;
  }

  function getDoubleThreeEntries() {
    if (doubleThreeEntries) return doubleThreeEntries;

    const byPoint = new Map();
    for (const placement of genBuildLiveThreePlacements(GEN_BLACK, 2)) {
      for (const forbiddenPoint of placement.anchorCandidates) {
        const list = byPoint.get(forbiddenPoint) || [];
        list.push({ placement, forbiddenPoint });
        byPoint.set(forbiddenPoint, list);
      }
    }
    doubleThreeEntries = byPoint;
    return doubleThreeEntries;
  }

  function mergeDoubleThree(left, right, forbiddenPoint) {
    if (left.direction.line === right.direction.line) return null;

    const board = genBoard();
    const nMask = new Uint8Array(225);
    for (let idx = 0; idx < 225; idx++) {
      const leftStone = left.board[idx];
      const rightStone = right.board[idx];
      if (leftStone && rightStone && leftStone !== rightStone) return null;
      board[idx] = leftStone || rightStone || GEN_EMPTY;
      nMask[idx] = left.nMask[idx] | right.nMask[idx];
    }

    board[forbiddenPoint] = GEN_EMPTY;
    nMask[forbiddenPoint] |= BOTH_N;
    for (let idx = 0; idx < 225; idx++) {
      if (board[idx] === GEN_BLACK && genIsNFor(nMask, idx, GEN_BLACK)) return null;
    }
    if (!isFoul(forbiddenPoint, board)) return null;

    return makeSkeleton(
      "doubleThree",
      forbiddenPoint,
      board,
      nMask,
      `${left.patternText} × ${right.patternText}`,
      (left.weight || 1) * (right.weight || 1),
    );
  }

  function randomDoubleThreeSkeleton() {
    const byPoint = getDoubleThreeEntries();
    const points = Array.from(byPoint.keys()).filter(point => byPoint.get(point).length >= 2);
    if (!points.length) return null;

    for (let attempt = 0; attempt < 240; attempt++) {
      const forbiddenPoint = points[genRand(points.length)];
      const entries = byPoint.get(forbiddenPoint);
      const first = entries[genRand(entries.length)].placement;
      const second = entries[genRand(entries.length)].placement;
      if (first === second) continue;
      const skeleton = mergeDoubleThree(first, second, forbiddenPoint);
      if (skeleton) return skeleton;
    }
    return null;
  }

  function getBlackDeadFourBases() {
    if (!blackDeadFourBases) {
      // The base geometry is identical under no-forbidden rules; final legality is checked
      // with the active Renju foul detector after the two fours are combined.
      blackDeadFourBases = genBuildDeadFourPlacements(GEN_BLACK, 1);
    }
    return blackDeadFourBases;
  }

  function buildDoubleFourCandidatesWithoutThreeRepair(
    base,
    anchor,
    direction,
    sign,
    template,
    anchorSlot,
    options,
  ) {
    const previousRepair = genBuildRepairVariants;
    const previousIsFoul = isFoul;

    // Reuse the normal four-four layer generator, but this one call has two deliberate
    // differences: A is allowed to be a foul, and a live three left in Black's first
    // four after removing A is not closed with a White stone.
    genBuildRepairVariants = function skipForbiddenSkeletonThreeRepair(
      board,
      scanPoints,
      _xPoints,
      lineDirection,
      attacker,
      _defender,
      rules,
    ) {
      return [{
        board,
        addedDefenders: [],
        liveThreeExtensions: genGetNewLiveThreeExtensions(
          board,
          scanPoints,
          lineDirection.line,
          attacker,
          rules,
        ),
      }];
    };
    isFoul = function allowTargetForbiddenPoint(idx, board) {
      return idx === anchor ? false : previousIsFoul(idx, board);
    };

    try {
      return baseBuildLayerCandidates(
        base,
        anchor,
        direction,
        sign,
        template,
        anchorSlot,
        GEN_BLACK,
        2,
        options,
      );
    } finally {
      genBuildRepairVariants = previousRepair;
      isFoul = previousIsFoul;
    }
  }

  function randomDoubleFourSkeleton(options) {
    const bases = getBlackDeadFourBases();
    if (!bases.length) return null;

    for (let attempt = 0; attempt < 120; attempt++) {
      const base = genWeightedPick(bases);
      const anchors = genWeightedOrder(base.anchorCandidates.map(point => ({ point, weight: 1 })))
        .map(item => item.point);
      for (const anchor of anchors) {
        for (const direction of genWeightedOrder(GEN_DIRECTIONS.map(item => ({ ...item, weight: 1 })))) {
          for (const sign of genRand(2) ? [1, -1] : [-1, 1]) {
            for (const template of GEN_NEW_FOUR_TEMPLATES) {
              for (const anchorSlot of template.stoneSlots) {
                const candidates = buildDoubleFourCandidatesWithoutThreeRepair(
                  base,
                  anchor,
                  direction,
                  sign,
                  template,
                  anchorSlot,
                  options,
                );
                for (const candidate of candidates) {
                  if (!isFoul(anchor, candidate.board)) continue;
                  const nMask = cloneNMask(candidate.nMask);
                  nMask[anchor] |= BOTH_N;
                  return makeSkeleton(
                    "doubleFour",
                    anchor,
                    candidate.board,
                    nMask,
                    candidate.sameLineDoubleFour ? "同線四四" : "異線四四",
                    candidate.weight || base.weight || 1,
                  );
                }
              }
            }
          }
        }
      }
    }
    return null;
  }

  function randomForbiddenSkeleton(kind, options) {
    if (kind === "overline") {
      const items = buildOverlineSkeletons();
      return items.length ? genWeightedPick(items) : null;
    }
    if (kind === "doubleFour") return randomDoubleFourSkeleton(options);
    if (kind === "doubleThree") return randomDoubleThreeSkeleton();
    return null;
  }

  function buildWhiteCaptureCandidates(skeleton, options) {
    const forbiddenPoint = skeleton.point;
    const candidates = [];

    for (const direction of GEN_DIRECTIONS) {
      for (const sign of [-1, 1]) {
        for (const template of GEN_NEW_FOUR_TEMPLATES) {
          for (const anchorSlot of template.stoneSlots) {
            const anchor = genPointFrom(
              forbiddenPoint,
              anchorSlot - template.fiveSlot,
              direction,
              sign,
            );
            if (anchor === GEN_OUT || anchor === forbiddenPoint) continue;

            const board = genCloneBoard(skeleton.board);
            const nMask = cloneNMask(skeleton.nMask);
            // A is already reserved for both sides in the finished candidate, but the
            // existing layer builder must temporarily see it as an available five point.
            nMask[forbiddenPoint] &= ~BOTH_N;

            if (board[anchor] === GEN_BLACK || genIsNFor(nMask, anchor, GEN_WHITE)) continue;
            if (board[anchor] === GEN_EMPTY) board[anchor] = GEN_WHITE;
            if (board[anchor] !== GEN_WHITE) continue;

            const base = {
              board,
              nMask,
              attacker: GEN_WHITE,
              materialType: "forbiddenCapture",
              patternName: `抓禁手（${skeleton.label}）`,
              patternText: skeleton.patternText,
              anchorCandidates: [anchor],
              forbiddenAnchorPoints: [],
              direction: null,
              finishPoint: null,
              weight: skeleton.weight || 1,
              captureForbidden: true,
              forbiddenPoint,
              forbiddenKind: skeleton.kind,
              forbiddenLabel: skeleton.label,
            };

            const built = genBuildLayerCandidates(
              base,
              anchor,
              direction,
              sign,
              template,
              anchorSlot,
              GEN_WHITE,
              2,
              options,
            );

            for (const candidate of built) {
              if (candidate.fivePoint !== forbiddenPoint) continue;
              candidate.nMask[forbiddenPoint] |= BOTH_N;
              candidate.base.nMask[forbiddenPoint] |= BOTH_N;

              const expected = genCloneBoard(candidate.board);
              if (expected[anchor] !== GEN_EMPTY) continue;
              expected[anchor] = GEN_WHITE;

              const lineInfo = testLineFour(
                anchor,
                candidate.direction.line,
                GEN_WHITE,
                expected,
              );
              const rawLevel = getLevelPoint(anchor, GEN_WHITE, expected);
              // 抓禁手會被整體等級判成活四（9），但指定方向的幾何棋型仍必須是死四（8）。
              if ((lineInfo & GEN_LINE_MASK) !== GEN_FOUR_NOFREE || (rawLevel & 0x60)) continue;
              if (!isFoul(forbiddenPoint, expected)) continue;

              candidate.captureForbidden = true;
              candidate.forbiddenPoint = forbiddenPoint;
              candidate.forbiddenKind = skeleton.kind;
              candidate.forbiddenLabel = skeleton.label;
              candidate.forbiddenPatternText = skeleton.patternText;
              candidate.weight *= skeleton.weight || 1;
              candidates.push(candidate);
            }
          }
        }
      }
    }

    const dedup = new Map();
    for (const candidate of candidates) {
      const key = `${candidate.board.slice(0, 225).join("")}|${candidate.anchor}|${candidate.forbiddenPoint}`;
      const old = dedup.get(key);
      if (!old || old.weight < candidate.weight) dedup.set(key, candidate);
    }
    return Array.from(dedup.values());
  }

  async function genFindForbiddenCaptureSeed(options, counters, targetSteps) {
    while (!genCancelled) {
      counters.baseRounds++;
      const kind = FORBIDDEN_KINDS[genRand(FORBIDDEN_KINDS.length)];
      const skeleton = randomForbiddenSkeleton(kind, options);
      if (!skeleton) {
        if (counters.baseRounds % 12 === 0) await genTick();
        continue;
      }

      const candidates = genWeightedOrder(buildWhiteCaptureCandidates(skeleton, options));
      if (!candidates.length) {
        if (counters.baseRounds % 12 === 0) await genTick();
        continue;
      }

      for (const candidate of candidates) {
        if (genCancelled) return null;
        counters.attempts++;
        genSetStatus(
          `正在建立 1/${targetSteps} 步白方抓禁手（${candidate.forbiddenLabel}）基礎……` +
          `已驗證 ${counters.attempts} 個候選`,
        );

        const result = await genValidateCandidate(candidate, 1);
        if (result) {
          result.candidateGroupCounts = [candidates.length];
          return result;
        }
        if (counters.attempts % 8 === 0) await genTick();
      }
    }
    return null;
  }

  const previousBuildExpectedBaseBoard = genBuildExpectedBaseBoard;
  genBuildExpectedBaseBoard = function buildForbiddenExpectedBaseBoard(candidate) {
    const expected = previousBuildExpectedBaseBoard(candidate);
    if (!expected || !candidate?.captureForbidden) return expected;

    const forbiddenPoint = Number(candidate.forbiddenPoint);
    if (
      candidate.attacker !== GEN_WHITE ||
      candidate.rules !== 2 ||
      forbiddenPoint < 0 ||
      forbiddenPoint >= 225 ||
      expected[forbiddenPoint] !== GEN_EMPTY ||
      !genIsNFor(candidate.nMask, forbiddenPoint, GEN_BLACK) ||
      !genIsNFor(candidate.nMask, forbiddenPoint, GEN_WHITE)
    ) {
      return null;
    }

    const line = Number(candidate.direction?.line);
    if (!Number.isInteger(line) || line < 0 || line > 3) return null;
    const lineInfo = testLineFour(candidate.anchor, line, GEN_WHITE, expected);
    const rawLevel = getLevelPoint(candidate.anchor, GEN_WHITE, expected);
    // 整體等級可因黑方唯一防點為禁手而升成抓禁活四，但模板方向必須仍是死四。
    if ((lineInfo & GEN_LINE_MASK) !== GEN_FOUR_NOFREE || (rawLevel & 0x60)) return null;
    if (!isFoul(forbiddenPoint, expected)) return null;
    return expected;
  };

  const previousLayerRecord = genLayerRecord;
  genLayerRecord = function layerRecordWithForbidden(candidate, step) {
    const record = previousLayerRecord(candidate, step);
    if (!candidate?.captureForbidden) return record;
    return {
      ...record,
      captureForbidden: true,
      forbiddenPoint: candidate.forbiddenPoint,
      forbiddenKind: candidate.forbiddenKind,
      forbiddenLabel: candidate.forbiddenLabel,
    };
  };

  const previousFindTwoStep = genFindTwoStep;
  genFindTwoStep = async function findForbiddenCaptureOrNormal(
    attacker,
    rules,
    options,
    counters,
    targetSteps,
  ) {
    if (rules === 2 && attacker === GEN_WHITE) {
      return genFindForbiddenCaptureSeed(options, counters, targetSteps);
    }
    return previousFindTwoStep(attacker, rules, options, counters, targetSteps);
  };
})();

// Show only the compact generator summary requested by the user.
(function initGeneratorCompactSummary() {
  document.querySelector("#generator-panel .gen-badge")?.remove();

  let details = genEl("details");
  if (!details) {
    const status = genEl("status");
    if (status) {
      details = document.createElement("div");
      details.id = status.id.startsWith("gen-") ? "gen-details" : "details";
      status.insertAdjacentElement("afterend", details);
    }
  }

  const style = document.createElement("style");
  style.dataset.generatorCompactSummary = "true";
  style.textContent = `
    #gen-details, #details {
      display: block !important;
      margin-top: 8px;
      color: #685936;
      font-size: 12px;
      line-height: 1.65;
      white-space: pre-line;
    }
    #gen-details:empty, #details:empty {
      display: none !important;
    }
  `;
  document.head.appendChild(style);

  const previousShowResult = genShowResult;
  genShowResult = function showCompactSummary(result, targetSteps, attacker, counters, options) {
    previousShowResult(result, targetSteps, attacker, counters, options);

    const output = genEl("details");
    if (!output || !result) return;

    const root = result.rootBase || result.base || {};
    const layers = Array.from(result.layers || []);
    const initialShape = result.captureForbidden || root.materialType === "forbiddenCapture"
      ? `抓禁手（${result.forbiddenLabel || root.forbiddenLabel || "禁手"}，A=${genName(result.forbiddenPoint)}）`
      : root.materialType === "deadFour" ? "死四" : "活三";

    let balanceLine;
    if (options?.balanceStones) {
      const liveThreeClosedPoints = new Set();
      const vcfBlockedPoints = new Set();

      for (const layer of layers) {
        const autoBlocked = new Set(layer.autoBlockDefenders || []);
        for (const idx of autoBlocked) vcfBlockedPoints.add(idx);
        for (const idx of new Set(layer.addedDefenders || [])) {
          if (!autoBlocked.has(idx)) liveThreeClosedPoints.add(idx);
        }
      }

      for (const idx of new Set(result.autoBlockDefenders || [])) {
        vcfBlockedPoints.add(idx);
      }
      const filled = new Set(result.balanceFillDefenders || []).size;
      balanceLine = `子數補齊：活三封閉 ${liveThreeClosedPoints.size} 、VCF 封鎖 ${vcfBlockedPoints.size} 、最後補齊 ${filled}`;
    } else {
      balanceLine = "子數補齊：未開啟";
    }

    const reuseCounts = layers.map(layer => {
      const addedCount = new Set(layer.addedAttackers || []).size;
      return Math.max(0, 3 - addedCount);
    });
    const reuseTotal = reuseCounts.reduce((sum, count) => sum + count, 0);
    const reuseExpression = reuseCounts.length ? reuseCounts.join("+") : "0";

    const candidateGroupCounts = Array.from(result.candidateGroupCounts || [])
      .map(value => Math.max(0, Math.round(Number(value) || 0)));
    const candidateGroupExpression = candidateGroupCounts.length
      ? candidateGroupCounts.join("+")
      : "0";

    let blackCount = 0;
    let whiteCount = 0;
    const board = Array.from(result.board || []).slice(0, 225);
    for (const stone of board) {
      if (stone === GEN_BLACK) blackCount++;
      else if (stone === GEN_WHITE) whiteCount++;
    }

    output.textContent = [
      `初始棋型：${initialShape}`,
      balanceLine,
      `沿用攻子：${reuseExpression}＝${reuseTotal}`,
      `候選組數：${candidateGroupExpression}`,
      `雙方子數：黑${blackCount}、白${whiteCount}`,
      `多組 VCF：共 ${Number(result.groupCount || 0)} 組`,
    ].join("\n");
  };
})();
