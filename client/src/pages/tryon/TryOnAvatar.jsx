// client/src/pages/tryon/TryOnAR.jsx
//
// AR try-on. Pose and hand tracking run ON DEVICE via MediaPipe Tasks.
// No GPU server, no WebSocket, no round-trip latency, video never leaves the browser.
//
// Requires:  npm install @mediapipe/tasks-vision
//
// The .task model files are fetched from Google's CDN on first run and then
// cached by the browser. To work fully offline, download them into
// client/public/models/ and point POSE_TASK_URL / HAND_TASK_URL at local paths.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FilesetResolver, PoseLandmarker, HandLandmarker } from '@mediapipe/tasks-vision';
import { getWardrobe } from '../../utils/wardrobeStorage';

const API_BASE = process.env.REACT_APP_API || 'http://localhost:5050';
const toPublicUrl = (s = '') => (s?.startsWith?.('/uploads') ? `${API_BASE}${s}` : s);

// ───────── UI helpers ─────────
const ui = {
  panel: { width: 340, borderRight: '1px solid #e5e7eb', padding: 12, overflow: 'auto', background: '#fff' },
  row: { display: 'grid', gap: 8, marginBottom: 12 },
  input: { width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8 },
  btn: { padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', cursor: 'pointer' },
  chip: { padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 999, background: '#fff', cursor: 'pointer' },
  label: { fontWeight: 600, marginBottom: 4, fontSize: 13, color: '#111827' },
  hint: { color: '#6b7280', fontSize: 12 },
};

// ───────── Keypoints ─────────
// The overlay logic below indexes joints in COCO-17 order. MediaPipe Pose
// returns 33 landmarks in its own order, so we remap once on read. Keeping the
// COCO layout means a server-side pose source could be dropped back in later
// without touching any of the fitting code.
const KP = { NOSE: 0, L_SH: 5, R_SH: 6, L_HIP: 11, R_HIP: 12, L_KNEE: 13, R_KNEE: 14, L_ANK: 15, R_ANK: 16 };

// index = COCO slot, value = MediaPipe Pose landmark index
const MP_TO_COCO = [
  0,   // 0  nose
  2,   // 1  left eye
  5,   // 2  right eye
  7,   // 3  left ear
  8,   // 4  right ear
  11,  // 5  left shoulder
  12,  // 6  right shoulder
  13,  // 7  left elbow
  14,  // 8  right elbow
  15,  // 9  left wrist
  16,  // 10 right wrist
  23,  // 11 left hip
  24,  // 12 right hip
  25,  // 13 left knee
  26,  // 14 right knee
  27,  // 15 left ankle
  28,  // 16 right ankle
];

const SLOT_SCHEMES = {
  top: [
    { id: 'shoulders', label: 'Shoulders', anchors: [KP.L_SH, KP.R_SH], scaleBase: 'shoulders' },
    { id: 'torso', label: 'Torso (avg)', anchors: [KP.L_SH, KP.R_SH, KP.L_HIP, KP.R_HIP], scaleBase: 'torso' },
  ],
  bottom: [
    { id: 'hips', label: 'Hips', anchors: [KP.L_HIP, KP.R_HIP], scaleBase: 'hips' },
    { id: 'knees', label: 'Knees', anchors: [KP.L_KNEE, KP.R_KNEE], scaleBase: 'hips' },
  ],
  dress: [
    { id: 'torso', label: 'Torso', anchors: [KP.L_SH, KP.R_SH, KP.L_HIP, KP.R_HIP], scaleBase: 'torso' },
  ],
  hat: [
    { id: 'head', label: 'Head (to nose)', anchors: [KP.L_SH, KP.R_SH, KP.NOSE], scaleBase: 'shoulders' },
  ],
  shoes: [
    { id: 'ankles', label: 'Ankles', anchors: [KP.L_ANK, KP.R_ANK], scaleBase: 'hips' },
  ],
};

// ───────── MediaPipe Tasks ─────────
const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.6/wasm';
const POSE_TASK_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const HAND_TASK_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

let _visionPromise = null;
function getVision() {
  // The WASM fileset is heavy; resolve it once and share it between landmarkers.
  if (!_visionPromise) _visionPromise = FilesetResolver.forVisionTasks(WASM_ROOT);
  return _visionPromise;
}

async function createPoseLandmarker() {
  const vision = await getVision();
  try {
    return await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: POSE_TASK_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  } catch {
    // Some machines have no WebGL delegate available — CPU still works, just slower.
    return await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: POSE_TASK_URL, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
  }
}

async function createHandLandmarker() {
  const vision = await getVision();
  try {
    return await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: HAND_TASK_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  } catch {
    return await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: HAND_TASK_URL, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: 2,
    });
  }
}

