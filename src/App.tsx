import { useEffect, useState } from 'react'
import { createHand } from './engine/handEngine'
import { POSTFLOP_STAT_LABELS, computePlayerStats } from './engine/statsEngine'
import { formatPercent, formatRate } from './lib/format'
import { createId, nowIso } from './lib/ids'
import { CardPicker } from './components/CardPicker'
import { HandEditor } from './components/HandEditor'
import { TableBoard } from './components/TableBoard'
import { listDrafts, getDraft, deleteDraft, saveDraft, exportLocalDrafts, type LocalDraftRecord } from './storage/localDb'
import { downloadJson, loadWorkspace, saveWorkspace } from './storage/workspaceStore'
import { hasSupabase, supabase } from './storage/supabaseClient'
import { useDraftAutosave } from './hooks/useDraftAutosave'
import type { Hand, Player, SeatAssignment, TableSession, Tournament, Workspace } from './types'

const DEMO_ACCOUNT = 'local-demo-account'

function createInitialWorkspace(): Workspace {
  const createdAt = nowIso()
  const tournament: Tournament = { id: createId('tournament'), name: '오늘의 라이브 토너먼트', defaultSeatCount: 6, status: 'active', createdAt }
  const session: TableSession = { id: createId('table'), tournamentId: tournament.id, name: 'Table 1', seatCount: 6, createdAt }
  const players: Player[] = Array.from({ length: 6 }, (_, index) => ({ id: createId('player'), name: `Player ${index + 1}`, description: '관측 대상', tags: [], createdAt, firstObservedTournamentId: tournament.id }))
  const seats: SeatAssignment[] = players.map((player, index) => ({ id: createId('seat'), tableSessionId: session.id, seatNo: index + 1, playerId: player.id, startedAt: createdAt }))
  return { players, tournaments: [tournament], sessions: [session], seats, hands: [] }
}

function actionLabel(status: LocalDraftRecord['syncState']): string {
  return ({ 'local-saved': '기기에 저장됨·서버 미동기화', 'server-pending': '서버 동기화 대기', failed: '저장 실패', conflict: '충돌 확인 필요' })[status]
}

function StatCell({ label, description, current, overall }: { label: string; description?: string; current: { numerator: number; denominator: number }; overall: { numerator: number; denominator: number } }) {
  return <div className="stat-cell" title={description}><span>{label}</span><strong>{formatPercent(current.numerator, current.denominator)}</strong><small>이번 {current.numerator}/{current.denominator} · 전체 {formatPercent(overall.numerator, overall.denominator)} ({overall.numerator}/{overall.denominator})</small></div>
}

function PlayerDetail({ player, hands, tournamentId, onClose }: { player: Player; hands: Hand[]; tournamentId: string; onClose: () => void }) {
  const [tab, setTab] = useState<'preflop' | 'postflop'>('preflop')
  const current = computePlayerStats(hands, player.id, tournamentId)
  const overall = computePlayerStats(hands, player.id)
  return <div className="modal-backdrop"><section className="detail-modal" role="dialog" aria-modal="true"><div className="modal-head"><div className="player-profile"><div className="avatar large">{player.name.slice(0, 1)}</div><div><strong>{player.name}</strong><small>{player.description || '플레이어 설명 없음'}</small></div></div><button className="icon-button" onClick={onClose}>×</button></div><div className="detail-tabs"><button className={tab === 'preflop' ? 'active' : ''} onClick={() => setTab('preflop')}>Preflop</button><button className={tab === 'postflop' ? 'active' : ''} onClick={() => setTab('postflop')}>Postflop · 11 stats</button></div>{tab === 'preflop' ? <div className="range-table"><div className="range-row header"><span>범위</span><span>VPIP</span><span>PFR</span><span>3-Bet</span></div><div className="range-row"><strong>이번 토너먼트</strong><span>{formatRate(current.vpip.numerator, current.vpip.denominator)}</span><span>{formatRate(current.pfr.numerator, current.pfr.denominator)}</span><span>{formatRate(current.threeBet.numerator, current.threeBet.denominator)}</span></div><div className="range-row"><strong>전체 누적</strong><span>{formatRate(overall.vpip.numerator, overall.vpip.denominator)}</span><span>{formatRate(overall.pfr.numerator, overall.pfr.denominator)}</span><span>{formatRate(overall.threeBet.numerator, overall.threeBet.denominator)}</span></div></div> : <><div className="postflop-heading"><div><strong>Postflop 상세</strong><small>Completed 핸드만 집계 · 통계명에 마우스를 올리면 설명</small></div></div><div className="postflop-grid">{Object.entries(POSTFLOP_STAT_LABELS).map(([key, meta]) => <StatCell key={key} label={meta.label} description={meta.description} current={current.postflop[key as keyof typeof current.postflop]} overall={overall.postflop[key as keyof typeof overall.postflop]} />)}</div></>}</section></div>
}

