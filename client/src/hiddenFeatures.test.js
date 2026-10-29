// Недоделанное спрятано (docs/PRODUCT_REVIEW.md, задача 2): ассистент, поиск по картинке,
// меню-заглушка категорий, панель разработчика в AR. Код оставлен, включается флагами.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TopBar from './components/TopBar';
import RightDock from './components/RightDock';
import TryOnAR from './pages/tryon/TryOnAR';
import { arDevToolsEnabled } from './utils/features';

// AR: трекинг и камера не нужны — проверяем только панель
jest.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: () => new Promise(() => {}) },
  PoseLandmarker: {}, HandLandmarker: {},
}));

const FLAGS = ['REACT_APP_ASSISTANT', 'REACT_APP_IMAGE_SEARCH', 'REACT_APP_CATEGORY_MENU', 'REACT_APP_AR_DEV'];
const ENV = { ...process.env };
beforeEach(() => {
  FLAGS.forEach((f) => delete process.env[f]);
  navigator.mediaDevices = { getUserMedia: () => new Promise(() => {}) };
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  process.env = { ...ENV };
  delete navigator.mediaDevices;
  HTMLCanvasElement.prototype.getContext.mockRestore();
});

const topBar = () => render(<MemoryRouter><TopBar search="" setSearch={() => {}} cartItems={[]} /></MemoryRouter>);

test('header: no image search and no "Categories" stub menu; text and voice search stay', () => {
  topBar();
  expect(screen.queryByRole('button', { name: 'Search by image' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Categories/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Search by voice' })).toBeInTheDocument();
});

test('header: the flags bring them back', () => {
  process.env.REACT_APP_IMAGE_SEARCH = 'on';
  process.env.REACT_APP_CATEGORY_MENU = 'on';
  topBar();
  expect(screen.getByRole('button', { name: 'Search by image' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Categories/ })).toBeInTheDocument();
});

test('right dock: no "AI Assistant" button unless the assistant is on', () => {
  const { unmount } = render(<MemoryRouter><RightDock /></MemoryRouter>);
  expect(screen.queryByTitle('Open the assistant')).not.toBeInTheDocument();
  expect(screen.getByTitle('Open the wardrobe')).toBeInTheDocument();
  unmount();
  process.env.REACT_APP_ASSISTANT = 'on';
  render(<MemoryRouter><RightDock /></MemoryRouter>);
  expect(screen.getByTitle('Open the assistant')).toBeInTheDocument();
});

describe('AR page', () => {
  test('buyers see the item picker and view options, not the developer panel', () => {
    render(<MemoryRouter><TryOnAR /></MemoryRouter>);
    expect(screen.getByText('Upload PNG/WebP')).toBeInTheDocument();
    expect(screen.getByText('Mirror')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/https:\/\/\.\.\.png/)).not.toBeInTheDocument();
    ['Appearance', 'Background', 'Debug (Alt+D)', 'Smooth tracking'].forEach((t) => {
      expect(screen.queryByText(t)).not.toBeInTheDocument();
    });
    expect(screen.queryByText(/Hotkeys:/)).not.toBeInTheDocument();
  });

  test('with REACT_APP_AR_DEV=on the developer panel is back', () => {
    process.env.REACT_APP_AR_DEV = 'on';
    render(<MemoryRouter><TryOnAR /></MemoryRouter>);
    expect(screen.getByPlaceholderText(/https:\/\/\.\.\.png/)).toBeInTheDocument();
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByText('Debug (Alt+D)')).toBeInTheDocument();
  });

  test('?debug in the address turns the developer panel on', () => {
    expect(arDevToolsEnabled('')).toBe(false);
    expect(arDevToolsEnabled('?debug')).toBe(true);
    expect(arDevToolsEnabled('?sku=1&debug=1')).toBe(true);
  });
});
