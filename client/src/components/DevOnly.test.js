// Служебные страницы /metrics, /triposr-debug, /avatar/mode1-test — только в режиме разработки.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DevOnly from './DevOnly';

const ENV = process.env.NODE_ENV;
afterEach(() => { process.env.NODE_ENV = ENV; });

const renderGuarded = () => render(
  <MemoryRouter><DevOnly><p>secret debug page</p></DevOnly></MemoryRouter>,
);

test('in a production build the page is "Page not found"', () => {
  process.env.NODE_ENV = 'production';
  renderGuarded();
  expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '← Back to the shop' })).toHaveAttribute('href', '/');
  expect(screen.queryByText('secret debug page')).not.toBeInTheDocument();
});

test('in development the page opens', () => {
  process.env.NODE_ENV = 'development';
  renderGuarded();
  expect(screen.getByText('secret debug page')).toBeInTheDocument();
});
