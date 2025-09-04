import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function ProductCard({ product, addToCart }) {
  const nav = useNavigate();
  const openAR = () => nav(`/tryon/ar?image=${encodeURIComponent(product.image)}`);
  const open3D = () => nav(`/viewer?model=${encodeURIComponent(product.model3d || '')}`);

  return (
    <div style={{ border:'1px solid #eee', borderRadius:10, padding:12, width:220, textAlign:'center' }}>
      <img src={product.image} alt={product.title} style={{ width:'100%', borderRadius:8 }} />
      <h4 style={{ margin:'8px 0' }}>{product.title}</h4>
      <p>💵 {product.price} ₸</p>
      <div style={{ display:'flex', gap:8, justifyContent:'center', flexWrap:'wrap' }}>
        <button onClick={() => addToCart?.(product)}>Add to cart</button>
        <button onClick={openAR}>👗 Try in AR</button>
        {product.model3d && <button onClick={open3D}>🧩 View 3D</button>}
      </div>
    </div>
  );
}