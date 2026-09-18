// Fixed locale so server and client render identical numbers.
export const num = (n: number) => n.toLocaleString("en-US");
export const usd = (n: number) => "$" + num(n);
export const short = (n: number) =>
  n >= 1_000_000 ? (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "K" : String(n);
