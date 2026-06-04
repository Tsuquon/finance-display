// Maps a Yahoo ticker to the currency its price/quote data is denominated in.
// Yahoo's chart() and quote() endpoints return values in each listing's native
// currency, so an ".AX" (ASX) ticker is already in AUD — we just need to label
// it correctly in the UI instead of assuming USD.
export function currencyForTicker(ticker: string): string {
  if (ticker.endsWith(".AX")) return "AUD";
  if (ticker.endsWith(".NZ")) return "NZD";
  if (ticker.endsWith(".L")) return "GBP";
  return "USD";
}

// Short display symbol for the ticker's native currency.
export function currencySymbol(ticker: string): string {
  switch (currencyForTicker(ticker)) {
    case "AUD":
      return "A$";
    case "NZD":
      return "NZ$";
    case "GBP":
      return "£";
    default:
      return "$";
  }
}
