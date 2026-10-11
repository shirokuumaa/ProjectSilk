import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { register } from '../utils/auth';

const MIN_PASSWORD = 8;

const hint = { color: 'var(--muted)' };
const errorText = { color: 'var(--fit-bad)', margin: '0 0 12px' };

export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [accountType, setAccountType] = useState('buyer');
  const [storeName, setStoreName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const isSeller = accountType === 'seller';

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('Please fill in both username and password.');
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (isSeller && storeName.trim().length < 2) {
      setError('Please enter your store name (at least 2 characters).');
      return;
    }

    setBusy(true);
    try {
      // при успехе пользователь сразу вошёл
      await register(username, password, { accountType, storeName: isSeller ? storeName : undefined });
      navigate(isSeller ? '/seller' : '/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2>Create account</h2>
      <form onSubmit={handleRegister}>
        <fieldset style={{ border: 'none', padding: 0, margin: '0 0 16px' }}>
          <legend style={{ marginBottom: 6 }}>Account type</legend>
          <label style={{ marginRight: 16 }}>
            <input
              type="radio"
              name="accountType"
              value="buyer"
              checked={!isSeller}
              onChange={() => setAccountType('buyer')}
            />{' '}
            I want to shop
          </label>
          <label>
            <input
              type="radio"
              name="accountType"
              value="seller"
              checked={isSeller}
              onChange={() => setAccountType('seller')}
            />{' '}
            I want to sell
          </label>
        </fieldset>

        {isSeller && (
          <>
            <input
              type="text"
              placeholder="Store name"
              autoComplete="organization"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
            /><br />
            <small style={hint}>Shown to buyers on your products. 2–60 characters.</small>
            <br /><br />
          </>
        )}

        <input
          type="text"
          placeholder="Username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        /><br />
        <small style={hint}>3–32 characters: letters, digits, dot, dash or underscore.</small>
        <br /><br />
        <input
          type="password"
          placeholder="Password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        /><br />
        <small style={hint}>At least {MIN_PASSWORD} characters.</small>
        <br /><br />
        {error && <p role="alert" style={errorText}>{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : isSeller ? 'Create seller account' : 'Create account'}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}
