from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, text):
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 anchor, got {count}")
    return text.replace(old, new, 1)


# ---------------- makevcf-layout.js ----------------
path = "makevcf-layout.js"
s = read(path)

old = '''  function renderNextMoveMarker(move) {
    let layer = board.querySelector("#vcf-record-next-move-layer");
    if (!layer) {
      layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
      layer.id = "vcf-record-next-move-layer";
      layer.setAttribute("pointer-events", "none");
      board.appendChild(layer);
    }
    while (layer.firstChild) layer.firstChild.remove();
    const index = Number(move);
    if (!Number.isInteger(index) || index < 0 || index >= BOARD_CELLS) return;
    const x = index % BOARD_SIZE;
    const y = Math.floor(index / BOARD_SIZE);
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", 22 + x * 34);
    circle.setAttribute("cy", 22 + y * 34);
    circle.setAttribute("r", 13);
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", "#1976c9");
    circle.setAttribute("stroke-width", "3");
    circle.setAttribute("vector-effect", "non-scaling-stroke");
    layer.appendChild(circle);
  }
'''
new = '''  function renderNextMoveMarkers(moves) {
    let layer = board.querySelector("#vcf-record-next-move-layer");
    if (!layer) {
      layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
      layer.id = "vcf-record-next-move-layer";
      layer.setAttribute("pointer-events", "none");
      board.appendChild(layer);
    }
    while (layer.firstChild) layer.firstChild.remove();
    const uniqueMoves = Array.from(new Set(Array.from(moves || [], move => Number(move))))
      .filter(index => Number.isInteger(index) && index >= 0 && index < BOARD_CELLS);
    for (const index of uniqueMoves) {
      const x = index % BOARD_SIZE;
      const y = Math.floor(index / BOARD_SIZE);
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", 22 + x * 34);
      circle.setAttribute("cy", 22 + y * 34);
      circle.setAttribute("r", 13);
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke", "#1976c9");
      circle.setAttribute("stroke-width", "3");
      circle.setAttribute("vector-effect", "non-scaling-stroke");
      layer.appendChild(circle);
    }
  }
'''
s = replace_once(s, old, new, "plural next-move markers")

