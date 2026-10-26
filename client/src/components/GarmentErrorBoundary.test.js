// Одна вещь не загрузилась — сцена цела, страница узнаёт об этом.
import { render, screen } from '@testing-library/react';
import GarmentErrorBoundary from './GarmentErrorBoundary';

function Broken() {
  throw new Error('Could not load /uploads/models/missing.glb');
}

test('a garment that fails to load renders nothing and reports the error; siblings stay', () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});   // React печатает пойманную ошибку
  const onError = jest.fn();
  render(
    <>
      <GarmentErrorBoundary onError={onError}><Broken /></GarmentErrorBoundary>
      <GarmentErrorBoundary onError={onError}><p>body</p></GarmentErrorBoundary>
    </>,
  );
  expect(screen.getByText('body')).toBeInTheDocument();
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError.mock.calls[0][0].message).toMatch('missing.glb');
  console.error.mockRestore();
});
