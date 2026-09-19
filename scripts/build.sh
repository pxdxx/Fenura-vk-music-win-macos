#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")/.."
xcodebuild -scheme Fenura -configuration Debug -derivedDataPath /tmp/FenuraDerived -destination 'platform=macOS' build
rm -rf dist/Fenura.app
mkdir -p dist
ditto /tmp/FenuraDerived/Build/Products/Debug/Fenura.app dist/Fenura.app
xattr -cr dist/Fenura.app || true
echo "Готово: $(pwd)/dist/Fenura.app"
echo "Запуск: open dist/Fenura.app"
