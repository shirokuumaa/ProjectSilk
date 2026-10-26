// «My products»: статус выкроек обновляется сам, пока они строятся.
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SellerPanel, { PATTERN_POLL_MS } from './SellerPanel';
import { fetchMe, isLoggedIn, authFetch } from '../utils/auth';

jest.mock('../utils/auth', () => ({
  ...jest.requireActual('../utils/auth'),
  isLoggedIn: jest.fn(),
  fetchMe: jest.fn(),
  authFetch: jest.fn(),
}));

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const dress = (patterns) => ({
  _id: 'p1', title: 'Wrap Dress', price: 19900, image: '', garmentType: 'dress',
  silhouette: { template: 'dress_aline', sleeve: 'short', length: 'knee' },
  sizeChart: [{ size: 'S', chest: 88 }, { size: 'M', chest: 92 }], patterns,
});

afterEach(() => jest.useRealTimers());

test('a queued product is re-read until its patterns are ready, then polling stops', async () => {
  jest.useFakeTimers();
  isLoggedIn.mockReturnValue(true);
  fetchMe.mockResolvedValue({ username: 'sam', role: 'seller', storeName: 'Sam Shop' });
  const answers = [
    [dress({ status: 'queued' })],
    [dress({ status: 'patterns_ready', sizes: [{ size: 'S', ok: true }, { size: 'M', ok: true }] })],
  ];
  let mine = 0;
  authFetch.mockImplementation(async (url) => {
    if (url.includes('/api/products/mine')) return ok(answers[Math.min(mine++, answers.length - 1)]);
    return ok({ AI_MODE: 'off', AI_ENABLED: false });
  });

  render(<MemoryRouter><SellerPanel /></MemoryRouter>);
  expect(await screen.findByText(/Patterns: drafting…/)).toBeInTheDocument();
  expect(mine).toBe(1);

  await act(async () => { jest.advanceTimersByTime(PATTERN_POLL_MS); });
  expect(await screen.findByText('Patterns ready: S, M.')).toBeInTheDocument();
  expect(mine).toBe(2);

  await act(async () => { jest.advanceTimersByTime(PATTERN_POLL_MS * 3); });
  expect(mine).toBe(2);
});
