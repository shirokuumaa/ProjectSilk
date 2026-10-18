// client/src/components/AccountSync.jsx
//
// Гардероб и обмеры вошедшего покупателя живут на сервере.
// При входе (и при открытии сайта уже вошедшим) кэш в браузере заполняется с сервера.
// Если гость успел что-то сохранить до входа — предлагаем перенести это в аккаунт.
import React, { useCallback, useEffect, useState } from 'react';
import { AUTH_EVENT, LOGIN_EVENT, isLoggedIn } from '../utils/auth';
import { loadBodyProfile } from '../utils/bodyProfileApi';
import {
  pullWardrobe, getGuestWardrobe, moveGuestWardrobeToAccount, discardGuestWardrobe,
} from '../utils/wardrobeStorage';
import styles from './AccountSync.module.css';

const plural = (n) => (n === 1 ? '1 item' : `${n} items`);

export default function AccountSync() {
  const [guest, setGuest] = useState([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const pull = useCallback(async () => {
    if (!isLoggedIn()) return;
    await Promise.all([pullWardrobe(), loadBodyProfile()]);
    if (isLoggedIn()) setGuest(getGuestWardrobe());
  }, []);

  useEffect(() => {
    pull();
    const onAuth = () => {
      if (!isLoggedIn()) { setGuest([]); setNote(''); }
    };
    window.addEventListener(LOGIN_EVENT, pull);
    window.addEventListener(AUTH_EVENT, onAuth);
    return () => {
      window.removeEventListener(LOGIN_EVENT, pull);
      window.removeEventListener(AUTH_EVENT, onAuth);
    };
  }, [pull]);

  useEffect(() => {
    if (!note) return undefined;
    const t = setTimeout(() => setNote(''), 4000);
    return () => clearTimeout(t);
  }, [note]);

  const move = async () => {
    setBusy(true);
    const moved = await moveGuestWardrobeToAccount();
    setBusy(false);
    setGuest([]);
    setNote(moved ? `Added ${plural(moved)} to your wardrobe.` : 'Could not add the items. Please try again later.');
  };

  const discard = () => {
    discardGuestWardrobe();
    setGuest([]);
  };

  if (!guest.length && !note) return null;

  return (
    <div className={styles.bar} role="status">
      {guest.length ? (
        <>
          <span className={styles.text}>
            You saved {plural(guest.length)} on this device before signing in.
            Add {guest.length === 1 ? 'it' : 'them'} to your account?
          </span>
          <div className={styles.actions}>
            <button className={styles.primary} onClick={move} disabled={busy}>
              {busy ? 'Adding…' : 'Add to my account'}
            </button>
            <button className={styles.secondary} onClick={discard} disabled={busy}>Discard</button>
          </div>
        </>
      ) : (
        <span className={styles.text}>{note}</span>
      )}
    </div>
  );
}
