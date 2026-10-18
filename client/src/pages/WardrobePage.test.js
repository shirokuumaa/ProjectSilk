// Гардероб: товар, удалённый продавцом, пропадает и не ломает страницу;
// если каталог не загрузился — вещи не трогаем.
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WardrobePage from './WardrobePage';
import { pruneWardrobe } from '../utils/wardrobeStorage';

jest.mock('../components/GlbViewer', () => () => null);
jest.mock('../utils/bodyProfileApi', () => ({
  ...jest.requireActual('../utils/bodyProfileApi'),
  loadBodyProfile: jest.fn().mockResolvedValue(null),
}));

const TEE = { _id: 'p1', title: 'Basic Tee', price: 9900, image: '/uploads/t.jpg', garmentType: 'top' };
const saved = () => JSON.parse(localStorage.getItem('wardrobeItems') || '[]').map((x) => x.id);

function renderPage() {
  return render(<MemoryRouter><WardrobePage /></MemoryRouter>);
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('wardrobeItems', JSON.stringify([
    { id: 'p1', name: 'Basic Tee', image: '/uploads/t.jpg' },
    { id: 'gone', name: 'Deleted Dress', image: '/uploads/d.jpg' },
  ]));
});
afterEach(() => { delete global.fetch; });

test('an item whose product was deleted disappears; the rest of the page works', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [TEE] });
  renderPage();
  await waitFor(() => expect(screen.queryByText('Deleted Dress')).not.toBeInTheDocument());
  expect(screen.getAllByText('Basic Tee').length).toBeGreaterThan(0);
  expect(saved()).toEqual(['p1']);
});

test('when every product is gone, the empty wardrobe message is shown', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
  renderPage();
  expect(await screen.findByText(/Your wardrobe is empty/)).toBeInTheDocument();
  expect(saved()).toEqual([]);
});

test('if the catalog cannot be loaded, nothing is removed', async () => {
  global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
  renderPage();
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.getAllByText('Deleted Dress').length).toBeGreaterThan(0);
  expect(saved()).toEqual(['p1', 'gone']);
});

describe('pruneWardrobe', () => {
  test('keeps only items that are still in the catalog', () => {
    expect(pruneWardrobe([{ _id: 'p1' }]).map((x) => x.id)).toEqual(['p1']);
    expect(saved()).toEqual(['p1']);
  });

  test('without a catalog (load failed) keeps everything', () => {
    expect(pruneWardrobe(null)).toHaveLength(2);
    expect(saved()).toEqual(['p1', 'gone']);
  });
});

test('there is no "2D" button: placing item photos on a photo is not ready', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [TEE] });
  renderPage();
  await waitFor(() => expect(screen.queryByText('Deleted Dress')).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: '2D' })).not.toBeInTheDocument();
  expect(screen.queryByTitle('Place on the photo')).not.toBeInTheDocument();
});
