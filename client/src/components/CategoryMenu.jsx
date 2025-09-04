import React from 'react';

export default function CategoryMenu({ selected, onSelect }) {
  const categories = ["All", "Clothes", "Home", "Electronics"];

  return (
    <div style={{
      display: "flex",
      justifyContent: "center",
      flexWrap: "wrap",
      gap: "12px",
      margin: "24px 0",
    }}>
      {categories.map((category) => (
        <button
          key={category}
          onClick={() => onSelect(category)}
          style={{
            padding: "10px 18px",
            border: "1px solid #ddd",
            borderRadius: "25px",
            backgroundColor: selected === category ? "#ff88aa" : "#fff",
            color: selected === category ? "#fff" : "#333",
            cursor: "pointer",
            fontWeight: "500",
            fontSize: "14px",
            boxShadow: selected === category ? "0 2px 6px rgba(0,0,0,0.2)" : "none",
            transition: "all 0.2s ease-in-out",
          }}
        >
          {category}
        </button>
      ))}
    </div>
  );
}