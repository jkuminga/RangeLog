import { createId, nowIso } from '../lib/ids'
import type {
  ActionKind,
  BlindSnapshot,
  Card,
  Hand,
  HandAction,
  HandParticipant,
  Street,
} from '../types'
import { emptyBoard } from '../types'

const STREET_ORDER: Street[] = ['preflop', 'flop', 'turn', 'river']

/** EngineParticipant: 상태 계산에 필요한 핸드 참가자 요약이다. */
export interface EngineParticipant extends HandParticipant {
  folded: boolean
  allIn: boolean
}

/** HandState: 현재 스트리트와 아직 입력이 필요한 참가자를 계산한 결과다. */
export interface HandState {
  street: Street
  actionOrder: string[]
  unresolvedParticipantIds: string[]
  aliveParticipantIds: string[]
  actionComplete: boolean
}

/** ActionInput: 팝업에서 선택한 임시 액션과 선택적 금액이다. */
export interface ActionInput {
  participantId: string
  kind: ActionKind
  isAllIn?: boolean
  amountBB?: number
  percentage?: number
  amountSource?: 'percentage' | 'bb' | 'unknown'
}

/** 팝업 액션: 화면에 표시할 수 있는 버튼의 의미와 즉시 등록 여부다. */
export interface ActionOption {
  kind: ActionKind
  label: string
  withSize?: boolean
  isAllIn?: boolean
}

/** 새 핸드 생성: 테이블의 물리 좌석과 핸드 시작 블라인드를 스냅샷으로 복사한다. */
export function createHand(args: {
  accountId: string
  tournamentId: string
  tableSessionId: string
  seatCount: number
  occupiedSeats: Array<{ seatNo: number; playerId: string }>
  buttonSeat: number
  blindSnapshot: BlindSnapshot
}): Hand {
  const occupied = [...args.occupiedSeats].sort((a, b) => a.seatNo - b.seatNo)
  const buttonIndex = Math.max(0, occupied.findIndex((seat) => seat.seatNo === args.buttonSeat))
  const positionBySeat = new Map<number, string>()
  if (occupied.length > 0) {
    const count = occupied.length
    const names = count === 2
      ? ['BTN', 'BB']
      : count === 3
        ? ['BTN', 'SB', 'BB']
        : ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO', 'LJ', 'UTG+1', 'UTG+2']
    occupied.forEach((seat, relativeIndex) => {
      const positionIndex = (relativeIndex - buttonIndex + count) % count
      const label = names[positionIndex] ?? `UTG+${Math.max(1, positionIndex - 3)}`
      positionBySeat.set(seat.seatNo, label)
    })
  }
  const participants: HandParticipant[] = occupied.map((seat) => ({
    id: createId('participant'),
    playerId: seat.playerId,
    seatNo: seat.seatNo,
    position: positionBySeat.get(seat.seatNo) ?? 'UTG',
    holeCards: [null, null],
  }))
  return {
    id: createId('hand'),
    accountId: args.accountId,
    tournamentId: args.tournamentId,
    tableSessionId: args.tableSessionId,
    status: 'draft',
    draftKind: 'new',
    buttonSeat: args.buttonSeat,
    startedAt: nowIso(),
    updatedAt: nowIso(),
    blindSnapshot: args.blindSnapshot,
    participants,
    actions: [],
    board: emptyBoard(),
    potCheckpoints: [],
    currentStreet: 'preflop',
    actionComplete: false,
    revision: 0,
    mutationId: createId('mutation'),
  }
}

/** 한 스트리트의 액션 순서: BTN 고정 좌석에서 실제 포커 순서를 계산한다. */
export function getActionOrder(hand: Hand, street: Street): string[] {
  const participants = [...hand.participants].sort((a, b) => a.seatNo - b.seatNo)
  if (participants.length === 0) return []
  const buttonIndex = Math.max(0, participants.findIndex((participant) => participant.seatNo === hand.buttonSeat))
  const startOffset = street === 'preflop' ? Math.min(3, participants.length - 1) : 1
  return Array.from({ length: participants.length }, (_, index) => {
    const participant = participants[(buttonIndex + startOffset + index) % participants.length]
    return participant.id
  })
}

function actionsInStreet(hand: Hand, street: Street): HandAction[] {
  return hand.actions.filter((action) => action.street === street).sort((a, b) => a.sequence - b.sequence)
}

