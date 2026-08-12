import { DmrRawDataPage } from './DmrRawDataPage';
import { DMR2_COLUMNS } from '@/lib/dmr/columns';

/**
 * DMR Raw Data 2 — Daily Entry 저장 결과 원본(인원종류별 3행).
 * UI 는 DMR Raw Data 와 같은 컴포넌트를 그대로 쓴다. 열 묶음만 다르다.
 */
export function DmrRawData2Page() {
  return (
    <DmrRawDataPage
      columnDefs={DMR2_COLUMNS}
      title="DMR Raw Data 2"
      subtitle="Daily Entry 저장 원본 — TM 코드·담당자·하루치 증분·인원종류별 행"
      prefKey="dmr-raw-data-2"
      routePath="/resource/dmr/raw-data-2"
      routeId="/_authenticated/resource/dmr/raw-data-2"
      showImport={false}
      scope="entry"
      exportFilePrefix="CMS_DMR_RawData2"
    />
  );
}
