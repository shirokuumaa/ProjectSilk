import React, { useEffect, useState } from "react";
import { getBaseURL } from "../assistant/api";

function BarChart({ data, keys }) {
  const W = 680, H = 240, P = 28;
  const days = data.map(d => d.date);
  const totals = data.map(d => keys.reduce((s,k)=>s+(d.events[k]||0),0));
  const maxV = Math.max(1, ...totals);
  const bw = (W - 2*P) / Math.max(1, days.length);
  return (
    <svg width={W} height={H} style={{border:"1px solid #e5e7eb", borderRadius:12}}>
      {/* оси */}
      <line x1={P} y1={H-P} x2={W-P} y2={H-P} stroke="#ddd" />
      <line x1={P} y1={P} x2={P} y2={H-P} stroke="#ddd" />
      {/* бары */}
      {totals.map((v,i)=>{
        const h = Math.round((v/maxV) * (H-2*P));
        const x = P + i*bw + 6;
        const y = H-P-h;
        return <rect key={i} x={x} y={y} width={bw-12} height={h} fill="#93c5fd" />;
      })}
      {/* подписи */}
      {days.map((d,i)=>{
        const x = P + i*bw + bw/2;
        return <text key={d} x={x} y={H-8} fontSize="10" textAnchor="middle" fill="#555">{d.slice(5)}</text>;
      })}
    </svg>
  );
}

export default function Metrics(){
  const [rows, setRows] = useState([]);

  // Ключи для графика (можно расширять)
  const keys = ["search","search_click","add_to_cart","compare","similar","checkout","checkout_ok"];

  useEffect(()=>{
    (async ()=>{
      try {
        const r = await fetch(`${getBaseURL()}/api/metrics/daily`).then(r=>r.json());
        setRows(r.days || []);
      } catch {
        setRows([]);
      }
    })();
  },[]);

  // -------- CTR (rough) = sum(clicks) / max(1, sum(searches)) --------
  const totalSearches = rows.reduce((s,r)=> s + (r.events?.search || 0), 0);
  const totalClicks   = rows.reduce((s,r)=> s + (r.events?.search_click || 0), 0);
  const ctr = (totalClicks / Math.max(1, totalSearches)).toFixed(3);

  return (
    <div style={{display:"grid", gap:12}}>
      <div style={{display:"flex", alignItems:"baseline", gap:12}}>
        <h2 style={{fontSize:20, fontWeight:700, margin:0}}>Metrics</h2>
        <div style={{fontSize:14, opacity:.8}}>
          CTR (rough): <b>{ctr}</b> &nbsp;
          <span style={{opacity:.7}}>
            (clicks={totalClicks}, searches={totalSearches})
          </span>
        </div>
      </div>

      <BarChart data={rows} keys={keys} />

      <table style={{borderCollapse:"collapse", width:"100%", border:"1px solid #e5e7eb"}}>
        <thead>
          <tr style={{background:"#f9fafb"}}>
            <th style={{padding:8, border:"1px solid #e5e7eb"}}>Date</th>
            {keys.map(k=>(
              <th key={k} style={{padding:8, border:"1px solid #e5e7eb"}}>{k}</th>
            ))}
            <th style={{padding:8, border:"1px solid #e5e7eb"}}>Total (row)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r=>{
            const rowTotal = keys.reduce((s,k)=>s+(r.events[k]||0),0);
            return (
              <tr key={r.date}>
                <td style={{padding:8, border:"1px solid #e5e7eb"}}>{r.date}</td>
                {keys.map(k=>(
                  <td key={k} style={{padding:8, border:"1px solid #e5e7eb"}}>{r.events[k]||0}</td>
                ))}
                <td style={{padding:8, border:"1px solid #e5e7eb", fontWeight:600}}>{rowTotal}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}