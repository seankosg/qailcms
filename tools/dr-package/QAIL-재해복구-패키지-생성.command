#!/bin/bash
# QAIL CMS 재해복구 패키지 생성기 (macOS)
# 공용 엔진(run.mjs)을 그대로 호출합니다. OS별 차이는 이 런처와 pg_dump 탐색뿐입니다.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "[실패] Node.js 를 찾지 못했습니다."
  echo "  https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요."
  echo
  read -r -p "엔터를 누르면 닫힙니다."
  exit 1
fi

node "$(pwd)/run.mjs"
CODE=$?
echo
read -r -p "엔터를 누르면 닫힙니다."
exit $CODE
