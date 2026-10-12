// client/src/components/AvatarPanel.jsx
//
// The .tryzone block from projectsilk_v11.html — the live avatar panel on
// the home page that accepts dragged items.
//
// Matches the mock: header, figure, measurements line, drop zone, one wide
// action button, one text link underneath. Camera and wardrobe entries live
// in the right-hand rail, so they are deliberately not repeated here.
//
// The figure is framed by FitCamera, which measures the real bounding box
// instead of guessing a camera distance. That is what makes it fill the
// panel the way it does in the mock.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';

import AvatarBody from './AvatarBody';
import BodyStage from './BodyStage';
import FitCamera from './FitCamera';
import { loadBodyProfile, isProfileComplete } from '../utils/bodyProfileApi';
import { findBestSize } from '../utils/fitCalculator';
import { addToWardrobe } from '../utils/wardrobeStorage';
import styles from '../pages/HomePage.module.css';

export default function AvatarPanel() {
  const nav = useNavigate();
  const controlsRef = useRef(null);

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [over, setOver] = useState(false);
  const [worn, setWorn] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const p = await loadBodyProfile();
      if (alive) { setProfile(p); setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  const ready = isProfileComplete(profile);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setOver(false);
    let item = null;
    try { item = JSON.parse(e.dataTransfer.getData('application/json')); } catch { return; }
    if (!item?.id) return;
    addToWardrobe(item);
    setWorn(item);
  }, []);

  const verdict = useMemo(() => {
    if (!worn?.sizeChart?.length || !ready) return null;
    return findBestSize(profile, worn.sizeChart);
  }, [worn, profile, ready]);

  // ── new visitor: no measurements yet ──
  if (!loading && !ready) {
    return (
      <aside className={styles.tryzone}>
        <div className={styles.tzhdr}>Try it on</div>
        <div className={styles.tzempty}>
          <strong>Add your measurements</strong>
          <small>Four numbers, once. Then every item shows whether it fits you.</small>
          <button className={`${styles.tzbtn} ${styles.tzbtnAccent}`} onClick={() => nav('/avatar/create')}>
            Create my avatar
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={`${styles.tryzone} ${over ? styles.tryzoneOver : ''}`}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
    >
      <div className={styles.tzhdr}>{worn ? 'On my avatar' : 'My avatar'}</div>

      {loading ? (
        <div className={styles.tzempty}><small>Loading measurements…</small></div>
      ) : (
        <>
          <div className={styles.tzfig}>
            <div className={styles.tzfigInner}>
            <Canvas dpr={[1, 2]} camera={{ fov: 38, position: [0, 1, 3] }}>
              <color attach="background" args={['#FDFCFB']} />
              <BodyStage />

              <AvatarBody profile={profile} />

              <FitCamera
                controlsRef={controlsRef}
                fill={0.96}
                resetKey={`${profile.heightCm}-${profile.chest}-${profile.waist}-${profile.hips}`}
              />
              <OrbitControls
                ref={controlsRef}
                enablePan={false}
                enableZoom={false}
                minPolarAngle={Math.PI / 2.7}
                maxPolarAngle={Math.PI / 1.85}
              />
            </Canvas>
            </div>
          </div>

          <p className={styles.tzm}>
            {profile.heightCm} · {profile.chest} · {profile.waist} · {profile.hips} cm
          </p>
        </>
      )}

      {worn ? (
        <div className={`${styles.tzsz} ${verdict?.shouldWarn ? styles.tzszWarn : ''}`}>
          {verdict
            ? <>{worn.name} — {verdict.message.toLowerCase()}</>
            : <>{worn.name} — no size chart from the seller</>}
        </div>
      ) : (
        <div className={styles.tzdrop}>Drag an item here to try it on</div>
      )}

      <div className={styles.tzb}>
        <button
          className={`${styles.tzbtn} ${styles.tzbtnAccent}`}
          onClick={() => nav('/tryon/avatar')}
        >
          Try on my avatar
        </button>
      </div>

      {worn ? (
        <button className={styles.tzlink} onClick={() => setWorn(null)}>Take it off</button>
      ) : (
        <button className={styles.tzlink} onClick={() => nav('/avatar/create')}>
          Edit measurements
        </button>
      )}
    </aside>
  );
}