old = '''  function replayStatus(route) {
    const color = typeof lastVCFColor !== "undefined" && Number(lastVCFColor) === 2 ? "白" : "黑";
    const groups = typeof vcfGroups !== "undefined" && Array.isArray(vcfGroups) ? vcfGroups : null;
    const branchText = groups && groups.length
      ? `分支 ${Math.min(groups.length, Number(vcfGroupIdx || 0) + 1)}/${groups.length}`
      : "單一分支";
    const stepText = replayPly === 0 ? "起始盤面" : `第 ${replayPly}/${route.length} 手`;
    if (typeof setStatus === "function") setStatus(`${color}方 ${branchText}，${stepText}`);
  }

  function moveVcfReplay(delta) {
    const route = ensureReplayState();
    if (!route.length) {
      if (typeof setStatus === "function") setStatus("目前沒有可回放的 VCF 分支");
      return;
    }
    replayPly = Math.max(0, Math.min(route.length, replayPly + delta));
    const color = typeof lastVCFColor !== "undefined" ? Number(lastVCFColor) : 1;
    window._showVCF?.(route.slice(0, replayPly), color);
    replayStatus(route);
  }
'''
new = '''  function replayStatus(route) {
    const color = typeof lastVCFColor !== "undefined" && Number(lastVCFColor) === 2 ? "白" : "黑";
    const groups = typeof vcfGroups !== "undefined" && Array.isArray(vcfGroups) ? vcfGroups : null;
    const branchText = groups && groups.length
      ? `分支 ${Math.min(groups.length, Number(vcfGroupIdx || 0) + 1)}/${groups.length}`
      : "單一分支";
    const stepText = replayPly === 0 ? "起始盤面" : `第 ${replayPly}/${route.length} 手`;
    if (typeof setStatus === "function") setStatus(`${color}方 ${branchText}，${stepText}`);
  }

  function vcfRoutesForPrefix(route, ply) {
    const prefix = route.slice(0, ply);
    const groups = typeof vcfGroups !== "undefined" && Array.isArray(vcfGroups) && vcfGroups.length
      ? vcfGroups
      : [route];
    return groups.filter(candidate => {
      if (!candidate || candidate.length < ply) return false;
      for (let i = 0; i < ply; i++) if (Number(candidate[i]) !== Number(prefix[i])) return false;
      return true;
    });
  }

  function vcfNextMoves(route, ply) {
    return Array.from(new Set(
      vcfRoutesForPrefix(route, ply)
        .map(candidate => Number(candidate[ply]))
        .filter(move => Number.isInteger(move) && move >= 0 && move < BOARD_CELLS)
    ));
  }

  function renderVcfReplay(route) {
    const color = typeof lastVCFColor !== "undefined" ? Number(lastVCFColor) : 1;
    window._showVCF?.(route.slice(0, replayPly), color);
    renderNextMoveMarkers(vcfNextMoves(route, replayPly));
    replayStatus(route);
  }

  function moveVcfReplay(delta) {
    const route = ensureReplayState();
    if (!route.length) {
      if (typeof setStatus === "function") setStatus("目前沒有可回放的 VCF 分支");
      return false;
    }
    replayPly = Math.max(0, Math.min(route.length, replayPly + delta));
    renderVcfReplay(route);
    return true;
  }

  // 「前一分支／後一分支」不是切換 sibling，而是跳到上一個／下一個
  // 有多個次一手的分岔盤面。若該方向沒有分岔，分別停在起點／末端。
  function moveVcfBranch(direction) {
    const route = ensureReplayState();
    if (!route.length) return false;
    if (direction < 0) {
      if (replayPly <= 0) {
        renderVcfReplay(route);
        return true;
      }
      do {
        replayPly--;
      } while (replayPly > 0 && vcfNextMoves(route, replayPly).length <= 1);
      renderVcfReplay(route);
      return true;
    }
    if (replayPly >= route.length) {
      renderVcfReplay(route);
      return true;
    }
    do {
      replayPly++;
    } while (replayPly < route.length && vcfNextMoves(route, replayPly).length <= 1);
    renderVcfReplay(route);
    return true;
  }
'''
s = replace_once(s, old, new, "VCF branch-point navigation")

old = '''  window.addEventListener("vcf-record-state-changed", event => {
    if (importedTree) return;
    if (document.activeElement !== recordCommentInput) {
      syncCommentEditorFromRecordText(event.detail?.recordText || "");
    }
    renderNextMoveMarker(event.detail?.selectedNextMove);
  });
'''
new = '''  window.addEventListener("vcf-record-state-changed", event => {
    if (importedTree) return;
    if (document.activeElement !== recordCommentInput) {
      syncCommentEditorFromRecordText(event.detail?.recordText || "");
    }
    renderNextMoveMarkers(event.detail?.nextMoves || []);
    if (!currentReplayRoute().length) {
      prevStepButton.disabled = !event.detail?.canPrev;
      nextStepButton.disabled = !event.detail?.canNext;
      previousBranchButton.disabled = !event.detail?.canPrev;
      nextBranchButton.disabled = !event.detail?.canNext;
    }
  });
'''
s = replace_once(s, old, new, "manual record event")

old = '''  function importedHasBranchChoice(node) {
    const { siblings } = importedSiblingInfo(node);
    return siblings.length > 1 || (node?.children?.length || 0) > 1;
  }

  function updateImportedBranchButtons() {
    if (!importedTree) return;
    const enabled = importedHasBranchChoice(importedTree.current);
    if (previousBranchButton) previousBranchButton.disabled = !enabled;
    if (nextBranchButton) nextBranchButton.disabled = !enabled;
  }
'''
new = '''  function updateImportedBranchButtons() {
    if (!importedTree) return;
    const current = importedTree.current;
    const canPrev = Boolean(current?.parent && current.parent.navigable !== false);
    const canNext = Boolean(current?.children?.length);
    if (prevStepButton) prevStepButton.disabled = !canPrev;
    if (nextStepButton) nextStepButton.disabled = !canNext;
    if (previousBranchButton) previousBranchButton.disabled = !canPrev;
    if (nextBranchButton) nextBranchButton.disabled = !canNext;
  }
'''
s = replace_once(s, old, new, "imported button availability")