/** streetContribution: 블라인드와 이전 액션을 포함한 해당 스트리트의 기투입 BB를 계산한다. */
function streetContribution(hand: Hand, participantId: string, street: Street): number | undefined {
  const participant = hand.participants.find((item) => item.id === participantId)
  if (!participant) return undefined
  let paid = street === 'preflop' && participant.position === 'SB' ? hand.blindSnapshot.smallBlindBB : 0
  if (street === 'preflop' && participant.position === 'BB') paid = hand.blindSnapshot.bigBlindBB
  for (const action of actionsInStreet(hand, street).filter((item) => item.participantId === participantId)) {
    if (action.kind === 'fold' || action.kind === 'check') continue
    if (action.amountBB === undefined) return undefined
    paid = action.kind === 'raise' ? action.amountBB : paid + action.amountBB
  }
  return paid
}

/** automaticCallAmount: 일반 Call에 필요한 추가 투입액을 최고 투입액과 기투입액 차이로 산출한다. */
function automaticCallAmount(hand: Hand, participantId: string, street: Street): number | undefined {
  const actions = actionsInStreet(hand, street)
  const aggressive = [...actions].reverse().find((action) => action.kind === 'bet' || action.kind === 'raise')
  if (!aggressive?.amountBB) return aggressive?.amountBB === 0 ? 0 : undefined
  const paid = streetContribution(hand, participantId, street)
  if (paid === undefined) return undefined
  return Math.max(0, aggressive.amountBB - paid)
}

function participantStatus(hand: Hand, participantId: string): { folded: boolean; allIn: boolean } {
  const actions = hand.actions.filter((action) => action.participantId === participantId)
  const last = actions.at(-1)
  return {
    folded: actions.some((action) => action.kind === 'fold'),
    allIn: Boolean(last?.isAllIn),
  }
}

function activeIds(hand: Hand): string[] {
  return hand.participants
    .filter((participant) => {
      const status = participantStatus(hand, participant.id)
      return !status.folded
    })
    .map((participant) => participant.id)
}

function streetHasOnlyOneAlive(hand: Hand): boolean {
  return activeIds(hand).length <= 1
}

function nextStreet(street: Street): Street | undefined {
  const index = STREET_ORDER.indexOf(street)
  return STREET_ORDER[index + 1]
}

/** 미해결 액션: 마지막 Bet/Raise 이후 응답하지 않은 활성 참가자를 순서대로 반환한다. */
export function getUnresolvedParticipantIds(hand: Hand, street = hand.currentStreet): string[] {
  const order = getActionOrder(hand, street)
  const actions = actionsInStreet(hand, street)
  const active = new Set(activeIds(hand))
  const eligible = order.filter((id) => active.has(id) && !participantStatus(hand, id).allIn)
  if (eligible.length <= 1) return []

  const aggressive = [...actions].reverse().find((action) => action.kind === 'bet' || action.kind === 'raise')
  if (!aggressive) {
    const acted = new Set(actions.map((action) => action.participantId))
    return eligible.filter((id) => !acted.has(id))
  }

  const aggressiveIndex = order.indexOf(aggressive.participantId)
  const responseOrder = order.slice(aggressiveIndex + 1).concat(order.slice(0, aggressiveIndex + 1))
  const actedAfterAggression = new Set(
    actions.filter((action) => action.sequence > aggressive.sequence).map((action) => action.participantId),
  )
  return responseOrder.filter((id) => id !== aggressive.participantId && active.has(id) && !participantStatus(hand, id).allIn && !actedAfterAggression.has(id))
}

/** HandState 계산: UI와 테스트가 현재 스트리트 진행 상태를 같은 규칙으로 사용한다. */
export function deriveHandState(hand: Hand): HandState {
  let street = hand.currentStreet
  let working = hand
  let guard = 0
  while (guard < 4) {
    guard += 1
    const unresolved = getUnresolvedParticipantIds(working, street)
    if (unresolved.length > 0) {
      return {
        street,
        actionOrder: getActionOrder(working, street),
        unresolvedParticipantIds: unresolved,
        aliveParticipantIds: activeIds(working),
        actionComplete: false,
      }
    }
    if (streetHasOnlyOneAlive(working) || street === 'river') {
      return {
        street,
        actionOrder: getActionOrder(working, street),
        unresolvedParticipantIds: [],
        aliveParticipantIds: activeIds(working),
        actionComplete: true,
      }
    }
    const following = nextStreet(street)
    if (!following) break
    street = following
    if (working.currentStreet !== street) working = { ...working, currentStreet: street }
  }
  return {
    street,
    actionOrder: getActionOrder(working, street),
    unresolvedParticipantIds: getUnresolvedParticipantIds(working, street),
    aliveParticipantIds: activeIds(working),
    actionComplete: false,
  }
}

