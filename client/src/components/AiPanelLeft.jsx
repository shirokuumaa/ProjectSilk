import React, { useEffect, useRef } from "react";
import "./AiPanelLeft.css";

/**
 * Левая выезжающая панель ассистента.
 * Props:
 *  - open: boolean
 *  - onClose: () => void
 *  - title?: string
 *  - width?: string (например, "420px" или "360px")
 */
export default function AiPanelLeft({ open, onClose, children, title = "Fizzy — ассистент", width }) {
  const panelRef = useRef(null);
  const headingId = "ai-panel-title";

  useEffect(() => {
    if (!open) return;

    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);

    // блокируем прокрутку документа
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // фокус в панель
    setTimeout(() => panelRef.current?.focus(), 0);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="ai-overlay" onClick={onClose} />
      <aside
        className="ai-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        ref={panelRef}
        tabIndex={-1}
        /* даём возможность переопределять ширину панельки */
        style={width ? { ["--ai-panel-width"]: width } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ai-panel__header">
          <div id={headingId} className="ai-title">{title}</div>
          <button
            className="ai-btn ai-btn--ghost"
            onClick={onClose}
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        <div className="ai-panel__body">
          {/* Скин — общая типографика/контролы для содержимого */}
          <div className="ai-skin">
            {children}
          </div>
        </div>
      </aside>
    </>
  );
}