old = '''  function renderRecordAnnotations(node) {
    setCommentEditorValue(node?.comment || "");
    recordCommentMeta.textContent = "目前盤面注釋；修改後會自動保存，匯出 DB 時一併寫入。";
    const children = node?.children || [];
    const selectedIndex = Math.max(0, Math.min(children.length - 1, Number(node?.selectedChild || 0)));
    renderNextMoveMarker(children[selectedIndex]?.move);
    let layer = board.querySelector("#vcf-record-text-layer");
'''
new = '''  function renderRecordAnnotations(node) {
    setCommentEditorValue(node?.comment || "");
    recordCommentMeta.textContent = "目前盤面注釋；修改後會自動保存，匯出 DB 時一併寫入。";
    const children = node?.children || [];
    renderNextMoveMarkers(children.map(child => child.move));
    let layer = board.querySelector("#vcf-record-text-layer");
'''
s = replace_once(s, old, new, "imported all child markers")

old = '''  function moveImportedBranch(direction) {
    if (!importedTree) return false;
    const current = importedTree.current;
    const { siblings, index } = importedSiblingInfo(current);
    if (siblings.length > 1 && index >= 0) {
      const nextIndex = (index + direction + siblings.length) % siblings.length;
      current.parent.selectedChild = nextIndex;
      renderImportedNode(siblings[nextIndex]);
      return true;
    }
    if (current.children.length > 1) {
      const count = current.children.length;
      const nextIndex = ((current.selectedChild || 0) + direction + count) % count;
      current.selectedChild = nextIndex;
      renderNextMoveMarker(current.children[nextIndex]?.move);
      importedStatus();
      return true;
    }
    importedStatus();
    return true;
  }
'''
new = '''  function moveImportedBranch(direction) {
    if (!importedTree) return false;
    const current = importedTree.current;
    if (direction < 0) {
      let target = current.parent;
      if (!target || target.navigable === false) {
        importedStatus();
        return true;
      }
      while (target.parent && target.parent.navigable !== false && target.children.length <= 1) {
        target = target.parent;
      }
      renderImportedNode(target);
      return true;
    }
    if (!current.children.length) {
      importedStatus();
      return true;
    }
    let target = current;
    do {
      target.selectedChild = Math.max(0, Math.min(target.children.length - 1, Number(target.selectedChild || 0)));
      target = target.children[target.selectedChild];
    } while (target.children.length === 1);
    renderImportedNode(target);
    return true;
  }
'''
s = replace_once(s, old, new, "imported branch-point jump")

