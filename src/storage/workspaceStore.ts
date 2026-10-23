import type { Workspace } from '../types'

const keyFor = (accountId: string) => `rangelog-workspace:${accountId}`

/** Workspace 저장: Supabase가 설정되지 않은 로컬 데모에서도 서버 원본 형태를 유지한다. */
export function loadWorkspace(accountId: string): Workspace | undefined {
  try {
    const raw = localStorage.getItem(keyFor(accountId))
    return raw ? JSON.parse(raw) as Workspace : undefined
  } catch {
    return undefined
  }
}

/** Workspace 저장: Completed와 테이블 기준 데이터를 브라우저 재진입 후 복원한다. */
export function saveWorkspace(accountId: string, workspace: Workspace): void {
  localStorage.setItem(keyFor(accountId), JSON.stringify(workspace))
}

/** JSON export: 현재 계정의 서버형 데이터와 로컬 Draft를 합쳐 내려받을 수 있는 JSON을 만든다. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
