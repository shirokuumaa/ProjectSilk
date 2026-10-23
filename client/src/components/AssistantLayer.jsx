// client/src/components/AssistantLayer.jsx
import React, { useEffect, useState, lazy, Suspense } from "react";
import AiPanelLeft from "./AiPanelLeft";
import VoiceOrb, { VoiceToggle } from "./VoiceOrb";

// ВАЖНО: путь предполагает, что LunbeeWidget лежит в этой же папке /components
// Если он в другом месте — поправь путь соответственно.
const LunbeeWidget = lazy(() => import("./LunbeeWidget"));

export default function AssistantLayer() {
  const [open, setOpen] = useState(false);

  // Подписки на глобальные события, чтобы открывать/закрывать извне
  useEffect(() => {
    const openHandler = () => setOpen(true);
    const closeHandler = () => setOpen(false);
    const toggleHandler = () => setOpen((v) => !v);

    window.addEventListener("open-ai-panel", openHandler);
    window.addEventListener("close-ai-panel", closeHandler);
    window.addEventListener("toggle-ai-panel", toggleHandler);

    return () => {
      window.removeEventListener("open-ai-panel", openHandler);
      window.removeEventListener("close-ai-panel", closeHandler);
      window.removeEventListener("toggle-ai-panel", toggleHandler);
    };
  }, []);

  return (
    <>
      <AiPanelLeft
        open={open}
        onClose={() => setOpen(false)}
        actions={
          // голос — только по кнопке в панели; распознанный текст уходит в виджет событием
          <VoiceToggle
            onFinalText={(text) =>
              window.dispatchEvent(new CustomEvent("assistant-voice-text", { detail: { text } }))
            }
          />
        }
      >
        <Suspense fallback={<div className="text-sm opacity-70">Loading the assistant…</div>}>
          <LunbeeWidget />
        </Suspense>
      </AiPanelLeft>

      {/* кнопка открывает панель; пока панель открыта — не нужна */}
      {!open && <VoiceOrb onOpen={() => setOpen(true)} />}
    </>
  );
}
