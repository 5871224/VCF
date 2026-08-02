"use strict";

const fs = require("fs");
const target = "tools/refactor-generator-phase1-once.js";
let source = fs.readFileSync(target, "utf8");

const oldText = `  if (!html.includes(fixedScripts)) html = replaceOnce(html, oldScripts, fixedScripts, relative);\n  write(relative, html);\n}\n\nconst sourceOrderTest =`;
const newText = `  if (!html.includes(fixedScripts)) {\n    if (html.includes(oldScripts)) {\n      html = replaceOnce(html, oldScripts, fixedScripts, relative);\n    } else {\n      html = replaceOnce(html, "</body>", fixedScripts + "\\n\\n</body>", \`\${relative} body\`);\n    }\n  }\n  write(relative, html);\n}\n\n// Pages 只複製正式 HTML，不再另外注入另一份腳本清單。\n{\n  const relative = ".github/workflows/pages.yml";\n  let workflow = read(relative);\n  const startMarker = "          python - <<'PY'\\n";\n  const start = workflow.indexOf(startMarker);\n  if (start < 0) fail(\`\${relative}：找不到靜態站驗證區段\`);\n  const endMarker = "          PY\\n";\n  const end = workflow.indexOf(endMarker, start);\n  if (end < 0) fail(\`\${relative}：找不到靜態站驗證結尾\`);\n  const verification = \`          python - <<'PY'\\n          from pathlib import Path\\n\\n          index_path = Path("_site/index.html")\\n          index_text = index_path.read_text(encoding="utf-8")\\n          assert index_path.is_file()\\n          assert Path("_site/rapfi/lab.html").is_file()\\n          for removed in (\\n              "_site/makevcf.html",\\n              "_site/pattern-compare.html",\\n              "_site/pattern-compare.js",\\n              "_site/rapfi/index.html",\\n              "_site/rapfi/generator-flowchart.html",\\n          ):\\n              assert not Path(removed).exists(), removed\\n          for token in (\\n              "vcf-bitboard-main.js",\\n              "makevcf-generator-core.js",\\n              "makevcf-generator-target-board-v3.js",\\n              "makevcf-generator-defense-points.js",\\n              "makevcf-generator-progress.js",\\n              "rapfi-bitboard-dashboard.js",\\n              "vcf-shortest-vcf-ui.js",\\n              "vcf-forbidden-overlay.js",\\n          ):\\n              assert token in index_text, token\\n          assert "installRootBitboardFeatures" not in index_text\\n          PY\\n\`;\n  workflow = workflow.slice(0, start) + verification + workflow.slice(end + endMarker.length);\n  write(relative, workflow);\n}\n\nconst sourceOrderTest =`;

if (!source.includes(oldText)) {
  throw new Error("找不到第一階段 HTML／Pages 修正位置");
}
source = source.replace(oldText, newText);
fs.writeFileSync(target, source, "utf8");
console.log("第一階段腳本已補上正式 HTML 與 Pages workflow 搬移邏輯。");
