// Примерка по фото выключена: фото никуда не уходят; включённая — только на наш сервер.
import axios from 'axios';
import { photoTryOnEnabled, photoTryOnUrl, sendPhotoTryOn } from './photoTryOn';
import { tryOn } from '../assistant/api';

jest.mock('axios', () => ({ post: jest.fn() }));

const ENV = process.env.REACT_APP_PHOTO_TRYON;
afterEach(() => {
  process.env.REACT_APP_PHOTO_TRYON = ENV;
  jest.clearAllMocks();
});

test('off by default: no address and no request', async () => {
  delete process.env.REACT_APP_PHOTO_TRYON;
  expect(photoTryOnEnabled()).toBe(false);
  expect(photoTryOnUrl()).toBeNull();
  await expect(sendPhotoTryOn(new FormData())).rejects.toThrow('Photo try-on is turned off.');
  expect(axios.post).not.toHaveBeenCalled();
});

test('the old assistant helper no longer sends photos to the tunnel', async () => {
  delete process.env.REACT_APP_PHOTO_TRYON;
  global.fetch = jest.fn();
  await expect(tryOn({ human: { uri: 'h' }, garment: { uri: 'g' } })).rejects.toThrow('Photo try-on is turned off.');
  expect(global.fetch).not.toHaveBeenCalled();
  delete global.fetch;
});

test('when turned on, photos go only to our own server', async () => {
  process.env.REACT_APP_PHOTO_TRYON = 'on';
  axios.post.mockResolvedValue({ data: 'blob' });
  expect(photoTryOnUrl()).toBe('http://localhost:5050/api/ai/tryon');
  await expect(sendPhotoTryOn(new FormData())).resolves.toBe('blob');
  expect(axios.post.mock.calls[0][0]).toBe('http://localhost:5050/api/ai/tryon');
  expect(axios.post.mock.calls[0][0]).not.toMatch(/lhr\.life/);
});
