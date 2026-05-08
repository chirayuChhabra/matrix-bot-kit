#!/usr/bin/env bash
set -euo pipefail

workspace_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target_dir="${workspace_root}/target/debug"
native_dir="${workspace_root}/js/native"

cargo build -p matrix-bot-node
mkdir -p "${native_dir}"

case "$(uname -s)" in
  Darwin)
    source_library="${target_dir}/libmatrix_bot_node.dylib"
    ;;
  Linux)
    source_library="${target_dir}/libmatrix_bot_node.so"
    ;;
  *)
    echo "Unsupported OS: $(uname -s)" >&2
    exit 1
    ;;
esac

cp "${source_library}" "${native_dir}/matrix_bot_node.node"
if [[ "$(uname -s)" == "Darwin" ]]; then
  codesign --force --sign - "${native_dir}/matrix_bot_node.node"
fi
echo "Built ${native_dir}/matrix_bot_node.node"
