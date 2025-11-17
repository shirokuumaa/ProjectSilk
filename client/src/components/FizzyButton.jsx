import React, { useEffect, useRef, useState } from "react";

/** простой draggable + STT-триггер */
export default function FizzyButton() {
  const [pos, setPos] = useState(() => {
    // старт в правом нижнем углу
    const pad = 20;
    return { x: window.innerWidth - 80 - pad, y: window.innerHeight - 80 - pad };
  });
  const [drag, setDrag] = useState(null);
  const [active, setActive] = useState(false); // слушаем ли речь

  const recRef = useRef(null);

  // init STT
  useEffect(() => {
    if (!("webkitSpeechRecognition" in window)) return;
    const r = new window.webkitSpeechRecognition();
    r.lang = "ru-RU";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let txt = "";
      for (let i = e.resultIndex; i < e.results.length; i++) txt += e.results[i][0].transcript;
      const final = e.results[e.results.length - 1].isFinal;
      if (final) {
        window.dispatchEvent(new CustomEvent("ai:voiceQuery", { detail: txt.trim() }));
      }
    };
    r.onend = () => setActive(false);
    recRef.current = r;
  }, []);

  const startRec = () => {
    if (!recRef.current) return alert("Распознавание речи не поддерживается.");
    try { recRef.current.start(); setActive(true); } catch {}
  };
  const stopRec = () => { try { recRef.current?.stop(); } catch {}; setActive(false); };

  // drag
  const onDown = (e) => {
    const p = e.touches ? e.touches[0] : e;
    setDrag({ sx: p.clientX, sy: p.clientY, bx: pos.x, by: pos.y });
  };
  const onMove = (e) => {
    if (!drag) return;
    const p = e.touches ? e.touches[0] : e;
    setPos({ x: drag.bx + (p.clientX - drag.sx), y: drag.by + (p.clientY - drag.sy) });
  };
  const onUp = () => setDrag(null);

  // open panel by click (без перетаскивания)
  const onClick = () => {
    if (drag) return; // в момент перетаскивания — игнор
    if (active) stopRec(); else startRec();
    // одновременно раскрыть панель
    window.dispatchEvent(new CustomEvent("ai:open"));
  };

  const size = 72;
  const style = {
    position: "fixed",
    left: Math.max(10, Math.min(pos.x, window.innerWidth - size - 10)),
    top: Math.max(10, Math.min(pos.y, window.innerHeight - size - 10)),
    width: size, height: size, borderRadius: "50%",
    background: active ? "radial-gradient(circle at 30% 30%, #60a5fa, #1e40af)" : "radial-gradient(circle at 30% 30%, #93c5fd, #2563eb)",
    boxShadow: active ? "0 12px 28px rgba(37,99,235,.45)" : "0 10px 24px rgba(0,0,0,.18)",
    color: "#fff", display: "grid", placeItems: "center", cursor: "pointer", userSelect: "none",
    zIndex: 60, transition: "box-shadow 120ms ease"
  };

  return (
    <div
      style={style}
      onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
      onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
      onClick={onClick}
      title={active ? "Слушаю… Нажми чтобы остановить" : "Нажми, скажи запрос"}
    >
      {active ? "🎙️" : "🟣"}
    </div>
  );
}