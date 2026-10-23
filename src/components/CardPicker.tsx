import { useMemo, useState } from 'react'
import type { Card } from '../types'

const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const
const suits = ['s', 'h', 'd', 'c'] as const
const suitSymbols = { s: '♠', h: '♥', d: '♦', c: '♣' }

interface CardPickerProps {
  title: string
  max: number
  initial: Array<Card | null>
  unavailable: Card[]
  onConfirm: (cards: Array<Card | null>) => void
  onCancel: () => void
}

/** CardPicker: 52장 그리드에서 임시 선택 후 확인할 때만 카드 배열을 확정한다. */
export function CardPicker({ title, max, initial, unavailable, onConfirm, onCancel }: CardPickerProps) {
  const [selected, setSelected] = useState<Array<Card | null>>(initial)
  const usedElsewhere = useMemo(() => new Set(unavailable), [unavailable])
  const toggle = (card: Card) => {
    if (usedElsewhere.has(card) && !selected.includes(card)) return
    if (selected.includes(card)) setSelected(selected.map((item) => item === card ? null : item))
    else {
      const nextIndex = selected.findIndex((item) => item === null)
      if (nextIndex >= 0) setSelected(selected.map((item, index) => index === nextIndex ? card : item))
    }
  }
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="card-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><div><strong>{title}</strong><small>{selected.filter(Boolean).length}/{max}장 · 빈 슬롯은 미입력</small></div><button className="icon-button" onClick={onCancel}>×</button></div>
        <div className="selected-cards">{selected.map((card, index) => <span className="card-slot" key={index}>{card ? card[0] + suitSymbols[card[1] as keyof typeof suitSymbols] : '+'}</span>)}</div>
        <div className="card-grid">
          {ranks.flatMap((rank) => suits.map((suit) => {
            const card = `${rank}${suit}` as Card
            const chosen = selected.includes(card)
            const disabled = usedElsewhere.has(card) && !chosen
            return <button key={card} disabled={disabled} className={`playing-card suit-${suit} ${chosen ? 'chosen' : ''}`} onClick={() => toggle(card)}>{rank}{suitSymbols[suit]}</button>
          }))}
        </div>
        <div className="modal-actions"><button className="secondary-button" onClick={() => setSelected(Array.from({ length: max }, () => null))}>전체 해제</button><span /><button className="secondary-button" onClick={onCancel}>취소</button><button className="primary-button" onClick={() => onConfirm(selected)}>확인</button></div>
      </section>
    </div>
  )
}
