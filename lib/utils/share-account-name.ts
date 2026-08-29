export function buildShareAccountName(ticker: string, brokerageAccountName: string) {
  return `${ticker.trim().toUpperCase()} · ${brokerageAccountName.trim()}`;
}
