// client/src/components/BodyStage.jsx
//
// Свет и обработка цвета для всех 3D-сцен с телом (BodyAvatar и BaseAvatar).
//
// Цель: цвет тела на экране — как кружок-образец тона в форме.
//
//   • Освещённость. В three.js рассеянная поверхность даёт на экране
//     цвет × освещённость / π. Поверхность, повёрнутая к камере, здесь
//     получает чуть больше π (рассеянный 1.55 + ключевой ≈1.6 + заполняющий
//     ≈0.35): живот и бёдра смотрят немного вниз, и на экране их цвет
//     выходит равным цвету токена. Бока темнее — так видна форма.
//   • Контровой свет — два источника сзади-сверху. Высвечивают край силуэта,
//     чтобы тёмные тона не сливались с фоном; на обращённые к камере
//     поверхности не попадают и цвет спереди не меняют.
//   • Тональная компрессия Neutral (Khronos PBR Neutral): цвета до ~0.8 не
//     трогает, мягко сжимает только блики. ACES, который React Three Fiber
//     ставит по умолчанию, уводит светлые тона в серый, а тёмные в чёрный.
//
// Свет белый — цветов здесь нет, тон тела задают токены --skin-N.

import { useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

const AMBIENT = 1.55;
const KEY = { intensity: 1.8, position: [1, 2, 4] };       // спереди-сверху-справа
const FILL = { intensity: 0.5, position: [-3, 0.6, 3] };  // спереди-слева, ниже
const RIMS = [
  { intensity: 1.4, position: [-2.5, 3, -3] },              // сзади-слева-сверху
  { intensity: 1.4, position: [2.5, 3, -3] },               // сзади-справа-сверху
];

export default function BodyStage({ shadows = false }) {
  const gl = useThree((state) => state.gl);

  useLayoutEffect(() => {
    gl.toneMapping = THREE.NeutralToneMapping;
    gl.toneMappingExposure = 1;
  }, [gl]);

  return (
    <>
      <ambientLight intensity={AMBIENT} />
      <directionalLight intensity={KEY.intensity} position={KEY.position} castShadow={shadows} />
      <directionalLight intensity={FILL.intensity} position={FILL.position} />
      {RIMS.map((rim) => (
        <directionalLight key={rim.position.join()} intensity={rim.intensity} position={rim.position} />
      ))}
    </>
  );
}
