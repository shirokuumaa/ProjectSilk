// Отзывы о посадке: форма после доставки (обязательны оценка и «как сидит») и блок на странице товара.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FitReviewForm from './FitReviewForm';
import ProductReviews from './ProductReviews';
import { authFetch, isLoggedIn } from '../utils/auth';

jest.mock('../utils/auth', () => ({ ...jest.requireActual('../utils/auth'), authFetch: jest.fn(), isLoggedIn: jest.fn() }));

const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
afterEach(() => { jest.clearAllMocks(); delete global.fetch; });

test('the form needs a rating and a fit; it sends zones and text', async () => {
  authFetch.mockResolvedValue(ok({ _id: 'r1', rating: 4, fit: 'true' }, 201));
  const onDone = jest.fn();
  render(<FitReviewForm orderId="o1" item={{ product: 'p1', size: 'M', title: 'Dress' }} onDone={onDone} />);
  fireEvent.click(screen.getByRole('button', { name: 'Send review' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Please rate the item from 1 to 5 stars.');
  expect(authFetch).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('radio', { name: '4 stars' }));
  fireEvent.click(screen.getByRole('radio', { name: 'True to size' }));
  fireEvent.click(screen.getAllByRole('radio', { name: 'Loose' })[1]);   // талия
  fireEvent.change(screen.getByLabelText(/Your review/), { target: { value: 'Nice' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send review' }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(JSON.parse(authFetch.mock.calls[0][1].body)).toEqual({
    orderId: 'o1', productId: 'p1', size: 'M', rating: 4, fit: 'true', zones: { waist: 'loose' }, text: 'Nice',
  });
});

test('the product block: rating, fit shares, similar figure, reviews with height and size', async () => {
  isLoggedIn.mockReturnValue(true);
  global.fetch = jest.fn().mockResolvedValue(ok({
    summary: { count: 2, rating: 4.5, fit: { small: 1, true: 1, large: 0 } },
    reviews: [{ _id: 'r1', author: 'A.', size: 'M', rating: 5, fit: 'true', heightCm: 166, zones: { waist: 'loose' }, text: 'Lovely', createdAt: '2026-10-29' }],
  }));
  authFetch.mockResolvedValue(ok({ enough: true, count: 4, size: 'M', sizeCount: 3 }));
  render(<ProductReviews productId="p1" />);
  expect(await screen.findByText('★ 4.5')).toBeInTheDocument();
  expect(await screen.findByText(/mostly kept size/)).toHaveTextContent('People with a figure like yours mostly kept size M (3 of 4 similar buyers).');
  expect(screen.getByText('Height 166 cm')).toBeInTheDocument();
  expect(screen.getByText('Waist: loose')).toBeInTheDocument();
  expect(screen.getAllByText('50%')).toHaveLength(2);
});

test('no reviews yet — a plain line; a guest is not asked about similar figures', async () => {
  isLoggedIn.mockReturnValue(false);
  global.fetch = jest.fn().mockResolvedValue(ok({ summary: { count: 0 }, reviews: [] }));
  render(<ProductReviews productId="p1" />);
  expect(await screen.findByText(/No reviews yet/)).toBeInTheDocument();
  expect(authFetch).not.toHaveBeenCalled();
});
