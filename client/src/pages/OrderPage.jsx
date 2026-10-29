// client/src/pages/OrderPage.jsx — заказ покупателя: статус по шагам, вещи, контакты, адрес;
// пока продавец не подтвердил — «Cancel order» (остаток вернётся на склад продавца).
import React, { useEffect, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { cancelOrder, getOrder, ORDER_STATUS_LABELS, ORDER_STEPS } from "../utils/ordersApi";
import { formatPrice } from "../utils/money";
import { countryName } from "../utils/countries";
import styles from "./Shop.module.css";

const API_BASE = process.env.REACT_APP_API || "http://localhost:5050";
const toPublicUrl = (s = "") => (String(s).startsWith("/uploads") ? `${API_BASE}${s}` : s);
const when = (d) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function OrderPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getOrder(id)
      .then((o) => alive && setOrder(o))
      .catch((e) => alive && setError(e.status === 404 ? "Order not found" : e.message));
    return () => { alive = false; };
  }, [id]);

  const cancel = async () => {
    setBusy(true);
    try { setOrder(await cancelOrder(id)); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  if (error && !order) {
    return (
      <main className={`ui-container ${styles.page}`}>
        <h1 className={styles.title}>{error}</h1>
        <Link to="/orders" className="ui-btn">← My orders</Link>
      </main>
    );
  }
  if (!order) return <main className={`ui-container ${styles.page}`}><p className={styles.muted}>Loading…</p></main>;

  const reached = (s) => order.history.some((h) => h.status === s);
  const a = order.address;

  return (
    <main className={`ui-container ${styles.page}`}>
      <Link to="/orders" className={styles.muted}>← My orders</Link>
      <h1 className={styles.title} style={{ marginTop: "var(--sp-3)" }}>
        Order <span className={styles.orderNo}>{order.number}</span>
      </h1>
      {params.get("placed") && (
        <div className={styles.success} role="status">
          Thank you — your order is placed. {order.storeName || "The seller"} will contact you about payment and delivery.
        </div>
      )}

      <div className={styles.layout}>
        <section className={`ui-card ${styles.panel}`}>
          <div className={styles.orderHead}>
            <h2 className={styles.panelTitle}>{ORDER_STATUS_LABELS[order.status]}</h2>
            {order.storeName && <span className={styles.muted}>Sold by {order.storeName}</span>}
          </div>
          {order.status === "cancelled" ? (
            <p className={styles.note}>This order was cancelled.</p>
          ) : (
            <div className={styles.steps}>
              {ORDER_STEPS.map((s) => (
                <div key={s} className={`${styles.step} ${reached(s) ? styles.stepOn : ""}`}>{ORDER_STATUS_LABELS[s]}</div>
              ))}
            </div>
          )}

          <ul className={styles.lines} style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {order.items.map((it, i) => (
              <li key={`${it.product}-${it.size}-${i}`} className={styles.line}>
                <img className={styles.thumb} src={toPublicUrl(it.image)} alt="" />
                <div>
                  <Link to={`/product/${it.product}`} className={styles.lineName}>{it.title}</Link>
                  <div className={styles.lineMeta}>{it.size ? `Size ${it.size}` : "One size"} · × {it.quantity}</div>
                </div>
                <div className={styles.linePrice}>{formatPrice(it.price * it.quantity, order.currency)}</div>
              </li>
            ))}
          </ul>
        </section>

        <aside className={`ui-card ${styles.panel}`}>
          <h2 className={styles.panelTitle}>Details</h2>
          <dl className={styles.facts}>
            <dt>Placed</dt><dd>{when(order.createdAt)}</dd>
            <dt>Name</dt><dd>{order.contact.name}</dd>
            <dt>Phone</dt><dd>{order.contact.phone}</dd>
            {order.contact.email && (<><dt>Email</dt><dd>{order.contact.email}</dd></>)}
            <dt>Address</dt>
            <dd>{[a.line1, a.line2, a.city, a.postcode, countryName(a.country)].filter(Boolean).join(", ")}</dd>
            {order.note && (<><dt>Note</dt><dd>{order.note}</dd></>)}
            <dt>Payment</dt><dd>Coming soon — arranged with the seller</dd>
          </dl>
          <div className={`${styles.sumRow} ${styles.sumTotal}`}><span>Total</span><span>{formatPrice(order.total, order.currency)}</span></div>
          {order.status === "placed" && (
            <button className={`ui-btn ${styles.full}`} onClick={cancel} disabled={busy}>
              {busy ? "Cancelling…" : "Cancel order"}
            </button>
          )}
          {error && <p className={styles.note} role="alert">{error}</p>}
        </aside>
      </div>
    </main>
  );
}
