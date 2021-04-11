#!/usr/bin/env bash
set -euo pipefail

code_quality() {
  echo "Checking formatting..."
  deno fmt --unstable --check ./src
  echo "Linting..."
  deno lint --unstable ./src
  # echo "Runnning tests..."
  # deno test -A
}

compile() {
  # This sed replacement is a temporary workaround for https://github.com/denoland/deno/issues/9810
  deno bundle ./src/app.ts | sed -e 's/await this\._loading\[ref2\] = loadSchema(ref2)/await (this._loading[ref2] = loadSchema(ref2))/g' > ./images/app/app.js
}

"$@"