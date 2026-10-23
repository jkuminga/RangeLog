import type { ActionKind, Hand, HandAction, PlayerStats, PostflopStatKey, RateStat, Street } from '../types'

const POSTFLOP_KEYS: PostflopStatKey[] = [
  'flopCBet', 'turnBarrel', 'riverBarrel', 'flopCheckRaise',
  'foldToFlopCBet', 'foldToTurnCBet', 'foldToRiverBet', 'callFlopBet',
  'flopBet', 'turnBet', 'riverBet',
]

function blankRate(): RateStat { return { numerator: 0, denominator: 0 } }

function blankStats(): PlayerStats {
  return {
    hands: 0,
    vpip: blankRate(),
    pfr: blankRate(),
    threeBet: blankRate(),
    postflop: Object.fromEntries(POSTFLOP_KEYS.map((key) => [key, blankRate()])) as Record<PostflopStatKey, RateStat>,
  }
}

function sortActions(hand: Hand, street: Street): HandAction[] {
  return hand.actions.filter((action) => action.street === street).sort((a, b) => a.sequence - b.sequence)
}

function isAggressive(action: HandAction): boolean {
  return action.kind === 'bet' || action.kind === 'raise'
}

function firstAction(actions: HandAction[], participantId: string): HandAction | undefined {
  return actions.find((action) => action.participantId === participantId)
}

function firstPreflopRaise(actions: HandAction[]): HandAction | undefined {
  return actions.find((action) => action.kind === 'raise' || action.kind === 'bet')
}

function addStat(stats: PlayerStats, key: PostflopStatKey, success: boolean): void {
  stats.postflop[key].denominator += 1
  if (success) stats.postflop[key].numerator += 1
}

function firstBetAndResponders(hand: Hand, street: Street): { bet?: HandAction; responses: HandAction[] } {
  const actions = sortActions(hand, street)
  const betIndex = actions.findIndex((action) => action.kind === 'bet')
  if (betIndex < 0) return { responses: [] }
  const bet = actions[betIndex]
  const responses: HandAction[] = []
  for (const action of actions.slice(betIndex + 1)) {
    if (action.kind === 'raise') break
    if (action.participantId !== bet.participantId && !responses.some((item) => item.participantId === action.participantId)) responses.push(action)
  }
  return { bet, responses }
}

/** cBetTarget: 프리플랍 마지막 공격자가 해당 스트리트의 첫 Bet을 했는지 확인한다. */
function cBetTarget(hand: Hand, street: 'flop' | 'turn' | 'river'): { bet?: HandAction; responses: HandAction[] } {
  const preflop = sortActions(hand, 'preflop')
  const aggressor = [...preflop].reverse().find(isAggressive)
  if (!aggressor) return { responses: [] }
  const target = firstBetAndResponders(hand, street)
  return target.bet?.participantId === aggressor.participantId ? target : { responses: [] }
}

/** barrelTarget: Turn/River Barrel의 연속성이 유지되는 경우에만 방어 기회로 인정한다. */
function barrelTarget(hand: Hand, street: 'turn' | 'river'): { bet?: HandAction; responses: HandAction[] } {
  const preflop = sortActions(hand, 'preflop')
  const aggressor = [...preflop].reverse().find(isAggressive)
  if (!aggressor) return { responses: [] }
  const flop = sortActions(hand, 'flop')
  const flopBet = flop.find((action) => action.kind === 'bet' && action.participantId === aggressor.participantId)
  if (!flopBet || flop.some((action) => action.kind === 'raise')) return { responses: [] }
  if (street === 'turn') return cBetTarget(hand, street)
  const turn = sortActions(hand, 'turn')
  const turnBet = turn.find((action) => action.kind === 'bet' && action.participantId === aggressor.participantId)
  if (!turnBet || turn.some((action) => action.kind === 'raise')) return { responses: [] }
  return cBetTarget(hand, street)
}

