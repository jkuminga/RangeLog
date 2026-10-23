import { useMemo, useState } from 'react'
import { actionKindLabel } from '../engine/statsEngine'
import { applyAction, calculateCurrentPot, deriveHandState, editAction, updateCards, type ActionInput } from '../engine/handEngine'
import type { Card, Hand, HandAction, Player, Street } from '../types'
import { formatBB } from '../lib/format'
import { ActionPopup } from './ActionPopup'
import { CardPicker } from './CardPicker'
import { TableBoard } from './TableBoard'

interface HandEditorProps {
  hand: Hand
  players: Player[]
  allHands: Hand[]
  tournamentId: string
  session: import('../types').TableSession
  seats: import('../types').SeatAssignment[]
  onChange: (hand: Hand) => void
  onSave: () => void
  onDiscard: () => void
  onExit: () => void
}

type CardTarget = { type: 'board'; street: Exclude<Street, 'preflop'> } | { type: 'hole'; participantId: string }

function cardText(card: Card | null): string {
  if (!card) return '+'
  const symbols: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' }
  return `${card[0]}${symbols[card[1]]}`
}

/** ActionEditModal: 히스토리의 액션 종류/All-in/금액을 같은 편집 흐름에서 수정한다. */
function ActionEditModal({ action, onClose, onSave }: { action: HandAction; onClose: () => void; onSave: (patch: Partial<Pick<HandAction, 'kind' | 'isAllIn' | 'amountBB'>>) => void }) {
  const [kind, setKind] = useState(action.kind)
  const [isAllIn, setIsAllIn] = useState(action.isAllIn)
  const [amount, setAmount] = useState(action.amountBB?.toString() ?? '')
  const changedMeaning = kind !== action.kind || isAllIn !== action.isAllIn
  return <div className="modal-backdrop"><section className="edit-modal" role="dialog" aria-modal="true"><div className="modal-head"><div><strong>액션 수정</strong><small>{action.inferred ? '자동 추론된 액션' : '직접 입력된 액션'}</small></div><button className="icon-button" onClick={onClose}>×</button></div><div className="edit-action-grid">{(['fold', 'check', 'call', 'bet', 'raise'] as const).map((item) => <button key={item} className={kind === item ? 'selected' : ''} onClick={() => setKind(item)}>{actionKindLabel(item)}</button>)}</div><label className="check-row"><input type="checkbox" checked={isAllIn} onChange={(event) => setIsAllIn(event.target.checked)} /> All-in</label><label className="field-label">투입/최종 금액 BB<input inputMode="decimal" value={amount} placeholder="미입력" onChange={(event) => setAmount(event.target.value)} /></label>{changedMeaning && <p className="warning">액션 의미가 바뀌면 이 지점 이후의 후속 액션을 초기화하고 다시 진행합니다.</p>}<div className="modal-actions"><button className="secondary-button" onClick={onClose}>취소</button><button className="primary-button" onClick={() => { const parsed = amount === '' ? undefined : Number(amount); onSave({ kind, isAllIn, amountBB: parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined }) }}>저장</button></div></section></div>
}

