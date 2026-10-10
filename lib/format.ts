export const money = (v: number, c = '') =>
  `${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${c ? ' ' + c : ''}`;
