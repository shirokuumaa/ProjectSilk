import React, { useEffect, useRef, useState } from "react";

// props:
// - onFinalText(text) -> что сделать с распознанным запросом
// - getReplyText? -> async (text) => string (если хочешь сразу TTS ответа)
// - bottom, right (позиция)
export default function VoiceOrb({ onFinalText, getReplyText, bottom=20, right=20 }) {
  const [listening, setListening] = useState(false);
  const [voices, setVoices] = useState([]);
  const [voiceName, setVoiceName] = useState("");
  const synthRef = useRef(window.speechSynthesis);
  const recRef = useRef(null);
  const [partial, setPartial] = useState("");

  useEffect(() => {
    const loadVoices = () => setVoices(synthRef.current.getVoices() || []);
    loadVoices();
    if (synthRef.current && synthRef.current.onvoiceschanged === null) {
      synthRef.current.onvoiceschanged = loadVoices;
    } else {
      // Safari иногда требует таймаут
      setTimeout(loadVoices, 500);
    }
  }, []);

  function speak(text) {
    if (!text) return;
    const u = new SpeechSynthesisUtterance(text);
    const v = voices.find(v => v.name === voiceName) || voices[0];
    if (v) u.voice = v;
    synthRef.current.cancel();
    synthRef.current.speak(u);
  }

  function startRec() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("SpeechRecognition недоступен в этом браузере"); return; }
    const rec = new SR();
    rec.lang = "ru-RU";      // авто-язык? можешь делать 'en-US' по UI
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = async (e) => {
      let finalText = "";
      for (let i=0;i<e.results.length;i++){
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript + " ";
      }
      const last = e.results[e.results.length - 1];
      if (last && !last.isFinal) setPartial(last[0].transcript);
      if (finalText.trim()) {
        setPartial("");
        const txt = finalText.trim();
        // wake-word: "hey fizzy"
        if (/hey\s+fizzy/i.test(txt) || /эй\s+физзи/i.test(txt)) {
          // просто подтверждаем, дальше слушаем следующую фразу
          speak("Слушаю");
        } else {
          onFinalText?.(txt);
          if (getReplyText) {
            try { const reply = await getReplyText(txt); speak(reply); } catch {}
          }
        }
      }
    };
    rec.onend = ()=> setListening(false);
    rec.onerror = ()=> setListening(false);
    rec.start();
    recRef.current = rec;
    setListening(true);
  }

  function stopRec() {
    try { recRef.current?.stop(); } catch {}
    setListening(false);
  }

  return (
    <>
      <div style={{
        position:"fixed", bottom, right, zIndex:1000,
        width:68, height:68, borderRadius:"50%",
        background: listening ? "#111827" : "#ffffff",
        color: listening ? "#fff" : "#111827",
        border:"1px solid #e5e7eb", boxShadow:"0 8px 16px rgba(0,0,0,.12)",
        display:"grid", placeItems:"center", cursor:"pointer", userSelect:"none"
      }} onClick={() => listening ? stopRec() : startRec()} title={listening?"Stop":"Hey, Fizzy"}>
        {listening ? "🎤" : "🟣"}
      </div>

      {/* маленькая карточка статуса */}
      {listening && (
        <div style={{
          position:"fixed", bottom: bottom+80, right, zIndex:1000,
          background:"#fff", border:"1px solid #e5e7eb", borderRadius:12, padding:10, width:260,
          boxShadow:"0 8px 16px rgba(0,0,0,.12)", fontSize:13
        }}>
          <div style={{marginBottom:6, fontWeight:600}}>Listening… say “Hey, Fizzy”</div>
          <div style={{opacity:.7, minHeight:18}}>{partial}</div>
          <div style={{marginTop:8, display:"flex", gap:6, alignItems:"center"}}>
            <span style={{opacity:.7}}>Voice:</span>
            <select value={voiceName} onChange={e=>setVoiceName(e.target.value)} style={{flex:1}}>
              <option value="">Default</option>
              {voices.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select>
          </div>
        </div>
      )}
    </>
  );
}