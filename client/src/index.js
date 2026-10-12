import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { cleanupLegacyAuth } from './utils/auth';
import { readAvatarMode } from './utils/avatarMode';

// старый вход хранил пароль в localStorage 'user' — убираем до первого рендера
cleanupLegacyAuth();

// ?avatar=base / ?avatar=standard в адресе любой страницы — запомнить режим тела
readAvatarMode();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
