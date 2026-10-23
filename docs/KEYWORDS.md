# RangeLog 핵심 키워드

프로젝트 전반에서 반복되는 DB 필드·객체·함수의 의미를 짧게 정리한 문서다.

| 키워드 | 설명 |
| --- | --- |
| `Player` | 토너먼트가 바뀌어도 재사용하는 전역 플레이어 관측 대상 |
| `Tournament` | 실제로 참가한 한 번의 토너먼트 이벤트 |
| `TableSession` | 한 토너먼트에서 특정 테이블에 연속으로 머문 구간 |
| `SeatAssignment` | 물리 좌석 번호와 Player의 착석·이탈 이력 |
| `Hand` | 액션·카드·팟을 묶은 하나의 핸드 스냅샷 |
| `HandParticipant` | 핸드 시작 당시 플레이어·좌석·홀카드 스냅샷 |
| `HandAction` | 시간순으로 저장되는 관측 액션; `inferred`는 자동 추론 여부 |
| `revision` | 서버 조건부 갱신에서 기대 버전을 확인하는 숫자 |
| `mutation_id` | 완료·재시도 요청을 한 번만 적용하기 위한 멱등성 키 |
| `draft` | 사용자가 기록 중인 미완성 핸드; HUD에서 제외 |
| `completed` | 액션 종료와 저장 완료가 확정된 핸드; HUD에 반영 |
| `HandEditDraft` | 기존 Completed를 덮지 않고 수정하는 별도 작업본 |
| `currentStreet` | 현재 입력 중인 `preflop`/`flop`/`turn`/`river` |
| `isAllIn` | `bet`·`raise`·`call`에 붙는 올인 여부 플래그 |
| `amountBB` | 절대 금액을 빅블라인드 단위로 저장한 값 |
| `percentage` | 팟 대비 상대 사이즈 원본 또는 파생값 |
| `PotCheckpoint` | 플랍·턴·리버 시작 팟을 사용자가 보정하는 기준점 |
| `computePlayerStats()` | Completed 원본에서 HUD 통계를 재집계하는 함수 |
| `deriveHandState()` | 현재 스트리트·미해결 액션·종료 여부를 계산하는 함수 |
| `applyAction()` | 액션을 기록하고 건너뛴 Check/Fold를 추론하는 함수 |
| `editAction()` | 액션 의미 변경 시 후속 이력을 초기화하는 함수 |
| `useDraftAutosave()` | 500ms debounce와 3초 상한으로 IndexedDB에 Draft를 저장하는 훅 |
