// «Hide body» на примерке и в гардеробе: заметная кнопка со значком, переключает тело.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BodyToggle from './BodyToggle';
import WardrobePage from '../pages/WardrobePage';
import Product3DViewer from '../pages/Product3DViewer';
import { loadBodyProfile } from '../utils/bodyProfileApi';

const viewerProps = [];
jest.mock('./GlbViewer', () => (props) => { viewerProps.push(props); return null; });
jest.mock('../utils/bodyProfileApi', () => ({
  ...jest.requireActual('../utils/bodyProfileApi'),
  loadBodyProfile: jest.fn(),
}));

test('labelled, with an icon, and pressed while the body is hidden', () => {
  const onToggle = jest.fn();
  const { rerender } = render(<BodyToggle shown onToggle={onToggle} />);
  const btn = screen.getByRole('button', { name: 'Hide body' });
  expect(btn).toHaveAttribute('aria-pressed', 'false');
  expect(btn.innerHTML).toMatch(/<svg/);
  fireEvent.click(btn);
  expect(onToggle).toHaveBeenCalled();

  rerender(<BodyToggle shown={false} onToggle={onToggle} />);
  expect(screen.getByRole('button', { name: 'Show body' })).toHaveAttribute('aria-pressed', 'true');
});

test('wardrobe: "Hide body" is on the stage and hides the body in the 3D view', async () => {
  // CRA сбрасывает моки перед каждым тестом — профиль задаём здесь
  loadBodyProfile.mockResolvedValue({ heightCm: 166, chest: 90, waist: 72, hips: 98 });
  const TEE = { _id: 'p1', title: 'Basic Tee', price: 9900, image: '/uploads/t.jpg', garmentType: 'top' };
  localStorage.setItem('wardrobeItems', JSON.stringify([{ id: 'p1', name: 'Basic Tee', image: '/uploads/t.jpg' }]));
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [TEE] });
  render(<MemoryRouter><WardrobePage /></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: 'Hide body' }));
  await waitFor(() => expect(viewerProps[viewerProps.length - 1].showBody).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Show body' }));
  await waitFor(() => expect(viewerProps[viewerProps.length - 1].showBody).toBe(true));
  delete global.fetch;
});

test('the 3D viewer does not print the model path (file names carry figure sizes)', () => {
  render(
    <MemoryRouter initialEntries={['/viewer?src=%2Fmodels%2Fdemo-garments%2Fdress_XXL.glb']}>
      <Product3DViewer />
    </MemoryRouter>,
  );
  expect(document.body.textContent).not.toMatch(/xxl|\.glb/i);
});

test('the try-on page puts the same toggle first among its actions', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../pages/tryon/TryOnAvatar.jsx'), 'utf8');
  expect(src).toMatch(/actions=\{\s*<>\s*(\{\/\*[^]*?\*\/\}\s*)?<BodyToggle shown=\{showBody\}/);
  expect(src).not.toMatch(/'Hide body' : 'Show body'/); // не прежняя неприметная кнопка
});