// ───────── helpers ─────────
const avg = (arr) => (arr && arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function convexHull(pts) {
  if (!pts || pts.length < 3) return pts || [];
  const points = pts.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of points.slice().reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

const PREFS_KEY = 'tryonAR_prefs_v4';

// ───────── Component ─────────
export default function TryOnAr() {
  const nav = useNavigate();

  // garment & UI
  const qs = new URLSearchParams(window.location.search);
  const [garmentUrl, setGarmentUrl] = useState(qs.get('image') || '');
  const [garmentImg, setGarmentImg] = useState(null);
  const [slot, setSlot] = useState('top');
  const [schemeId, setSchemeId] = useState(SLOT_SCHEMES.top[0].id);
  const [fitMode, setFitMode] = useState('auto'); // auto | manual
  const [opacity, setOpacity] = useState(1);
  const [manual, setManual] = useState({ x: 0, y: 0, scale: 1, rot: 0 });

  // grading
  const [hue, setHue] = useState(0);
  const [sat, setSat] = useState(1);
  const [light, setLight] = useState(1);
  const PRESETS = [
    { name: 'Natural', hue: 0, sat: 1, light: 1 },
    { name: 'Vivid', hue: 0, sat: 1.25, light: 1.02 },
    { name: 'Warm', hue: 15, sat: 1.1, light: 1.03 },
    { name: 'Cool', hue: -15, sat: 1.05, light: 1.02 },
    { name: 'Mono', hue: 0, sat: 0, light: 1.0 },
  ];

  // background
  const [blurBg, setBlurBg] = useState(0);
  const [bgReplace, setBgReplace] = useState('');
  const bgImgRef = useRef(null);
  const bgSrcRef = useRef('');

  // view
  const [mirror, setMirror] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [showHands, setShowHands] = useState(true);

  // panel
  const [panelHidden, setPanelHidden] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);

  // tracking status (state only — updated rarely, never per frame)
  const [poseReady, setPoseReady] = useState(false);
  const [poseErr, setPoseErr] = useState('');
  const [handsErr, setHandsErr] = useState('');
  const [hasPose, setHasPose] = useState(false);
  const [fps, setFps] = useState(0);

  // smoothing
  const [smoothing, setSmoothing] = useState(true);
  const [heightCm, setHeightCm] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('avatarDraft') || '{}')?.m?.heightCm || 170;
    } catch {
      return 170;
    }
  });

  // camera/canvas
  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const layerGarment = useRef(document.createElement('canvas'));

  // per-frame data lives in refs so the draw loop never triggers a re-render
  const poseRef = useRef(null);
  const handPolysRef = useRef([]);
  const hasPoseRef = useRef(false);
  const frameCountRef = useRef(0);
  const fpsCounterRef = useRef(0);
  const lastPoseTsRef = useRef(-1);

  // landmarkers
  const poseLmRef = useRef(null);
  const handLmRef = useRef(null);

  // drag/pinch state
  const dragRef = useRef({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0 });
  const pinchRef = useRef({
    active: false, pointers: new Map(), startDist: 0, startAngle: 0,
    startScale: 1, startRot: 0, lastTapTs: 0,
  });

  // wardrobe
  const wardrobe = useMemo(() => getWardrobe(), []);
  const pickWardrobe = (id) => {
    const it = wardrobe.find((x) => x.id === id);
    if (it?.image) setGarmentUrl(toPublicUrl(it.image));
  };

  // toasts
  const toastTimerRef = useRef(null);
  const [toast, setToast] = useState(null);

  const pushToast = useCallback((msg) => {
    if (!msg) return;
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  // ── prefs ──
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      if (!p) return;
      if (p.slot) setSlot(p.slot);
      if (p.schemeId) setSchemeId(p.schemeId);
      if (p.fitMode) setFitMode(p.fitMode);
      if (typeof p.opacity === 'number') setOpacity(p.opacity);
      if (typeof p.hue === 'number') setHue(p.hue);
      if (typeof p.sat === 'number') setSat(p.sat);
      if (typeof p.light === 'number') setLight(p.light);
      if (typeof p.blurBg === 'number') setBlurBg(p.blurBg);
      if (typeof p.bgReplace === 'string') setBgReplace(p.bgReplace);
      if (typeof p.mirror === 'boolean') setMirror(p.mirror);
      if (typeof p.showGrid === 'boolean') setShowGrid(p.showGrid);
      if (typeof p.showSkeleton === 'boolean') setShowSkeleton(p.showSkeleton);
      if (typeof p.showHands === 'boolean') setShowHands(p.showHands);
      if (typeof p.smoothing === 'boolean') setSmoothing(p.smoothing);
      if (typeof p.heightCm === 'number') setHeightCm(p.heightCm);
      if (p.manual && typeof p.manual === 'object') setManual(p.manual);
      if (typeof p.panelHidden === 'boolean') setPanelHidden(p.panelHidden);
    } catch {
      /* corrupted prefs — use defaults */
    }
  }, []);

  useEffect(() => {
    const p = {
      slot, schemeId, fitMode, opacity,
      hue, sat, light,
      blurBg, bgReplace,
      mirror, showGrid, showSkeleton, showHands,
      smoothing, heightCm, manual, panelHidden,
    };
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  }, [
    slot, schemeId, fitMode, opacity,
    hue, sat, light,
    blurBg, bgReplace,
    mirror, showGrid, showSkeleton, showHands,
    smoothing, heightCm, manual, panelHidden,
  ]);

  // ── garment image ──
  useEffect(() => {
    if (!garmentUrl) {
      setGarmentImg(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setGarmentImg(img);
    img.onerror = () => setGarmentImg(null);
    img.src = toPublicUrl(garmentUrl);
  }, [garmentUrl]);

  const onGarmentFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => setGarmentUrl(ev.target.result);
    r.readAsDataURL(f);
  };

  // ── camera ──
  useEffect(() => {
    let stop = false;
    let localVideo = null;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stop) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localVideo = videoRef.current;
        if (localVideo) {
          localVideo.srcObject = stream;
          await localVideo.play();
        }
      } catch (e) {
        console.error(e);
        pushToast('Camera unavailable — check browser permissions');
      }
    })();
    return () => {
      stop = true;
      if (localVideo && localVideo.srcObject) {
        [...localVideo.srcObject.getTracks()].forEach((t) => t.stop());
        localVideo.srcObject = null;
      }
    };
  }, [pushToast]);

  // ── pose landmarker (on device) ──
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setPoseErr('');
        const lm = await createPoseLandmarker();
        if (!alive) {
          lm.close?.();
          return;
        }
        poseLmRef.current = lm;
        setPoseReady(true);
      } catch (e) {
        console.error(e);
        setPoseErr(e?.message || 'Failed to load pose model');
        setPoseReady(false);
        poseLmRef.current = null;
      }
    })();
    return () => {
      alive = false;
      const lm = poseLmRef.current;
      poseLmRef.current = null;
      poseRef.current = null;
      if (lm?.close) {
        try { lm.close(); } catch { /* already disposed */ }
      }
    };
  }, []);

  // ── hand landmarker (optional, for occlusion) ──
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!showHands) {
        setHandsErr('');
        const lm = handLmRef.current;
        handLmRef.current = null;
        handPolysRef.current = [];
        if (lm?.close) {
          try { lm.close(); } catch { /* already disposed */ }
        }
        return;
      }
      try {
        setHandsErr('');
        const lm = await createHandLandmarker();
        if (!alive) {
          lm.close?.();
          return;
        }
        handLmRef.current = lm;
      } catch (e) {
        console.error(e);
        setHandsErr(e?.message || 'Failed to load hand model');
        handLmRef.current = null;
        setShowHands(false);
        pushToast('Hand occlusion is off (auto)');
      }
    })();
    return () => { alive = false; };
  }, [showHands, pushToast]);

  // ── draw loop ──
  const draw = useCallback(() => {
    const v = videoRef.current;
    const c = stageRef.current;
    if (!v || !c) return;

    const ctx = c.getContext('2d');
    const DPR = window.devicePixelRatio || 1;
    const W = c.clientWidth;
    const H = c.clientHeight;
    c.width = W * DPR;
    c.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const vw = v.videoWidth || 1280;
    const vh = v.videoHeight || 720;
    const scale = Math.min(W / vw, H / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;

    const ready = v.readyState >= 2 && v.videoWidth > 0;
    frameCountRef.current += 1;
    fpsCounterRef.current += 1;

    // MediaPipe reports normalised coordinates on the *raw* video. The stage
    // draws the video mirrored, so flip x here to keep the overlay aligned.
    const toStageX = (nx) => (mirror ? 1 - nx : nx) * vw;

    // ── Pose (every frame) ──
    if (ready && poseLmRef.current) {
      const ts = performance.now();
      if (ts > lastPoseTsRef.current) {
        lastPoseTsRef.current = ts;
        try {
          const res = poseLmRef.current.detectForVideo(v, ts);
          const lms = res?.landmarks?.[0];
          if (lms && lms.length >= 29) {
            const raw = MP_TO_COCO.map((mpIdx) => {
              const p = lms[mpIdx];
              return {
                x: toStageX(p.x),
                y: p.y * vh,
                conf: p.visibility ?? 1,
              };
            });

            const prev = poseRef.current;
            if (smoothing && prev && prev.length === raw.length) {
              const a = 0.4; // exponential moving average — trades lag for stability
              poseRef.current = raw.map((p, i) => ({
                x: a * p.x + (1 - a) * prev[i].x,
                y: a * p.y + (1 - a) * prev[i].y,
                conf: p.conf,
              }));
            } else {
              poseRef.current = raw;
            }

            if (!hasPoseRef.current) {
              hasPoseRef.current = true;
              setHasPose(true);
            }
          } else {
            poseRef.current = null;
            if (hasPoseRef.current) {
              hasPoseRef.current = false;
              setHasPose(false);
            }
          }
        } catch {
          /* transient detector hiccup — keep the previous pose */
        }
      }
    }

    // ── Hands (every other frame — occlusion tolerates the lower rate) ──
    if (ready && showHands && handLmRef.current && frameCountRef.current % 2 === 0) {
      try {
        const res = handLmRef.current.detectForVideo(v, performance.now());
        handPolysRef.current = (res?.landmarks || []).map((lms) =>
          convexHull(lms.map((p) => ({ x: toStageX(p.x), y: p.y * vh })))
        );
      } catch {
        handPolysRef.current = [];
      }
    } else if (!showHands || !handLmRef.current) {
      handPolysRef.current = [];
    }

    // ── Background ──
    if (bgReplace) {
      if (bgReplace !== bgSrcRef.current) {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => { bgImgRef.current = im; };
        im.onerror = () => { bgImgRef.current = null; };
        im.src = bgReplace;
        bgSrcRef.current = bgReplace;
      }
      if (bgImgRef.current) ctx.drawImage(bgImgRef.current, 0, 0, W, H);
      else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
      // Without a segmentation mask the person cannot be cut out, so the camera
      // frame is drawn on top of the replacement at reduced strength.
      ctx.save();
      ctx.globalAlpha = 0.92;
      if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
      ctx.drawImage(v, dx, dy, dw, dh);
      ctx.restore();
    } else if (blurBg > 0) {
      ctx.save();
      if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
      ctx.filter = `blur(${blurBg}px)`;
      ctx.drawImage(v, dx, dy, dw, dh);
      ctx.restore();
    } else {
      ctx.save();
      if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
      ctx.drawImage(v, dx, dy, dw, dh);
      ctx.restore();
    }

    const pose = poseRef.current;

    // ── Skeleton (debug) ──
    if (showSkeleton && pose) {
      ctx.save();
      ctx.fillStyle = '#22c55e';
      pose.forEach((p) => {
        if (p?.conf > 0.3) {
          ctx.beginPath();
          ctx.arc(dx + p.x * scale, dy + p.y * scale, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      ctx.restore();
    }

    // ── Garment layer ──
    if (garmentImg) {
      const layer = layerGarment.current;
      const lctx = layer.getContext('2d');
      layer.width = W * DPR;
      layer.height = H * DPR;
      lctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      lctx.clearRect(0, 0, W, H);

      lctx.save();
      lctx.globalAlpha = opacity;

      if (fitMode === 'manual' || !pose) {
        lctx.translate(W / 2, H / 2);
        lctx.rotate((manual.rot * Math.PI) / 180);
        const s = manual.scale * scale;
        const w = garmentImg.width * s;
        const h = garmentImg.height * s;
        lctx.filter = `hue-rotate(${hue}deg) saturate(${sat}) brightness(${light})`;
        lctx.drawImage(garmentImg, -w / 2 + manual.x, -h / 2 + manual.y, w, h);
      } else {
        const sch = SLOT_SCHEMES[slot].find((s) => s.id === schemeId) || SLOT_SCHEMES[slot][0];
        const shL = pose[KP.L_SH];
        const shR = pose[KP.R_SH];
        const hpL = pose[KP.L_HIP];
        const hpR = pose[KP.R_HIP];

        const cx = avg([shL?.x, shR?.x, hpL?.x, hpR?.x].filter(Boolean));
        const cy = avg([shL?.y, shR?.y, hpL?.y, hpR?.y].filter(Boolean));
        const shouldersW = dist(shL, shR);
        const hipsW = dist(hpL, hpR);
        const torsoW = Math.max(shouldersW, hipsW);
        const angle = Math.atan2((shL?.y ?? 0) - (shR?.y ?? 0), (shL?.x ?? 0) - (shR?.x ?? 0));

        const w = garmentImg.width;
        const h = garmentImg.height;
        let s = 1;
        if (sch.scaleBase === 'shoulders') s = (shouldersW * scale) / (w * 0.8);
        else if (sch.scaleBase === 'hips') s = (hipsW * scale) / (w * 0.9);
        else s = (torsoW * scale) / (w * 0.8);

        lctx.translate(dx + (cx ?? vw / 2) * scale, dy + (cy ?? vh / 2) * scale);
        lctx.rotate(angle);
        lctx.filter = `hue-rotate(${hue}deg) saturate(${sat}) brightness(${light})`;

        let oy = 0;
        switch (slot) {
          case 'top': oy = -h * s * 0.25; break;
          case 'bottom': oy = h * s * 0.15; break;
          case 'dress': oy = h * s * 0.05; break;
          case 'hat': oy = -h * s * 0.9; break;
          case 'shoes': oy = h * s * 0.9; break;
          default: oy = 0;
        }
        lctx.drawImage(garmentImg, (-w * s) / 2 + manual.x, (-h * s) / 2 + manual.y + oy, w * s, h * s);
      }
      lctx.restore();

      // ── Hand occlusion: punch holes where hands are ──
      if (showHands && handPolysRef.current?.length) {
        lctx.save();
        lctx.globalCompositeOperation = 'destination-out';
        lctx.fillStyle = '#000';
        handPolysRef.current.forEach((poly) => {
          if (!poly?.length) return;
          lctx.beginPath();
          poly.forEach((p, i) => {
            const x = dx + p.x * scale;
            const y = dy + p.y * scale;
            if (i === 0) lctx.moveTo(x, y);
            else lctx.lineTo(x, y);
          });
          lctx.closePath();
          lctx.fill();
        });
        lctx.restore();
      }

      ctx.drawImage(layer, 0, 0, W, H);
    }

    // ── Grid overlay ──
    if (showGrid) {
      ctx.strokeStyle = '#e5e7eb';
      for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    }
  }, [
    garmentImg, mirror, showGrid, showSkeleton, blurBg, bgReplace,
    opacity, fitMode, slot, schemeId, manual, hue, sat, light, showHands, smoothing,
  ]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  // fps meter
  useEffect(() => {
    const t = setInterval(() => {
      setFps(fpsCounterRef.current);
      fpsCounterRef.current = 0;
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // ── snapshot / record ──
  const [rec, setRec] = useState(null);
  const [recording, setRecording] = useState(false);

  const snapshot = useCallback(() => {
    const url = stageRef.current.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tryon.png';
    a.click();
  }, []);

  const toggleRecord = useCallback(async () => {
    if (recording) {
      rec?.stop();
      setRecording(false);
      return;
    }
    const stream = stageRef.current.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
    const chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tryon.webm';
      a.click();
      URL.revokeObjectURL(url);
    };
    recorder.start();
    setRec(recorder);
    setRecording(true);
  }, [recording, rec]);

  // ── hotkeys ──
  useEffect(() => {
    const onKey = (e) => {
      const step = e.shiftKey ? 20 : 5;
      if (e.key === 'ArrowLeft') setManual((m) => ({ ...m, x: m.x - step }));
      if (e.key === 'ArrowRight') setManual((m) => ({ ...m, x: m.x + step }));
      if (e.key === 'ArrowUp') setManual((m) => ({ ...m, y: m.y - step }));
      if (e.key === 'ArrowDown') setManual((m) => ({ ...m, y: m.y + step }));
      if (e.key === '=' || e.key === '+') setManual((m) => ({ ...m, scale: clamp(m.scale + 0.05, 0.2, 3) }));
      if (e.key === '-') setManual((m) => ({ ...m, scale: clamp(m.scale - 0.05, 0.2, 3) }));
      if (e.key === '[') setManual((m) => ({ ...m, rot: m.rot - 2 }));
      if (e.key === ']') setManual((m) => ({ ...m, rot: m.rot + 2 }));
      if (e.key === '0') setManual({ x: 0, y: 0, scale: 1, rot: 0 });
      if (e.key === 'g' || e.key === 'G') setShowGrid((v) => !v);
      if (e.key === 'm' || e.key === 'M') setMirror((v) => !v);
      if (e.key === 's' || e.key === 'S') snapshot();
      if (e.key === 'r' || e.key === 'R') toggleRecord();
      if (e.key === 'h' || e.key === 'H') setPanelHidden((v) => !v);
      if ((e.key === 'd' || e.key === 'D') && e.altKey) {
        e.preventDefault();
        setDebugOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [snapshot, toggleRecord]);

  // ── pointer: drag / pinch / wheel ──
  const onPointerDown = (e) => {
    const rect = stageRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const now = performance.now();
    if (e.pointerType === 'touch') {
      if (now - pinchRef.current.lastTapTs < 300) setManual({ x: 0, y: 0, scale: 1, rot: 0 });
      pinchRef.current.lastTapTs = now;
    }

    pinchRef.current.pointers.set(e.pointerId, { x, y });

    if (pinchRef.current.pointers.size === 2) {
      const pts = [...pinchRef.current.pointers.values()];
      pinchRef.current.active = true;
      pinchRef.current.startDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchRef.current.startAngle = Math.atan2(pts[0].y - pts[1].y, pts[0].x - pts[1].x);
      pinchRef.current.startScale = manual.scale;
      pinchRef.current.startRot = manual.rot;
    } else if (pinchRef.current.pointers.size === 1 && fitMode === 'manual') {
      dragRef.current = { active: true, startX: x, startY: y, baseX: manual.x, baseY: manual.y };
    }

    stageRef.current.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    const rect = stageRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (pinchRef.current.pointers.has(e.pointerId)) {
      pinchRef.current.pointers.set(e.pointerId, { x, y });
    }

    if (pinchRef.current.active && pinchRef.current.pointers.size >= 2) {
      const pts = [...pinchRef.current.pointers.values()];
      const distNow = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const angNow = Math.atan2(pts[0].y - pts[1].y, pts[0].x - pts[1].x);
      const scaleK = distNow > 0 ? distNow / (pinchRef.current.startDist || distNow) : 1;
      const rotDeg = ((angNow - pinchRef.current.startAngle) * 180) / Math.PI;
      setManual((m) => ({
        ...m,
        scale: clamp(pinchRef.current.startScale * scaleK, 0.2, 3),
        rot: pinchRef.current.startRot + rotDeg,
      }));
      return;
    }

    if (dragRef.current.active) {
      const ddx = x - dragRef.current.startX;
      const ddy = y - dragRef.current.startY;
      setManual((prev) => ({ ...prev, x: dragRef.current.baseX + ddx, y: dragRef.current.baseY + ddy }));
    }
  };

  const onPointerUp = (e) => {
    dragRef.current.active = false;
    pinchRef.current.pointers.delete(e.pointerId);
    if (pinchRef.current.pointers.size < 2) pinchRef.current.active = false;
    try { stageRef.current.releasePointerCapture?.(e.pointerId); } catch { /* pointer already gone */ }
  };

  const onDoubleClick = () => setManual({ x: 0, y: 0, scale: 1, rot: 0 });

  const onWheel = (e) => {
    if (fitMode !== 'manual') return;
    if (e.ctrlKey || e.altKey) e.preventDefault();
    if (e.ctrlKey) {
      const factor = Math.exp(-e.deltaY / 600);
      setManual((m) => ({ ...m, scale: clamp(m.scale * factor, 0.2, 3) }));
    } else if (e.altKey) {
      setManual((m) => ({ ...m, rot: m.rot + (e.deltaY > 0 ? 2 : -2) }));
    }
  };

  const schemes = SLOT_SCHEMES[slot];

  const trackingLabel = !poseReady
    ? (poseErr ? 'Tracking failed' : 'Loading model…')
    : hasPose ? 'Tracking you' : 'Step into frame';
  const trackingColor = !poseReady ? (poseErr ? '#ef4444' : '#6b7280') : hasPose ? '#059669' : '#b45309';

  return (
    <div style={{
      height: '100vh',
      display: 'grid',
      gridTemplateColumns: panelHidden ? '1fr' : `${ui.panel.width}px 1fr`,
    }}>
      {!panelHidden && (
        <aside style={ui.panel}>
          {/* header */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button style={ui.chip} onClick={() => nav('/wardrobe')}>← Wardrobe</button>
              <div style={{ fontWeight: 700 }}>AR Try-On</div>
            </div>
            <button style={ui.chip} onClick={() => setPanelHidden(true)}>Hide (H)</button>
          </div>

          <div style={{ ...ui.hint, marginBottom: 12, color: trackingColor }}>
            ● {trackingLabel}
            {poseErr && <div style={{ color: '#ef4444', marginTop: 4 }}>{poseErr}</div>}
          </div>

          {/* BASICS */}
          <section style={{ marginBottom: 16 }}>
            <div style={{ ...ui.label, fontSize: 14 }}>Basics</div>

            <div style={ui.row}>
              <div style={ui.label}>Garment</div>
              <input
                placeholder="https://...png  or  /uploads/xxx.png"
                value={garmentUrl}
                onChange={(e) => setGarmentUrl(e.target.value)}
                style={ui.input}
              />
              <label style={{ ...ui.btn, display: 'inline-block', textAlign: 'center' }}>
                Upload PNG/WebP
                <input type="file" accept="image/png,image/webp" onChange={onGarmentFile} style={{ display: 'none' }} />
              </label>
              <div style={{ ...ui.hint, marginTop: -4 }}>
                Use a PNG with transparency. Manual mode: drag, Ctrl+wheel zoom, Alt+wheel rotate,
                double-click resets.
              </div>
            </div>

            <div style={ui.row}>
              <div style={ui.label}>From Wardrobe</div>
              <div style={{ display: 'grid', gap: 8, maxHeight: 150, overflow: 'auto' }}>
                {wardrobe
                  .filter((i) => (i.image || '').match(/\.(png|webp)$/i))
                  .map((it) => (
                    <button
                      key={it.id}
                      style={{ ...ui.btn, display: 'grid', gridTemplateColumns: '48px 1fr', gap: 8, alignItems: 'center' }}
                      onClick={() => pickWardrobe(it.id)}
                    >
                      <img
                        src={toPublicUrl(it.image)}
                        alt={it.name}
                        style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6 }}
                      />
                      <div style={{ textAlign: 'left' }}>{it.name || it.id}</div>
                    </button>
                  ))}
              </div>
            </div>

            <div style={ui.row}>
              <div style={ui.label}>Slot &amp; Fit</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                {Object.keys(SLOT_SCHEMES).map((s) => (
                  <button
                    key={s}
                    style={{ ...ui.chip, background: slot === s ? '#111827' : '#fff', color: slot === s ? '#fff' : '#111827' }}
                    onClick={() => { setSlot(s); setSchemeId(SLOT_SCHEMES[s][0].id); }}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <select value={schemeId} onChange={(e) => setSchemeId(e.target.value)} style={ui.input}>
                {schemes.map((sc) => <option key={sc.id} value={sc.id}>{sc.label}</option>)}
              </select>

              <div style={{ display: 'flex', gap: 6 }}>
                {['auto', 'manual'].map((m) => (
                  <button
                    key={m}
                    style={{ ...ui.chip, background: fitMode === m ? '#111827' : '#fff', color: fitMode === m ? '#fff' : '#111827' }}
                    onClick={() => setFitMode(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>

              {fitMode === 'manual' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label>Move X
                    <input type="range" min="-300" max="300" value={manual.x}
                      onChange={(e) => setManual({ ...manual, x: Number(e.target.value) })} />
                  </label>
                  <label>Move Y
                    <input type="range" min="-300" max="300" value={manual.y}
                      onChange={(e) => setManual({ ...manual, y: Number(e.target.value) })} />
                  </label>
                  <label>Scale
                    <input type="range" min="0.2" max="3" step="0.01" value={manual.scale}
                      onChange={(e) => setManual({ ...manual, scale: Number(e.target.value) })} />
                  </label>
                  <label>Rotate
                    <input type="range" min="-180" max="180" value={manual.rot}
                      onChange={(e) => setManual({ ...manual, rot: Number(e.target.value) })} />
                  </label>
                  <button style={{ gridColumn: '1 / span 2', ...ui.btn }}
                    onClick={() => setManual({ x: 0, y: 0, scale: 1, rot: 0 })}>
                    Reset transform
                  </button>
                </div>
              )}

              <label>Opacity
                <input type="range" min="0.2" max="1" step="0.01" value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))} />
              </label>

              <label>Height (cm)
                <input type="number" value={heightCm}
                  onChange={(e) => setHeightCm(Number(e.target.value) || 0)} style={ui.input} />
              </label>

              <label>
                <input type="checkbox" checked={smoothing} onChange={(e) => setSmoothing(e.target.checked)} />
                {' '}Smooth tracking
              </label>
            </div>
          </section>

          {/* APPEARANCE */}
          <section style={{ marginBottom: 16 }}>
            <div style={{ ...ui.label, fontSize: 14 }}>Appearance</div>
            <div style={ui.row}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {PRESETS.map((p) => (
                  <button key={p.name} style={ui.chip}
                    onClick={() => { setHue(p.hue); setSat(p.sat); setLight(p.light); }}>
                    {p.name}
                  </button>
                ))}
              </div>
              <label>Hue ({hue}°)
                <input type="range" min="-180" max="180" value={hue} onChange={(e) => setHue(Number(e.target.value))} />
              </label>
              <label>Saturation ({sat.toFixed(2)})
                <input type="range" min="0" max="2" step="0.01" value={sat} onChange={(e) => setSat(Number(e.target.value))} />
              </label>
              <label>Lightness ({light.toFixed(2)})
                <input type="range" min="0.6" max="1.4" step="0.01" value={light} onChange={(e) => setLight(Number(e.target.value))} />
              </label>
            </div>
          </section>

          {/* BACKGROUND */}
          <section style={{ marginBottom: 16 }}>
            <div style={{ ...ui.label, fontSize: 14 }}>Background</div>
            <div style={ui.row}>
              <label>Blur ({blurBg}px)
                <input type="range" min="0" max="18" step="1" value={blurBg}
                  onChange={(e) => setBlurBg(Number(e.target.value))} />
              </label>
              <input placeholder="Replace bg image URL (optional)" value={bgReplace}
                onChange={(e) => setBgReplace(e.target.value)} style={ui.input} />
              <div style={ui.hint}>
                Blur and replacement apply to the whole frame — cutting the person out
                needs a segmentation mask, which is not wired up yet.
              </div>
            </div>
          </section>

          {/* VIEW */}
          <section style={{ marginBottom: 16 }}>
            <div style={{ ...ui.label, fontSize: 14 }}>View</div>
            <div style={ui.row}>
              <label>
                <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
                {' '}Mirror
              </label>
              <label>
                <input type="checkbox" checked={showHands} onChange={(e) => setShowHands(e.target.checked)} />
                {' '}Hand occlusion
              </label>
              {handsErr && <div style={{ ...ui.hint, color: '#ef4444' }}>Hands: {handsErr}</div>}
            </div>
          </section>

          {/* DEBUG */}
          <section style={{ marginBottom: 16 }}>
            <button
              style={{ ...ui.btn, width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              onClick={() => setDebugOpen((v) => !v)}
            >
              <span>Debug (Alt+D)</span>
              <span>{debugOpen ? '▲' : '▼'}</span>
            </button>
            {debugOpen && (
              <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                <label>
                  <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
                  {' '}Grid
                </label>
                <label>
                  <input type="checkbox" checked={showSkeleton} onChange={(e) => setShowSkeleton(e.target.checked)} />
                  {' '}Skeleton
                </label>
                <div style={ui.hint}>
                  Render: <b>{fps} FPS</b> • Pose: <b>on-device</b>
                </div>
              </div>
            )}
          </section>

          {/* capture */}
          <section style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button style={ui.btn} onClick={snapshot}>📸 Snapshot</button>
              <button
                style={{ ...ui.btn, background: recording ? '#111827' : '#fff', color: recording ? '#fff' : '#111827' }}
                onClick={toggleRecord}
              >
                {recording ? '⏺ Stop' : '⏺ Record'}
              </button>
            </div>
            <div style={{ marginTop: 8, ...ui.hint }}>
              Hotkeys: <b>H</b> hide panel, <b>R</b> record, <b>S</b> shot, <b>G</b> grid,
              <b> M</b> mirror, <b>Alt+D</b> debug, <b>Arrows</b> move, <b>+/−</b> scale,
              <b> [ / ]</b> rotate, <b>0</b> reset.
            </div>
          </section>
        </aside>
      )}

      <main style={{ position: 'relative', background: '#000' }}>
        {panelHidden && (
          <button
            onClick={() => setPanelHidden(false)}
            style={{
              position: 'absolute', zIndex: 5, top: 10, left: 10,
              padding: '6px 10px', borderRadius: 999, border: '1px solid #e5e7eb',
              background: '#fff', cursor: 'pointer',
            }}
          >
            Show panel (H)
          </button>
        )}

        {toast && (
          <div style={{
            position: 'absolute', left: '50%', bottom: 16, transform: 'translateX(-50%)',
            background: 'rgba(17,24,39,0.9)', color: '#fff', padding: '8px 12px',
            borderRadius: 999, fontSize: 12, zIndex: 10, maxWidth: '80%', textAlign: 'center',
          }}>
            {toast}
          </div>
        )}

        {/* video stays hidden — everything is composited onto the canvas */}
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: 0 }}
        />
        <canvas
          ref={stageRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
          onWheel={onWheel}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }}
        />
      </main>
    </div>
  );
}
