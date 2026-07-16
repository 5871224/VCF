//if (self.SCRIPT_VERSIONS) self.SCRIPT_VERSIONS["worker"] = "2024.23206";
/Worker/.exec(`${self}`) && (function(global, factory) {
    (global = global || self, factory(global));
}(this, (function(exports) {
    'use strict';
    //console.log(exports);

    if ("importScripts" in self) {
    	if (true && "WebAssembly" in self && typeof WebAssembly.instantiate == "function")
        	self.importScripts('../emoji/emoji.js', `EvaluatorWebassembly.js`, `Evaluator.js`)
        else
        	self.importScripts('../emoji/emoji.js', `EvaluatorJScript.js`, `Evaluator.js`)
    }
    else new Error(`"importScripts" not found`)

    let isWorkerBusy = false;
    const MSG_RESOLVE = { cmd: "resolve" };
    const COMMAND = {
        setGameRules: function ({rules}) {
            isWorkerBusy = true;
            let timer = setInterval(() => {
                if ("setGameRules" in self) {
                    clearInterval(timer);
                    setGameRules(rules);
                    post({ cmd: "info", param: `已经设置为${[undefined,"无禁","有禁"][rules]}规则`});
                    post(MSG_RESOLVE);
                    isWorkerBusy = false;
                }
            }, 10)
        },
        getLevelB: function({arr, color, maxVCF, maxDepth, maxNode}) {
            getLevelB(arr, color, maxVCF, maxDepth, maxNode);
            //post({ cmd: "levelBInfo", param: { levelBInfo: levelBInfo } });
            //post(MSG_RESOLVE);
            post({cmd: "resolve", param: levelBInfo})
        },
        isVCF: function({color, arr, moves}) {
            const result = isVCF(color, arr, moves);
            post({cmd: "resolve", param: result})
        },
        findVCF: function({ arr, color, maxVCF, maxDepth, maxNode }) {
            findVCF(arr, color, maxVCF, maxDepth, maxNode);
            //post({cmd: "vcfInfo", param: {vcfInfo: vcfInfo}});
            //post(MSG_RESOLVE);
            post({cmd: "resolve", param: vcfInfo})
        },
        getBlockVCF: function({arr, color, vcfMoves, includeFour}) {
            let points = getBlockVCF(arr, color, vcfMoves, includeFour);
            //post({ cmd: "points", param: { points: points } });
            //post(MSG_RESOLVE);
            post({cmd: "resolve", param: points})
        },
        selectPoints: function({ arr, color, radius, maxVCF, maxDepth, maxNode}) {
            let selectArr = selectPoints(arr, color, radius, maxVCF, maxDepth, maxNode);
            //post({ cmd: "selectPoints", param: { selectArr: selectArr } });
            //post(MSG_RESOLVE);
            post({cmd: "resolve", param: selectArr})
        },
        selectPointsLevel: function({ arr, color, radius, maxVCF, maxDepth, maxNode, nMaxDepth}) {
            let selectArr = selectPointsLevel(arr, color, radius, maxVCF, maxDepth, maxNode, nMaxDepth);
            //post({ cmd: "selectPointsLevel", param: { selectArr: selectArr } });
            //post(MSG_RESOLVE);
            post({cmd: "resolve", param: selectArr})
        },
        excludeBlockVCF: function({points, arr, color, maxVCF, maxDepth, maxNode}) {
            let ps = excludeBlockVCF(points, arr, color, maxVCF, maxDepth, maxNode);
            //post({ cmd: "points", param: { points: ps } });
            //post(MSG_RESOLVE);
            post({cmd: "resolve", param: ps})
        },
        getBlockPoints: function({arr, color, radius, maxVCF, maxDepth, maxNode}) {
            let ps = getBlockPoints(arr, color, radius, maxVCF, maxDepth, maxNode);
            post({cmd: "resolve", param: ps})
        },
        trimVCFGroups: function({arr, groups, color}) {
            const oppColor = 3 - color;
            const processed = [];
            const seen = new Set();
            for (const moves of groups) {
                if (!moves || !moves.length) continue;
                // 重建棋盤
                const board = arr.slice(0, 225);
                for (let i = 0; i < moves.length; i++)
                    board[moves[i]] = (i % 2 === 0) ? color : oppColor;
                // 最後一步若是活四（level=9）則移除
                let trimmed = Array.from(moves);
                const lastIdx = trimmed[trimmed.length - 1];
                const level = getLevelPoint(lastIdx, color, board) & 0x0f;
                if (level === 9) trimmed = trimmed.slice(0, -1);
                // 去重：用修剪後的正規化 key，但保留原始 moves（含活四）顯示
                const key = trimmed
                    .map((idx, i) => `${idx}:${i % 2 === 0 ? color : oppColor}`)
                    .sort()
                    .join(',');
                if (!seen.has(key)) {
                    seen.add(key);
                    processed.push(Array.from(moves)); // 原始完整手順
                }
            }
            // 按長度排序（短的優先）
            processed.sort((a, b) => a.length - b.length);
            post({cmd: "resolve", param: processed});
        },
        getLevelPoints: function({arr, color, placeColor, indices, maxDepth, maxNode}) {
            // color: 找 VCF 的顏色；placeColor: 試落子的顏色（預設同 color）
            // indices: 要掃描的格子索引陣列（預設掃全盤 225 格）
            let md = maxDepth || 200;
            let mn = maxNode  || 5000000;
            let pColor = placeColor || color;
            let scan = indices || Array.from({length: 225}, (_, i) => i);
            let result = [];
            let totalNodes = 0;
            for (let k = 0; k < scan.length; k++) {
                let i = scan[k];
                if (arr[i] === 0) {
                    arr[i] = pColor;
                    if (pColor === color) {
                        // 同色：先檢查連五/沖四/活四
                        let level = getLevelPoint(i, color, arr) & 0x0f;
                        if (level >= 10) { // 連五
                            result.push({idx: i, label: "5"});
                            arr[i] = 0;
                            continue;
                        }
                        if (level === 8 || level === 9) { // 沖四 or 活四
                            result.push({idx: i, label: "4"});
                            arr[i] = 0;
                            continue;
                        }
                    }
                    findVCF(arr, color, 1, md, mn);
                    totalNodes += vcfInfo.nodeCount;
                    if (vcfInfo.vcfCount > 0 && vcfInfo.winMoves.length > 0 && vcfInfo.winMoves[0].length > 0) {
                        result.push({idx: i, label: vcfInfo.winMoves[0].length});
                    }
                    arr[i] = 0;
                }
            }
            post({cmd: "resolve", param: {items: result, nodeCount: totalNodes}});
        }
    };

    function onmessage(e) {
        /*let i = 0,
            timer = setInterval(() => {
                if (i++ < 30) post({ cmd: "log", param: i });?
                else post(MSG_RESOLVE);
            }, 1000);*/

        if (isWorkerBusy) throw new Error("Worker onmessage Error: Worker is Busy");
        else if (typeof COMMAND[e.data.cmd] == "function") {
            //post({cmd: "info", param: e.data.param});
            COMMAND[e.data.cmd](e.data.param);
        }
        else throw new Error(`Worker onmessage Error: not found cmd "${e.data.cmd}"`);
    }

    function post({ cmd, param }) {
        typeof postMessage == "function" && postMessage({ cmd: cmd, param: param });
    }
    
    exports.onmessage = onmessage;
    exports.post = post;
})))
