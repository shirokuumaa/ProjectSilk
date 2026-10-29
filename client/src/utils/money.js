// client/src/utils/money.js
//
// Цены во всех валютах — одним видом. Валюта — у товара (Product.currency), по умолчанию тенге:
// пилот на одном рынке, но место под другие валюты и страны заложено.

export const DEFAULT_CURRENCY = 'KZT';

// symbol — как пишут цену; after — знак после числа (19,900 ₸) или перед ($49)
export const CURRENCIES = {
  KZT: { symbol: '₸', after: true },
  RUB: { symbol: '₽', after: true },
  UZS: { symbol: 'soʻm', after: true },
  USD: { symbol: '$', after: false },
  EUR: { symbol: '€', after: false },
  GBP: { symbol: '£', after: false },
};

export const currencySymbol = (currency = DEFAULT_CURRENCY) =>
  (CURRENCIES[currency] || CURRENCIES[DEFAULT_CURRENCY]).symbol;

/** 19900 → «19,900 ₸»; 49 USD → «$49». */
export function formatPrice(amount, currency = DEFAULT_CURRENCY) {
  const c = CURRENCIES[currency] || CURRENCIES[DEFAULT_CURRENCY];
  const n = Number(amount);
  const num = Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—';
  return c.after ? `${num} ${c.symbol}` : `${c.symbol}${num}`;
}