function scoreCBet(hand: Hand, playerId: string, stats: PlayerStats): void {
  const preflop = sortActions(hand, 'preflop')
  const lastAggressor = [...preflop].reverse().find(isAggressive)
  if (!lastAggressor) return
  const participant = hand.participants.find((item) => item.id === lastAggressor.participantId && item.playerId === playerId)
  if (!participant) return
  const flop = sortActions(hand, 'flop')
  const decision = firstAction(flop, participant.id)
  if (!decision || (decision.kind !== 'check' && decision.kind !== 'bet')) return
  addStat(stats, 'flopCBet', decision.kind === 'bet')

  if (decision.kind !== 'bet') return
  const flopRaise = flop.some((action) => action.kind === 'raise')
  if (flopRaise) return
  const turn = sortActions(hand, 'turn')
  const turnDecision = firstAction(turn, participant.id)
  if (turnDecision && (turnDecision.kind === 'check' || turnDecision.kind === 'bet')) {
    addStat(stats, 'turnBarrel', turnDecision.kind === 'bet')
    if (turnDecision.kind !== 'bet') return
    if (turn.some((action) => action.kind === 'raise')) return
    const river = sortActions(hand, 'river')
    const riverDecision = firstAction(river, participant.id)
    if (riverDecision && (riverDecision.kind === 'check' || riverDecision.kind === 'bet')) addStat(stats, 'riverBarrel', riverDecision.kind === 'bet')
  }
}

function scoreGeneralBet(hand: Hand, playerId: string, street: Street, stats: PlayerStats, key: PostflopStatKey): void {
  const actions = sortActions(hand, street)
  const participant = hand.participants.find((item) => item.playerId === playerId)
  if (!participant) return
  const decision = firstAction(actions, participant.id)
  if (!decision || (decision.kind !== 'check' && decision.kind !== 'bet')) return
  addStat(stats, key, decision.kind === 'bet')
}

function scoreDefence(hand: Hand, playerId: string, stats: PlayerStats): void {
  const flopTarget = cBetTarget(hand, 'flop')
  const turnTarget = barrelTarget(hand, 'turn')
  const flopBetTarget = firstBetAndResponders(hand, 'flop')
  const riverTarget = firstBetAndResponders(hand, 'river')
  const player = hand.participants.find((item) => item.playerId === playerId)
  if (!player) return

  if (flopTarget.bet && flopTarget.bet.participantId !== player.id) {
    const response = flopTarget.responses.find((action) => action.participantId === player.id)
    if (response && (response.kind === 'fold' || response.kind === 'call' || response.kind === 'raise')) {
      addStat(stats, 'foldToFlopCBet', response.kind === 'fold')
      addStat(stats, 'callFlopBet', response.kind === 'call')
    }
  }
  // Call Flop Bet은 C-Bet에 한정하지 않고 플랍 최초 Bet 전체를 대상으로 한다.
  if (flopBetTarget.bet && flopBetTarget.bet.participantId !== player.id && flopBetTarget.bet.id !== flopTarget.bet?.id) {
    const response = flopBetTarget.responses.find((action) => action.participantId === player.id)
    if (response && (response.kind === 'fold' || response.kind === 'call' || response.kind === 'raise')) addStat(stats, 'callFlopBet', response.kind === 'call')
  }
  if (turnTarget.bet && turnTarget.bet.participantId !== player.id) {
    const response = turnTarget.responses.find((action) => action.participantId === player.id)
    if (response && (response.kind === 'fold' || response.kind === 'call' || response.kind === 'raise')) addStat(stats, 'foldToTurnCBet', response.kind === 'fold')
  }
  if (riverTarget.bet && riverTarget.bet.participantId !== player.id) {
    const response = riverTarget.responses.find((action) => action.participantId === player.id)
    if (response && (response.kind === 'fold' || response.kind === 'call' || response.kind === 'raise')) addStat(stats, 'foldToRiverBet', response.kind === 'fold')
  }

  const flop = sortActions(hand, 'flop')
  const first = firstAction(flop, player.id)
  if (first?.kind === 'check') {
    const later = flop.find((action) => action.participantId === player.id && action.sequence > first.sequence)
    if (later?.kind === 'raise') addStat(stats, 'flopCheckRaise', true)
    else if (later && (later.kind === 'call' || later.kind === 'fold')) addStat(stats, 'flopCheckRaise', false)
  }
}

