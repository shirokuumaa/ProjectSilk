import React, { useEffect, useRef, useState } from 'react';
import Webcam from 'react-webcam';

const GPU_API = process.env.REACT_APP_GPU_API || 'http://localhost:8000';
const qs = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');

const smooth = (prev, next, a = 0.35) => (prev == null ? next : prev * (1 - a) + next * a);

const DEFAULT_AR = { type: 'top', scale: 1.9, xShift: 0.0, yShift: 0.12, rotAdj: 0.0, occlusion: true };

export default function TryOnAR() {
  const webcamRef = useRef(null);
  const canvasRef = useRef(null);
  const maskImgRef = useRef(null);        // ImageBitmap (PNG от /segm)
  const keypointsRef = useRef(null);      // [{name,x,y,score},...]

  const poseState = useRef({ cx:null, cy:null, w:null, h:null, rot:null });
  const sendingPoseRef = useRef(false);
  const sendingSegmRef = useRef(false);

  const [running, setRunning] = useState(false);
  const [cloth, setCloth] = useState(null);
  const [cfg, setCfg] = useState(DEFAULT_AR);

  // загрузка одежды
  useEffect(() => {
    const imageParam = qs.get('image');
    if (!imageParam) return;
    const img = new Image();
    try {
      const origin = new URL(imageParam, window.location.href).origin;
      if (origin !== window.location.origin) img.crossOrigin = 'anonymous';
    } catch {}
    img.onload = () => setCloth(img);
    img.src = imageParam;

    const stored = localStorage.getItem(`arcfg:${imageParam}`);
    if (stored) setCfg({ ...DEFAULT_AR, ...JSON.parse(stored) });
  }, []);

  // вырезаем кадр из <video> как JPEG и отправляем на эндпоинт
  const sendFrame = async (endpoint, busyRef, onOk) => {
    if (busyRef.current) return;
    const video = webcamRef.current?.video;
    if (!video || video.readyState !== 4) return;

    busyRef.current = true;
    try {
      // захват кадра без зеркала (на сервер — «как есть»)
      const tmp = document.createElement('canvas');
      tmp.width = video.videoWidth || 640;
      tmp.height = video.videoHeight || 480;
      const tctx = tmp.getContext('2d');
      tctx.drawImage(video, 0, 0, tmp.width, tmp.height);

      const blob = await new Promise(r => tmp.toBlob(r, 'image/jpeg', 0.6));
      const fd = new FormData();
      fd.append('image', blob, 'frame.jpg');

      const resp = await fetch(`${GPU_API}/${endpoint}`, { method: 'POST', body: fd });
      if (!resp.ok) throw new Error(`${endpoint} failed`);
      await onOk(resp);
    } catch (e) {
      // тихо падаем — кадр потеряли, едем дальше
    } finally {
      busyRef.current = false;
    }
  };

  // циклы опроса GPU
  useEffect(() => {
    if (!running) return;

    const poseTimer = setInterval(() => {
      sendFrame('pose', sendingPoseRef, async (resp) => {
        const j = await resp.json();
        keypointsRef.current = j.keypoints || null;
      });
    }, 70); // ~14 FPS

    const segmTimer = setInterval(() => {
      sendFrame('segm', sendingSegmRef, async (resp) => {
        const buf = await resp.arrayBuffer();
        const bmp = await createImageBitmap(new Blob([buf], { type: 'image/png' }));
        maskImgRef.current = bmp;
      });
    }, 100); // ~10 FPS, RVM тяжёлый — чаще не надо

    return () => {
      clearInterval(poseTimer);
      clearInterval(segmTimer);
    };
  }, [running]);

  // главный рендер-цикл (60 FPS)
  useEffect(() => {
    let rafId;
    const tick = () => {
      const video = webcamRef.current?.video;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== 4) { rafId = requestAnimationFrame(tick); return; }

      const ctx = canvas.getContext('2d');
      const W = video.videoWidth || 640;
      const H = video.videoHeight || 480;
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;

      // фон (зеркало)
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, -W, 0, W, H);
      ctx.restore();

      // наложение
      if (running && cloth && keypointsRef.current) {
        const kp = keypointsRef.current;

        // имена у YOLO — индексы; возьмём COCO плечи/бедра: 5-6 (shoulders), 11-12 (hips)
        const get = (i) => kp[i] && kp[i].score > 0.3 ? kp[i] : null;
        const LS = get(5), RS = get(6), LH = get(11), RH = get(12);

        let ax, ay, baseW, angle;
        if ((cfg.type === 'skirt' || cfg.type === 'pants') && LH && RH) {
          ax = (LH.x + RH.x) / 2; ay = (LH.y + RH.y) / 2;
          baseW = Math.hypot(LH.x - RH.x, LH.y - RH.y);
          angle = Math.atan2(LH.y - RH.y, LH.x - RH.x);
        } else if (LS && RS) {
          ax = (LS.x + RS.x) / 2; ay = (LS.y + RS.y) / 2;
          baseW = Math.hypot(LS.x - RS.x, LS.y - RS.y);
          angle = Math.atan2(LS.y - RS.y, LS.x - RS.x);
        }

        if (ax != null && baseW) {
          const targetW = baseW * cfg.scale;
          const aspect  = cloth.height / cloth.width;
          const targetH = targetW * aspect;

          const px = ax + cfg.xShift * targetW;
          const py = ay + cfg.yShift * targetH;
          const rot = angle + cfg.rotAdj;

          const st = poseState.current;
          st.cx  = smooth(st.cx,  px);
          st.cy  = smooth(st.cy,  py);
          st.w   = smooth(st.w,   targetW);
          st.h   = smooth(st.h,   targetH);
          st.rot = smooth(st.rot, rot);

          ctx.save();
          ctx.translate(W - st.cx, st.cy); // зеркалим X
          ctx.rotate(-st.rot);
          ctx.drawImage(cloth, -st.w / 2, -st.h * 0.35, st.w, st.h);
          ctx.restore();
        }
      }

      // окклюзия из RVM (alpha-PNG)
      if (running && cfg.occlusion && maskImgRef.current) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        ctx.drawImage(maskImgRef.current, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [running, cloth, cfg]);

  return (
    <div style={{ padding: 16 }}>
      <h2>📷 AR Try-On — GPU (YOLOv8-pose + RVM)</h2>
      <div style={{ marginBottom: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button onClick={() => setRunning(v => !v)} disabled={!cloth}>
          {running ? '■ Stop' : '▶️ Start'}
        </button>
        <label style={{ display:'inline-flex', gap:6, alignItems:'center' }}>
          Тип:
          <select value={cfg.type} onChange={e => setCfg({ ...cfg, type: e.target.value })}>
            <option value="top">top</option>
            <option value="dress">dress</option>
            <option value="skirt">skirt</option>
            <option value="pants">pants</option>
            <option value="scarf">scarf</option>
          </select>
        </label>
        {!cloth && <span style={{ color:'#666' }}>Добавь PNG в URL: <code>?image=/dress.png</code></span>}
      </div>

      <div style={{ position:'relative', width:640, height:480 }}>
        <Webcam
          ref={webcamRef}
          mirrored
          audio={false}
          videoConstraints={{ width: 640, height: 480, facingMode: 'user' }}
          style={{ position:'absolute', inset:0, visibility:'hidden' }}
        />
        <canvas ref={canvasRef} style={{ position:'absolute', inset:0, border:'1px solid #eee' }} />
      </div>

      <p style={{ color:'#666', marginTop:8 }}>
        Совет: для стабильности отправляем ~10–14 FPS на сервер, рендерим локально 60 FPS.
      </p>
    </div>
  );
}