import type { Hand } from '../types'

const DB_NAME = 'rangelog-local'
const DB_VERSION = 1
const STORE_NAME = 'drafts'

/** LocalDraftRecord: IndexedDB에 저장하는 계정별 미완성 핸드 보호 레코드다. */
export interface LocalDraftRecord {
  id: string
  accountId: string
  hand: Hand
  savedAt: string
  syncState: 'local-saved' | 'server-pending' | 'failed' | 'conflict'
  pendingCompletion?: boolean
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('이 브라우저에서는 IndexedDB를 사용할 수 없습니다.'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB를 열 수 없습니다.'))
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('accountId', 'accountId', { unique: false })
        store.createIndex('savedAt', 'savedAt', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

/** Draft 저장: 로컬 저장 성공 여부를 호출자에게 반환해 UI 상태 배지를 결정한다. */
export async function saveDraft(record: LocalDraftRecord): Promise<void> {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(record)
    transaction.onerror = () => reject(transaction.error ?? new Error('Draft 저장에 실패했습니다.'))
    transaction.oncomplete = () => resolve()
  })
  database.close()
}

/** 계정별 Draft 조회: 로그아웃 후에도 다른 계정의 로컬 Draft를 노출하지 않는다. */
export async function listDrafts(accountId: string): Promise<LocalDraftRecord[]> {
  const database = await openDatabase()
  const records = await new Promise<LocalDraftRecord[]>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).index('accountId').getAll(accountId)
    request.onerror = () => reject(request.error ?? new Error('Draft 조회에 실패했습니다.'))
    request.onsuccess = () => resolve(request.result as LocalDraftRecord[])
  })
  database.close()
  return records.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

/** Draft 단건 조회: 복원 알림과 핸드 편집 진입점이 사용한다. */
export async function getDraft(id: string): Promise<LocalDraftRecord | undefined> {
  const database = await openDatabase()
  const record = await new Promise<LocalDraftRecord | undefined>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id)
    request.onerror = () => reject(request.error ?? new Error('Draft 조회에 실패했습니다.'))
    request.onsuccess = () => resolve(request.result as LocalDraftRecord | undefined)
  })
  database.close()
  return record
}

/** Draft 삭제: 서버 완료 확인 후 임시 보관분을 정리할 때만 호출한다. */
export async function deleteDraft(id: string): Promise<void> {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(id)
    transaction.onerror = () => reject(transaction.error ?? new Error('Draft 삭제에 실패했습니다.'))
    transaction.oncomplete = () => resolve()
  })
  database.close()
}

/** 전체 JSON 백업: 서버 데이터와 로컬 Draft를 함께 담을 수 있는 계정 파일 포맷이다. */
export async function exportLocalDrafts(accountId: string): Promise<LocalDraftRecord[]> {
  return listDrafts(accountId)
}
