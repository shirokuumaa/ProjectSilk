// Ассистент: кнопка со значком открывает панель, микрофон — только по кнопке «Voice».
import { render, screen, fireEvent, act } from '@testing-library/react';
import AssistantLayer from './AssistantLayer';

jest.mock('./LunbeeWidget', () => () => <div>assistant widget</div>);

let created;
class FakeRecognition {
  constructor() { created.push(this); this.start = jest.fn(); this.stop = jest.fn(); this.abort = jest.fn(); }
}

beforeEach(() => {
  created = [];
  window.SpeechRecognition = FakeRecognition;
  navigator.mediaDevices = { getUserMedia: jest.fn() };
});
afterEach(() => { delete window.SpeechRecognition; delete navigator.mediaDevices; });

test('the assistant button has an icon and opens the panel without touching the microphone', async () => {
  render(<AssistantLayer />);
  const btn = screen.getByRole('button', { name: 'Open the assistant' });
  expect(btn.innerHTML).toMatch(/<svg[^>]*aria-hidden="true"/); // значок, а не пустой круг

  fireEvent.click(btn);

  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(await screen.findByText('assistant widget')).toBeInTheDocument();
  expect(created).toHaveLength(0);
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  // пока панель открыта, плавающая кнопка не мешает
  expect(screen.queryByRole('button', { name: 'Open the assistant' })).not.toBeInTheDocument();
});

test('voice starts only when the buyer turns it on, and the text reaches the widget', () => {
  const heard = jest.fn();
  window.addEventListener('assistant-voice-text', heard);
  render(<AssistantLayer />);
  fireEvent.click(screen.getByRole('button', { name: 'Open the assistant' }));
  expect(created).toHaveLength(0);

  fireEvent.click(screen.getByRole('button', { name: 'Voice' }));
  expect(created).toHaveLength(1);
  expect(created[0].start).toHaveBeenCalled();
  expect(created[0].lang).toBe('en-US');
  expect(screen.getByRole('button', { name: 'Stop' })).toHaveAttribute('aria-pressed', 'true');

  act(() => {
    created[0].onresult({ results: [Object.assign([{ transcript: 'black dress' }], { isFinal: true })] });
  });
  expect(heard).toHaveBeenCalledTimes(1);
  expect(heard.mock.calls[0][0].detail.text).toBe('black dress');
  window.removeEventListener('assistant-voice-text', heard);
});

test('closing the panel stops listening', () => {
  render(<AssistantLayer />);
  fireEvent.click(screen.getByRole('button', { name: 'Open the assistant' }));
  fireEvent.click(screen.getByRole('button', { name: 'Voice' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(created[0].abort).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Open the assistant' })).toBeInTheDocument();
});

test('no speech recognition in the browser: a plain note, no alert', () => {
  delete window.SpeechRecognition;
  window.alert = jest.fn();
  render(<AssistantLayer />);
  fireEvent.click(screen.getByRole('button', { name: 'Open the assistant' }));
  fireEvent.click(screen.getByRole('button', { name: 'Voice' }));
  expect(screen.getByRole('status')).toHaveTextContent('Voice input is not supported in this browser.');
  expect(window.alert).not.toHaveBeenCalled();
});