function ReadonlyHand({ hand, players, onClose, onEdit }: { hand: Hand; players: Player[]; onClose: () => void; onEdit: () => void }) {
  const playerMap = new Map(players.map((player) => [player.id, player]))
  return <div className="modal-backdrop"><section className="detail-modal hand-detail" role="dialog" aria-modal="true"><div className="modal-head"><div><strong>완료 핸드 상세</strong><small>{new Date(hand.startedAt).toLocaleString('ko-KR')} · {hand.actions.length}개 액션</small></div><button className="icon-button" onClick={onClose}>×</button></div><div className="readonly-board"><span>Flop {hand.board.flop.map((card, index) => <b key={index}>{card ?? '+'}</b>)}</span><span>Turn {hand.board.turn.map((card, index) => <b key={index}>{card ?? '+'}</b>)}</span><span>River {hand.board.river.map((card, index) => <b key={index}>{card ?? '+'}</b>)}</span></div><div className="readonly-actions">{hand.actions.map((action) => <span key={action.id}>{playerMap.get(hand.participants.find((participant) => participant.id === action.participantId)?.playerId ?? '')?.name ?? '?'} · {action.kind}{action.isAllIn ? ' AI' : ''}</span>)}</div><div className="modal-actions"><button className="secondary-button" onClick={onClose}>닫기</button><button className="primary-button" onClick={onEdit}>수정하기</button></div></section></div>
}

