import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SiteFooter from './SiteFooter';

// CC BY 4.0 требует указать автора шкалы тонов — атрибуция не должна пропасть из подвала
test('footer credits the Monk Skin Tone Scale under CC BY 4.0', () => {
  render(<MemoryRouter><SiteFooter /></MemoryRouter>);
  expect(screen.getByText(/Dr\. Ellis Monk, Google LLC/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Monk Skin Tone Scale' })).toHaveAttribute('href', 'https://skintone.google');
  expect(screen.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
});

test('footer links lead to the shop sections, the fitting room and the seller page', () => {
  render(<MemoryRouter><SiteFooter /></MemoryRouter>);
  expect(screen.getByRole('link', { name: 'Dresses' })).toHaveAttribute('href', '/?type=dress');
  expect(screen.getByRole('link', { name: 'Fitting room' })).toHaveAttribute('href', '/wardrobe');
  expect(screen.getByRole('link', { name: /^Sell on / })).toHaveAttribute('href', '/seller');
});