/** 건너뛰기 추론: 명시 입력 전에 필요한 Check/Fold만 실제 이력으로 추가한다. */
function inferSkippedActions(hand: Hand, targetParticipantId: string, street: Street): Hand {
  const unresolved = getUnresolvedParticipantIds(hand, street)
  const order = getActionOrder(hand, street)
  const targetIndex = unresolved.indexOf(targetParticipantId)
  if (targetIndex <= 0) return hand
  // 프리플랍은 체크 가능한 특수 BB 상황을 임의로 가정하지 않고 생략을 Fold로 기록한다.
  // 포스트플랍에서만 선행 베팅이 없는 생략을 Check로 추론한다.
  const inferredKind: ActionKind = street === 'preflop' || actionsInStreet(hand, street).some((action) => action.kind === 'bet' || action.kind === 'raise') ? 'fold' : 'check'
  let next = hand
  unresolved.slice(0, targetIndex).forEach((participantId) => {
    const action: HandAction = {
      id: createId('action'),
      participantId,
      street,
      kind: inferredKind,
      isAllIn: false,
      inferred: true,
      sequence: next.actions.length,
      createdAt: nowIso(),
    }
    next = { ...next, actions: [...next.actions, action] }
  })
  void order
  return next
}

function advanceAfterAction(hand: Hand): Hand {
  let next = { ...hand, updatedAt: nowIso(), revision: hand.revision + 1, mutationId: createId('mutation') }
  let state = deriveHandState(next)
  let guard = 0
  while (!state.actionComplete && state.unresolvedParticipantIds.length === 0 && guard < 4) {
    guard += 1
    next = { ...next, currentStreet: state.street }
    state = deriveHandState(next)
  }
  next = {
    ...next,
    currentStreet: state.street,
    actionComplete: state.actionComplete,
  }
  return next
}

/** 액션 등록: 명시한 뒤쪽 좌석의 입력이 앞쪽 Check/Fold 추론을 트리거한다. */
export function applyAction(hand: Hand, input: ActionInput): Hand {
  if (hand.status === 'completed') throw new Error('Completed 핸드는 읽기 전용입니다.')
  const participant = hand.participants.find((item) => item.id === input.participantId)
  if (!participant) throw new Error('핸드 참가자를 찾을 수 없습니다.')
  const state = deriveHandState(hand)
  if (state.actionComplete) throw new Error('이미 액션이 종료된 핸드입니다.')
  let next = inferSkippedActions(hand, input.participantId, state.street)
  const afterInference = deriveHandState(next)
  if (!afterInference.unresolvedParticipantIds.includes(input.participantId)) {
    throw new Error('현재 상태에서 해당 플레이어의 액션을 입력할 수 없습니다.')
  }
  const action: HandAction = {
    id: createId('action'),
    participantId: input.participantId,
    street: afterInference.street,
    kind: input.kind,
    isAllIn: Boolean(input.isAllIn),
    inferred: false,
    sequence: next.actions.length,
    createdAt: nowIso(),
    amountBB: input.amountBB ?? (input.kind === 'call' && !input.isAllIn ? automaticCallAmount(next, input.participantId, afterInference.street) : undefined),
    percentage: input.percentage,
    amountSource: input.amountSource ?? (input.amountBB !== undefined || input.kind === 'call' ? 'bb' : 'unknown'),
  }
  next = { ...next, actions: [...next.actions, action] }
  return advanceAfterAction(next)
}

/** 동적 팝업 옵션: 베팅 대응 여부에 따라 최대 2행 UI가 사용할 버튼을 결정한다. */
export function getActionOptions(hand: Hand, participantId: string): ActionOption[] {
  const state = deriveHandState(hand)
  if (!state.unresolvedParticipantIds.includes(participantId)) return []
  const facingBet = actionsInStreet(hand, state.street).some((action) => action.kind === 'bet' || action.kind === 'raise')
  if (!facingBet) {
    if (state.street === 'preflop') {
      const participant = hand.participants.find((item) => item.id === participantId)
      return [
        ...(participant?.position === 'BB' ? [{ kind: 'check' as const, label: 'Check' }] : []),
        { kind: 'raise', label: 'Raise', withSize: true },
        { kind: 'raise', label: 'Raise without Size' },
      ]
    }
    return [
      { kind: 'check', label: 'Check' },
      { kind: 'bet', label: 'Bet with Size', withSize: true },
      { kind: 'bet', label: 'Bet without Size' },
    ]
  }
  return [
    { kind: 'fold', label: 'Fold' },
    { kind: 'call', label: 'Call' },
    { kind: 'call', label: 'Call All-in', isAllIn: true },
    { kind: 'raise', label: 'Raise with Size', withSize: true },
    { kind: 'raise', label: 'Raise without Size' },
  ]
}

