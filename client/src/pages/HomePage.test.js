// Витрина: аватар слева (у гостя — стандартная фигура), «Try on» надевает вещь в рекомендованном
// размере, список надетого с крестиком и «Take all off», подсказка для вещи, которую не надеть,
// фильтр «Fits me».
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import HomePage from './HomePage';
import { loadBodyProfile } from '../utils/bodyProfileApi';

jest.mock('axios');
jest.mock('../utils/bodyProfileApi', () => ({
  ...jest.requireActual('../utils/bodyProfileApi'),
  loadBodyProfile: jest.fn(),
}));
// сцена: показываем фигуру и что на ней надето (адрес|размер)
jest.mock('../components/GlbViewer', () => ({ profile, garments }) => (
  <p data-testid="scene">
    {profile.heightCm}/{profile.chest}/{profile.waist}/{profile.hips}
    {' '}{(garments || []).map((g) => `${g.url}|${g.size?.size || '-'}`).join(',')}
  </p>
));

const PRODUCTS = [
  { _id: 'd', title: 'Midi Dress', price: 19900, garmentType: 'dress', image: '/d.jpg', model3d: '/uploads/models/d.glb',
    sizeChart: [{ size: 'M', chest: 96, waist: 80, hips: 104, fit: 'regular' }] },
  { _id: 't', title: 'Crop Top', price: 5900, garmentType: 'top', image: '/t.jpg',
    sizeChart: [{ size: 'XS', chest: 70, fit: 'tight' }] },
  { _id: 'c', title: 'Wool Coat', price: 39900, garmentType: 'outerwear', image: '/c.jpg', sizeChart: [] },
];
const BODY = { heightCm: 170, chest: 90, waist: 72, hips: 98 };
const renderHome = (path = '/') => render(<MemoryRouter initialEntries={[path]}><HomePage addToCart={jest.fn()} /></MemoryRouter>);
const tryOn = (name) => fireEvent.click(within(screen.getByRole('button', { name })).getByRole('button', { name: 'Try on' }));

beforeEach(() => { localStorage.clear(); axios.get.mockResolvedValue({ data: PRODUCTS }); });

test('no welcome block; a guest sees the standard figure with "Add your measurements" and can still try items on', async () => {
  loadBodyProfile.mockResolvedValue(null);
  renderHome();
  expect(await screen.findByText('Standard figure')).toBeInTheDocument();
  expect(screen.queryByText(/Know your size before it arrives/)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Add your measurements' })).toHaveAttribute('href', '/avatar/create');
  expect(await screen.findByTestId('scene')).toHaveTextContent('166/88/70/96');
  await screen.findByText('3 items');
  tryOn('Midi Dress');
  expect(screen.getByTestId('scene')).toHaveTextContent('http://localhost:5050/uploads/models/d.glb|M');
  const worn = screen.getByRole('list', { name: 'Wearing now' });
  expect(within(worn).getByText('Midi Dress')).toBeInTheDocument();
  expect(screen.getByText(/\(for the standard figure\)/)).toBeInTheDocument();
});

test('with measurements: my avatar; the item goes on in my recommended size; × and "Take all off" remove it', async () => {
  loadBodyProfile.mockResolvedValue(BODY);
  renderHome();
  expect(await screen.findByText('My avatar')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Add your measurements' })).not.toBeInTheDocument();
  await screen.findByText('3 items');
  tryOn('Midi Dress');
  expect(screen.getByTestId('scene')).toHaveTextContent('170/90/72/98');
  expect(screen.getByText('M · fits')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open fitting room →' })).toHaveAttribute('href', '/tryon/avatar');
  // то же сохраняется для полной примерки
  expect(JSON.parse(localStorage.getItem('avatarOutfitDraft')).dress).toBe('d');
  fireEvent.click(screen.getByRole('button', { name: 'Take off Midi Dress' }));
  expect(screen.queryByRole('list', { name: 'Wearing now' })).not.toBeInTheDocument();
  tryOn('Midi Dress');
  tryOn('Crop Top');   // верх снимает платье
  expect(within(screen.getByRole('list', { name: 'Wearing now' })).queryByText('Midi Dress')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Take all off' }));
  expect(screen.getByText(/Drag an item here or press “Try on”/)).toBeInTheDocument();
});

test('an item that cannot be shown on the figure explains why instead of disappearing', async () => {
  loadBodyProfile.mockResolvedValue(BODY);
  renderHome();
  await screen.findByText('3 items');
  tryOn('Wool Coat');
  expect(screen.getByRole('status')).toHaveTextContent(/Wool Coat has no 3D model yet/);
  expect(screen.queryByRole('list', { name: 'Wearing now' })).not.toBeInTheDocument();
});

test('"Fits me" leaves only what fits; a search with no results offers everything', async () => {
  loadBodyProfile.mockResolvedValue({ heightCm: 166, chest: 88, waist: 70, hips: 96 });
  renderHome();
  await screen.findByText('3 items');
  fireEvent.click(screen.getByRole('button', { name: /Fits me/ }));
  expect(await screen.findByText('1 item')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters (1)' }));
  expect(await screen.findByText('3 items')).toBeInTheDocument();
});

test('a search with no results says so', async () => {
  loadBodyProfile.mockResolvedValue(null);
  renderHome('/?q=velvet');
  expect(await screen.findByText(/Nothing found for/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show everything' }));
  expect(await screen.findByText('3 items')).toBeInTheDocument();
});
