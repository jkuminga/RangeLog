import { useEffect, useRef, useState } from 'react'
import type { Hand } from '../types'
import { saveDraft } from '../storage/localDb'
import { DraftDebouncer, syncHandSnapshot, type SyncState } from '../storage/syncService'

/** useDraftAutosave: Draft 변경을 IndexedDB에 먼저 기록하고 저장 상태를 UI에 제공한다. */
export function useDraftAutosave(accountId: string, hand: Hand | undefined): SyncState {
  const [state, setState] = useState<SyncState>('local-saved')
  const debouncer = useRef<DraftDebouncer | null>(null)
  if (!debouncer.current) debouncer.current = new DraftDebouncer()

  useEffect(() => {
    if (!hand) return
    setState('local-saving')
    debouncer.current?.schedule(() => {
      void saveDraft({
        id: hand.id,
        accountId,
        hand,
        savedAt: new Date().toISOString(),
        syncState: 'local-saved',
        pendingCompletion: hand.status === 'completed',
      }).then(async () => {
        if (hand.status === 'completed') { setState('pending-completion'); return }
        setState('server-syncing')
        const remote = await syncHandSnapshot(hand)
        setState(remote.state === 'server-saved' ? 'server-saved' : remote.state)
      }).catch(() => setState('failed'))
    })
    return () => undefined
  }, [accountId, hand])

  useEffect(() => () => debouncer.current?.dispose(), [])
  return state
}