/** 플레이어 통계 집계: Completed 원본 핸드만 매번 계산하며 Draft는 분모에 넣지 않는다. */
export function computePlayerStats(hands: Hand[], playerId: string, tournamentId?: string): PlayerStats {
  const stats = blankStats()
  const completed = hands.filter((hand) => hand.status === 'completed' && (!tournamentId || hand.tournamentId === tournamentId))
  for (const hand of completed) {
    const participant = hand.participants.find((item) => item.playerId === playerId)
    if (!participant) continue
    stats.hands += 1
    const preflop = sortActions(hand, 'preflop')
    const first = firstAction(preflop, participant.id)
    if (first) {
      stats.vpip.denominator += 1
      if (first.kind === 'call' || first.kind === 'raise' || first.kind === 'bet') stats.vpip.numerator += 1
      stats.pfr.denominator += 1
      if (first.kind === 'raise' || first.kind === 'bet') stats.pfr.numerator += 1
    }
    const firstRaise = firstPreflopRaise(preflop)
    if (firstRaise && first && first.sequence > firstRaise.sequence) {
      stats.threeBet.denominator += 1
      if (first.kind === 'raise') stats.threeBet.numerator += 1
    }
    scoreCBet(hand, playerId, stats)
    scoreDefence(hand, playerId, stats)
    scoreGeneralBet(hand, playerId, 'flop', stats, 'flopBet')
    scoreGeneralBet(hand, playerId, 'turn', stats, 'turnBet')
    scoreGeneralBet(hand, playerId, 'river', stats, 'riverBet')
  }
  return stats
}

/** 여러 범위의 통계 병합: 이번 토너먼트/전체 누적을 분자·분모 합산으로 표시한다. */
export function mergeStats(statsList: PlayerStats[]): PlayerStats {
  const merged = blankStats()
  for (const stats of statsList) {
    merged.hands += stats.hands
    merged.vpip.numerator += stats.vpip.numerator
    merged.vpip.denominator += stats.vpip.denominator
    merged.pfr.numerator += stats.pfr.numerator
    merged.pfr.denominator += stats.pfr.denominator
    merged.threeBet.numerator += stats.threeBet.numerator
    merged.threeBet.denominator += stats.threeBet.denominator
    for (const key of POSTFLOP_KEYS) {
      merged.postflop[key].numerator += stats.postflop[key].numerator
      merged.postflop[key].denominator += stats.postflop[key].denominator
    }
  }
  return merged
}

/** 통계 키 설명: 상세 탭에서 사용자에게 표시할 짧은 한국어 설명이다. */
export const POSTFLOP_STAT_LABELS: Record<PostflopStatKey, { label: string; description: string }> = {
  flopCBet: { label: 'Flop C-Bet', description: '프리플랍 공격자의 플랍 첫 베팅' },
  turnBarrel: { label: 'Turn Barrel', description: '플랍 C-Bet 이후 턴 연속 베팅' },
  riverBarrel: { label: 'River Barrel', description: '턴 Barrel 이후 리버 연속 베팅' },
  flopCheckRaise: { label: 'Flop Check-Raise', description: '플랍 체크 후 레이즈' },
  foldToFlopCBet: { label: 'Fold to Flop C-Bet', description: '플랍 C-Bet에 폴드' },
  foldToTurnCBet: { label: 'Fold to Turn C-Bet', description: '턴 Barrel에 폴드' },
  foldToRiverBet: { label: 'Fold to River Bet', description: '리버 최초 베팅에 폴드' },
  callFlopBet: { label: 'Call Flop Bet', description: '플랍 최초 베팅에 콜' },
  flopBet: { label: 'Flop Bet', description: '플랍 첫 선택이 베팅' },
  turnBet: { label: 'Turn Bet', description: '턴 첫 선택이 베팅' },
  riverBet: { label: 'River Bet', description: '리버 첫 선택이 베팅' },
}

/** actionKindLabel: 액션 이력의 기계값을 짧은 화면용 라벨로 바꾼다. */
export function actionKindLabel(kind: ActionKind): string {
  return ({ fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise' })[kind]
}