/** 액션 편집: 종류/All-in 변경은 이후 액션을 제거하고, 금액만 바꾸면 후속 액션을 보존한다. */
export function editAction(hand: Hand, actionId: string, patch: Partial<Pick<HandAction, 'kind' | 'isAllIn' | 'amountBB' | 'percentage' | 'amountSource'>>): Hand {
  const index = hand.actions.findIndex((action) => action.id === actionId)
  if (index < 0) throw new Error('수정할 액션을 찾을 수 없습니다.')
  const current = hand.actions[index]
  const meaningChanged = patch.kind !== undefined && patch.kind !== current.kind || patch.isAllIn !== undefined && patch.isAllIn !== current.isAllIn
  const actions = hand.actions.map((action, actionIndex) => actionIndex === index ? { ...action, ...patch, inferred: false } : action)
  const trimmed = meaningChanged ? actions.slice(0, index + 1) : actions
  const next: Hand = { ...hand, actions: trimmed, currentStreet: meaningChanged ? current.street : hand.currentStreet, actionComplete: false, updatedAt: nowIso(), revision: hand.revision + 1, mutationId: createId('mutation') }
  return advanceAfterAction(next)
}

/** 카드 업데이트: 액션 초기화와 독립적으로 보드·홀카드를 보존/수정한다. */
export function updateCards(hand: Hand, args: { board?: Hand['board']; participantId?: string; holeCards?: [Card | null, Card | null] }): Hand {
  const participants = args.participantId && args.holeCards
    ? hand.participants.map((participant) => participant.id === args.participantId ? { ...participant, holeCards: args.holeCards! } : participant)
    : hand.participants
  return { ...hand, board: args.board ?? hand.board, participants, updatedAt: nowIso(), revision: hand.revision + 1, mutationId: createId('mutation') }
}

/** 포트 계산: 알 수 없는 금액을 임의로 추정하지 않고 undefined로 전파한다. */
export function calculateCurrentPot(hand: Hand, throughActionIndex = hand.actions.length - 1): number | undefined {
  const start = hand.blindSnapshot.smallBlindBB + hand.blindSnapshot.bigBlindBB + (hand.blindSnapshot.anteEnabled ? hand.blindSnapshot.anteBB : 0)
  let pot = start
  const paidByParticipant = new Map<string, number>()
  const lastBetByStreet = new Map<Street, number>()
  hand.participants.forEach((participant) => {
    if (participant.position === 'SB') paidByParticipant.set(`${participant.id}:preflop`, hand.blindSnapshot.smallBlindBB)
    if (participant.position === 'BB') paidByParticipant.set(`${participant.id}:preflop`, hand.blindSnapshot.bigBlindBB)
  })
  const actions = hand.actions.slice(0, throughActionIndex + 1).sort((a, b) => a.sequence - b.sequence)
  for (const action of actions) {
    if (action.kind === 'fold' || action.kind === 'check') continue
    if (action.amountBB === undefined && action.kind !== 'call') return undefined
    const actionAmount = action.amountBB
    const previousPaid = paidByParticipant.get(action.participantId) ?? 0
    let contribution = action.amountBB
    if (action.kind === 'raise' && actionAmount !== undefined) contribution = Math.max(0, actionAmount - (paidByParticipant.get(`${action.participantId}:${action.street}`) ?? 0))
    if (action.kind === 'call') {
      const highest = lastBetByStreet.get(action.street) ?? 0
      contribution = Math.max(0, highest - (paidByParticipant.get(`${action.participantId}:${action.street}`) ?? 0))
    }
    if (contribution === undefined || action.kind === 'call' && action.isAllIn && action.amountBB === undefined) return undefined
    pot += contribution
    paidByParticipant.set(action.participantId, previousPaid + contribution)
    paidByParticipant.set(`${action.participantId}:${action.street}`, (paidByParticipant.get(`${action.participantId}:${action.street}`) ?? 0) + contribution)
    if ((action.kind === 'bet' || action.kind === 'raise') && actionAmount !== undefined) lastBetByStreet.set(action.street, actionAmount)
  }
  const checkpoint = [...hand.potCheckpoints].reverse().find((item) => item.street === hand.currentStreet && item.amountBB !== undefined)
  return checkpoint?.amountBB ?? pot
}

/** 카드 중복 검사: 보드와 모든 홀카드에서 같은 실물 카드가 두 번 배정되지 않았는지 확인한다. */
export function hasDuplicateCards(hand: Hand): boolean {
  const cards: Card[] = [
    ...hand.board.flop,
    ...hand.board.turn,
    ...hand.board.river,
    ...hand.participants.flatMap((participant) => participant.holeCards),
  ].filter((card): card is Card => card !== null)
  return new Set(cards).size !== cards.length
}
