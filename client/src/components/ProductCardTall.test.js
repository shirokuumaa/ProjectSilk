// Карточка товара в каталоге: звёзды только при оценке, кнопка корзины с подписью,
// ссылка на обмеры без голого «add».
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
  await screen.findByRole('button', { name: /add measurements/i });
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
  expect(addToCart).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', name: 'Basic Tee', price: 9900 }));
  expect(screen.getByRole('button', { name: /added/i })).toBeInTheDocument();
});

test('without measurements: one clear link, no bare "add" button', async () => {
  renderCard(TEE);
  expect(await screen.findByRole('button', { name: 'Add measurements to see your size' })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('button', { name: /^add$/i })).not.toBeInTheDocument());
});
