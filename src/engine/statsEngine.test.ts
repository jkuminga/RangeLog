import { describe, expect, it } from 'vitest'
import { computePlayerStats, mergeStats } from './statsEngine'
import { createHand } from './handEngine'
import type { Hand } from '../types'

function hand(status: 'draft' | 'completed', id: string, p4Kind: 'raise' | 'fold'): Hand {
  const result = createHand({
    accountId: 'a', tournamentId: 't', tableSessionId: 's', seatCount: 6, buttonSeat: 1,
    occupiedSeats: [1, 2, 3, 4, 5, 6].map((seatNo) => ({ seatNo, playerId: `p${seatNo}` })),
    blindSnapshot: { smallBlindBB: .5, bigBlindBB: 1, anteEnabled: false, anteBB: 1 },
  })
  const p4 = result.participants.find((participant) => participant.seatNo === 4)!
  const p3 = result.participants.find((participant) => participant.seatNo === 3)!
  return {
    ...result,
    id,
    status,
    actionComplete: true,
    actions: [
      { id: `${id}-0`, participantId: p4.id, street: 'preflop', kind: p4Kind, isAllIn: false, inferred: false, sequence: 0, createdAt: result.startedAt },
      { id: `${id}-1`, participantId: p3.id, street: 'preflop', kind: 'call', isAllIn: false, inferred: false, sequence: 1, createdAt: result.startedAt },
      { id: `${id}-2`, participantId: p4.id, street: 'flop', kind: 'bet', isAllIn: false, inferred: false, sequence: 2, createdAt: result.startedAt },
      { id: `${id}-3`, participantId: p3.id, street: 'flop', kind: 'fold', isAllIn: false, inferred: false, sequence: 3, createdAt: result.startedAt },
    ],
  }
}

describe('stats engine', () => {
  it('excludes Draft and uses completed action observations as denominators', () => {
    const completed = hand('completed', 'completed', 'raise')
    const draft = hand('draft', 'draft', 'fold')
    const stats = computePlayerStats([completed, draft], 'p4')
    expect(stats.hands).toBe(1)
    expect(stats.vpip).toEqual({ numerator: 1, denominator: 1 })
    expect(stats.pfr).toEqual({ numerator: 1, denominator: 1 })
    expect(stats.postflop.flopCBet).toEqual({ numerator: 1, denominator: 1 })
  })

  it('merges numerator and denominator instead of averaging percentages', () => {
    const a = hand('completed', 'a', 'raise')
    const b = hand('completed', 'b', 'fold')
    const merged = mergeStats([computePlayerStats([a], 'p4'), computePlayerStats([b], 'p4')])
    expect(merged.vpip).toEqual({ numerator: 1, denominator: 2 })
    expect(merged.pfr).toEqual({ numerator: 1, denominator: 2 })
  })
})
