// Витрина: первый экран для гостя, строка фигуры для покупателя с обмерами, фильтр «Fits me».
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import HomePage from './HomePage';
import { loadBodyProfile } from '../utils/bodyProfileApi';

jest.mock('axios');
jest.mock('../utils/bodyProfileApi', () => ({
  ...jest.requireActual('../utils/bodyProfileApi'),
  loadBodyProfile: jest.fn(),
}));

const PRODUCTS = [
  { _id: 'd', title: 'Midi Dress', price: 19900, garmentType: 'dress', image: '/d.jpg',
    sizeChart: [{ size: 'M', chest: 96, waist: 80, hips: 104, fit: 'regular' }] },
  { _id: 't', title: 'Crop Top', price: 5900, garmentType: 'top', image: '/t.jpg',
    sizeChart: [{ size: 'XS', chest: 70, fit: 'tight' }] },
];
const renderHome = (path = '/') => render(<MemoryRouter initialEntries={[path]}><HomePage addToCart={jest.fn()} /></MemoryRouter>);

beforeEach(() => { localStorage.clear(); axios.get.mockResolvedValue({ data: PRODUCTS }); });

test('a guest sees what the shop does and a way to start; "Fits me" asks for measurements', async () => {
  loadBodyProfile.mockResolvedValue(null);
  renderHome();
  expect(await screen.findByRole('link', { name: /Create my avatar/ })).toHaveAttribute('href', '/avatar/create');
  expect(await screen.findByText('2 items')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Fits me/ })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'Add measurements to filter by fit' })).toBeInTheDocument();
});

test('with measurements: the figure strip, and "Fits me" leaves only what fits', async () => {
  loadBodyProfile.mockResolvedValue({ heightCm: 166, chest: 88, waist: 70, hips: 96 });
  renderHome();
  expect(await screen.findByText(/Sizes below are picked for your figure/)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Create my avatar/ })).not.toBeInTheDocument();
  await screen.findByText('2 items');
  fireEvent.click(screen.getByRole('button', { name: /Fits me/ }));
  expect(await screen.findByText('1 item')).toBeInTheDocument();
  expect(screen.getByText('Midi Dress')).toBeInTheDocument();
  expect(screen.queryByText('Crop Top')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters (1)' }));
  expect(await screen.findByText('2 items')).toBeInTheDocument();
});

test('a search with no results says so and offers everything', async () => {
  loadBodyProfile.mockResolvedValue(null);
  renderHome('/?q=velvet');
  expect(await screen.findByText(/Nothing found for/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show everything' }));
  expect(await screen.findByText('2 items')).toBeInTheDocument();
});