/** HandEditor: 상단 이력·테이블 좌석·보드/홀카드·팟·수동 저장을 하나의 등록 화면으로 묶는다. */
export function HandEditor({ hand, players, allHands, tournamentId, session, seats, onChange, onSave, onDiscard, onExit }: HandEditorProps) {
  const [selectedParticipantId, setSelectedParticipantId] = useState<string>()
  const [editActionTarget, setEditActionTarget] = useState<HandAction>()
  const [cardTarget, setCardTarget] = useState<CardTarget>()
  const [message, setMessage] = useState<string>()
  const state = deriveHandState(hand)
  const playerMap = new Map(players.map((player) => [player.id, player]))
  const selectedParticipant = hand.participants.find((item) => item.id === selectedParticipantId)
  const selectedPlayer = selectedParticipant ? playerMap.get(selectedParticipant.playerId) : undefined
  const allCards = [
    ...hand.board.flop,
    ...hand.board.turn,
    ...hand.board.river,
    ...hand.participants.flatMap((participant) => participant.holeCards),
  ]
  const unavailableCards = allCards.filter((card): card is Card => card !== null && !((cardTarget?.type === 'board' && hand.board[cardTarget.street].includes(card)) || (cardTarget?.type === 'hole' && hand.participants.find((item) => item.id === cardTarget.participantId)?.holeCards.includes(card))))

  const pickerInitial = useMemo<Array<Card | null>>(() => {
    if (!cardTarget) return []
    if (cardTarget.type === 'hole') return hand.participants.find((participant) => participant.id === cardTarget.participantId)?.holeCards ?? [null, null]
    return hand.board[cardTarget.street]
  }, [cardTarget, hand])

  const handleApply = (input: ActionInput) => {
    try {
      onChange(applyAction(hand, input))
      setSelectedParticipantId(undefined)
      setMessage(undefined)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '액션을 등록할 수 없습니다.')
    }
  }

  const handleSeat = (seat: import('../types').SeatAssignment) => {
    const participant = hand.participants.find((item) => item.seatNo === seat.seatNo)
    if (participant) setSelectedParticipantId(participant.id)
  }

  const confirmCards = (cards: Array<Card | null>) => {
    if (!cardTarget) return
    if (cardTarget.type === 'hole') onChange(updateCards(hand, { participantId: cardTarget.participantId, holeCards: cards as [Card | null, Card | null] }))
    else onChange(updateCards(hand, { board: { ...hand.board, [cardTarget.street]: cards } as Hand['board'] }))
    setCardTarget(undefined)
  }

  const setCheckpoint = (value: string) => {
    if (hand.currentStreet === 'preflop') return
    const parsed = value === '' ? undefined : Number(value)
    const amountBB = parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined
    const checkpoints = hand.potCheckpoints.filter((item) => item.street !== hand.currentStreet)
    onChange({ ...hand, potCheckpoints: [...checkpoints, { street: hand.currentStreet, amountBB }], updatedAt: new Date().toISOString(), revision: hand.revision + 1 })
  }

  return <div className="hand-editor">
    <div className="editor-topbar"><button className="text-button" onClick={onExit}>‹ 테이블</button><div><strong>핸드 등록</strong><small>{hand.draftKind === 'edit' ? 'Completed 편집본' : '자동 Draft 보존'}</small></div><div className="editor-actions"><span className={`sync-pill ${hand.status}`}>{hand.status === 'completed' ? '완료' : 'Draft'}</span><button className="icon-button" onClick={() => { if (window.confirm('이 핸드 기록을 폐기할까요?')) onDiscard() }}>⋯</button></div></div>
    <div className="history-bar" aria-label="액션 히스토리"><div className="history-caption">HISTORY</div>{hand.actions.length === 0 ? <span className="history-empty">좌석을 탭해 첫 액션을 기록하세요</span> : hand.actions.map((action) => { const p = hand.participants.find((item) => item.id === action.participantId); return <button key={action.id} className={`history-chip ${action.inferred ? 'inferred' : ''}`} onClick={() => setEditActionTarget(action)}><b>{p?.position ?? '?'}</b> {actionKindLabel(action.kind)}{action.isAllIn ? ' AI' : ''}{action.amountBB !== undefined ? ` ${action.amountBB}BB` : ''}{action.inferred ? ' ·' : ''}</button> })}</div>
    <div className="editor-status"><span className="street-pill">{state.street.toUpperCase()}</span><span>{state.actionComplete ? '액션 종료 · 저장할 수 있습니다' : `${state.unresolvedParticipantIds.length}명 액션 대기`}</span><span className="pot-label">Current Pot <b>{formatBB(calculateCurrentPot(hand))}</b></span></div>
    <div className="board-editor"><div className="board-head"><strong>보드 / 팟</strong><small>카드 그룹을 탭해 부분 입력</small></div><div className="board-groups">{(['flop', 'turn', 'river'] as const).map((street) => <button key={street} onClick={() => setCardTarget({ type: 'board', street })}><span>{street.toUpperCase()}</span><b>{hand.board[street].map((card, index) => <em key={index}>{cardText(card)}</em>)}</b></button>)}</div><label className="checkpoint-input">{hand.currentStreet === 'preflop' ? 'Flop 진입 후 Pot Checkpoint를 입력할 수 있습니다' : `${hand.currentStreet.toUpperCase()} 시작 Pot Checkpoint (BB)`}<input disabled={hand.currentStreet === 'preflop'} inputMode="decimal" value={hand.potCheckpoints.find((item) => item.street === hand.currentStreet)?.amountBB ?? ''} placeholder="자동 계산" onChange={(event) => setCheckpoint(event.target.value)} /></label></div>
    <TableBoard session={session} seats={seats} players={players} hands={allHands} tournamentId={tournamentId} hand={hand} mode="hand" onSeatClick={handleSeat} />
    <div className="editor-bottom"><div><span className="next-label">{state.actionComplete ? '기록 검토 후' : '다음 액션은 좌석 탭으로'} </span><strong>{state.actionComplete ? '저장 완료' : '관측된 플레이어를 선택'}</strong></div><div className="bottom-actions"><button className="secondary-button" onClick={onDiscard}>기록 폐기</button><button className="primary-button" disabled={!state.actionComplete} onClick={onSave}>저장 완료</button></div></div>
    {message && <div className="inline-error">{message}</div>}
    {selectedParticipant && <ActionPopup hand={hand} participant={selectedParticipant} player={selectedPlayer} onClose={() => setSelectedParticipantId(undefined)} onApply={handleApply} onOpenCards={() => setCardTarget({ type: 'hole', participantId: selectedParticipant.id })} />}
    {editActionTarget && <ActionEditModal action={editActionTarget} onClose={() => setEditActionTarget(undefined)} onSave={(patch) => { try { onChange(editAction(hand, editActionTarget.id, patch)); setEditActionTarget(undefined) } catch (error) { setMessage(error instanceof Error ? error.message : '액션을 수정할 수 없습니다.') } }} />}
    {cardTarget && <CardPicker title={cardTarget.type === 'hole' ? `${selectedPlayer?.name ?? '플레이어'} 홀카드` : `${cardTarget.street.toUpperCase()} 보드`} max={cardTarget.type === 'hole' ? 2 : cardTarget.street === 'flop' ? 3 : 1} initial={pickerInitial} unavailable={unavailableCards} onCancel={() => setCardTarget(undefined)} onConfirm={confirmCards} />}
  </div>
}
