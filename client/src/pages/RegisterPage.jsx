import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function RegisterPage() {
  // State to store user input
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  // Function to handle registration logic
  const handleRegister = () => {
    if (!username || !password) {
      alert('Please fill in both username and password.');
      return;
    }

    // Save user info to localStorage
    const user = { username, password };
    localStorage.setItem('user', JSON.stringify(user));

    alert('Registration successful!');
    navigate('/login'); // Go to login page
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2>Register</h2>
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
      <button onClick={handleRegister}>Register</button>
    </div>
  );
}