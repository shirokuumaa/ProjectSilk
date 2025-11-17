import React, {useEffect, useState} from "react";
import { Link } from "react-router-dom";
import { getBaseURL } from "../assistant/api";

export default function OrdersList({ sessionId }){
  const [rows, setRows] = useState([]);
  useEffect(()=>{
    (async ()=>{
      const r = await fetch(`${getBaseURL()}/api/orders?session_id=${encodeURIComponent(sessionId)}`).then(r=>r.json());
      setRows((r.orders)||[]);
    })();
  }, [sessionId]);
  return (
    <div style={{display:"grid", gap:12}}>
      <h2>Мои заказы</h2>
      <ul>
        {rows.map(o=>(
          <li key={o.order_id}>
            <Link to={`/orders/${o.order_id}`}>#{o.order_id}</Link> — ${o.total_usd} — {o.created_at}
          </li>
        ))}
      </ul>
    </div>
  );
}