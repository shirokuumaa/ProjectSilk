// client/src/components/Icons.jsx
//
// Линейные значки сайта: 20 px, цвет — currentColor (берётся из текста вокруг).
// Свои простые контуры, без сторонних наборов.

import React from 'react';

const Svg = ({ size = 20, children, ...rest }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}
  >
    {children}
  </svg>
);

export const SearchIcon = (p) => <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></Svg>;
export const MicIcon = (p) => <Svg {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></Svg>;
export const HeartIcon = ({ filled, ...p }) => (
  <Svg {...p} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />
  </Svg>
);
export const BagIcon = (p) => <Svg {...p}><path d="M5 8h14l-1.2 12H6.2L5 8Z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></Svg>;
export const UserIcon = (p) => <Svg {...p}><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20c1.4-3.6 4.2-5.2 7.5-5.2s6.1 1.6 7.5 5.2" /></Svg>;
export const HangerIcon = (p) => (
  <Svg {...p}><path d="M12 7.5a2 2 0 1 1 2-2c0 1-1 1.6-2 2.3V9l8.2 6.6c.7.6.3 1.9-.7 1.9H4.5c-1 0-1.4-1.3-.7-1.9L12 9" /></Svg>
);
export const ArrowRightIcon = (p) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
export const CheckIcon = (p) => <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>;
