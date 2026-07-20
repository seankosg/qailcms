import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatabaseBackup } from "lucide-react";
import { BackupHelpDialog } from "@/components/admin/backup/BackupHelpDialog";

export const Route = createFileRoute("/_authenticated/admin/backup")({
  component: BackupPage,
});

function BackupPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <DatabaseBackup className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Backup &amp; Restore</h1>
        </div>
        <BackupHelpDialog />
      </div>
      <p className="text-sm text-muted-foreground">
        데이터베이스 스냅샷 생성, 스케줄 관리, 복원(Restore) 기능이 이 페이지에서 제공될 예정입니다.
        지금은 상단 <strong>도움말 / Help</strong> 버튼을 통해 백업/복원 사용자 가이드를 열람하고 Markdown/PDF 로 내려받을 수 있습니다.
      </p>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">이 페이지에서 곧 제공될 기능</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1.5 text-muted-foreground">
          <div>• 자동 백업 스케줄 (기본값: 도하 시간 23:50 daily)</div>
          <div>• 즉시(수동) 스냅샷 생성 및 SHA-256 무결성 검증</div>
          <div>• 스냅샷 목록 · 로컬 zip 다운로드 · 잠금(영구 보존) / 삭제</div>
          <div>• 선택적 복원(Selective Restore) — 특정 테이블만 되돌리기</div>
          <div>• 임포트 직전 자동 안전 백업 (Pre-import Safety Snapshot)</div>
          <div>• Retention 정책 (keep_last_n / keep_days)</div>
          <div>• 성공/경고/실패 알림 및 Webhook 연동</div>
        </CardContent>
      </Card>
    </div>
  );
}