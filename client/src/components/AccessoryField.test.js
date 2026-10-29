// Карточка аксессуара в форме продавца: у одежды её нет, у обуви — размер и система,
// у аксессуара — вид и поля этого вида; на сервер уходит только заполненное.
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import AccessoryField, { serializeAccessory } from './AccessoryField';

function Harness({ type, initial = null }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <AccessoryField garmentType={type} value={value} onChange={setValue} />
      <output data-testid="sent">{serializeAccessory(type, value)}</output>
    </>
  );
}

test('clothes have no accessory card', () => {
  const { container } = render(<Harness type="dress" />);
  expect(container.querySelector('fieldset')).toBeNull();
  expect(serializeAccessory('dress', { kind: 'watch', widthCm: '4' })).toBe('');
});

test('shoes ask for the size and its system', () => {
  render(<Harness type="shoes" />);
  fireEvent.change(screen.getByLabelText('Shoe size'), { target: { value: '38.5' } });
  fireEvent.change(screen.getByLabelText('Size system'), { target: { value: 'US-W' } });
  expect(JSON.parse(screen.getByTestId('sent').textContent)).toEqual({ kind: 'shoes', size: '38.5', sizeSystem: 'US-W' });
});

test('an accessory shows the fields of its kind; changing the kind starts afresh', () => {
  render(<Harness type="accessory" />);
  expect(screen.getByTestId('sent').textContent).toBe('');
  fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'shoulder_bag' } });
  ['Width, cm', 'Height, cm', 'Depth, cm', 'Strap drop, cm', 'Worn on'].forEach((l) => expect(screen.getByLabelText(l)).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Width, cm'), { target: { value: '28' } });
  fireEvent.change(screen.getByLabelText('Worn on'), { target: { value: 'r' } });
  expect(JSON.parse(screen.getByTestId('sent').textContent)).toEqual({ kind: 'shoulder_bag', widthCm: '28', side: 'r' });

  fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'earrings' } });
  expect(screen.getByLabelText('Drop length, cm')).toHaveValue(null);
  expect(screen.queryByLabelText('Width, cm')).toBeNull();
  expect(JSON.parse(screen.getByTestId('sent').textContent)).toEqual({ kind: 'earrings' });
});
