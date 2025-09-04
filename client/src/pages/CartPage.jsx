import React from 'react';

export default function CartPage({ cartItems, onRemove }) {
  return (
    <div style={{ padding: "20px", textAlign: "center" }}>
      <h2>Your Cart 🛒</h2>
      {cartItems.length === 0 ? (
        <p>Your cart is empty 🛒</p>
      ) : (
        <>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {cartItems.map((item, index) => (
              <li key={index} style={{ marginBottom: "10px" }}>
                {item.name} — {item.price} ₸
                <button
                  style={{ marginLeft: "10px", background: "#ff88aa", color: "white", border: "none", padding: "5px 10px", borderRadius: "5px" }}
                  onClick={() => onRemove(item.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <button style={{ marginTop: "20px", background: "#ccc", padding: "8px 20px", border: "none", borderRadius: "6px" }}>
            Checkout
          </button>
        </>
      )}
    </div>
  );
}