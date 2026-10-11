import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { register } from '../utils/auth';

const MIN_PASSWORD = 8;

export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

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

    setBusy(true);
    try {
      await register(username, password); // при успехе пользователь сразу вошёл
      navigate('/');
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
        <input
          type="text"
          placeholder="Username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        /><br />
        <small style={{ color: '#6b7280' }}>3–32 characters: letters, digits, dot, dash or underscore.</small>
        <br /><br />
        <input
          type="password"
          placeholder="Password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        /><br />
        <small style={{ color: '#6b7280' }}>At least {MIN_PASSWORD} characters.</small>
        <br /><br />
        {error && <p role="alert" style={{ color: '#c92a2a', margin: '0 0 12px' }}>{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
      <p style={{ marginTop: 16 }}>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}
