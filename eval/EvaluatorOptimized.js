"use strict";

// Isolated first-route VCF fast path. It never replaces the existing findVCF.
(function initOptimizedVCFEvaluator(exports) {
    if (typeof exports.findVCFOptimized === "function") return;

    const BOARD_POINTS = 225;
    const OUT_POINT = 225;
    const EMPTY = 0;
    const FOUR_MASK = 0x1e;
    const LEVEL_MASK = 0x1f;
    const FOUR_NOFREE = 8;
    const TERMINAL_LEVEL = 9;
    const DEFAULT_QUICK_DEPTH = 31;
    const DEFAULT_QUICK_NODES = 250000;

    function makeZobrist(seed) {
        const table = new Uint32Array(BOARD_POINTS * 2);
        let value = seed >>> 0;
        for (let i = 0; i < table.length; i++) {
            value ^= value << 13;
            value ^= value >>> 17;
            value ^= value << 5;
            table[i] = value >>> 0;
        }
        return table;
    }

    const ZOBRIST_A = makeZobrist(0x9e3779b9);
    const ZOBRIST_B = makeZobrist(0x85ebca6b);

    function stoneKeyIndex(idx, color) {
        return idx * 2 + color - 1;
    }

    function initialHash(board) {
        let a = 0;
        let b = 0;
        for (let idx = 0; idx < BOARD_POINTS; idx++) {
            const color = board[idx];
            if (color !== 1 && color !== 2) continue;
            const key = stoneKeyIndex(idx, color);
            a ^= ZOBRIST_A[key];
            b ^= ZOBRIST_B[key];
        }
        return [a >>> 0, b >>> 0];
    }

    function toggleHash(hashA, hashB, idx, color) {
        const key = stoneKeyIndex(idx, color);
        return [
            (hashA ^ ZOBRIST_A[key]) >>> 0,
            (hashB ^ ZOBRIST_B[key]) >>> 0,
        ];
    }

    function localThreatScore(board, idx, color) {
        let score = 0;
        for (let direction = 0; direction < 4; direction++) {
            for (let delta = -4; delta <= 4; delta++) {
                if (!delta) continue;
                const point = moveIdx(idx, delta, direction);
                if (point === OUT_POINT) continue;
                if (board[point] === color) score += 5 - Math.abs(delta);
            }
        }
        return score;
    }

    function cloneResult(info, extra) {
        return {
            vcfCount: Number(info && info.vcfCount || 0),
            nodeCount: Number(info && info.nodeCount || 0),
            winMoves: Array.from(info && info.winMoves || [], moves => Array.from(moves || [])),
            ...extra,
        };
    }

    function quickFindVCF(initArr, color, maxDepth, maxNode) {
        const board = initArr.slice(0, 226);
        if (board.length < 226) board.length = 226;
        board[OUT_POINT] = -1;

        const defender = 3 - color;
        const infoArr = new Array(BOARD_POINTS);
        const seen = new Set();
        const rootBoard = initArr.slice(0, 226);
        rootBoard[OUT_POINT] = -1;
        const quickDepth = Math.max(1, Math.min(maxDepth, DEFAULT_QUICK_DEPTH));
        const quickNodeLimit = Math.max(1000, Math.min(maxNode, DEFAULT_QUICK_NODES));
        let nodes = 0;
        let stoppedByLimit = false;

        function makeCandidates(centerIdx, forcedIdx) {
            testFour(board, color, infoArr);
            const candidates = [];

            function addCandidate(idx) {
                if (
                    idx < 0 ||
                    idx >= BOARD_POINTS ||
                    board[idx] !== EMPTY ||
                    (infoArr[idx] & FOUR_MASK) !== FOUR_NOFREE
                ) return;

                board[idx] = color;
                const levelInfo = getLevelPoint(idx, color, board);
                board[idx] = EMPTY;
                const level = levelInfo & 0xff;
                if (level < FOUR_NOFREE) return;

                candidates.push({
                    idx,
                    level,
                    blockIdx: (levelInfo >>> 8) & 0xff,
                    score: localThreatScore(board, idx, color),
                });
            }

            if (forcedIdx >= 0) {
                addCandidate(forcedIdx);
            } else {
                // The existing engine also searches around the latest attack point.
                // Here stronger local connections are tried first and equal scores stay stable.
                for (let i = 0; i < BOARD_POINTS; i++) addCandidate(aroundIdx(centerIdx, i));
            }

            candidates.sort((left, right) =>
                Number(right.level >= TERMINAL_LEVEL) - Number(left.level >= TERMINAL_LEVEL) ||
                right.score - left.score
            );
            return candidates;
        }

        function search(moves, centerIdx, forcedIdx, hashA, hashB) {
            if (stoppedByLimit || moves.length >= quickDepth) return null;

            const stateKey = `${hashA.toString(36)}:${hashB.toString(36)}:${forcedIdx}`;
            if (seen.has(stateKey)) return null;
            seen.add(stateKey);

            const candidates = makeCandidates(centerIdx, forcedIdx);
            for (const candidate of candidates) {
                if (++nodes > quickNodeLimit) {
                    stoppedByLimit = true;
                    return null;
                }

                const attackIdx = candidate.idx;
                board[attackIdx] = color;
                const attackHash = toggleHash(hashA, hashB, attackIdx, color);

                if (candidate.level >= TERMINAL_LEVEL) {
                    const route = moves.concat(attackIdx);
                    const valid = isVCF(color, rootBoard.slice(0), route);
                    board[attackIdx] = EMPTY;
                    if (valid) return route;
                    continue;
                }

                const blockIdx = candidate.blockIdx;
                if (
                    moves.length + 2 <= quickDepth &&
                    blockIdx >= 0 &&
                    blockIdx < BOARD_POINTS &&
                    board[blockIdx] === EMPTY
                ) {
                    board[blockIdx] = defender;
                    const defenseHash = toggleHash(attackHash[0], attackHash[1], blockIdx, defender);
                    const defenseInfo = getLevelPoint(blockIdx, defender, board);
                    const defenseLevel = defenseInfo & LEVEL_MASK;

                    if (defenseLevel <= FOUR_NOFREE) {
                        const nextForced = defenseLevel === FOUR_NOFREE
                            ? (defenseInfo >>> 8) & 0xff
                            : -1;
                        const route = search(
                            moves.concat(attackIdx, blockIdx),
                            attackIdx,
                            nextForced,
                            defenseHash[0],
                            defenseHash[1]
                        );
                        board[blockIdx] = EMPTY;
                        board[attackIdx] = EMPTY;
                        if (route) return route;
                        continue;
                    }
                    board[blockIdx] = EMPTY;
                }

                board[attackIdx] = EMPTY;
            }
            return null;
        }

        // Preserve the original engine's direct-five shortcut.
        for (let idx = 0; idx < BOARD_POINTS && nodes < quickNodeLimit; idx++) {
            if (board[idx] !== EMPTY) continue;
            nodes++;
            board[idx] = color;
            const level = getLevelPoint(idx, color, board) & 0xff;
            board[idx] = EMPTY;
            if (level < 10) continue;
            const route = [idx];
            if (isVCF(color, rootBoard.slice(0), route)) {
                return {
                    route,
                    nodeCount: nodes,
                    stoppedByLimit: false,
                    maxDepth: quickDepth,
                    maxNode: quickNodeLimit,
                };
            }
        }

        const hash = initialHash(board);
        const route = search([], 112, -1, hash[0], hash[1]);
        return {
            route,
            nodeCount: nodes,
            stoppedByLimit,
            maxDepth: quickDepth,
            maxNode: quickNodeLimit,
        };
    }

    function findVCFOptimized(arr, color, maxDepth = 200, maxNode = 5000000) {
        const quick = quickFindVCF(arr, color, maxDepth, maxNode);
        if (quick.route && quick.route.length) {
            return {
                vcfCount: 1,
                nodeCount: quick.nodeCount,
                winMoves: [quick.route],
                optimizedMode: "fast-path",
                quickNodeCount: quick.nodeCount,
                fallbackNodeCount: 0,
                quickStoppedByLimit: false,
                quickMaxDepth: quick.maxDepth,
                quickMaxNode: quick.maxNode,
            };
        }

        // Full compatibility fallback: call the untouched existing search with its
        // original limits. The fast path therefore cannot remove an old capability.
        const fallbackBoard = arr.slice(0, 226);
        fallbackBoard[OUT_POINT] = -1;
        findVCF(fallbackBoard, color, 1, maxDepth, maxNode);
        const fallback = cloneResult(vcfInfo, {});
        return {
            ...fallback,
            nodeCount: quick.nodeCount + fallback.nodeCount,
            optimizedMode: "fallback",
            quickNodeCount: quick.nodeCount,
            fallbackNodeCount: fallback.nodeCount,
            quickStoppedByLimit: quick.stoppedByLimit,
            quickMaxDepth: quick.maxDepth,
            quickMaxNode: quick.maxNode,
        };
    }

    exports.findVCFOptimized = findVCFOptimized;
})(typeof self !== "undefined" ? self : globalThis);
