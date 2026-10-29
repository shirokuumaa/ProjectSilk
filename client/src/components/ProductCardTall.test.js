// Карточка товара в каталоге: звёзды только при оценке, кнопка корзины с подписью и выбором
// размера, размер покупателя, магазин, «Sold out».
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProductCardTall from './ProductCardTall';
import { loadBodyProfile } from '../utils/bodyProfileApi';

jest.mock('../utils/bodyProfileApi', () => ({
  ...jest.requireActual('../utils/bodyProfileApi'),
  loadBodyProfile: jest.fn(),
}));

const TEE = {
  _id: 'p1', title: 'Basic Tee', price: 9900, garmentType: 'top',
  sizeChart: [{ size: 'S', chest: 92, waist: 84, fit: 'regular' }],
};

const renderCard = (product, addToCart = jest.fn()) =>
  render(<MemoryRouter><ProductCardTall product={product} addToCart={addToCart} /></MemoryRouter>);

beforeEach(() => { loadBodyProfile.mockResolvedValue(null); localStorage.clear(); });

test('no reviews: no "★★★★★ 0.0"', async () => {
  renderCard({ ...TEE, rating: 0 });
  expect(screen.queryByText(/★/)).not.toBeInTheDocument();
  expect(screen.queryByText('0.0')).not.toBeInTheDocument();
});

test('a rated product shows its stars and score', async () => {
  renderCard({ ...TEE, rating: 4.5 });
  expect(screen.getByLabelText('Rated 4.5 out of 5')).toHaveTextContent('4.5');
});

test('rating with zero reviews is hidden too', () => {
  renderCard({ ...TEE, rating: 4, reviewCount: 0 });
  expect(screen.queryByText(/★/)).not.toBeInTheDocument();
});

test('the cart button says "Add to cart" and adds the product', () => {
  const addToCart = jest.fn();
  renderCard(TEE, addToCart);
  const btn = screen.getByRole('button', { name: 'Add to cart' });
  expect(btn).toHaveTextContent('Add to cart');
  fireEvent.click(btn);
  // один размер — выбирать нечего, кладётся сразу
  expect(addToCart).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', name: 'Basic Tee', price: 9900, size: 'S' }));
  expect(screen.getByRole('button', { name: /added/i })).toBeInTheDocument();
});

test('without measurements: no size chip, no nagging link, no bare "add" button', async () => {
  renderCard(TEE);
  await waitFor(() => expect(screen.queryByRole('button', { name: /^add$/i })).not.toBeInTheDocument());
  expect(screen.queryByText(/Your size/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /measurements/i })).not.toBeInTheDocument();
});

const DRESS = {
  _id: 'd1', title: 'Midi Dress', price: 19900, garmentType: 'dress', store: 'Linen & Co',
  sizeChart: [
    { size: 'S', chest: 92, waist: 76, hips: 98, fit: 'regular', stock: 2 },
    { size: 'M', chest: 96, waist: 80, hips: 102, fit: 'regular', stock: 5 },
    { size: 'L', chest: 100, waist: 84, hips: 106, fit: 'regular', stock: 0 },
  ],
};

test('several sizes: "Add to cart" asks for a size; a sold-out size cannot be picked', () => {
  const addToCart = jest.fn();
  renderCard(DRESS, addToCart);
  fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
  expect(addToCart).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Add size L to cart (out of stock)' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Add size M to cart' }));
  expect(addToCart).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1', size: 'M' }));
  expect(screen.getByRole('button', { name: 'Added · M ✓' })).toBeInTheDocument();
});

test('the store name and the buyer\'s size are on the card', () => {
  render(<MemoryRouter><ProductCardTall product={DRESS} profile={{ heightCm: 166, chest: 88, waist: 72, hips: 96 }} /></MemoryRouter>);
  expect(screen.getByText('Linen & Co')).toBeInTheDocument();
  expect(screen.getByText(/^Your size [A-Z]+$/)).toBeInTheDocument();
  expect(screen.getByText('19,900 ₸')).toBeInTheDocument();
});

test('every size sold out: "Sold out" and no adding to the cart', () => {
  renderCard({ ...DRESS, sizeChart: DRESS.sizeChart.map((r) => ({ ...r, stock: 0 })) });
  expect(screen.getByText('Sold out')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled();
});