old = '''  prevStepButton.addEventListener("click", () => {
    if (moveImportedStep(-1)) return;
    if (currentReplayRoute().length) {
      moveVcfReplay(-1);
      const route = ensureReplayState();
      renderNextMoveMarker(route[replayPly]);
      return;
    }
    if (window.VCFWorkbenchRecord?.navigateStep?.(-1)) return;
    if (typeof setStatus === "function") setStatus("目前已是棋譜起點");
  });
  nextStepButton.addEventListener("click", () => {
    if (moveImportedStep(1)) return;
    if (currentReplayRoute().length) {
      moveVcfReplay(1);
      const route = ensureReplayState();
      renderNextMoveMarker(route[replayPly]);
      return;
    }
    if (window.VCFWorkbenchRecord?.navigateStep?.(1)) return;
    if (typeof setStatus === "function") setStatus("目前沒有下一手");
  });

  previousBranchButton.addEventListener("click", () => {
    if (moveImportedBranch(-1)) return;
    if (typeof vcfGroups !== "undefined" && Array.isArray(vcfGroups) && vcfGroups.length && typeof setVcfGroup === "function") {
      if (Number(vcfGroupIdx) > 0) setVcfGroup(Number(vcfGroupIdx) - 1);
      else if (typeof setStatus === "function") setStatus("目前已是第一個 VCF 分支");
      replaySignature = "";
      replayPly = 0;
      return;
    }
    if (window.VCFWorkbenchRecord?.navigateBranch?.(-1)) return;
    if (typeof setStatus === "function") setStatus("目前沒有可切換的前一分支");
  });
  nextBranchButton.addEventListener("click", () => {
    if (moveImportedBranch(1)) return;
    if (typeof vcfGroups !== "undefined" && Array.isArray(vcfGroups) && vcfGroups.length && typeof setVcfGroup === "function") {
      if (Number(vcfGroupIdx) < vcfGroups.length - 1) setVcfGroup(Number(vcfGroupIdx) + 1);
      else if (typeof setStatus === "function") setStatus("目前已是最後一個 VCF 分支");
      replaySignature = "";
      replayPly = 0;
      return;
    }
    if (window.VCFWorkbenchRecord?.navigateBranch?.(1)) return;
    if (typeof setStatus === "function") setStatus("目前沒有可切換的後一分支");
  });
'''
new = '''  prevStepButton.addEventListener("click", () => {
    if (moveImportedStep(-1)) return;
    if (currentReplayRoute().length) {
      moveVcfReplay(-1);
      return;
    }
    if (window.VCFWorkbenchRecord?.navigateStep?.(-1)) return;
    if (typeof setStatus === "function") setStatus("目前已是棋譜起點");
  });
  nextStepButton.addEventListener("click", () => {
    if (moveImportedStep(1)) return;
    if (currentReplayRoute().length) {
      moveVcfReplay(1);
      return;
    }
    if (window.VCFWorkbenchRecord?.navigateStep?.(1)) return;
    if (typeof setStatus === "function") setStatus("目前沒有下一手");
  });

  previousBranchButton.addEventListener("click", () => {
    if (moveImportedBranch(-1)) return;
    if (currentReplayRoute().length && moveVcfBranch(-1)) return;
    if (window.VCFWorkbenchRecord?.navigateBranch?.(-1)) return;
    if (typeof setStatus === "function") setStatus("已停在棋譜起點");
  });
  nextBranchButton.addEventListener("click", () => {
    if (moveImportedBranch(1)) return;
    if (currentReplayRoute().length && moveVcfBranch(1)) return;
    if (window.VCFWorkbenchRecord?.navigateBranch?.(1)) return;
    if (typeof setStatus === "function") setStatus("已停在棋譜末端");
  });
'''
s = replace_once(s, old, new, "branch button handlers")

write(path, s)


# ---------------- rapfi/rapfi-workbench-header.js ----------------
path = "rapfi/rapfi-workbench-header.js"
s = read(path)

old = '''          canPrev: Boolean(exact && current?.parent),
          canNext: Boolean(next),
          selectedNextMove: next?.move ?? null,
          nextBranchCount: current?.children?.length || 0,
'''
new = '''          canPrev: Boolean(exact && current?.parent),
          canNext: Boolean(next),
          selectedNextMove: next?.move ?? null,
          nextMoves: exact ? current.children.map(child => child.move) : [],
          nextBranchCount: current?.children?.length || 0,
'''
s = replace_once(s, old, new, "manual all next moves")

old = '''      navigateBranch(direction) {
        if (!exact) return false;
        const siblings = current?.parent?.children || [];
        if (siblings.length > 1) {
          const index = siblings.indexOf(current);
          const nextIndex = (index + Number(direction || 1) + siblings.length) % siblings.length;
          current.parent.selectedChild = nextIndex;
          current = siblings[nextIndex];
          return applyCurrentBoard();
        }
        if (current.children.length > 1) {
          const count = current.children.length;
          current.selectedChild = (Number(current.selectedChild || 0) + Number(direction || 1) + count) % count;
          persist();
          notify();
          return true;
        }
        return false;
      },
'''
new = '''      navigateBranch(direction) {
        if (!exact) return false;
        if (direction < 0) {
          if (!current.parent) return false;
          let target = current.parent;
          while (target.parent && target.children.length <= 1) target = target.parent;
          current = target;
          return applyCurrentBoard();
        }
        if (!current.children.length) return false;
        let target = current;
        do {
          target.selectedChild = Math.max(0, Math.min(target.children.length - 1, Number(target.selectedChild || 0)));
          target = target.children[target.selectedChild];
        } while (target.children.length === 1);
        current = target;
        return applyCurrentBoard();
      },
'''
s = replace_once(s, old, new, "manual branch-point jump")
write(path, s)


