// client/src/components/VoiceOrb.jsx
//
// Кнопка ассистента и голосовой ввод.
//   VoiceOrb    — круглая кнопка внизу справа со значком: только открывает панель.
//                 Раньше нажатие сразу включало распознавание речи — браузер без
//                 объяснения спрашивал доступ к микрофону, а панель не открывалась.
//   VoiceToggle — кнопка «Voice» в шапке панели. Распознавание (и запрос микрофона)
//                 создаётся только по её нажатию и останавливается при закрытии панели.
import React, { useEffect, useRef, useState } from "react";
import styles from "./VoiceOrb.module.css";

function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 2.5l1.9 5.1a3 3 0 0 0 1.8 1.8L20.8 11.3l-5.1 1.9a3 3 0 0 0-1.8 1.8L12 20.1l-1.9-5.1a3 3 0 0 0-1.8-1.8L3.2 11.3l5.1-1.9a3 3 0 0 0 1.8-1.8L12 2.5z"
      />
      <path fill="currentColor" d="M19 2l.7 1.8 1.8.7-1.8.7L19 7l-.7-1.8-1.8-.7 1.8-.7L19 2z" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z"
      />
    </svg>
  );
}

/** Плавающая кнопка: открывает панель ассистента. Микрофон не трогает. */
export default function VoiceOrb({ onOpen }) {
  return (
    <button
      type="button"
      className={styles.orb}
      onClick={() => onOpen?.()}
      aria-label="Open the assistant"
      title="Assistant"
    >
      <SparkleIcon />
    </button>
  );
}

/** Голосовой ввод — только когда покупатель сам его включил. */
export function VoiceToggle({ onFinalText }) {
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const [note, setNote] = useState("");
  const recRef = useRef(null);

  // панель закрыли — распознавание останавливаем
  useEffect(() => () => { try { recRef.current?.abort(); } catch {} }, []);

  function start() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setNote("Voice input is not supported in this browser."); return; }
    setNote("");
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let finalText = "";
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + " ";
      }
      const last = e.results[e.results.length - 1];
      if (last && !last.isFinal) setPartial(last[0].transcript);
      if (finalText.trim()) {
        setPartial("");
        onFinalText?.(finalText.trim());
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = (e) => {
      setListening(false);
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
        setNote("Microphone access is blocked. You can type your request instead.");
      }
    };
    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { setListening(false); }
  }

  function stop() {
    try { recRef.current?.stop(); } catch {}
    setListening(false);
  }

  return (
    <div className={styles.voice}>
      <button
        type="button"
        className={`ai-btn ${styles.voiceBtn} ${listening ? styles.voiceOn : ""}`}
        onClick={listening ? stop : start}
        aria-pressed={listening}
      >
        <MicIcon />
        {listening ? "Stop" : "Voice"}
      </button>
      {(listening || note) && (
        <div className={styles.status} role="status">
          {note || partial || "Listening… say what you are looking for"}
        </div>
      )}
    </div>
  );
}
