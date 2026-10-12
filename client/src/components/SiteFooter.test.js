import { render, screen } from '@testing-library/react';
import SiteFooter from './SiteFooter';

// CC BY 4.0 требует указать автора шкалы тонов — атрибуция не должна пропасть из подвала
test('footer credits the Monk Skin Tone Scale under CC BY 4.0', () => {
  render(<SiteFooter />);
  expect(screen.getByText(/Dr\. Ellis Monk, Google LLC/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Monk Skin Tone Scale' })).toHaveAttribute('href', 'https://skintone.google');
  expect(screen.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
});
