import { describe, expect, it } from 'vitest'
import { applyAction, calculateCurrentPot, createHand, deriveHandState, editAction, getActionOrder } from './handEngine'
import type { Hand } from '../types'

function makeHand(): Hand {
  return createHand({
    accountId: 'account',
    tournamentId: 'tournament',
    tableSessionId: 'table',
    seatCount: 6,
    occupiedSeats: [1, 2, 3, 4, 5, 6].map((seatNo) => ({ seatNo, playerId: `player-${seatNo}` })),
    buttonSeat: 1,
    blindSnapshot: { smallBlindBB: 0.5, bigBlindBB: 1, anteEnabled: false, anteBB: 1 },
  })
}

function participantAt(hand: Hand, seatNo: number): string {
  return hand.participants.find((participant) => participant.seatNo === seatNo)!.id
}

describe('hand state engine', () => {
  it('keeps physical seats and calculates preflop order from BTN', () => {
    const hand = makeHand()
    const order = getActionOrder(hand, 'preflop').map((id) => hand.participants.find((participant) => participant.id === id)!.seatNo)
    expect(order).toEqual([4, 5, 6, 1, 2, 3])
    expect(hand.participants.find((participant) => participant.seatNo === 6)?.position).toBe('CO')
  })

  it('infers skipped preflop seats as Fold and advances to flop after responses', () => {
    let hand = makeHand()
    hand = applyAction(hand, { participantId: participantAt(hand, 6), kind: 'raise', amountBB: 2 })
    expect(hand.actions.slice(0, 2).map((action) => action.kind)).toEqual(['fold', 'fold'])
    expect(hand.actions.slice(0, 2).every((action) => action.inferred)).toBe(true)
    hand = applyAction(hand, { participantId: participantAt(hand, 3), kind: 'call', amountBB: 2 })
    expect(hand.actions.filter((action) => action.inferred).map((action) => action.participantId)).toHaveLength(4)
    expect(hand.currentStreet).toBe('flop')
    expect(deriveHandState(hand).unresolvedParticipantIds).toHaveLength(2)
  })

  it('calculates a normal Call as the additional amount after blinds', () => {
    let hand = makeHand()
    hand = applyAction(hand, { participantId: participantAt(hand, 6), kind: 'raise', amountBB: 2 })
    hand = applyAction(hand, { participantId: participantAt(hand, 3), kind: 'call' })
    const call = hand.actions.at(-1)!
    expect(call.amountBB).toBe(1)
    expect(calculateCurrentPot(hand)).toBe(4.5)
  })

  it('infers postflop checks, but does not auto-fold untouched players without a later explicit action', () => {
    let hand = makeHand()
    hand = applyAction(hand, { participantId: participantAt(hand, 6), kind: 'raise' })
    hand = applyAction(hand, { participantId: participantAt(hand, 3), kind: 'call' })
    // This is intentionally incomplete: a player did not explicitly provide the next street action.
    expect(hand.currentStreet).toBe('flop')
    expect(hand.actions.filter((action) => action.street === 'flop')).toHaveLength(0)
    hand = applyAction(hand, { participantId: participantAt(hand, 6), kind: 'bet', amountBB: 2 })
    expect(hand.actions.filter((action) => action.street === 'flop').map((action) => action.kind)).toEqual(['check', 'bet'])
  })

  it('clears later actions when action meaning changes and keeps cards intact', () => {
    let hand = makeHand()
    hand = applyAction(hand, { participantId: participantAt(hand, 4), kind: 'fold' })
    const actionId = hand.actions[0].id
    hand = { ...hand, board: { ...hand.board, flop: ['As', null, null] }, participants: hand.participants.map((participant) => participant.id === participantAt(hand, 4) ? { ...participant, holeCards: ['Kh', null] } : participant) }
    hand = editAction(hand, actionId, { kind: 'check' })
    expect(hand.actions).toHaveLength(1)
    expect(hand.actions[0].kind).toBe('check')
    expect(hand.board.flop[0]).toBe('As')
    expect(hand.participants.find((participant) => participant.id === participantAt(hand, 4))?.holeCards[0]).toBe('Kh')
  })
})
