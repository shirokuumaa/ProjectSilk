// Страница примерки по фото спрятана: адрес ведёт на примерку на аватаре.
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TryOnPhotoPage from './TryOnPhoto';

test('with photo try-on off, /tryon/photo opens the avatar try-on instead', () => {
  render(
    <MemoryRouter initialEntries={['/tryon/photo']}>
      <Routes>
        <Route path="/tryon/photo" element={<TryOnPhotoPage />} />
        <Route path="/tryon/avatar" element={<p>avatar try-on</p>} />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByText('avatar try-on')).toBeInTheDocument();
  expect(screen.queryByText('Try on with a photo')).not.toBeInTheDocument();
});
