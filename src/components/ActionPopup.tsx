import { useMemo, useState } from 'react'
import { calculateCurrentPot, getActionOptions, type ActionInput } from '../engine/handEngine'
import type { Hand, HandParticipant, Player } from '../types'
import { formatBB } from '../lib/format'

interface ActionPopupProps {
  hand: Hand
  participant: HandParticipant
  player: Player | undefined
  onClose: () => void
  onApply: (input: ActionInput) => void
  onOpenCards: () => void
}

/** ActionPopup: 좌석 탭과 액션 히스토리 편집이 공유하는 모바일 액션 입력 컴포넌트다. */
export function ActionPopup({ hand, participant, player, onClose, onApply, onOpenCards }: ActionPopupProps) {
  const [sizeMode, setSizeMode] = useState<{ kind: 'bet' | 'raise'; isAllIn: boolean }>()
  const [amountBB, setAmountBB] = useState<number | undefined>()
  const [percentage, setPercentage] = useState<number | undefined>()
  const currentPot = calculateCurrentPot(hand)
  const options = useMemo(() => getActionOptions(hand, participant.id), [hand, participant.id])
  const currentActions = hand.actions.filter((action) => action.participantId === participant.id)

  const openSized = (kind: 'bet' | 'raise') => {
    setSizeMode({ kind, isAllIn: false })
    setAmountBB(undefined)
    setPercentage(undefined)
  }

  const applySize = () => {
    if (!sizeMode) return
    onApply({
      participantId: participant.id,
      kind: sizeMode.kind,
      isAllIn: sizeMode.isAllIn,
      amountBB,
      percentage,
      amountSource: amountBB === undefined && percentage === undefined ? 'unknown' : amountBB !== undefined ? 'bb' : 'percentage',
    })
  }

  const presets = hand.currentStreet === 'preflop' && sizeMode?.kind === 'raise' && !hand.actions.some((action) => action.street === 'preflop' && (action.kind === 'bet' || action.kind === 'raise'))
    ? [2, 2.5, 3, 4]
    : [25, 33, 50, 75, 100]

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="action-modal" role="dialog" aria-modal="true" aria-label={`${player?.name ?? '플레이어'} 액션`}>
        <div className="modal-head">
          <div className="player-profile">
            <div className="avatar large">{(player?.name ?? '?').slice(0, 1)}</div>
            <div>
              <strong>{player?.name ?? '알 수 없는 플레이어'}</strong>
              <small>{participant.position} · {player?.description || '설명 없음'}</small>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div className="mini-hud">
          <span>VPIP <b>–</b></span><span>PFR <b>–</b></span><span>3-Bet <b>–</b></span>
        </div>
        <div className="popup-context">{hand.currentStreet.toUpperCase()} · {formatBB(currentPot)} current pot</div>
        {!sizeMode ? (
          <>
            <div className="action-grid">
              {options.map((option, index) => (
                <button
                  key={`${option.label}-${index}`}
                  className={`action-button ${option.kind === 'fold' ? 'danger' : option.kind === 'raise' || option.kind === 'bet' ? 'accent' : ''}`}
                  onClick={() => option.withSize ? openSized(option.kind as 'bet' | 'raise') : onApply({ participantId: participant.id, kind: option.kind, isAllIn: option.isAllIn })}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="popup-footer">
              <button className="secondary-button" onClick={onOpenCards}>홀카드 {participant.holeCards.some(Boolean) ? '수정' : '입력'}</button>
              {currentActions.length > 0 && <small>{currentActions.length}개 액션 기록됨</small>}
            </div>
          </>
        ) : (
          <div className="size-panel">
            <div className="size-panel-title">
              <strong>{sizeMode.kind === 'bet' ? 'Bet' : 'Raise'} 사이즈</strong>
              <button className="text-button" onClick={() => setSizeMode(undefined)}>액션 선택으로</button>
            </div>
            <div className="preset-grid">
              {presets.map((value) => {
                const isBBPreset = hand.currentStreet === 'preflop' && presets.length === 4
                const calculated = isBBPreset ? value : currentPot === undefined ? undefined : Number((currentPot * value / 100).toFixed(2))
                return <button key={value} className={`preset ${percentage === value || amountBB === calculated ? 'selected' : ''}`} onClick={() => {
                  if (isBBPreset) { setAmountBB(value); setPercentage(undefined) } else { setPercentage(value); setAmountBB(calculated) }
                }}>
                  <b>{isBBPreset ? `${value}BB` : `${value}%`}</b>
                  {!isBBPreset && <small>{formatBB(calculated)}</small>}
                </button>
              })}
              <button className={`preset all-in ${sizeMode.isAllIn ? 'selected' : ''}`} onClick={() => { setSizeMode({ ...sizeMode, isAllIn: true }); setPercentage(undefined) }}>
                <b>All-in</b><small>금액 선택</small>
              </button>
            </div>
            <div className="bb-editor">
              <button className="round-button" disabled={amountBB === undefined} onClick={() => setAmountBB((amountBB ?? 0) - 0.5)}>−</button>
              <label>BB 직접 입력<input inputMode="decimal" value={amountBB ?? ''} placeholder="–" onChange={(event) => {
                const value = event.target.value === '' ? undefined : Number(event.target.value)
                setAmountBB(Number.isNaN(value) ? undefined : value)
                setPercentage(undefined)
              }} /></label>
              <button className="round-button" disabled={amountBB === undefined} onClick={() => setAmountBB((amountBB ?? 0) + 0.5)}>+</button>
            </div>
            <p className="hint">추천값은 임시 선택입니다. `확인`을 눌러야 액션이 등록됩니다.</p>
            <button className="primary-button full" onClick={applySize}>확인</button>
          </div>
        )}
      </section>
    </div>
  )
}
