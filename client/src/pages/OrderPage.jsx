import React, {useEffect, useState} from "react";
import { useParams, Link } from "react-router-dom";
import { getBaseURL } from "../assistant/api";

export default function OrderPage(){
  const { id } = useParams();
  const [data, setData] = useState(null);

  useEffect(()=>{
    (async ()=>{
      try {
        const r = await fetch(`${getBaseURL()}/api/orders/${encodeURIComponent(id)}`).then(r=>r.json());
        setData(r);
      } catch (e) {
        setData({ ok:false, error:String(e?.message||e) });
      }
    })();
  }, [id]);

  if(!data) return <div>Loading…</div>;
  if(!data.ok) {
    const msg = data.error === "no_db"
      ? "Orders storage is not available (DB missing)."
      : "Order not found";
    return <div>{msg}</div>;
  }

  const o = data.order, items = data.items||[];
  const totalFmt = (n)=> (typeof n === "number" ? n.toFixed(2) : n);
  return (
    <div style={{display:"grid", gap:12}}>
      <h2>Order #{o.order_id}</h2>
      <div>Created: {o.created_at}</div>
      <div>Total: ${totalFmt(o.total_usd)}</div>
      <h3>Items</h3>
      <ul>
        {items.map((it,i)=>(
          <li key={i}>
            {it.product_id} — size {it.size||"-"} × {it.qty} @ ${it.price_usd}
          </li>
        ))}
      </ul>
      <Link to="/orders">← Мои заказы</Link>
    </div>
  );
}