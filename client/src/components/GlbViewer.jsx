// client/src/components/GlbViewer.jsx
//
// Что изменено против прошлой версии:
//
// 1. КАМЕРА ПОДСТРАИВАЕТСЯ САМА (FitCamera). Раньше стояла на жёстких 3.2 м:
//    на высокой фигуре обрезало голову, на низкой оставалось пустое поле.
//    Теперь замеряется фактический bounding box сцены и камера отъезжает
//    ровно настолько, чтобы фигура заполнила кадр. Переживёт замену
//    процедурного тела на болванку художника.
//
// 2. УБРАН <Environment preset="city" />. Он качает HDR-карту со стороннего
//    CDN внутри Suspense: при сбое сети вся сцена навсегда зависала на
//    «Loading 3D…». Заменён обычным светом — выглядит так же, грузится сразу.
//
// 3. Светлая сцена и мягкая сетка по макету v11 вместо серого блока с рамкой.

import React, { Suspense, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF, Html } from '@react-three/drei';
import * as THREE from 'three';
import AvatarBody from './AvatarBody';
import BodyStage from './BodyStage';
import FitCamera from './FitCamera';
import { drapeGarment, restoreGeometry, snapshotGeometry } from '../utils/garmentDrape';
import { useAvatarBody } from '../utils/avatarBody';
import { figureShape, transferToFigure, pushOutOfBody, simFitMode } from '../utils/sizeModels';

/** Приводит модель к целевому росту, ставит ступни на y=0. */
function normalizeModel(object, targetHeight = 1.7) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  if (size.y === 0) return;
  object.scale.setScalar(targetHeight / size.y);
  const nb = new THREE.Box3().setFromObject(object);
  object.position.x -= (nb.min.x + nb.max.x) / 2;
  object.position.y -= nb.min.y;
  object.position.z -= (nb.min.z + nb.max.z) / 2;
}

/**
 * На какой уровень тела садится вещь и какой обхват задаёт ширину.
 * Масштаб по ШИРИНЕ, не по росту — иначе футболка растягивается на весь рост.
 */
const FIT_RULES = {
  top:       { anchor: 'shoulder', widthAt: 'chest', align: 'top' },
  outerwear: { anchor: 'shoulder', widthAt: 'chest', align: 'top' },
  dress:     { anchor: 'shoulder', widthAt: 'chest', align: 'top' },
  bottom:    { anchor: 'waist',    widthAt: 'hips',  align: 'top' },
  shoes:     { anchor: 'ankle',    widthAt: 'hips',  align: 'bottom' },
  accessory: { anchor: 'neck',     widthAt: 'chest', align: 'top' },
};

function bodyWidthAt(profile, key) {
  const per = Number(profile?.[key]) || 92;
  return (per / 100) / 2.7;
}

