#!/bin/sh
# Point git at the repo's tracked hooks. Run once per clone: sh jarvis-ops/scripts/install-hooks.sh
set -e
ROOT=$(git rev-parse --show-toplevel)
chmod +x "$ROOT"/.githooks/*
git -C "$ROOT" config core.hooksPath .githooks
echo "Hooks installed: $(ls "$ROOT/.githooks" | tr '\n' ' ')"
