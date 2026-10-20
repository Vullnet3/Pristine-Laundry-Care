const euro = new Intl.NumberFormat("sq-AL", { style: "currency", currency: "EUR" });

export function formatEuro(value: number): string {
  return euro.format(value);
}