function GarmentOnBody({
  garmentScene, profile, garmentType = 'top',
  layerOffset = 0, fit = 'regular', drape = true, size = null, legs = null, simFigure = null,
}) {
  const ref = useRef();
  // тело и его форма — те же, что у AvatarBody в этой сцене
  const avatar = useAvatarBody(profile);
  const { shape, kind: avatarKind, body: avatarBody } = avatar;

  useLayoutEffect(() => {
    if (!garmentScene || !ref.current || !shape) return;

    // прижатие считается с исходной вещи, а не с уже прижатой
    snapshotGeometry(garmentScene);
    restoreGeometry(garmentScene);

    const rule = FIT_RULES[garmentType] || FIT_RULES.top;
    const marks = shape.landmarks;

    ref.current.scale.setScalar(1);
    ref.current.position.set(0, 0, 0);

    // ткань, просимулированная на фигуре размера: перенос на фигуру покупателя
    // (складки сохраняются) и страховка — что оказалось внутри тела, наружу на 4 мм
    if (simFigure) {
      ref.current.updateWorldMatrix(true, true);
      transferToFigure(garmentScene, figureShape(simFigure, { kind: avatarKind, body: avatarBody }), shape);
      if (simFitMode() === 'transfer') {
        pushOutOfBody(garmentScene, shape);
        return;
      }
      if (drape && ['top', 'dress', 'outerwear', 'bottom'].includes(garmentType)) {
        try {
          drapeGarment(ref.current, shape, { fit, layer: layerOffset, size, garmentType, legs });
        } catch (e) {
          console.warn('[drape] could not fit garment to body:', e.message);
        }
      }
      return;
    }

    // габариты вещи; не путать с size — строкой размерной сетки
    const box = new THREE.Box3().setFromObject(garmentScene);
    const extent = box.getSize(new THREE.Vector3());
    if (extent.x === 0 || extent.y === 0) return;

    // автоопределение единиц (см против метров)
    let preScale = 1;
    if (extent.y > marks.height * 10) preScale = 0.01;
    else if (extent.y < marks.height * 0.1) preScale = 100;

    const targetWidth = bodyWidthAt(profile, rule.widthAt) * 2.15;
    const scale = (targetWidth / (extent.x * preScale)) * preScale;
    ref.current.scale.setScalar(scale);

    const scaled = new THREE.Box3().setFromObject(ref.current);
    const anchorY = marks[rule.anchor] ?? marks.shoulder;

    if (rule.align === 'top') ref.current.position.y += anchorY - scaled.max.y;
    else ref.current.position.y += anchorY - scaled.min.y;

    ref.current.position.x -= (scaled.min.x + scaled.max.x) / 2;
    ref.current.position.z -= (scaled.min.z + scaled.max.z) / 2;

    if (drape && ['top', 'dress', 'outerwear', 'bottom'].includes(garmentType)) {
      try {
        drapeGarment(ref.current, shape, { fit, layer: layerOffset, size, garmentType, legs });
      } catch (e) {
        console.warn('[drape] could not fit garment to body:', e.message);
      }
    }
  }, [garmentScene, profile, garmentType, layerOffset, fit, drape, shape, size, legs, simFigure, avatarKind, avatarBody]);

  if (!shape) return null;   // болванка ещё грузится
  return <group ref={ref}><primitive object={garmentScene} /></group>;
}

/** Фиттер для случая, когда аватар — это GLB-файл, а не обмеры. */
function GarmentFitter({ avatarScene, garmentScene }) {
  const garmentRef = useRef();
  const fitted = useRef(false);

  useLayoutEffect(() => {
    if (!avatarScene || !garmentScene || !garmentRef.current || fitted.current) return;
    fitted.current = true;

    const aBox = new THREE.Box3().setFromObject(avatarScene);
    const aSize = aBox.getSize(new THREE.Vector3());
    const gBox = new THREE.Box3().setFromObject(garmentScene);
    const gSize = gBox.getSize(new THREE.Vector3());
    if (gSize.y === 0) return;

    let preScale = 1;
    if (gSize.y > aSize.y * 10) preScale = 0.01;
    else if (gSize.y < aSize.y * 0.1) preScale = 100;

    const scaleFactor = (aSize.y / (gSize.y * preScale)) * preScale * 0.55;
    garmentRef.current.scale.setScalar(scaleFactor);

    const sBox = new THREE.Box3().setFromObject(garmentRef.current);
    garmentRef.current.position.x += ((aBox.min.x + aBox.max.x) / 2) - ((sBox.min.x + sBox.max.x) / 2);
    garmentRef.current.position.y += aBox.max.y * 0.82 - sBox.max.y;
    garmentRef.current.position.z += ((aBox.min.z + aBox.max.z) / 2) - ((sBox.min.z + sBox.max.z) / 2) + 0.01;
  }, [avatarScene, garmentScene]);

  return <group ref={garmentRef}><primitive object={garmentScene} /></group>;
}

function GlbGarment({ url, profile, garmentType, layerOffset, fit, drape, size, legs, simFigure }) {
  const { scene } = useGLTF(url);

  // Клон с копией геометрии: drape меняет вершины, без клона
  // испортим модель в кэше useGLTF для всех остальных экранов.
  const cloned = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((child) => {
      if (child.isMesh && child.geometry) child.geometry = child.geometry.clone();
    });
    return c;
  }, [scene]);

  return (
    <GarmentOnBody
      garmentScene={cloned}
      profile={profile}
      garmentType={garmentType}
      layerOffset={layerOffset}
      fit={fit}
      drape={drape}
      size={size}
      legs={legs}
      simFigure={simFigure}
    />
  );
}

