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

test('skirts have no sleeve knob; shorts are not supported yet', () => {
  render(<Harness type="bottom" initial={{ template: 'skirt_aline', length: 'knee' }} />);
  expect(screen.getByText(/for shorts choose/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Sleeve')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Length')).toHaveValue('knee');
});

test('bottoms offer skirts and three trousers; trousers have their own lengths', () => {
  const onChange = jest.fn();
  render(<Harness type="bottom" initial={{ template: 'skirt_aline', length: 'midi' }} onChange={onChange} />);
  const srcs = screen.getAllByRole('presentation').map((i) => i.getAttribute('src'));
  expect(srcs.slice(3)).toEqual(['/silhouettes/pants_straight.png', '/silhouettes/pants_slim.png', '/silhouettes/pants_wide.png']);

  fireEvent.click(screen.getByRole('button', { name: /Wide-leg trousers/ }));
  expect(onChange).toHaveBeenLastCalledWith({ template: 'pants_wide', length: 'full' });
  const lengths = [...screen.getByLabelText('Length').querySelectorAll('option')].map((o) => o.value);
  expect(lengths).toEqual(['cropped', 'full']);
  expect(screen.queryByLabelText('Sleeve')).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Length'), { target: { value: 'cropped' } });
  expect(onChange).toHaveBeenLastCalledWith({ template: 'pants_wide', length: 'cropped' });
});

test('outerwear offers a jacket and a coat with lengths but no sleeve choice', () => {
  const onChange = jest.fn();
  render(<Harness type="outerwear" onChange={onChange} />);
  const srcs = screen.getAllByRole('presentation').map((i) => i.getAttribute('src'));
  expect(srcs).toEqual(['/silhouettes/jacket.png', '/silhouettes/coat.png']);
  expect(screen.getByText(/drafted closed, with lapels and long sleeves/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Coat/ }));
  expect(onChange).toHaveBeenLastCalledWith({ template: 'coat', length: 'knee' });
  fireEvent.click(screen.getByRole('button', { name: /Jacket/ }));
  expect(onChange).toHaveBeenLastCalledWith({ template: 'jacket', length: 'hip' });
  const lengths = [...screen.getByLabelText('Length').querySelectorAll('option')].map((o) => o.value);
  expect(lengths).toEqual(['hip', 'thigh', 'knee']);
  expect(screen.queryByLabelText('Sleeve')).not.toBeInTheDocument();
});

test.each(['shoes', 'accessory', ''])('nothing to pick for "%s"', (type) => {
  const { container } = render(<Harness type={type} />);
  expect(container).toBeEmptyDOMElement();
});
