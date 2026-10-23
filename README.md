# RangeLog MVP

설계 기준선 `RangeLog_..._v0.7.md`를 바탕으로 만든 모바일 우선 React/Vite/TypeScript MVP다.

## 실행

```bash
npm install
npm run dev
```

Supabase Google OAuth를 연결하려면 `.env.example`을 `.env`로 복사하고 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 입력한다. 두 값이 없으면 로컬 데모 계정으로 동작하며, Draft는 IndexedDB에 저장된다.

## 구현된 핵심 흐름

- 고정 물리 좌석 테이블, 좌석 수정 모드, 실제 BTN 탭으로 핸드 시작
- 좌석 탭 → 동적 액션 팝업 → 액션 이력 등록
- 뒤쪽 좌석을 먼저 입력할 때 상태 기반 Check/Fold 추론
- 스트리트 자동 전환, All-in 플래그, Raise-to/Call 차액 및 금액 미상 전파
- 상단 가로 액션 히스토리와 액션 의미 변경 시 후속 액션 초기화
- Flop/Turn/River 부분 보드, 플레이어 홀카드 52장 그리드, Pot Checkpoint
- IndexedDB Draft 자동 저장(500ms debounce/3초 상한) 및 복원 알림
- Completed 읽기 전용 상세 → 별도 Edit Draft → 원본 교체
- VPIP/PFR/3-Bet/Hands와 Postflop 11개 통계 재집계
- JSON 백업, Supabase PostgreSQL 마이그레이션과 `auth.uid()` 기반 RLS 정책

## 검증

```bash
npm test
npm run build
```

핵심 DB 필드·객체·함수 설명은 [`docs/KEYWORDS.md`](./docs/KEYWORDS.md)에 정리했다.
