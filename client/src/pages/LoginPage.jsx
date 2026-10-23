import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { login } from '../utils/auth';
import FormErrors, { errorsOf } from '../components/FormErrors';
import styles from './Auth.module.css';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    const found = [
      ...(username.trim() ? [] : ['Please enter your username.']),
      ...(password ? [] : ['Please enter your password.']),
    ];
    setErrors(found);
    if (found.length) return;

    setBusy(true);
    try {
      const user = await login(username, password);
      // продавец — в свою панель, покупатель — в магазин
      navigate(user?.role === 'seller' ? '/seller' : '/');
    } catch (err) {
      setErrors(errorsOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleLogin}>
        <h1 className={styles.title}>Sign in</h1>

        <label className={styles.field}>
          <span className={styles.label}>Username</span>
          <input
            className={styles.input}
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Password</span>
          <input
            className={styles.input}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <FormErrors errors={errors} className={styles.error} />

        <button type="submit" className={styles.primary} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className={styles.foot}>
          No account yet? <Link to="/register">Create one</Link>
        </p>
      </form>
    </div>
  );
}
