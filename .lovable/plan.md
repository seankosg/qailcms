## 변경 범위
`src/components/layout/AppLayout.tsx` 한 줄 수정.

## 내용
사이드바 최상단의 "QAIL CMS" 라벨 왼쪽에 있는 `Wrench` 아이콘을 삭제합니다. 텍스트 레이블은 그대로 유지.

- 현재 (lines 238-241):
  ```tsx
  <div className="flex items-center gap-2">
    <Wrench className="h-5 w-5 text-primary" />
    <span className="text-sm font-semibold">QAIL CMS</span>
  </div>
  ```
- 변경:
  ```tsx
  <div className="flex items-center gap-2">
    <span className="text-sm font-semibold">QAIL CMS</span>
  </div>
  ```

`Wrench` import가 다른 곳에서 사용되지 않으면 import도 함께 제거.

## 확인
- 혹시 상단 헤더(TopBrandHeader)의 "QAIL CMS" 라벨 왼쪽 현대 로고를 삭제하려는 것이라면 이 계획이 아니니 말씀해 주세요.