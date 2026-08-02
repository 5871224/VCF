from pathlib import Path

path = Path('tools/apply-image-import-build-fixes.js')
source = path.read_text(encoding='utf-8')
old = '''requireTokens("makevcf-generator-balance.js", [
  "generatorOptionsWithFinalBalance",
  "黑白子數已補齊",
]);'''
new = '''requireTokens("makevcf-generator-core.js", [
  "function genRegisterOptionProvider(",
  "function genRegisterBusyHook(",
  "function genBeginGenerationContext(",
  "function genGetActiveOptions(",
]);
requireTokens("makevcf-generator-main.js", [
  "genResolveOptions({",
  "genBeginGenerationContext({",
  "genEndGenerationContext(generationContext)",
]);
requireTokens("makevcf-generator-balance.js", [
  'genRegisterOptionProvider("final-balance"',
  'genRegisterBusyHook("final-balance"',
  "黑白子數已補齊",
]);'''
if source.count(old) != 1:
    raise SystemExit('找不到舊 final balance 建置驗證')
path.write_text(source.replace(old, new), encoding='utf-8')
print('GenerationContext build verifier updated')
