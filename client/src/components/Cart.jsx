import React from 'react';

export default function Cart({ items, onRemove }) {
  return (
    <div style={{ padding: "20px", borderTop: "1px solid #eee" }}>
      <h2>🛒 Cart</h2>
      {items.length === 0 ? (
        <p>Your cart is empty.</p>
      ) : (
        <ul>
          {items.map((item, index) => (
            <li key={index} style={{ marginBottom: "10px" }}>
              {item.name} — {item.price} ₸
              <button onClick={() => onRemove(item.id)} style={{ marginLeft: "10px", color: "red" }}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}