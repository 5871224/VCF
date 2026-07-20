$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$DockerRepoRoot = $RepoRoot -replace '\\', '/'

Write-Host 'Building with emscripten/emsdk:3.1.74 ...'
docker run --rm `
  -v "${DockerRepoRoot}:/src" `
  -w /src `
  emscripten/emsdk:3.1.74 `
  bash upstream/lfz084-renju/build-evaluator.sh

Write-Host "Output: $RepoRoot\upstream\lfz084-renju\build\Evaluator.wasm"
