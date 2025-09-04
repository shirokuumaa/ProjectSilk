import React, { useState } from 'react';

export default function App() {
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState('');

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    setImage(file);

    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result);
    };
    if (file) {
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const formData = new FormData();
    formData.append('title', title);
    formData.append('price', price);
    formData.append('image', image);

    try {
      const res = await fetch('http://localhost:5000/api/products', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (res.ok) {
        alert('✅ Product added to MongoDB!');
        setTitle('');
        setPrice('');
        setImage(null);
        setPreview('');
      } else {
        alert('❌ Failed to upload: ' + data.message);
      }
    } catch (err) {
      console.error('Error:', err);
      alert('❌ Something went wrong.');
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>👩‍💼 Seller Panel</h1>
      <p>Upload your product here</p>

      <form onSubmit={handleSubmit} style={{ maxWidth: '400px' }}>
        <input
          type="text"
          placeholder="Product title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          style={{ display: 'block', marginBottom: '10px', width: '100%' }}
        />
        <input
          type="number"
          placeholder="Price"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          required
          style={{ display: 'block', marginBottom: '10px', width: '100%' }}
        />
        <input
          type="file"
          accept="image/*"
          onChange={handleImageChange}
          required
          style={{ display: 'block', marginBottom: '10px' }}
        />

        {preview && (
          <img
            src={preview}
            alt="Preview"
            style={{ width: '100%', marginBottom: '10px', borderRadius: '10px' }}
          />
        )}

        <button
          type="submit"
          style={{
            background: '#f06595',
            color: '#fff',
            border: 'none',
            padding: '10px 15px',
            borderRadius: '5px',
            cursor: 'pointer',
          }}
        >
            Add Product
        </button>
      </form>
    </div>
  );
}