# ---------------- makevcf.html cache bust ----------------
path = "makevcf.html"
s = read(path)
s = replace_once(s, 'makevcf-layout.js?v=20260826-record-v3', 'makevcf-layout.js?v=20260826-branch-jump-v4', "layout cache bust")
s = replace_once(s, 'rapfi/rapfi-workbench-header.js?v=20260826-record-v3', 'rapfi/rapfi-workbench-header.js?v=20260826-branch-jump-v4', "header cache bust")
write(path, s)


# ---------------- tests ----------------
path = "tests/workbench-architecture.test.js"
s = read(path)
s = s.replace("  'renderNextMoveMarker',\n", "  'renderNextMoveMarkers',\n")
s = replace_once(s,
'''  'VCFWorkbenchRecord?.navigateBranch?.(-1)',
  'VCFWorkbenchRecord?.navigateBranch?.(1)',
]) if (!layout.includes(token)) throw new Error(`manual record navigation contract missing: ${token}`);
''',
'''  'VCFWorkbenchRecord?.navigateBranch?.(-1)',
  'VCFWorkbenchRecord?.navigateBranch?.(1)',
  'renderNextMoveMarkers(children.map(child => child.move))',
  'moveVcfBranch(direction)',
  'vcfNextMoves(route, replayPly).length <= 1',
]) if (!layout.includes(token)) throw new Error(`manual record navigation contract missing: ${token}`);
''', "layout branch contracts")
s = replace_once(s,
'''  'navigateBranch(direction)',
  'selectedNextMove',
  'children: []',
]) if (!header.includes(token)) throw new Error(`record tree state contract missing: ${token}`);
''',
'''  'navigateBranch(direction)',
  'selectedNextMove',
  'nextMoves: exact ? current.children.map(child => child.move) : []',
  'while (target.parent && target.children.length <= 1)',
  'while (target.children.length === 1)',
  'children: []',
]) if (!header.includes(token)) throw new Error(`record tree state contract missing: ${token}`);
''', "header branch contracts")
old = '''if (!entry.includes('makevcf-layout.js?v=20260826-record-v3') || !entry.includes('rapfi/rapfi-workbench-header.js?v=20260826-record-v3')) {
  throw new Error("record UI scripts must be cache-busted after navigation model change");
}
'''
new = '''if (!entry.includes('makevcf-layout.js?v=20260826-branch-jump-v4') || !entry.includes('rapfi/rapfi-workbench-header.js?v=20260826-branch-jump-v4')) {
  throw new Error("record UI scripts must be cache-busted after branch-jump navigation change");
}
'''
s = replace_once(s, old, new, "test cache bust")
write(path, s)


# ---------------- spec ----------------
path = "規格書.MD"
s = read(path)
old = '''- 目前棋譜節點若存在下一手，棋盤必須在選定分支的下一手落點顯示圓圈提示；同一節點有多個子分支時，前一／後一分支可切換選定子分支，圓圈同步移動。
'''
new = '''- 目前棋譜節點若存在下一手，棋盤必須在所有可用次一手落點各顯示一個藍色圓圈；同一盤面有多個次一手時必須同時全部顯示，不得只標示目前選定分支。
- 「前一分支」不是切換同層 sibling：操作時先往上一步，再一路往前尋找最近一個「具有多個次一手」的盤面並停在該盤面；若一路都沒有分岔則停在空盤面。
- 「後一分支」不是切換同層 sibling：操作時至少往下一步，再沿目前選定的下一手一路往後尋找下一個「具有多個次一手」的盤面並停在該盤面；若後續都沒有分岔則停在最後一手。
'''
s = replace_once(s, old, new, "spec branch semantics")
write(path, s)