function AvatarOnly({ avatarUrl }) {
  const { scene } = useGLTF(avatarUrl);
  useLayoutEffect(() => { normalizeModel(scene, 1.7); }, [scene]);
  return <primitive object={scene} />;
}

function AvatarWithGarment({ avatarUrl, garmentUrl }) {
  const avatar = useGLTF(avatarUrl);
  const garment = useGLTF(garmentUrl);
  useLayoutEffect(() => { normalizeModel(avatar.scene, 1.7); }, [avatar.scene]);
  return (
    <>
      <primitive object={avatar.scene} />
      <GarmentFitter avatarScene={avatar.scene} garmentScene={garment.scene} />
    </>
  );
}

/**
 * GlbViewer
 *
 * Аватар: profile — тело из обмеров (файл не нужен); url — GLB-модель.
 * garments — [{ url, garmentType, layer, fit, size?, legs? }]; size — обмеры выбранного
 * размера изделия ({ chest, waist, hips }, см), legs — подсказка 'split' | 'joined'
 */
export default function GlbViewer({
  url,
  profile = null,
  garmentUrl,
  garments = null,
  stressMap = null,
  height = 360,
  background = '#FDFCFB',
  showGrid = false,
  drape = true,
  fill = 0.92,
  back = false,
  resetKey = '',
  showBody = true, // false — «Hide body»: одежда садится по фигуре, но тело не рисуется
}) {
  const controlsRef = useRef(null);

  const items = useMemo(() => {
    if (Array.isArray(garments) && garments.length) {
      return [...garments].sort((a, b) => (a.layer || 1) - (b.layer || 1));
    }
    if (garmentUrl) return [{ url: garmentUrl, garmentType: 'dress', layer: 1 }];
    return [];
  }, [garments, garmentUrl]);

  const fitKey = useMemo(
    () => [profile?.heightCm, profile?.chest, profile?.waist, profile?.hips,
           items.map((g) => g.url).join('|')].join('-'),
    [profile, items],
  );

  const hasBody = !!profile;
  if (!hasBody && !url) return null;

  return (
    <div style={{ width: '100%', height, borderRadius: 12, overflow: 'hidden', background }}>
      <Canvas dpr={[1, 2]} camera={{ position: [0, 1, 3], fov: 40 }}>
        <color attach="background" args={[background]} />
        {hasBody ? (
          <BodyStage />
        ) : (
          <>
            <ambientLight intensity={0.82} />
            <directionalLight intensity={0.95} position={[2, 4, 2]} />
            <directionalLight intensity={0.28} position={[-2, 2, -2]} />
            <directionalLight intensity={0.18} position={[0, 1, -3]} />
          </>
        )}

        <Suspense
          fallback={
            <Html center>
              <div style={{ color: '#7A7580', fontSize: 13, whiteSpace: 'nowrap' }}>
                Loading model…
              </div>
            </Html>
          }
        >
          {hasBody ? (
            <>
              {showBody && <AvatarBody profile={profile} stressMap={stressMap} />}
              {items.map((g, i) => (
                <GlbGarment
                  key={`${g.url}-${i}`}
                  url={g.url}
                  profile={profile}
                  garmentType={g.garmentType || 'dress'}
                  layerOffset={i}
                  fit={g.fit || 'regular'}
                  drape={drape}
                  size={g.size || null}
                  legs={g.legs || null}
                  simFigure={g.simFigure || null}
                />
              ))}
            </>
          ) : items.length ? (
            <AvatarWithGarment avatarUrl={url} garmentUrl={items[0].url} />
          ) : (
            <AvatarOnly avatarUrl={url} />
          )}
        </Suspense>

        {showGrid && <gridHelper args={[4, 16, '#E4E1DC', '#EDEAE5']} />}

        <FitCamera
          controlsRef={controlsRef}
          fill={fill}
          back={back}
          resetKey={`${fitKey}-${resetKey}`}
        />
        <OrbitControls ref={controlsRef} enablePan={false} enableZoom />
      </Canvas>
    </div>
  );
}
