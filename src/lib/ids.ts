/** ID 생성: 브라우저와 테스트 환경 모두에서 사용할 수 있는 UUID 헬퍼. */
export function createId(_prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    // Supabase/PostgreSQL의 uuid FK와 바로 연결할 수 있도록 접두사를 저장하지 않는다.
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.random() * 16 | 0
    const value = character === 'x' ? random : random & 0x3 | 0x8
    return value.toString(16)
  })
}

/** 현재 시각: 저장 모델의 생성·수정 시각을 ISO 문자열로 반환한다. */
export function nowIso(): string {
  return new Date().toISOString()
}
