# ProjectSilk

Single-page shop (React) + single backend (Express + MongoDB Atlas).  
Old experimental folder `seller/` is archived/ignored — all features live in `server/`.

---

## Directory map

client/                     # React SPA
src/pages/SellerPanel.jsx # uses http://localhost:5050/api/…
src/pages/HomePage.jsx    # products grid, etc.

server/                     # Express API (Node)
index.js                  # boot, CORS, /uploads static, /healthz, Mongo connect
routes/
productRoutes.js        # /api/products (create/list/get) + file upload
aiRoutes.js             # /api/ai/* proxy to GPU_URL (remove-bg, triposr, …)
controllers/
productController.js    # addProduct, getAllProducts, getProductById
models/
Product.js              # Mongoose schema
uploads/
images/                 # saved product images
models/                 # saved GLB
.env                        # MONGODB_URI (Atlas), PORT, GPU_URL

> **Ports**: API on `5050`, React dev server on `3000`.

---

## Environment

Create `server/.env`:

```env
PORT=5050
MONGODB_URI=mongodb+srv://<dbUser>:<dbPass>@<clusterHost>/<dbName>?retryWrites=true&w=majority&appName=<yourAppName>
GPU_URL=http://127.0.0.1:8000