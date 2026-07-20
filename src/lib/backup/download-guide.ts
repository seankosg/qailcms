import guideMarkdown from "@/content/backup-user-guide.md?raw";

export const BACKUP_GUIDE_MARKDOWN = guideMarkdown;

function timestamp() {
  return todayInDoha().replace(/-/g, "");
}

export function downloadGuideMarkdown() {
  const blob = new Blob([BACKUP_GUIDE_MARKDOWN], { type: "text/markdown;charset=utf-8" });
  triggerDownload(blob, `QAIL_Backup_Restore_Guide_${timestamp()}.md`);
}

export async function downloadGuidePdf(container: HTMLElement | null) {
  if (!container) return;
  const mod: any = await import("html2pdf.js");
  const html2pdf = mod.default ?? mod;
  await html2pdf()
    .from(container)
    .set({
      margin: [10, 12, 12, 12],
      filename: `QAIL_Backup_Restore_Guide_${timestamp()}.pdf`,
      image: { type: "jpeg", quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"] },
    })
    .save();
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}