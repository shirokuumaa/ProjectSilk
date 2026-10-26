// Выбор фасона продавцом: картинки шаблонов своего типа, рукав и длина, «None of these».
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import SilhouettePicker from './SilhouettePicker';

function Harness({ type, initial = null, onChange = () => {} }) {
  const [value, setValue] = useState(initial);
  return (
    <SilhouettePicker
      garmentType={type}
      value={value}
      onChange={(v) => { setValue(v); onChange(v); }}
    />
  );
}

test('a dress offers the three dress silhouettes with their pictures and "None of these"', () => {
  render(<Harness type="dress" />);
  const cards = screen.getAllByRole('button');
  expect(cards.map((b) => b.textContent)).toEqual([
    expect.stringMatching(/^Fitted/), expect.stringMatching(/^A-line/), expect.stringMatching(/^Flared/),
    expect.stringMatching(/^None of these/),
  ]);
  const srcs = screen.getAllByRole('presentation').map((i) => i.getAttribute('src'));   // картинки с alt=""
  expect(srcs).toEqual(['/silhouettes/dress_fitted.png', '/silhouettes/dress_aline.png', '/silhouettes/dress_flared.png']);
  expect(screen.getByRole('button', { name: /None of these/ })).toHaveAttribute('aria-pressed', 'true');
});

test('picking a silhouette gives its default knobs; sleeve and length can be changed', () => {
  const onChange = jest.fn();
  render(<Harness type="dress" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: /A-line/ }));
  expect(onChange).toHaveBeenLastCalledWith({ template: 'dress_aline', sleeve: 'short', length: 'knee' });
  expect(screen.getByRole('button', { name: /A-line/ })).toHaveAttribute('aria-pressed', 'true');

  fireEvent.change(screen.getByLabelText('Sleeve'), { target: { value: 'long' } });
  fireEvent.change(screen.getByLabelText('Length'), { target: { value: 'maxi' } });
  expect(onChange).toHaveBeenLastCalledWith({ template: 'dress_aline', sleeve: 'long', length: 'maxi' });

  fireEvent.click(screen.getByRole('button', { name: /None of these/ }));
  expect(onChange).toHaveBeenLastCalledWith(null);
  expect(screen.queryByLabelText('Length')).not.toBeInTheDocument();
});

test('skirts have no sleeve knob and say that trousers are not supported yet', () => {
  render(<Harness type="bottom" initial={{ template: 'skirt_aline', length: 'knee' }} />);
  expect(screen.getByText(/Only skirts for now/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Sleeve')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Length')).toHaveValue('knee');
});

test.each(['outerwear', 'shoes', 'accessory', ''])('nothing to pick for "%s"', (type) => {
  const { container } = render(<Harness type={type} />);
  expect(container).toBeEmptyDOMElement();
});
