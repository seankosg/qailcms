#!/bin/bash
# QAIL CMS 재해복구 패키지 생성기 (macOS)
# 배포 ZIP 안에서는 run.bundle.mjs, 저장소 안에서는 run.mjs 를 호출합니다.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "[실패] Node.js 를 찾지 못했습니다."
  echo "  https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요."
  echo
  read -r -p "엔터를 누르면 닫힙니다."
  exit 1
fi

ENTRY="$(pwd)/run.bundle.mjs"
[ -f "$ENTRY" ] || ENTRY="$(pwd)/run.mjs"

node "$ENTRY"
CODE=$?
echo
read -r -p "엔터를 누르면 닫힙니다."
exit $CODE
