"use strict";

// Adds an isolated optimized VCF search and a side-by-side speed comparison.
(function initOptimizedVCFSearch() {
    if (window.__optimizedVCFSearchLoaded) return;
    window.__optimizedVCFSearchLoaded = true;

    function startAfterLayout() {
        const actionBox = document.getElementById("btns");
        const status = document.getElementById("status");
        const blackButton = document.getElementById("btn-black");
        const whiteButton = document.getElementById("btn-white");
        if (!actionBox || !status || !blackButton || !whiteButton || typeof window._getArr !== "function") return;

        class OptimizedVCFEngine {
            constructor() {
                this.rules = Number(document.querySelector('input[name="rules"]:checked')?.value || 2);
                this.worker = null;
                this.pending = null;
                this.ready = this.restart();
            }

            createWorker() {
                const worker = new Worker("eval/worker-optimized.js");
                worker.onmessage = event => {
                    if (event.data?.cmd !== "resolve" || !this.pending) return;
                    const done = this.pending;
                    this.pending = null;
                    done(event.data.param);
                };
                worker.onerror = event => {
                    console.error("Optimized VCF worker error", event);
                    if (this.pending) {
                        const done = this.pending;
                        this.pending = null;
                        done(null);
                    }
                };
                return worker;
            }

            post(cmd, param) {
                return new Promise(resolve => {
                    this.pending = resolve;
                    this.worker.postMessage({ cmd, param });
                });
            }

            async restart() {
                if (this.worker) this.worker.terminate();
                this.worker = this.createWorker();
                await this.post("setGameRules", { rules: this.rules });
            }

            async setRules(rules) {
                this.rules = Number(rules || 2);
                await this.ready;
                await this.post("setGameRules", { rules: this.rules });
            }

            async findVCF({ arr, color, maxDepth = 200, maxNode = 5000000 }) {
                await this.ready;
                return this.post("findVCFOptimized", {
                    arr: Array.from(arr),
                    color,
                    maxDepth,
                    maxNode,
                });
            }

            async cancel() {
                if (this.pending) {
                    const done = this.pending;
                    this.pending = null;
                    done(null);
                }
                this.ready = this.restart();
                await this.ready;
            }
        }

        const optimizedEngine = new OptimizedVCFEngine();
        let optimizedBusy = false;
        let originalPending = null;
        const results = { original: null, optimized: null };

        function createOptimizedButton(id, text, color) {
            const button = document.createElement("button");
            button.id = id;
            button.type = "button";
            button.textContent = text;
            button.dataset.optimizedColor = String(color);
            button.className = "vcf-optimized-action";
            return button;
        }

        const optimizedBlack = createOptimizedButton("btn-black-optimized", "優化找黑 VCF", 1);
        const optimizedWhite = createOptimizedButton("btn-white-optimized", "優化找白 VCF", 2);
        whiteButton.insertAdjacentElement("afterend", optimizedWhite);
        whiteButton.insertAdjacentElement("afterend", optimizedBlack);

        const comparison = document.createElement("section");
        comparison.id = "vcf-speed-comparison";
        comparison.innerHTML = `
            <div class="vcf-speed-title">VCF 搜尋速度比較</div>
            <div class="vcf-speed-row"><strong>原版</strong><span id="vcf-speed-original">尚未測試</span></div>
            <div class="vcf-speed-row"><strong>優化版</strong><span id="vcf-speed-optimized">尚未測試</span></div>
            <div id="vcf-speed-difference" class="vcf-speed-difference">請在相同盤面與顏色分別執行兩種搜尋。</div>
        `;
        status.insertAdjacentElement("afterend", comparison);

        const style = document.createElement("style");
        style.dataset.optimizedVcfSearch = "true";
        style.textContent = `
            #vcf-app-shell .vcf-optimized-action,
            .vcf-optimized-action {
                color: #fff;
                background: #39745a;
                border-color: #39745a;
            }
            #vcf-app-shell .vcf-optimized-action:hover:not(:disabled),
            .vcf-optimized-action:hover:not(:disabled) {
                color: #fff;
                background: #2d6049;
                border-color: #2d6049;
            }
            #vcf-speed-comparison {
                width: 100%;
                margin-top: 9px;
                padding: 9px 11px;
                border: 1px solid #cfd8c5;
                border-radius: 8px;
                background: #f7fbf4;
                color: #354333;
                font-size: 12px;
                line-height: 1.5;
            }
            .vcf-speed-title {
                margin-bottom: 5px;
                font-weight: 700;
                font-size: 13px;
            }
            .vcf-speed-row {
                display: grid;
                grid-template-columns: 52px minmax(0, 1fr);
                gap: 7px;
                align-items: start;
            }
            .vcf-speed-row span {
                overflow-wrap: anywhere;
            }
            .vcf-speed-difference {
                margin-top: 5px;
                padding-top: 5px;
                border-top: 1px solid #dce5d5;
                font-weight: 600;
            }
        `;
        document.head.appendChild(style);

        function currentRules() {
            return Number(document.querySelector('input[name="rules"]:checked')?.value || 2);
        }

        function boardFingerprint(arr, color) {
            return `${currentRules()}|${color}|${Array.from(arr).slice(0, 225).join("")}`;
        }

        function formatExactRate(nodes, seconds) {
            if (!Number.isFinite(nodes) || !Number.isFinite(seconds) || seconds <= 0) return "—";
            const rate = nodes / seconds;
            return rate >= 1e6 ? `${(rate / 1e6).toFixed(2)}M nodes/s`
                : rate >= 1000 ? `${(rate / 1000).toFixed(1)}K nodes/s`
                : `${Math.round(rate)} nodes/s`;
        }

        function resultText(result) {
            if (!result) return "尚未測試";
            const outcome = result.found ? `找到 ${result.moveCount} 手` : "未找到";
            const nodes = Number.isFinite(result.nodes) ? fmtNodes(result.nodes) : (result.nodeText || "節點不明");
            const rate = result.rateText || formatExactRate(result.nodes, result.seconds);
            const mode = result.mode ? `｜${result.mode}` : "";
            return `${result.seconds.toFixed(6)}s｜${nodes}｜${rate}｜${outcome}${mode}`;
        }

        function renderComparison() {
            document.getElementById("vcf-speed-original").textContent = resultText(results.original);
            document.getElementById("vcf-speed-optimized").textContent = resultText(results.optimized);
            const difference = document.getElementById("vcf-speed-difference");
            const original = results.original;
            const optimized = results.optimized;

            if (!original || !optimized) {
                difference.textContent = "請在相同盤面與顏色分別執行兩種搜尋。";
                return;
            }
            if (original.fingerprint !== optimized.fingerprint) {
                difference.textContent = "兩次測試的盤面、顏色或規則不同，不能直接比較。";
                return;
            }
            if (original.found !== optimized.found) {
                difference.textContent = "⚠ 兩種搜尋結果不同，請保留此盤面進一步檢查。";
                return;
            }

            const ratio = original.seconds / optimized.seconds;
            let text;
            if (ratio > 1.005) text = `優化版快 ${ratio.toFixed(2)} 倍`;
            else if (ratio < 0.995) text = `優化版慢 ${(1 / ratio).toFixed(2)} 倍`;
            else text = "兩者速度接近";

            if (original.found && original.moveCount !== optimized.moveCount) {
                text += `；兩者都找到 VCF，但路線手數為 ${original.moveCount}／${optimized.moveCount}`;
            }
            difference.textContent = text;
        }

        function parseOriginalStatus(text, measuredSeconds) {
            const time = text.match(/（([\d.]+)s[，）]/);
            const node = text.match(/，([\d.]+[MK]? nodes)/);
            const rate = text.match(/，([\d.]+[MK]? nodes\/s)）/);
            const moves = text.match(/共\s*(\d+)\s*手/);
            return {
                seconds: time ? Number(time[1]) : measuredSeconds,
                nodeText: node ? node[1] : "節點不明",
                rateText: rate ? rate[1] : "—",
                found: /VCF 找到/.test(text),
                moveCount: moves ? Number(moves[1]) : 0,
            };
        }

        function beginOriginal(color) {
            const arr = window._getArr();
            if (!arr.slice(0, 225).some(value => value > 0)) return;
            originalPending = {
                color,
                startedAt: performance.now(),
                fingerprint: boardFingerprint(arr, color),
            };
        }

        blackButton.addEventListener("click", () => beginOriginal(1), true);
        whiteButton.addEventListener("click", () => beginOriginal(2), true);

        const statusObserver = new MutationObserver(() => {
            if (!originalPending) return;
            const text = status.textContent || "";
            const colorName = originalPending.color === 1 ? "黑子" : "白子";
            const completed = text.startsWith(`${colorName} VCF 找到`) ||
                text.startsWith(`${colorName} VCF 未找到`) ||
                text.startsWith("搜索失敗");
            if (!completed) return;

            const measuredSeconds = (performance.now() - originalPending.startedAt) / 1000;
            const parsed = parseOriginalStatus(text, measuredSeconds);
            results.original = {
                ...parsed,
                fingerprint: originalPending.fingerprint,
            };
            originalPending = null;
            renderComparison();
        });
        statusObserver.observe(status, { childList: true, characterData: true, subtree: true });

        function setOptimizedButtonsDisabled(value) {
            optimizedBlack.disabled = value;
            optimizedWhite.disabled = value;
        }

        const previousSetBusy = typeof window.setBusy === "function" ? window.setBusy : null;
        if (previousSetBusy) {
            const wrappedSetBusy = function setBusyWithOptimizedButtons(value) {
                previousSetBusy(value);
                setOptimizedButtonsDisabled(Boolean(value));
            };
            window.setBusy = wrappedSetBusy;
            try { setBusy = wrappedSetBusy; } catch (_) {}
        }

        if (typeof window.genIntegrationSetBusy === "function") {
            const previousGeneratorBusy = window.genIntegrationSetBusy;
            window.genIntegrationSetBusy = function generatorBusyWithOptimizedButtons(value) {
                previousGeneratorBusy(value);
                setOptimizedButtonsDisabled(Boolean(value));
            };
        }

        async function runOptimized(color) {
            if (optimizedBusy) return;
            const arr = window._getArr();
            if (!arr.slice(0, 225).some(value => value > 0)) {
                setStatus("請先擺好棋型");
                return;
            }

            const colorName = color === 1 ? "黑子" : "白子";
            const fingerprint = boardFingerprint(arr, color);
            optimizedBusy = true;
            window.__optimizedVCFBusy = true;
            lastParam = { arr, color };
            lastVCFMoves = null;
            resetVcfGroups();
            window._clearVCF();
            window._clearAnalysis();
            setBusy(true);
            setStatus(`正在使用優化引擎搜索 ${colorName} VCF...`);
            const startedAt = performance.now();

            try {
                const info = await optimizedEngine.findVCF({
                    arr,
                    color,
                    maxDepth: 200,
                    maxNode: 5000000,
                });
                if (!info) {
                    if (optimizedBusy) setStatus("優化搜索已停止");
                    return;
                }

                const seconds = (performance.now() - startedAt) / 1000;
                const route = info.winMoves?.[0] || [];
                const found = route.length > 0;
                const nodes = Number(info.nodeCount || 0);
                const mode = info.optimizedMode === "fast-path"
                    ? "快速路徑"
                    : `原版後備（快速 ${fmtNodes(Number(info.quickNodeCount || 0))}＋原版 ${fmtNodes(Number(info.fallbackNodeCount || 0))}）`;

                if (found) {
                    lastVCFMoves = Array.from(route);
                    window._showVCF(lastVCFMoves, color);
                    document.getElementById("btn-block-vcf").disabled = false;
                    setStatus(`優化 ${colorName} VCF 找到，共 ${route.length} 手（${seconds.toFixed(6)}s，${fmtNodes(nodes)}，${formatExactRate(nodes, seconds)}；${mode}）`);
                } else {
                    setStatus(`優化 ${colorName} VCF 未找到（${seconds.toFixed(6)}s，${fmtNodes(nodes)}，${formatExactRate(nodes, seconds)}；${mode}）`);
                }

                results.optimized = {
                    fingerprint,
                    seconds,
                    nodes,
                    rateText: formatExactRate(nodes, seconds),
                    found,
                    moveCount: route.length,
                    mode,
                };
                renderComparison();
            } catch (error) {
                console.error(error);
                setStatus(`優化搜索失敗：${error?.message || String(error)}`);
            } finally {
                optimizedBusy = false;
                window.__optimizedVCFBusy = false;
                setBusy(false);
            }
        }

        optimizedBlack.addEventListener("click", () => runOptimized(1));
        optimizedWhite.addEventListener("click", () => runOptimized(2));

        document.querySelectorAll('input[name="rules"]').forEach(radio => {
            radio.addEventListener("change", async () => {
                if (optimizedBusy) return;
                await optimizedEngine.setRules(Number(radio.value));
            });
        });

        document.getElementById("btn-stop")?.addEventListener("click", async event => {
            if (!optimizedBusy) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            optimizedBusy = false;
            window.__optimizedVCFBusy = false;
            setStatus("正在停止優化搜索...");
            await optimizedEngine.cancel();
            setBusy(false);
            setStatus("已停止優化搜索");
        }, true);

        renderComparison();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => setTimeout(startAfterLayout, 0), { once: true });
    } else {
        setTimeout(startAfterLayout, 0);
    }
})();
