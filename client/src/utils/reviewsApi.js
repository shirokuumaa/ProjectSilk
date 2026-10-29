// client/src/utils/reviewsApi.js — отзывы о посадке (server/routes/reviewRoutes.js)
import { authFetch, isLoggedIn } from './auth';

const API = process.env.REACT_APP_API || 'http://localhost:5050';

export const FIT_LABELS = { small: 'Runs small', true: 'True to size', large: 'Runs large' };
export const ZONE_LABELS = { bust: 'Bust', waist: 'Waist', hips: 'Hips', length: 'Length' };
export const FEEL_LABELS = { tight: 'Tight', ok: 'Just right', loose: 'Loose' };

async function json(r) {
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const err = new Error(data?.message || 'Something went wrong. Please try again.');
    err.errors = data?.errors;
    throw err;
  }
  return data;
}

export const submitReview = (review) => authFetch(`${API}/api/reviews`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(review),
}).then(json);

export const myReviews = () => (isLoggedIn() ? authFetch(`${API}/api/reviews/mine`).then(json) : Promise.resolve([]));

export const productReviews = (id) => fetch(`${API}/api/reviews/product/${encodeURIComponent(id)}`).then(json);

/** Что брали люди с похожей фигурой — только для вошедшего с обмерами. */
export const similarFigure = (id) => (isLoggedIn()
  ? authFetch(`${API}/api/reviews/similar/${encodeURIComponent(id)}`).then(json).catch(() => null)
  : Promise.resolve(null));
