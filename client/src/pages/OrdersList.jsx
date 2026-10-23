// client/src/pages/OrdersList.jsx — заказы сессии; пустой список и ошибка — с понятным текстом и ссылкой в магазин
import React, {useEffect, useState} from "react";
import { Link } from "react-router-dom";
import { getBaseURL } from "../assistant/api";

const page = { maxWidth: "var(--page-max)", margin: "0 auto", padding: "32px 16px", color: "var(--ink)", display: "grid", gap: 12 };
const title = { fontFamily: "var(--font-display)", margin: 0 };
const muted = { color: "var(--muted)", margin: 0 };
const shopLink = { color: "var(--ink)" };

export default function OrdersList({ sessionId }){
  const [rows, setRows] = useState([]);
  const [state, setState] = useState("loading"); // loading | ready | error
  useEffect(()=>{
    let alive = true;
    (async ()=>{
      try {
        const r = await fetch(`${getBaseURL()}/api/orders?session_id=${encodeURIComponent(sessionId)}`).then(r=>r.json());
        if (!alive) return;
        setRows((r && r.orders)||[]);
        setState("ready");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => { alive = false; };
  }, [sessionId]);

  return (
    <div style={page}>
      <h2 style={title}>My orders</h2>
      {state === "loading" && <p style={muted}>Loading your orders…</p>}
      {state === "error" && (
        <>
          <p style={muted}>We could not load your orders right now. Please try again later.</p>
          <Link to="/" style={shopLink}>← Back to the shop</Link>
        </>
      )}
      {state === "ready" && rows.length === 0 && (
        <>
          <p style={muted}>No orders yet. When you place an order, it will appear here.</p>
          <Link to="/" style={shopLink}>Browse the shop</Link>
        </>
      )}
      {state === "ready" && rows.length > 0 && (
        <ul>
          {rows.map(o=>(
            <li key={o.order_id}>
              <Link to={`/orders/${o.order_id}`}>#{o.order_id}</Link> — ${o.total_usd} — {o.created_at}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
