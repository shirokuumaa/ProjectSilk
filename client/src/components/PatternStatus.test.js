// Статус выкроек товара в «My products».
import { render, screen } from '@testing-library/react';
import PatternStatus, { patternStatus } from './PatternStatus';

test.each([
  [{ garmentType: 'dress', patterns: { status: 'queued' } }, 'warn', /^Patterns: drafting…/],
  [{ garmentType: 'dress', patterns: { status: 'failed', message: 'Pattern tools are not installed on this server.' } },
    'bad', 'Patterns failed: Pattern tools are not installed on this server.'],
  [{ garmentType: 'top', patterns: { status: 'patterns_ready', sizes: [{ size: 'S', ok: true }, { size: 'M', ok: true }] } },
    'good', 'Patterns ready: S, M.'],
  [{ garmentType: 'top', patterns: { status: 'patterns_ready', sizes: [{ size: 'S', ok: true }, { size: 'XXXL', ok: false, error: 'This size is outside the body range we can model yet.' }] } },
    'warn', 'Patterns ready: S. Not drafted: XXXL — This size is outside the body range we can model yet.'],
  [{ garmentType: 'bottom' }, 'muted', 'No silhouette — choose one in Edit to draft patterns.'],
  [{ garmentType: 'bottom', silhouette: { template: 'skirt_aline' } }, 'muted', 'Add a size chart to draft patterns.'],
  [{ garmentType: 'outerwear' }, 'muted', 'No silhouette — choose one in Edit to draft patterns.'],
])('%o', (product, tone, text) => {
  const s = patternStatus(product);
  expect(s.tone).toBe(tone);
  expect(s.text).toMatch(text instanceof RegExp ? text : new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
});

test.each(['shoes', 'accessory', undefined])('no status for %s', (garmentType) => {
  expect(patternStatus({ garmentType })).toBeNull();
  const { container } = render(<PatternStatus product={{ garmentType }} />);
  expect(container).toBeEmptyDOMElement();
});

test('is announced as a status', () => {
  render(<PatternStatus product={{ garmentType: 'dress', patterns: { status: 'queued' } }} />);
  expect(screen.getByRole('status')).toHaveTextContent('Patterns: drafting…');
});