/** App: RangeLog MVP의 로컬 우선 테이블·핸드·통계 화면을 조립하는 루트 컴포넌트다. */
export default function App() {
  const [accountId, setAccountId] = useState(DEMO_ACCOUNT)
  const [workspace, setWorkspace] = useState<Workspace>(() => loadWorkspace(DEMO_ACCOUNT) ?? createInitialWorkspace())
  const [mode, setMode] = useState<'table' | 'seats'>('table')
  const [activeHandId, setActiveHandId] = useState<string>()
  const [buttonPicking, setButtonPicking] = useState(false)
  const [selectedPlayer, setSelectedPlayer] = useState<Player>()
  const [selectedCompletedHand, setSelectedCompletedHand] = useState<Hand>()
  const [restores, setRestores] = useState<LocalDraftRecord[]>([])
  const [toast, setToast] = useState<string>()
  const [newPlayerName, setNewPlayerName] = useState('')
  const [isTournamentModalOpen, setTournamentModalOpen] = useState(false)
  const [tournamentName, setTournamentName] = useState('')
  const [tournamentSeatCount, setTournamentSeatCount] = useState('6')
  const [tournamentFormError, setTournamentFormError] = useState<string>()
  const [authReady, setAuthReady] = useState(false)
  const [authEmail, setAuthEmail] = useState<string>()

  const activeTournament = workspace.tournaments.find((tournament) => tournament.status === 'active') ?? workspace.tournaments[0]
  const activeSession = workspace.sessions.find((session) => session.tournamentId === activeTournament?.id) ?? workspace.sessions[0]
  const activeHand = workspace.hands.find((hand) => hand.id === activeHandId)
  const draftSyncState = useDraftAutosave(accountId, activeHand?.status === 'draft' ? activeHand : undefined)
  const activeSeats = workspace.seats.filter((seat) => seat.tableSessionId === activeSession?.id)
  const draftHands = workspace.hands.filter((hand) => hand.status === 'draft')
  const completedHands = workspace.hands.filter((hand) => hand.status === 'completed')

  useEffect(() => { saveWorkspace(accountId, workspace) }, [accountId, workspace])

  useEffect(() => {
    let cancelled = false
    void listDrafts(accountId).then((records) => { if (!cancelled) setRestores(records) }).catch(() => setRestores([]))
    return () => { cancelled = true }
  }, [accountId])

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return }
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user.id) { setAccountId(data.session.user.id); setAuthEmail(data.session.user.email ?? undefined) }
      setAuthReady(true)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id) { setAccountId(session.user.id); setAuthEmail(session.user.email ?? undefined) }
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  const updateWorkspace = (updater: (current: Workspace) => Workspace) => setWorkspace((current) => updater(current))
  const updateHand = (hand: Hand) => updateWorkspace((current) => ({ ...current, hands: current.hands.some((item) => item.id === hand.id) ? current.hands.map((item) => item.id === hand.id ? hand : item) : [...current.hands, hand] }))

  const startHand = (buttonSeat: number) => {
    if (!activeTournament || !activeSession) return
    const occupiedSeats = activeSeats.flatMap((seat) => seat.playerId ? [{ seatNo: seat.seatNo, playerId: seat.playerId }] : [])
    if (!occupiedSeats.some((seat) => seat.seatNo === buttonSeat)) { setToast('BTN은 플레이어가 앉은 좌석이어야 합니다.'); return }
    const hand = createHand({ accountId, tournamentId: activeTournament.id, tableSessionId: activeSession.id, seatCount: activeSession.seatCount, occupiedSeats, buttonSeat, blindSnapshot: { smallBlindBB: 0.5, bigBlindBB: 1, anteEnabled: false, anteBB: 1 } })
    updateHand(hand)
    setActiveHandId(hand.id)
    setButtonPicking(false)
    setMode('table')
  }

  const handleSeatClick = (seat: SeatAssignment) => {
    if (buttonPicking) { if (seat.playerId) startHand(seat.seatNo); return }
    if (mode === 'seats') return
    if (mode === 'table' && seat.playerId) setSelectedPlayer(workspace.players.find((player) => player.id === seat.playerId))
  }

  const addPlayer = () => {
    const name = newPlayerName.trim()
    if (!name) return
    const player: Player = { id: createId('player'), name, description: '새 관측 대상', tags: [], createdAt: nowIso(), firstObservedTournamentId: activeTournament?.id }
    updateWorkspace((current) => ({ ...current, players: [...current.players, player] }))
    setNewPlayerName('')
  }

  const clearSeat = (seatId: string) => updateWorkspace((current) => ({ ...current, seats: current.seats.map((seat) => seat.id === seatId ? { ...seat, playerId: undefined } : seat) }))

  const updateActiveHand = (hand: Hand) => updateHand(hand)
  const saveCompleted = async () => {
    if (!activeHand) return
    if (activeHand.draftKind === 'new') {
      if (!activeHand.actionComplete) { setToast('액션 종료 전에는 저장 완료할 수 없습니다.'); return }
      const completed = { ...activeHand, status: 'completed' as const, updatedAt: nowIso(), revision: activeHand.revision + 1 }
      try { await saveDraft({ id: completed.id, accountId, hand: completed, savedAt: nowIso(), syncState: 'local-saved', pendingCompletion: true }) } catch { setToast('완료 대기 저장에 실패했습니다. 입력을 유지한 채 다시 시도하세요.'); return }
      updateHand(completed)
      setActiveHandId(undefined)
      setToast('완료 전송 대기로 보존했습니다. 로컬 HUD에는 서버 확인 전까지 반영하지 않습니다.')
    } else {
      const original = workspace.hands.find((item) => item.id === activeHand.originalHandId)
      if (!original || !activeHand.actionComplete) { setToast('편집본 액션을 완료한 뒤 저장하세요.'); return }
      const completed = { ...activeHand, id: original.id, status: 'completed' as const, draftKind: 'new' as const, originalHandId: undefined, updatedAt: nowIso(), revision: original.revision + 1 }
      updateWorkspace((current) => ({ ...current, hands: [...current.hands.filter((item) => item.id !== activeHand.id && item.id !== original.id), completed] }))
      await deleteDraft(activeHand.id).catch(() => undefined)
      setActiveHandId(undefined)
      setToast('편집 완료: 원본 핸드와 HUD를 갱신했습니다.')
    }
  }

  const discardActive = async () => {
    if (!activeHand) return
    updateWorkspace((current) => ({ ...current, hands: current.hands.filter((item) => item.id !== activeHand.id) }))
    await deleteDraft(activeHand.id).catch(() => undefined)
    setActiveHandId(undefined)
    setToast('핸드 기록을 폐기했습니다.')
  }

  const resumeDraft = async (record: LocalDraftRecord) => {
    const local = await getDraft(record.id).catch(() => undefined)
    const hand = local?.hand ?? record.hand
    updateHand(hand)
    setActiveHandId(hand.id)
    setMode('table')
    setRestores((current) => current.filter((item) => item.id !== record.id))
  }

  const editCompleted = (hand: Hand) => {
    const editDraft: Hand = { ...hand, id: createId('edit'), status: 'draft', draftKind: 'edit', originalHandId: hand.id, updatedAt: nowIso(), revision: hand.revision }
    updateHand(editDraft)
    setSelectedCompletedHand(undefined)
    setActiveHandId(editDraft.id)
  }

  /** openTournamentModal: 새 토너먼트의 이름과 기본 좌석 수를 한 모달에서 입력하도록 초기화한다. */
  const openTournamentModal = () => {
    setTournamentName(`토너먼트 ${workspace.tournaments.length + 1}`)
    setTournamentSeatCount('6')
    setTournamentFormError(undefined)
    setTournamentModalOpen(true)
  }

  /** createTournament: 입력한 이름과 기본 좌석 수로 활성 토너먼트와 첫 테이블 세션을 생성한다. */
  const createTournament = () => {
    const name = tournamentName.trim()
    const seatCount = Number(tournamentSeatCount)
    if (!name) { setTournamentFormError('토너먼트 이름을 입력하세요.'); return }
    if (!Number.isInteger(seatCount) || seatCount < 2 || seatCount > 10) { setTournamentFormError('좌석 수는 2~10 사이의 정수여야 합니다.'); return }
    const tournament: Tournament = { id: createId('tournament'), name, defaultSeatCount: seatCount, status: 'active', createdAt: nowIso() }
    const session: TableSession = { id: createId('table'), tournamentId: tournament.id, name: 'Table 1', seatCount, createdAt: nowIso() }
    const seats: SeatAssignment[] = Array.from({ length: seatCount }, (_, index) => ({ id: createId('seat'), tableSessionId: session.id, seatNo: index + 1, startedAt: nowIso() }))
    updateWorkspace((current) => ({ ...current, tournaments: [...current.tournaments.map((item) => item.status === 'active' ? { ...item, status: 'completed' as const, completedAt: nowIso() } : item), tournament], sessions: [...current.sessions, session], seats: [...current.seats, ...seats] }))
    setTournamentModalOpen(false)
    setToast(`${name} 토너먼트를 만들었습니다.`)
  }

  const exportAll = async () => {
    const localDrafts = await exportLocalDrafts(accountId).catch(() => [])
    downloadJson(`rangelog-backup-${new Date().toISOString().slice(0, 10)}.json`, { schemaVersion: 1, exportedAt: nowIso(), accountId, workspace, localDrafts })
  }

  if (!authReady) return <div className="loading-screen">RangeLog 불러오는 중…</div>
  if (activeHand) return <HandEditor hand={activeHand} players={workspace.players} allHands={workspace.hands} tournamentId={activeTournament?.id ?? ''} session={activeSession} seats={activeSeats} onChange={updateActiveHand} onSave={() => void saveCompleted()} onDiscard={() => void discardActive()} onExit={() => setActiveHandId(undefined)} />

  return <div className="app-shell">
    <header className="app-header"><div className="brand-mark">RANGE<span>LOG</span><small>LIVE OBSERVATION</small></div><div className="header-actions"><span className="account-badge">{hasSupabase() ? (authEmail ?? '로그인 필요') : '로컬 데모'}</span>{hasSupabase() && <button className="text-button" onClick={() => void supabase?.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })}>Google 로그인</button>}<button className="icon-button" title="JSON 백업" onClick={() => void exportAll()}>↓</button></div></header>
    <main className="main-content">
      <section className="context-bar"><div><span className="eyebrow">ACTIVE TOURNAMENT</span><h1>{activeTournament?.name ?? '토너먼트 없음'}</h1><p>{activeSession?.name ?? '테이블 없음'} · {activeSession?.seatCount ?? 0} seats · {completedHands.length} completed hands</p></div><div className="context-actions"><button className="secondary-button" onClick={openTournamentModal}>새 토너먼트</button><button className="primary-button" onClick={() => { setButtonPicking(true); setMode('table') }}>+ 새 핸드</button></div></section>
      {restores.length > 0 && <section className="restore-banner"><div><strong>복원 가능한 Draft {restores.length}개</strong><small>IndexedDB에 저장된 미완성 입력입니다. 선택해서 이어서 기록하세요.</small></div><div className="restore-list">{restores.slice(0, 3).map((record) => <button key={record.id} onClick={() => void resumeDraft(record)}>{record.hand.draftKind === 'edit' ? '편집본' : 'Draft'} · {new Date(record.savedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} · {actionLabel(record.syncState)}</button>)}</div></section>}
      <div className="mode-tabs"><button className={mode === 'table' && !buttonPicking ? 'active' : ''} onClick={() => { setMode('table'); setButtonPicking(false) }}>HUD 테이블</button><button className={mode === 'seats' ? 'active' : ''} onClick={() => { setMode('seats'); setButtonPicking(false) }}>좌석 수정</button><button className={buttonPicking ? 'active' : ''} onClick={() => { setButtonPicking(true); setMode('table') }}>BTN / 핸드 등록</button></div>
      {buttonPicking && <div className="instruction-banner"><span className="pulse-dot" /> 새 핸드의 실제 BTN 좌석을 탭하세요. 위치를 자동 이동하지 않습니다.</div>}
      {activeSession && <TableBoard session={activeSession} seats={activeSeats} players={workspace.players} hands={workspace.hands} tournamentId={activeTournament?.id ?? ''} mode={mode} buttonPicking={buttonPicking} onSeatClick={handleSeatClick} onPlayerClick={setSelectedPlayer} />}
      {mode === 'seats' && activeSession && <section className="seat-manager"><div className="section-heading"><div><span className="eyebrow">SEAT MANAGEMENT</span><h2>물리 좌석 배치</h2><p>빈자리는 유지되며 플레이어를 삭제하지 않습니다.</p></div><div className="add-player"><input value={newPlayerName} placeholder="새 플레이어 이름" onChange={(event) => setNewPlayerName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addPlayer()} /><button className="secondary-button" onClick={addPlayer}>플레이어 추가</button></div></div><div className="seat-list">{activeSeats.map((seat) => { const player = workspace.players.find((item) => item.id === seat.playerId); return <div className="seat-row" key={seat.id}><span className="seat-no">{seat.seatNo}</span><strong>{player?.name ?? '빈 좌석'}</strong>{player ? <button className="text-button danger-text" onClick={() => clearSeat(seat.id)}>비우기</button> : <select value="" onChange={(event) => event.target.value && updateWorkspace((current) => ({ ...current, seats: current.seats.map((item) => item.id === seat.id ? { ...item, playerId: event.target.value } : item) }))}><option value="">플레이어 배치</option>{workspace.players.filter((candidate) => !activeSeats.some((item) => item.playerId === candidate.id)).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select>}</div> })}</div></section>}
      <section className="records-section"><div className="section-heading"><div><span className="eyebrow">HAND LOG</span><h2>핸드 기록</h2><p>Draft와 Completed를 함께 보관하고 완료본만 HUD에 반영합니다.</p></div><span className="record-count">{draftHands.length} Draft · {completedHands.length} Completed</span></div><div className="record-list">{[...workspace.hands].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12).map((hand) => <button key={hand.id} className="record-row" onClick={() => hand.status === 'draft' ? setActiveHandId(hand.id) : setSelectedCompletedHand(hand)}><span className={`status-dot ${hand.status}`} /><span><strong>{hand.draftKind === 'edit' ? 'Completed 편집본' : hand.status === 'draft' ? '새 핸드 Draft' : 'Completed 핸드'}</strong><small>{new Date(hand.updatedAt).toLocaleString('ko-KR')} · {hand.actions.length} actions · BTN {hand.buttonSeat}</small></span><span className="record-arrow">›</span></button>)}{workspace.hands.length === 0 && <div className="empty-state">아직 기록된 핸드가 없습니다. <b>+ 새 핸드</b>를 눌러 실제 BTN을 선택하세요.</div>}</div></section>
    </main>
    <footer className="app-footer"><span>RangeLog MVP · 원본 액션에서 HUD 재집계</span><span className={`save-status ${draftSyncState}`}>{activeHand ? draftSyncState : 'server-saved'}</span></footer>
    {isTournamentModalOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setTournamentModalOpen(false) }}><section className="edit-modal tournament-modal" role="dialog" aria-modal="true" aria-labelledby="tournament-modal-title" onKeyDown={(event) => event.key === 'Escape' && setTournamentModalOpen(false)}><div className="modal-head"><div><span className="eyebrow">NEW TOURNAMENT</span><strong id="tournament-modal-title">새 토너먼트 만들기</strong><small>이름과 기본 좌석 수를 설정하세요.</small></div><button className="icon-button" type="button" aria-label="새 토너먼트 모달 닫기" onClick={() => setTournamentModalOpen(false)}>×</button></div><form className="tournament-form" onSubmit={(event) => { event.preventDefault(); createTournament() }}><label className="field-label">토너먼트 이름<input autoFocus value={tournamentName} placeholder="예: 금요일 라이브" onChange={(event) => { setTournamentName(event.target.value); setTournamentFormError(undefined) }} /></label><label className="field-label">기본 좌석 수<input type="number" min="2" max="10" step="1" inputMode="numeric" value={tournamentSeatCount} onChange={(event) => { setTournamentSeatCount(event.target.value); setTournamentFormError(undefined) }} /></label>{tournamentFormError && <p className="inline-error">{tournamentFormError}</p>}<div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setTournamentModalOpen(false)}>취소</button><button className="primary-button" type="submit">토너먼트 만들기</button></div></form></section></div>}
    {selectedPlayer && activeTournament && <PlayerDetail player={selectedPlayer} hands={workspace.hands} tournamentId={activeTournament.id} onClose={() => setSelectedPlayer(undefined)} />}
    {selectedCompletedHand && <ReadonlyHand hand={selectedCompletedHand} players={workspace.players} onClose={() => setSelectedCompletedHand(undefined)} onEdit={() => editCompleted(selectedCompletedHand)} />}
    {toast && <button className="toast" onClick={() => setToast(undefined)}>{toast}</button>}
  </div>
}
