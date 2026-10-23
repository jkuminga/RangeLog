/** 포커 스트리트: 액션 순서와 통계 분류의 기준이 되는 거리. */
export type Street = 'preflop' | 'flop' | 'turn' | 'river'

/** 기록할 행동 종류: 포커 규칙을 검증하기보다 관측된 행동을 보존한다. */
export type ActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise'

/** 핸드 생명주기: draft는 미완성, completed는 HUD 반영 가능한 원본이다. */
export type HandStatus = 'draft' | 'completed'

/** 편집본의 종류: 신규 핸드 Draft와 기존 Completed의 편집 Draft를 구별한다. */
export type DraftKind = 'new' | 'edit'

/** 카드: rank와 suit의 조합이며 null은 아직 모르는 빈 슬롯이다. */
export type Card = `${'2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A'}${'s' | 'h' | 'd' | 'c'}`

/** 블라인드 스냅샷: 핸드 시작 시 설정을 보존해 이후 설정 변경과 분리한다. */
export interface BlindSnapshot {
  smallBlindBB: number
  bigBlindBB: number
  anteEnabled: boolean
  anteBB: number
}

/** Player: 토너먼트를 넘어 재사용되는 전역 관측 대상이다. */
export interface Player {
  id: string
  name: string
  nickname?: string
  avatar?: string
  description?: string
  tags: string[]
  createdAt: string
  firstObservedTournamentId?: string
}

/** Tournament: 실제 참가한 한 번의 이벤트 단위다. */
export interface Tournament {
  id: string
  name: string
  defaultSeatCount: number
  status: 'active' | 'completed'
  createdAt: string
  completedAt?: string
}

/** TableSession: 한 토너먼트에서 한 테이블에 연속 체류한 구간이다. */
export interface TableSession {
  id: string
  tournamentId: string
  name: string
  seatCount: number
  createdAt: string
  endedAt?: string
}

/** SeatAssignment: 테이블의 물리 좌석과 현재 Player의 연결이다. */
export interface SeatAssignment {
  id: string
  tableSessionId: string
  seatNo: number
  playerId?: string
  startedAt: string
  endedAt?: string
}

/** HandParticipant: 핸드 시작 시점의 플레이어·좌석 스냅샷이다. */
export interface HandParticipant {
  id: string
  playerId: string
  seatNo: number
  position: string
  holeCards: [Card | null, Card | null]
}

/** HandAction: 시간순 액션 이력; inferred는 건너뛴 행동을 상태 기반으로 복원했음을 뜻한다. */
export interface HandAction {
  id: string
  participantId: string
  street: Street
  kind: ActionKind
  isAllIn: boolean
  inferred: boolean
  sequence: number
  createdAt: string
  percentage?: number
  amountBB?: number
  amountSource?: 'percentage' | 'bb' | 'unknown'
}

/** BoardCards: 스트리트별 공개 카드; 부분 입력은 null 슬롯으로 보존한다. */
export interface BoardCards {
  flop: [Card | null, Card | null, Card | null]
  turn: [Card | null]
  river: [Card | null]
}

/** PotCheckpoint: 스트리트 시작 팟을 사용자가 직접 보정하는 기준점이다. */
export interface PotCheckpoint {
  street: Exclude<Street, 'preflop'>
  amountBB?: number
}

/** Hand: 액션·카드·팟을 묶는 원본 스냅샷이다. */
export interface Hand {
  id: string
  accountId: string
  tournamentId: string
  tableSessionId: string
  status: HandStatus
  draftKind: DraftKind
  originalHandId?: string
  buttonSeat: number
  startedAt: string
  updatedAt: string
  blindSnapshot: BlindSnapshot
  participants: HandParticipant[]
  actions: HandAction[]
  board: BoardCards
  potCheckpoints: PotCheckpoint[]
  currentStreet: Street
  actionComplete: boolean
  revision: number
  /** mutationId: 동일 스냅샷 재시도를 한 번만 반영하는 요청 식별자. */
  mutationId?: string
}

/** Workspace: 서버 데이터와 로컬 Draft를 화면에서 묶는 최소 저장 모델이다. */
export interface Workspace {
  players: Player[]
  tournaments: Tournament[]
  sessions: TableSession[]
  seats: SeatAssignment[]
  hands: Hand[]
}

/** HUD 통계 한 칸: 원본 액션을 매번 재집계한 분자·분모다. */
export interface RateStat {
  numerator: number
  denominator: number
}

/** 플레이어 통계: 메인 HUD와 상세 Postflop 탭이 공유한다. */
export interface PlayerStats {
  hands: number
  vpip: RateStat
  pfr: RateStat
  threeBet: RateStat
  postflop: Record<PostflopStatKey, RateStat>
}

export type PostflopStatKey =
  | 'flopCBet'
  | 'turnBarrel'
  | 'riverBarrel'
  | 'flopCheckRaise'
  | 'foldToFlopCBet'
  | 'foldToTurnCBet'
  | 'foldToRiverBet'
  | 'callFlopBet'
  | 'flopBet'
  | 'turnBet'
  | 'riverBet'

/** 기본 보드 상태를 만든다. */
export function emptyBoard(): BoardCards {
  return { flop: [null, null, null], turn: [null], river: [null] }
}
