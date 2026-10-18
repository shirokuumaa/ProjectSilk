// client/src/components/AvatarBody.jsx
//
// Тело аватара для любой 3D-сцены: процедурное BodyAvatar или болванка BaseAvatar.
//
// Какое тело показывать, решает utils/avatarBody.js (то же решение берёт
// одежда, чтобы садиться на то же тело в той же фигуре). По умолчанию —
// болванка MPFB, если обмеры в калиброванном диапазоне и файл загрузился;
// иначе — процедурное BodyAvatar. С ?avatarDebug=1 в сцене плашка: что
// показано и почему (utils/avatarMode.js).

import React, { useState } from 'react';
import { Html } from '@react-three/drei';
import BodyAvatar from './BodyAvatar';
import BaseAvatar from './BaseAvatar';
import { useAvatarMode, avatarDebugEnabled } from '../utils/avatarMode';
import { useAvatarBody } from '../utils/avatarBody';
import { resolveSkinTone } from '../utils/skinTones';
import styles from './AvatarBody.module.css';

const FALLBACK_LABEL = {
  range: 'Standard body · out of calibrated range',
  missing: 'Standard body · measurements incomplete',
  error: 'Standard body · base avatar failed to load',
};

export default function AvatarBody({ profile, stressMap = null }) {
  const mode = useAvatarMode();
  const avatar = useAvatarBody(profile);
  const [height, setHeight] = useState(null);

  if (mode !== 'base') return <BodyAvatar profile={profile} stressMap={stressMap} />;

  const label = avatar.kind === 'standard'
    ? FALLBACK_LABEL[avatar.reason]
    : `Base avatar · ${avatar.kind === 'base' && height != null ? `${height.toFixed(1)} cm` : 'loading…'}`;

  return (
    <>
      {/* болванка (3,3 МБ) ещё грузится — вместо пустой сцены понятная загрузка */}
      {avatar.kind === 'loading' && (
        <Html
          fullscreen
          calculatePosition={(el, camera, size) => [size.width / 2, size.height / 2]}
          zIndexRange={[10, 0]}
          className={styles.layer}
        >
          <div className={styles.loading} role="status">
            <span className={styles.spinner} aria-hidden="true" />
            Loading your avatar…
          </div>
        </Html>
      )}
      {avatar.kind === 'standard' && <BodyAvatar profile={profile} stressMap={stressMap} />}
      {avatar.kind === 'base' && (
        <BaseAvatar
          body={avatar.body}
          solution={avatar.solution}
          skinTone={resolveSkinTone(profile?.skinTone)}
          profile={profile}
          stressMap={stressMap}
          onHeight={setHeight}
        />
      )}
      {/* слой во весь холст: центр слоя — центр холста, а не проекция точки сцены */}
      {avatarDebugEnabled() && (
        <Html
          fullscreen
          calculatePosition={(el, camera, size) => [size.width / 2, size.height / 2]}
          zIndexRange={[10, 0]}
          className={styles.layer}
        >
          <div className={styles.badge} data-avatar-mode={avatar.kind === 'base' ? 'base' : avatar.kind}>{label}</div>
        </Html>
      )}
    </>
  );
}
