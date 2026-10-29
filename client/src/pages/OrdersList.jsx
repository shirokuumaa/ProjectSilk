// client/src/pages/OrdersList.jsx — «My orders»: заказы покупателя с нашего сервера
// (server/routes/orderRoutes.js). Пусто, ошибка, гость — у каждого состояния свой понятный текст.
import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { myOrders, ORDER_STATUS_LABELS } from "../utils/ordersApi";
import { formatPrice } from "../utils/money";
import { isLoggedIn } from "../utils/auth";
import styles from "./Shop.module.css";

const API_BASE = process.env.REACT_APP_API || "http://localhost:5050";
const toPublicUrl = (s = "") => (String(s).startsWith("/uploads") ? `${API_BASE}${s}` : s);
const dateOf = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function OrdersList() {
  const [params] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [state, setState] = useState(isLoggedIn() ? "loading" : "guest"); // loading | ready | error | guest

  useEffect(() => {
    if (!isLoggedIn()) return undefined;
    let alive = true;
    myOrders()
      .then((list) => { if (alive) { setRows(list || []); setState("ready"); } })
      .catch(() => alive && setState("error"));
    return () => { alive = false; };
  }, []);

  return (
    <main className={`ui-container ${styles.page}`}>
      <h1 className={styles.title}>My orders</h1>
      {params.get("placed") && state === "ready" && (
        <div className={styles.success} role="status">Thank you — your orders are placed. Each store will contact you about payment and delivery.</div>
      )}
      {state === "loading" && <p className={styles.muted}>Loading your orders…</p>}
      {state === "guest" && (
        <div className={styles.empty}>
          <p className={styles.muted}>Sign in to see your orders.</p>
          <Link to="/login?next=/orders" className="ui-btn ui-btn--primary">Sign in</Link>
        </div>
      )}
      {state === "error" && (
        <div className={styles.empty}>
          <p className={styles.muted}>We could not load your orders right now. Please try again later.</p>
          <Link to="/" className="ui-btn">← Back to the shop</Link>
        </div>
      )}
      {state === "ready" && rows.length === 0 && (
        <div className={styles.empty}>
          <p className={styles.muted}>No orders yet. When you place an order, it will appear here.</p>
          <Link to="/" className="ui-btn ui-btn--primary">Browse the shop</Link>
        </div>
      )}
      {state === "ready" && rows.length > 0 && (
        <div className={styles.orders}>
          {rows.map((o) => (
            <Link key={o._id} to={`/orders/${o._id}`} className={`ui-card ${styles.orderCard}`}>
              <div className={styles.orderHead}>
                <span>
                  <span className={styles.orderNo}>{o.number}</span>
                  <span className={styles.muted}> · {dateOf(o.createdAt)}{o.storeName ? ` · ${o.storeName}` : ""}</span>
                </span>
                <span className={`ui-chip ${o.status === "cancelled" ? "" : o.status === "delivered" ? "ui-chip--good" : "ui-chip--dark"}`}>
                  {ORDER_STATUS_LABELS[o.status] || o.status}
                </span>
              </div>
              <div className={styles.orderHead}>
                <span className={styles.thumbs}>
                  {o.items.slice(0, 5).map((it, i) => (
                    <img key={`${it.product}-${it.size}-${i}`} className={`${styles.thumb} ${styles.thumbSm}`} src={toPublicUrl(it.image)} alt={it.title} />
                  ))}
                </span>
                <b>{formatPrice(o.total, o.currency)}</b>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
