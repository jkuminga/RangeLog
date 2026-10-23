/** 퍼센트 표시: 표본이 없으면 설계서 정책에 따라 대시를 반환한다. */
export function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0) return '–'
  return `${Math.round((numerator / denominator) * 100)}%`
}

/** 통계 셀 표시: 백분율과 분자/분모를 함께 보여준다. */
export function formatRate(numerator: number, denominator: number): string {
  return `${formatPercent(numerator, denominator)} (${numerator}/${denominator})`
}

/** BB 금액 표시: 알 수 없는 금액은 –BB로 표시한다. */
export function formatBB(value: number | undefined): string {
  return value === undefined ? '–BB' : `${Number.isInteger(value) ? value : value.toFixed(2)}BB`
}
