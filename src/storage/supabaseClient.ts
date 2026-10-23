import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** Supabase 설정: 공개 anon 키만 사용하며 service-role 키는 프론트에 두지 않는다. */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** supabase: 설정된 배포 환경에서만 인증·동기화 연결을 제공한다. */
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null

/** hasSupabase: 현재 빌드가 Google OAuth/Supabase 동기화를 사용할 수 있는지 반환한다. */
export function hasSupabase(): boolean {
  return supabase !== null
}
