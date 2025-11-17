import React, { useEffect, useRef, useState } from "react";

const API = process.env.REACT_APP_ASSISTANT_API || "http://127.0.0.1:8000";

/** Быстрая озвучка текста */
function speak(text, voiceName) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    const all = window.speechSynthesis.getVoices();
    if (voiceName) {
      const v = all.find((x) => x.name === voiceName);
      if (v) u.voice = v;
    }
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {}
}

/** Простой STT на базе webkitSpeechRecognition (Safari/Chrome) */
function useBrowserSTT(onFinalText) {
  const recRef = useRef(null);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!("webkitSpeechRecognition" in window)) return;
    const r = new window.webkitSpeechRecognition();
    r.lang = "ru-RU";                 // можно поменять
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let txt = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        txt += e.results[i][0].transcript;
      }
      if (e.results[e.results.length - 1].isFinal && onFinalText) {
        onFinalText(txt.trim());
      }
    };
    r.onend = () => setListening(false);
    recRef.current = r;
    return () => { try { r.abort(); } catch {} };
  }, [onFinalText]);

  const start = () => {
    if (!recRef.current) return alert("Распознавание речи не поддерживается в этом браузере.");
    try { recRef.current.start(); setListening(true); } catch {}
  };
  const stop = () => { try { recRef.current?.stop(); } catch {}; setListening(false); };

  return { listening, start, stop };
}

export default function AIChatSidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", text: "Привет! Я помогу подобрать вещи. Напиши или скажи голосом 🌼" },
  ]);
  const [userInput, setUserInput] = useState("");
  const [sending, setSending] = useState(false);

  const [voices, setVoices] = useState([]);
  const [voiceName, setVoiceName] = useState("");

  // загрузка голосов TTS
  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis?.getVoices?.() || []);
    load();
    window.speechSynthesis?.addEventListener?.("voiceschanged", load);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", load);
  }, []);

  // слушаем события от кнопок/дока
  useEffect(() => {
    const onOpen = () => setIsOpen(true);
    const onToggle = () => setIsOpen((x) => !x);
    const onVoiceQuery = (e) => { setIsOpen(true); send(e.detail); }; // из шарика
    window.addEventListener("ai:open", onOpen);
    window.addEventListener("ai:toggle", onToggle);
    window.addEventListener("ai:voiceQuery", onVoiceQuery);
    return () => {
      window.removeEventListener("ai:open", onOpen);
      window.removeEventListener("ai:toggle", onToggle);
      window.removeEventListener("ai:voiceQuery", onVoiceQuery);
    };
  }, []);

  // STT: при финальном распознавании сразу шлём запрос
  const { listening, start, stop } = useBrowserSTT((finalText) => {
    setUserInput(finalText);
    send(finalText);
  });

  async function send(textMaybe) {
    const text = (textMaybe ?? userInput).trim();
    if (!text) return;
    setSending(true);
    setMessages((m) => [...m, { role: "user", text }]);
    setUserInput("");

    try {
      // ⚠️ ожидаем, что на 8000 есть POST /api/chat  {message:string} -> {answer:string}
      const r = await fetch(`${API}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await r.json().catch(() => ({}));
      const answer = data?.answer || "Извини, не смогла ответить.";
      setMessages((m) => [...m, { role: "assistant", text: answer }]);
      speak(answer, voiceName);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: "Сервер недоступен. Попробуй позже." }]);
    } finally {
      setSending(false);
    }
  }

  // стили без Tailwind, чтобы точно отрисовалось в любом окружении
  const styles = {
    trigger: {
      position: "fixed", top: 120, right: 16, zIndex: 40,
      background: "#111827", color: "#fff", border: "none",
      padding: "8px 12px", borderRadius: 999, cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,.15)"
    },
    panelWrap: {
      position: "fixed", top: 100, right: 100, width: 360, height: 520,
      background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16,
      boxShadow: "0 10px 30px rgba(0,0,0,.15)", overflow: "hidden", zIndex: 50,
      display: isOpen ? "grid" : "none", gridTemplateRows: "auto 1fr auto"
    },
    header: { padding: 12, borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 8 },
    hTitle: { fontWeight: 700, fontSize: 16, flex: 1 },
    body: { padding: 12, overflow: "auto", background: "#fafafa" },
    bubbleU: { background: "#111827", color: "#fff", padding: "8px 10px", borderRadius: 12, margin: "6px 0", maxWidth: "85%", marginLeft: "auto" },
    bubbleA: { background: "#fff", color: "#111827", padding: "8px 10px", borderRadius: 12, margin: "6px 0", maxWidth: "85%", border: "1px solid #e5e7eb" },
    inputRow: { display: "grid", gridTemplateColumns: "1fr auto", gap: 8, padding: 12, borderTop: "1px solid #f3f4f6", background: "#fff" },
    text: { padding: "8px 10px", border: "1px solid #e5e7eb", borderRadius: 10 },
    sendBtn: { padding: "8px 12px", border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff", cursor: "pointer" },
    smallBtn: { border: "1px solid #e5e7eb", borderRadius: 999, padding: "6px 8px", background: "#fff", cursor: "pointer" }
  };

  return (
    <>
      {/* Кнопка-триггер (рядом с твоим правым доком) */}
      <button style={styles.trigger} onClick={() => setIsOpen(true)}>AI Assistant</button>

      {/* Панель */}
      <div style={styles.panelWrap}>
        <div style={styles.header}>
          <div style={styles.hTitle}>Ассистент</div>
          {/* mic */}
          <button style={styles.smallBtn} onClick={listening ? stop : start} title="Голосом">
            {listening ? "🎙️ Stop" : "🎙️ Speak"}
          </button>
          {/* TTS voice */}
          <select
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value)}
            style={{ ...styles.smallBtn, padding: 6, maxWidth: 140 }}
            title="Голос озвучки"
          >
            <option value="">Default voice</option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>{v.name}</option>
            ))}
          </select>
          <button style={styles.smallBtn} onClick={() => setIsOpen(false)}>✕</button>
        </div>

        <div style={styles.body}>
          {messages.map((m, i) => (
            <div key={i} style={m.role === "user" ? styles.bubbleU : styles.bubbleA}>{m.text}</div>
          ))}
        </div>

        <div style={styles.inputRow}>
          <input
            style={styles.text}
            placeholder="Ваш вопрос…"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => (e.key === "Enter" ? send() : null)}
          />
          <button style={styles.sendBtn} onClick={send} disabled={sending}>
            {sending ? "..." : "➤"}
          </button>
        </div>
      </div>
    </>
  );
}