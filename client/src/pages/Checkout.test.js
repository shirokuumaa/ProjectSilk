// Корзина и оформление заказа без оплаты: количество и итог, вход перед оформлением,
// проверка формы, отправка строк корзины, «Payment coming soon», переход к заказу.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CartPage from './CartPage';
import CheckoutPage from './CheckoutPage';
import { isLoggedIn, authFetch, getUsername } from '../utils/auth';

jest.mock('../utils/auth', () => ({
  ...jest.requireActual('../utils/auth'),
  isLoggedIn: jest.fn(),
  getUsername: jest.fn(),
  authFetch: jest.fn(),
}));

const LINES = [
  { id: 'p1', name: 'Mini Dress', price: 19900, size: 'S', quantity: 1, image: '/d.jpg' },
  { id: 'p2', name: 'Tee', price: 7900, size: 'M', quantity: 2, image: '/t.jpg' },
];

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  isLoggedIn.mockReturnValue(true);
  getUsername.mockReturnValue('ann');
});

describe('cart', () => {
  test('lines with size, quantity buttons and the total', () => {
    const onSetQuantity = jest.fn();
    render(<MemoryRouter><CartPage cartItems={LINES} onSetQuantity={onSetQuantity} /></MemoryRouter>);
    expect(screen.getByText('Size S')).toBeInTheDocument();
    expect(screen.getAllByText('35,700 ₸')).toHaveLength(2);   // итог: 19 900 + 2 × 7 900
    fireEvent.click(screen.getByRole('button', { name: 'One more Tee' }));
    expect(onSetQuantity).toHaveBeenCalledWith('p2|M', 3);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(onSetQuantity).toHaveBeenCalledWith('p1|S', 0);
  });

  test('a guest goes to sign in first, then back to checkout', () => {
    isLoggedIn.mockReturnValue(false);
    render(
      <MemoryRouter initialEntries={['/cart']}>
        <Routes>
          <Route path="/cart" element={<CartPage cartItems={LINES} />} />
          <Route path="/login" element={<p>login page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Checkout' }));
    expect(screen.getByText('login page')).toBeInTheDocument();
  });
});

describe('checkout', () => {
  const renderCheckout = (onOrdered = jest.fn()) => render(
    <MemoryRouter initialEntries={['/checkout']}>
      <Routes>
        <Route path="/checkout" element={<CheckoutPage cartItems={LINES} onOrdered={onOrdered} />} />
        <Route path="/orders/:id" element={<p>order page</p>} />
        <Route path="/orders" element={<p>orders page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  const fill = () => {
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ann Lee' } });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+7 701 123 45 67' } });
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Almaty' } });
    fireEvent.change(screen.getByLabelText('Street address'), { target: { value: 'Abay 10' } });
  };

  test('payment is shown as coming soon; Kazakhstan is the default country', () => {
    renderCheckout();
    expect(screen.getByText('Payment coming soon')).toBeInTheDocument();
    expect(screen.getByLabelText('Country')).toHaveValue('KZ');
  });

  test('empty form: every missing field at once, nothing sent', () => {
    renderCheckout();
    fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter your name.');
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter a street address.');
    expect(authFetch).not.toHaveBeenCalled();
  });

  test('the order goes to the server with sizes; the cart lines are cleared; two stores → My orders', async () => {
    authFetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({ orders: [{ _id: 'o1' }, { _id: 'o2' }] }) });
    const onOrdered = jest.fn();
    renderCheckout(onOrdered);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
    expect(await screen.findByText('orders page')).toBeInTheDocument();
    const body = JSON.parse(authFetch.mock.calls[0][1].body);
    expect(body.items).toEqual([{ productId: 'p1', size: 'S', quantity: 1 }, { productId: 'p2', size: 'M', quantity: 2 }]);
    expect(body.address).toEqual(expect.objectContaining({ country: 'KZ', city: 'Almaty', line1: 'Abay 10' }));
    expect(onOrdered).toHaveBeenCalledWith(['p1|S', 'p2|M']);
    // контакты запомнены для следующего раза
    expect(JSON.parse(localStorage.getItem('checkoutContact')).contact.name).toBe('Ann Lee');
  });

  test('a server refusal (sold out) is shown and the cart stays', async () => {
    authFetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ message: 'Mini Dress in size S is sold out.' }) });
    const onOrdered = jest.fn();
    renderCheckout(onOrdered);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Mini Dress in size S is sold out.'));
    expect(onOrdered).not.toHaveBeenCalled();
  });
});
