import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { register } from '../utils/auth';
import FormErrors, { errorsOf } from '../components/FormErrors';
import styles from './Auth.module.css';

const MIN_PASSWORD = 8;
const MAX_PASSWORD_BYTES = 72; // как на сервере: bcrypt отбрасывает остальное
const USERNAME_RE = /^[a-z0-9_.-]{3,32}$/; // как в server/models/User.js (имя приводится к нижнему регистру)

/** Все ошибки формы сразу — покупатель исправляет их за один раз. */
export function registerErrors({ username, password, isSeller, storeName }) {
  const errors = [];
  if (isSeller && storeName.trim().length < 2) errors.push('Please enter your store name (at least 2 characters).');
  const name = username.trim().toLowerCase();
  if (!name) errors.push('Please enter a username.');
  else if (!USERNAME_RE.test(name)) errors.push('Username must be 3–32 characters: letters, digits, dot, dash or underscore.');
  if (!password) errors.push('Please enter a password.');
  else if (password.length < MIN_PASSWORD) errors.push(`Password must be at least ${MIN_PASSWORD} characters.`);
  else if (new Blob([password]).size > MAX_PASSWORD_BYTES) errors.push('Password is too long (maximum 72 characters).');
  return errors;
}


export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // «Create seller account» ведёт сюда с ?as=seller — роль продавца уже выбрана
  const [params] = useSearchParams();
  const [accountType, setAccountType] = useState(params.get('as') === 'seller' ? 'seller' : 'buyer');
  const [storeName, setStoreName] = useState('');
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const isSeller = accountType === 'seller';

  const handleRegister = async (e) => {
    e.preventDefault();
    const found = registerErrors({ username, password, isSeller, storeName });
    setErrors(found);
    if (found.length) return;

    setBusy(true);
    try {
      // при успехе пользователь сразу вошёл
      await register(username, password, { accountType, storeName: isSeller ? storeName : undefined });
      navigate(isSeller ? '/seller' : '/');
    } catch (err) {
      setErrors(errorsOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleRegister}>
        <h1 className={styles.title}>{isSeller ? 'Create a seller account' : 'Create account'}</h1>

        <fieldset className={styles.choices}>
          <legend>Account type</legend>
          <label className={`${styles.choice} ${!isSeller ? styles.choiceOn : ''}`}>
            <input
              type="radio"
              name="accountType"
              value="buyer"
              checked={!isSeller}
              onChange={() => setAccountType('buyer')}
            />
            I want to shop
          </label>
          <label className={`${styles.choice} ${isSeller ? styles.choiceOn : ''}`}>
            <input
              type="radio"
              name="accountType"
              value="seller"
              checked={isSeller}
              onChange={() => setAccountType('seller')}
            />
            I want to sell
          </label>
        </fieldset>

        {isSeller && (
          <div className={styles.field}>
            <label className={styles.field}>
              <span className={styles.label}>Store name</span>
              <input
                className={styles.input}
                type="text"
                autoComplete="organization"
                aria-describedby="hint-store"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
              />
            </label>
            <small id="hint-store" className={styles.hint}>Shown to buyers on your products. 2–60 characters.</small>
          </div>
        )}

        <div className={styles.field}>
          <label className={styles.field}>
            <span className={styles.label}>Username</span>
            <input
              className={styles.input}
              type="text"
              autoComplete="username"
              aria-describedby="hint-user"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <small id="hint-user" className={styles.hint}>3–32 characters: letters, digits, dot, dash or underscore.</small>
        </div>

        <div className={styles.field}>
          <label className={styles.field}>
            <span className={styles.label}>Password</span>
            <input
              className={styles.input}
              type="password"
              autoComplete="new-password"
              aria-describedby="hint-pass"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <small id="hint-pass" className={styles.hint}>At least {MIN_PASSWORD} characters.</small>
        </div>

        <FormErrors errors={errors} className={styles.error} />

        <button type="submit" className={styles.primary} disabled={busy}>
          {busy ? 'Creating…' : isSeller ? 'Create seller account' : 'Create account'}
        </button>

        <p className={styles.foot}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
