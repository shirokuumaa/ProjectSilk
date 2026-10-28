// Форма сетки: у каждой мерки — схема и подсказка; выбор «Full circumference» / «Flat (half) width».
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import SizeChartEditor, { serializeSizeChart } from './SizeChartEditor';

function Editor({ initial = [{ size: 'S', chest: '', waist: '', hips: '', length: '', sleeve: '', fit: 'regular' }], type = 'dress', onMode }) {
  const [rows, setRows] = useState(initial);
  const [mode, setMode] = useState('circumference');
  return (
    <SizeChartEditor
      value={rows}
      onChange={setRows}
      garmentType={type}
      onGarmentTypeChange={() => {}}
      girthMode={mode}
      onGirthModeChange={(m) => { setMode(m); onMode?.(m); }}
    />
  );
}

test('every dress measurement has its own diagram and a one-line hint; sleeve from the shoulder seam', () => {
  render(<Editor />);
  for (const name of ['bust', 'waist', 'hips', 'length', 'sleeve']) {
    expect(screen.getByRole('img', { name: `How to measure ${name}` })).toBeInTheDocument();
  }
  expect(screen.getByText('From the shoulder seam to the end of the cuff.')).toBeInTheDocument();
  expect(screen.getByText('From the highest point of the shoulder, next to the collar, down to the hem.')).toBeInTheDocument();
});

test('trousers: waistband-to-hem length, no bust or sleeve', () => {
  render(<Editor type="bottom" />);
  expect(screen.getByText('From the top of the waistband down to the hem.')).toBeInTheDocument();
  expect(screen.queryByRole('img', { name: 'How to measure bust' })).not.toBeInTheDocument();
  expect(screen.queryByRole('img', { name: 'How to measure sleeve' })).not.toBeInTheDocument();
});

test('outerwear: shoulders across the back, with its own diagram and hint', () => {
  render(<Editor type="outerwear" />);
  expect(screen.getByRole('img', { name: 'How to measure shoulders' })).toBeInTheDocument();
  expect(screen.getByText('Lay the garment flat, back up, and measure straight across from one shoulder seam to the other.'))
    .toBeInTheDocument();
  expect(screen.queryByRole('img', { name: 'How to measure hips' })).not.toBeInTheDocument();
});

test('the shoulder width is kept when the chart is saved', () => {
  expect(serializeSizeChart([{ size: 'M', chest: '106', shoulder: '38', sleeve: '', fit: 'loose' }]))
    .toEqual([{ size: 'M', fit: 'loose', chest: 106, shoulder: 38 }]);
});

test('"Flat (half) width": hints and headers switch, the diagram draws a straight line across', () => {
  const onMode = jest.fn();
  render(<Editor onMode={onMode} />);
  const bust = () => screen.getByRole('img', { name: 'How to measure bust' });
  expect(bust().querySelector('ellipse')).not.toBeNull();             // вокруг
  expect(screen.getByText('Measure all the way around, just below the armholes.')).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText('Flat (half) width'));
  expect(onMode).toHaveBeenCalledWith('flat');
  expect(bust().querySelector('ellipse')).toBeNull();                 // поперёк
  expect(screen.getByText('Lay the garment flat and measure straight across, armpit to armpit.')).toBeInTheDocument();
  expect(screen.getByText(/We double bust, waist and hips when you save/)).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Bust, cm (flat)' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Length, cm' })).toBeInTheDocument(); // длины не «flat»
});

test('flat-looking numbers with "Full circumference" selected get a gentle warning', () => {
  render(<Editor initial={[{ size: 'S', chest: '36.5', waist: '31', hips: '40', length: '138', sleeve: '66', fit: 'tight' }]} />);
  expect(screen.getByRole('status')).toHaveTextContent('choose “Flat (half) width” above');
  fireEvent.click(screen.getByLabelText('Flat (half) width'));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('the size table inputs are labelled by measurement and size', () => {
  render(<Editor />);
  const table = screen.getByRole('table');
  expect(within(table).getByLabelText('Bust, size S')).toBeInTheDocument();
});
