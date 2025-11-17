// client/src/components/RightDock.jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import styles from '../pages/HomePage.module.css';

export default function RightDock() {
  const nav = useNavigate();

  return (
    <div className={styles.rightDock}>
      {/* просто шлём событие для открытия левого AI-панеля */}
      <button
        className={styles.dockBtn}
        onClick={() => window.dispatchEvent(new Event('open-ai-panel'))}
        title="Открыть ассистента"
      >
        ✨ AI Assistant
      </button>

      <button
        className={styles.dockBtn}
        onClick={() => nav('/wardrobe')}
        title="Открыть гардероб"
      >
        🖊️ Wardrobe
      </button>

      <button
        className={styles.dockBtn}
        onClick={() => alert('Support — скоро')}
        title="Поддержка"
      >
        💬 Support
      </button>
    </div>
  );
}