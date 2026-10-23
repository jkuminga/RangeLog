import type { Hand, Player, SeatAssignment, TableSession } from '../types'
import { computePlayerStats } from '../engine/statsEngine'
import { formatPercent } from '../lib/format'

interface TableBoardProps {
  session: TableSession
  seats: SeatAssignment[]
  players: Player[]
  hands: Hand[]
  tournamentId: string
  hand?: Hand
  mode: 'table' | 'seats' | 'hand'
  buttonPicking?: boolean
  onSeatClick: (seat: SeatAssignment) => void
  onPlayerClick?: (player: Player) => void
}

/** TableBoard: 물리 좌석 번호를 고정하고 빈자리를 당기지 않는 모바일 테이블 표현이다. */
export function TableBoard({ session, seats, players, hands, tournamentId, hand, mode, buttonPicking, onSeatClick, onPlayerClick }: TableBoardProps) {
  const seatMap = new Map(seats.filter((seat) => seat.tableSessionId === session.id).map((seat) => [seat.seatNo, seat]))
  const playerMap = new Map(players.map((player) => [player.id, player]))
  const handParticipantBySeat = new Map(hand?.participants.map((participant) => [participant.seatNo, participant]) ?? [])
  const compactLayout = typeof window !== 'undefined' && window.matchMedia('(max-width: 650px)').matches
  const positions = Array.from({ length: session.seatCount }, (_, index) => {
    const angle = -90 + (index * 360 / session.seatCount)
    const radians = angle * Math.PI / 180
    // 좌석 카드의 중심을 펠트 외곽 레일 바깥에 배치하기 위한 타원 반경(%)이다.
    const seatRadiusX = compactLayout ? 34 : 43
    const seatRadiusY = compactLayout ? 40 : 41
    return {
      seatNo: index + 1,
      angle,
      left: 50 + Math.cos(radians) * seatRadiusX,
      top: 50 + Math.sin(radians) * seatRadiusY,
    }
  })
  return (
    <div className={`table-wrap ${mode === 'hand' ? 'registering' : ''}`}>
      <div className="table-stage">
        <div className="felt-table">
          <div className="table-rail-copy" aria-hidden="true"><span>NO LIMIT</span><span>HOLD'EM</span></div>
          <div className="table-brand">RANGE<span>LOG</span><small>{mode === 'hand' ? '핸드 등록' : buttonPicking ? 'BTN 좌석 선택' : '라이브 HUD'}</small></div>
          {mode === 'hand' && <div className="board-preview"><div><span>FLOP</span><b>{hand?.board.flop.map((card, index) => card ? <em key={index}>{card[0]}{card[1]}</em> : <i key={index}>+</i>)}</b></div><div><span>TURN</span><b>{hand?.board.turn.map((card, index) => card ? <em key={index}>{card[0]}{card[1]}</em> : <i key={index}>+</i>)}</b></div><div><span>RIVER</span><b>{hand?.board.river.map((card, index) => card ? <em key={index}>{card[0]}{card[1]}</em> : <i key={index}>+</i>)}</b></div></div>}
        </div>
        {positions.map(({ seatNo, angle, left, top }) => {
          const seat = seatMap.get(seatNo) ?? { id: `empty-${seatNo}`, tableSessionId: session.id, seatNo, startedAt: '' }
          const player = seat.playerId ? playerMap.get(seat.playerId) : undefined
          const participant = handParticipantBySeat.get(seatNo)
          const stats = player ? computePlayerStats(hands, player.id, tournamentId) : undefined
          const isButton = hand?.buttonSeat === seatNo
          return <button key={seatNo} className={`seat-card ${player ? 'occupied' : 'empty'} ${isButton ? 'button-seat' : ''} ${participant && hand?.actions.some((action) => action.participantId === participant.id) ? 'acted' : ''}`} style={{ '--seat-angle': `${angle}deg`, '--seat-left': `${left}%`, '--seat-top': `${top}%` } as React.CSSProperties} onClick={() => onSeatClick(seat)}>
            <span className="seat-number">{seatNo}{isButton && <b>BTN</b>}</span>
            {player ? <><div className="avatar">{player.name.slice(0, 1)}</div><strong onClick={(event) => { event.stopPropagation(); onPlayerClick?.(player) }}>{player.name}</strong>{mode !== 'seats' && <div className="hud"><span>VPIP <b>{stats ? formatPercent(stats.vpip.numerator, stats.vpip.denominator) : '–'}</b></span><span>PFR <b>{stats ? formatPercent(stats.pfr.numerator, stats.pfr.denominator) : '–'}</b></span><span>3B <b>{stats ? formatPercent(stats.threeBet.numerator, stats.threeBet.denominator) : '–'}</b></span></div>}</> : <span className="empty-seat">빈 좌석</span>}
          </button>
        })}
      </div>
    </div>
  )
}
