"use strict";

// Experimental first-result VCF search.
// It follows the original findVCF search order and rules, but returns immediately
// after the first verified route and uses a collision-resistant completed-state table.
(function initFirstVCFSearch(exports) {
    if (typeof exports.findFirstVCF === "function") return;

    const BOARD_POINTS = 225;
    const OUT_POINT = 225;
    const FOUL_MAX = 0x1e;
    const FOUL_MAX_FREE = 0x1f;
    const LEVEL_NOFREEFOUR = 8;
    const LEVEL_CATCHFOUL = 9;
    const FOUR_FREE = 9;
    const FOUR_NOFREE = 8;
    const THREE_FREE = 7;
    const THREE_NOFREE = 6;
    const TWO_FREE = 5;
    const TWO_NOFREE = 4;

    function makeHashTable(seed) {
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

    const HASH_A = makeHashTable(0x9e3779b9);
    const HASH_B = makeHashTable(0x85ebca6b);

    function toggleHash(hashA, hashB, idx, color) {
        const key = idx * 2 + color - 1;
        return [
            (hashA ^ HASH_A[key]) >>> 0,
            (hashB ^ HASH_B[key]) >>> 0,
        ];
    }

    function createCompletedTable() {
        const table = new Map();
        return {
            has(hashA, hashB) {
                return table.get(hashA)?.has(hashB) || false;
            },
            add(hashA, hashB) {
                let bucket = table.get(hashA);
                if (!bucket) table.set(hashA, bucket = new Set());
                bucket.add(hashB);
            },
            get size() {
                let count = 0;
                for (const bucket of table.values()) count += bucket.size;
                return count;
            },
        };
    }

    function findFirstVCF(arr, color, maxDepth = 200, maxNode = 5000000) {
        const board = Array.from(arr || []).slice(0, 226);
        while (board.length < 226) board.push(0);
        board[OUT_POINT] = -1;

        const rootBoard = board.slice(0);
        const defender = 3 - color;
        const infoArr = new Array(BOARD_POINTS);
        const completed = createCompletedTable();
        const moves = [];
        let nodeCount = 0;
        let stoppedByNodeLimit = false;

        // Keep the original engine's direct-five shortcut and scan order.
        for (let idx = 0; idx < BOARD_POINTS; idx++) {
            if (board[idx] !== 0) continue;
            board[idx] = color;
            const level = getLevelPoint(idx, color, board) & 0x0f;
            board[idx] = 0;
            nodeCount++;
            if (level >= 10) {
                return {
                    vcfCount: 1,
                    nodeCount,
                    winMoves: [[idx]],
                    optimizedMode: "original-order-early-return",
                    completedStates: 0,
                    stoppedByNodeLimit: false,
                };
            }
        }

        function collectCandidates(centerIdx) {
            testFour(board, color, infoArr);

            const lastDefense = moves.length ? moves[moves.length - 1] : -1;
            const defenseLevelInfo = lastDefense >= 0
                ? getLevelPoint(lastDefense, defender, board)
                : getLevel(board, defender);
            const defenseLevel = defenseLevelInfo & FOUL_MAX_FREE;
            if (defenseLevel > LEVEL_NOFREEFOUR) return null;

            let scanCount = BOARD_POINTS;
            if (defenseLevel === LEVEL_NOFREEFOUR) {
                centerIdx = (defenseLevelInfo >>> 8) & 0xff;
                scanCount = 1;
            }

            let winInfo = 0;
            const fourPoints = [];

            // Same reverse aroundIdx scan as the original implementation.
            for (let i = scanCount - 1; i >= 0; i--) {
                const idx = aroundIdx(centerIdx, i);
                if ((infoArr[idx] & FOUL_MAX) !== FOUR_NOFREE) continue;

                board[idx] = color;
                const levelInfo = getLevelPoint(idx, color, board);
                board[idx] = 0;
                const level = levelInfo & 0xff;

                if (level >= LEVEL_CATCHFOUL) {
                    if ((winInfo & 0xff) < level) winInfo = (idx << 8) | level;
                } else {
                    fourPoints.push(idx, (levelInfo >>> 8) & 0xff);
                }
            }

            if (winInfo) {
                return {
                    winIdx: (winInfo >>> 8) & 0xff,
                    groups: null,
                    centerIdx,
                };
            }

            // Preserve the original move ordering heuristic: temporarily place all
            // candidate attack points before classifying each point's local shape.
            for (let i = 0; i < fourPoints.length; i += 2) {
                board[fourPoints[i]] = color;
            }

            const threePoints = [];
            const twoPoints = [];
            const elsePoints = [];

            for (let i = 0; i < fourPoints.length; i += 2) {
                const idx = fourPoints[i];
                const blockIdx = fourPoints[i + 1];
                let lineInfo = 0;
                for (let direction = 0; direction < 4; direction++) {
                    const info = 0x0f & testLine(idx, direction, color, board);
                    if (info <= FOUR_FREE && info > lineInfo) lineInfo = info;
                }

                switch (lineInfo) {
                    case FOUR_FREE:
                    case THREE_FREE:
                        threePoints.push(idx, blockIdx);
                        break;
                    case FOUR_NOFREE:
                    case THREE_NOFREE:
                        threePoints.unshift(idx, blockIdx);
                        break;
                    case TWO_FREE:
                    case TWO_NOFREE:
                        twoPoints.push(idx, blockIdx);
                        break;
                    default:
                        elsePoints.push(idx, blockIdx);
                        break;
                }
            }

            for (let i = 0; i < fourPoints.length; i += 2) {
                board[fourPoints[i]] = 0;
            }

            return {
                winIdx: -1,
                // Original stack uses concat(else, two, three) and pop(), so search
                // these arrays from their ends in the reverse group order.
                groups: [threePoints, twoPoints, elsePoints],
                centerIdx,
            };
        }

        function search(centerIdx, hashA, hashB) {
            if (moves.length >= maxDepth || stoppedByNodeLimit) return null;
            if (completed.has(hashA, hashB)) return null;

            const candidates = collectCandidates(centerIdx);
            if (!candidates) {
                completed.add(hashA, hashB);
                return null;
            }

            if (candidates.winIdx >= 0) {
                const route = moves.concat(candidates.winIdx);
                simpleVCF(color, rootBoard.slice(0), route);
                if (isVCF(color, rootBoard.slice(0), route)) return route;
            }

            for (const group of candidates.groups || []) {
                for (let i = group.length - 2; i >= 0; i -= 2) {
                    if (++nodeCount >= maxNode) {
                        stoppedByNodeLimit = true;
                        return null;
                    }

                    const attackIdx = group[i];
                    const blockIdx = group[i + 1];
                    if (
                        attackIdx < 0 || attackIdx >= BOARD_POINTS ||
                        blockIdx < 0 || blockIdx >= BOARD_POINTS ||
                        board[attackIdx] !== 0 || board[blockIdx] !== 0
                    ) continue;

                    board[attackIdx] = color;
                    board[blockIdx] = defender;
                    moves.push(attackIdx, blockIdx);

                    const attackHash = toggleHash(hashA, hashB, attackIdx, color);
                    const nextHash = toggleHash(attackHash[0], attackHash[1], blockIdx, defender);
                    const route = search(attackIdx, nextHash[0], nextHash[1]);

                    moves.pop();
                    moves.pop();
                    board[blockIdx] = 0;
                    board[attackIdx] = 0;

                    if (route) return route;
                }
            }

            completed.add(hashA, hashB);
            return null;
        }

        const route = search(112, 0, 0);
        return {
            vcfCount: route ? 1 : 0,
            nodeCount,
            winMoves: route ? [route] : [],
            optimizedMode: "original-order-early-return",
            completedStates: completed.size,
            stoppedByNodeLimit,
        };
    }

    exports.findFirstVCF = findFirstVCF;
})(typeof self !== "undefined" ? self : globalThis);
