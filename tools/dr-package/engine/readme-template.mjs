export function README_KR({ runId, buckets, excluded, storage, dumpBytes }) {
  const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `# QAIL CMS 재해복구(DR) 패키지 — ${runId}

이 폴더 하나로 데이터베이스와 업무 파일을 다시 세울 수 있습니다.

## 들어 있는 것

- \`database/qail-full-database.dump\` — 전체 데이터베이스(계정 정보 포함) 백업, ${mb(dumpBytes)}
- \`storage/\` — 업무 파일 ${storage.files.length}개, ${mb(storage.totalBytes)}
- \`auth/users-metadata.json\` — 사용자 목록(참고용). 정본은 위 데이터베이스 백업입니다.
- \`system/\` — 버전·마이그레이션·환경변수 **이름만** 기록(비밀값 없음)
- \`backup-manifest.json\`, \`checksums.sha256\` — 파일 목록과 무결성 값
- \`verification/backup-report.json\` — 생성 시 수행한 검산 결과

## 포함한 파일 보관함

${buckets.map((b) => `- ${b}`).join("\n")}

## 제외한 것

${excluded.map((b) => `- ${b} (기존 스냅샷 중복 보관물)`).join("\n")}

## 되살릴 때 (전문가용)

PostgreSQL 17 이 설치된 PC에서 실행합니다.

\`\`\`
pg_restore --clean --if-exists --no-owner --no-privileges \\
  --dbname="<대상 데이터베이스 접속 문자열>" database/qail-full-database.dump
\`\`\`

업무 파일은 \`storage/<보관함이름>/\` 폴더 구조 그대로 다시 올립니다.

## 무결성 확인

- macOS: \`shasum -a 256 -c checksums.sha256\`
- Windows(PowerShell): \`Get-FileHash <파일> -Algorithm SHA256\`

## 주의

- 이 패키지에는 데이터베이스 비밀번호나 접속 키가 들어 있지 않습니다.
- 데이터베이스 백업에는 계정 정보가 들어 있으므로 안전한 곳에 보관하세요.
`;
}
