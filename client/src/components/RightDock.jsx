// client/src/components/RightDock.jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import styles from '../pages/HomePage.module.css';
import { assistantEnabled } from '../utils/features';

export default function RightDock() {
  const nav = useNavigate();

  return (
    <div className={styles.rightDock}>
      {/* просто шлём событие для открытия левого AI-панеля; ассистент пока спрятан (utils/features.js) */}
      {assistantEnabled() && (
        <button
          className={styles.dockBtn}
          onClick={() => window.dispatchEvent(new Event('open-ai-panel'))}
          title="Open the assistant"
        >
          ✨ AI Assistant
        </button>
      )}

      <button
        className={styles.dockBtn}
        onClick={() => nav('/wardrobe')}
        title="Open the wardrobe"
      >
        🖊️ Wardrobe
      </button>

      <button
        className={styles.dockBtn}
        onClick={() => alert('Support is coming soon.')}
        title="Support"
      >
        💬 Support
      </button>
    </div>
  );
}