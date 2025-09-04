import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function LoginPage() {
  // State to store input fields
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  // Function to handle login logic
  const handleLogin = () => {
    const savedUser = JSON.parse(localStorage.getItem('user'));

    if (!savedUser) {
      alert('No user found. Please register first.');
      return;
    }

    if (savedUser.username === username && savedUser.password === password) {
      localStorage.setItem('loggedInUser', username);
      alert('Login successful!');
      navigate('/');
    } else {
      alert('Wrong username or password.');
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2>Login</h2>
      <input
        type="text"
        placeholder="Enter username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      /><br /><br />
      <input
        type="password"
        placeholder="Enter password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      /><br /><br />
      <button onClick={handleLogin}>Login</button>
    </div>
  );
}