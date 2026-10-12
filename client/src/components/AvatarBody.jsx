// client/src/components/AvatarBody.jsx
//
// Тело аватара для любой 3D-сцены: процедурное BodyAvatar или болванка BaseAvatar.
//
// По умолчанию — BodyAvatar. Болванка включается для проверки параметром
// ?avatar=base (см. utils/avatarMode.js) и показывается, только если:
//   • обмеры в калиброванном диапазоне (иначе обещанные сантиметры не сойдутся);
//   • на теле нет одежды: подгонка вещей пока сделана под BodyAvatar;
//   • файл болванки загрузился.
// В режиме проверки в углу сцены плашка: что показано и почему.

import React, { Component, Suspense, useMemo, useState } from 'react';
import { Html } from '@react-three/drei';
import BodyAvatar from './BodyAvatar';
import BaseAvatar from './BaseAvatar';
import { useAvatarMode } from '../utils/avatarMode';
import { solveAvatar } from '../utils/avatarMorphs';
import { resolveSkinTone } from '../utils/skinTones';
import styles from './AvatarBody.module.css';

const FALLBACK_LABEL = {
  garments: 'Standard body · garments on',
  range: 'Standard body · out of calibrated range',
  missing: 'Standard body · measurements incomplete',
  error: 'Standard body · base avatar failed to load',
};

class LoadBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.warn('[avatar] base avatar failed to load:', error?.message);
    this.props.onFail();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function AvatarBody({ profile, stressMap = null, hasGarments = false }) {
  const mode = useAvatarMode();
  const [failed, setFailed] = useState(false);
  const [height, setHeight] = useState(null);

  const measures = [
    profile?.heightCm, profile?.chest, profile?.waist, profile?.hips,
    profile?.shoulderWidth, profile?.armLength, profile?.inseam,
  ].join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const solution = useMemo(() => (mode === 'base' ? solveAvatar(profile) : null), [mode, measures]);

  const standard = <BodyAvatar profile={profile} stressMap={stressMap} />;
  if (mode !== 'base') return standard;

  const reason = hasGarments ? 'garments'
    : failed ? 'error'
    : !solution.inRange ? solution.reason
    : null;

  const label = reason
    ? FALLBACK_LABEL[reason]
    : `Base avatar · ${height != null ? `${height.toFixed(1)} cm` : 'loading…'}`;

  return (
    <>
      {reason ? standard : (
        <LoadBoundary fallback={standard} onFail={() => setFailed(true)}>
          <Suspense fallback={null}>
            <BaseAvatar
              solution={solution}
              skinTone={resolveSkinTone(profile?.skinTone)}
              profile={profile}
              stressMap={stressMap}
              onHeight={setHeight}
            />
          </Suspense>
        </LoadBoundary>
      )}
      {/* слой во весь холст: центр слоя — центр холста, а не проекция точки сцены */}
      <Html
        fullscreen
        calculatePosition={(el, camera, size) => [size.width / 2, size.height / 2]}
        zIndexRange={[10, 0]}
        className={styles.layer}
      >
        <div className={styles.badge} data-avatar-mode={reason ? 'standard' : 'base'}>{label}</div>
      </Html>
    </>
  );
}
