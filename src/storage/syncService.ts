import type { Hand } from '../types'
import { createId } from '../lib/ids'
import { supabase } from './supabaseClient'

/** 동기화 상태: 사용자가 로컬 보존과 서버 확인 상태를 구분해 볼 수 있게 한다. */
export type SyncState = 'local-saving' | 'local-saved' | 'server-pending' | 'server-syncing' | 'server-saved' | 'failed' | 'conflict' | 'pending-completion'

/** RemoteSyncResult: Supabase RPC 경계의 결과를 화면 저장 상태로 변환한다. */
export interface RemoteSyncResult {
  state: 'server-saved' | 'server-pending' | 'failed' | 'conflict'
  revision?: number
  message?: string
}

/** syncHandSnapshot: 로컬 Draft를 RPC로 전송하며 revision/mutation_id 충돌을 자동 덮어쓰지 않는다. */
async function performHandSync(hand: Hand): Promise<RemoteSyncResult> {
  if (!supabase) return { state: 'server-pending', message: 'Supabase 환경변수가 없어 로컬 Draft로 보존 중입니다.' }
  const mutationId = hand.mutationId ?? createId('mutation')
  const expectedRevision = Math.max(0, hand.revision - 1)
  const { data, error } = await supabase.rpc('sync_hand_snapshot', {
    p_hand: { ...hand, mutationId },
    p_expected_revision: expectedRevision,
    p_mutation_id: mutationId,
  })
  if (error) {
    if (error.message.includes('REVISION_CONFLICT')) return { state: 'conflict', message: '서버와 로컬 Draft의 revision이 다릅니다.' }
    return { state: 'failed', message: error.message }
  }
  return { state: 'server-saved', revision: Number((data as { revision?: number } | null)?.revision ?? hand.revision) }
}

const handSyncQueue = new Map<string, Promise<RemoteSyncResult>>()

/** syncHandSnapshot: 같은 Hand의 RPC를 직렬화해 오래된 응답이 최신 변경을 덮지 않게 한다. */
export function syncHandSnapshot(hand: Hand): Promise<RemoteSyncResult> {
  const previous = handSyncQueue.get(hand.id)
  const task = (previous ?? Promise.resolve()).catch(() => undefined).then(() => performHandSync(hand))
  const tracked = task.finally(() => {
    if (handSyncQueue.get(hand.id) === tracked) handSyncQueue.delete(hand.id)
  })
  handSyncQueue.set(hand.id, tracked)
  return task
}

/** 재시도 간격: 설계서의 2·4·8·16·최대30초 백오프 기준이다. */
export function retryDelayMs(attempt: number): number {
  const base = Math.min(30_000, 2_000 * (2 ** Math.max(0, attempt)))
  const jitter = Math.floor(Math.random() * 250)
  return base + jitter
}

/** DraftDebouncer: 500ms debounce와 최초 변경 후 3초 상한을 관리한다. */
export class DraftDebouncer {
  private debounceTimer?: number
  private maxTimer?: number
  private startedAt?: number
  private pendingCallback?: () => void

  schedule(callback: () => void): void {
    this.pendingCallback = callback
    if (this.startedAt === undefined) {
      this.startedAt = Date.now()
      this.maxTimer = window.setTimeout(() => this.flush(), 3_000)
    }
    window.clearTimeout(this.debounceTimer)
    this.debounceTimer = window.setTimeout(() => this.flush(), 500)
  }

  flush(): void {
    window.clearTimeout(this.debounceTimer)
    window.clearTimeout(this.maxTimer)
    this.debounceTimer = undefined
    this.maxTimer = undefined
    this.startedAt = undefined
    const callback = this.pendingCallback
    this.pendingCallback = undefined
    callback?.()
  }

  dispose(): void {
    window.clearTimeout(this.debounceTimer)
    window.clearTimeout(this.maxTimer)
    this.pendingCallback = undefined
  }
}
