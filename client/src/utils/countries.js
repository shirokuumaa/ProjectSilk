// client/src/utils/countries.js
//
// Страны доставки (ISO 3166-1 alpha-2). Пилот — Казахстан (по умолчанию); список заложен
// под другие рынки. Сервер принимает любой двухбуквенный код.

export const DEFAULT_COUNTRY = 'KZ';

export const COUNTRIES = [
  ['KZ', 'Kazakhstan'], ['UZ', 'Uzbekistan'], ['KG', 'Kyrgyzstan'], ['TJ', 'Tajikistan'],
  ['AM', 'Armenia'], ['AZ', 'Azerbaijan'], ['GE', 'Georgia'], ['TR', 'Turkey'],
  ['AE', 'United Arab Emirates'], ['DE', 'Germany'], ['FR', 'France'], ['IT', 'Italy'],
  ['ES', 'Spain'], ['PL', 'Poland'], ['GB', 'United Kingdom'], ['US', 'United States'],
];

export const countryName = (code) => COUNTRIES.find(([c]) => c === code)?.[1] || code;
