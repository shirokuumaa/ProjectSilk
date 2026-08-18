// client/src/components/GlbViewer.jsx
import React, { Suspense, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, useGLTF, Html } from '@react-three/drei';
import * as THREE from 'three';
import BodyAvatar, { getBodyLandmarks } from './BodyAvatar';
import { drapeGarment } from '../utils/garmentDrape';

// Normalizes any model to a target height and centers it at origin (feet at y=0)
function normalizeModel(object, targetHeight = 1.7) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  if (size.y === 0) return;
  const scale = targetHeight / size.y;
  object.scale.setScalar(scale);
  const newBox = new THREE.Box3().setFromObject(object);
  object.position.x -= (newBox.min.x + newBox.max.x) / 2;
  object.position.y -= newBox.min.y;
  object.position.z -= (newBox.min.z + newBox.max.z) / 2;
}

/**
 * На какой уровень тела садится вещь и какой обхват задаёт её ширину.
 * Одежда масштабируется по ШИРИНЕ тела, а не по росту —
 * иначе футболка растягивается на весь рост аватара.
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

/**
 * Посадка одежды: масштаб по ширине, позиция по анатомическому уровню,
 * затем прижатие вершин к телу.
 */
function GarmentOnBody({
  garmentScene,
  profile,
  garmentType = 'top',
  layerOffset = 0,
  fit = 'regular',
  drape = true,
}) {
  const ref = useRef();

  useLayoutEffect(() => {
    if (!garmentScene || !ref.current) return;

    const rule = FIT_RULES[garmentType] || FIT_RULES.top;
    const marks = getBodyLandmarks(profile);

    ref.current.scale.setScalar(1);
    ref.current.position.set(0, 0, 0);

    const box = new THREE.Box3().setFromObject(garmentScene);
    const size = box.getSize(new THREE.Vector3());
    if (size.x === 0 || size.y === 0) return;

    // автоопределение единиц (см vs м)
    let preScale = 1;
    if (size.y > marks.height * 10) preScale = 0.01;
    else if (size.y < marks.height * 0.1) preScale = 100;

    // масштаб по ширине тела на нужном уровне
    const targetWidth = bodyWidthAt(profile, rule.widthAt) * 2.15;
    const currentWidth = size.x * preScale;
    const scale = (targetWidth / currentWidth) * preScale;
    ref.current.scale.setScalar(scale);

    // позиционирование по анатомическому уровню
    const scaled = new THREE.Box3().setFromObject(ref.current);
    const anchorY = marks[rule.anchor] ?? marks.shoulder;

    if (rule.align === 'top') {
      ref.current.position.y += anchorY - scaled.max.y;
    } else {
      ref.current.position.y += anchorY - scaled.min.y;
    }

    ref.current.position.x -= (scaled.min.x + scaled.max.x) / 2;
    ref.current.position.z -= (scaled.min.z + scaled.max.z) / 2;

    // прижатие ткани к телу
    if (drape && ['top', 'dress', 'outerwear', 'bottom'].includes(garmentType)) {
      try {
        const stats = drapeGarment(ref.current, profile, {
          fit,
          layer: layerOffset,
        });
        if (stats.pushed > 0 || stats.pulled > 0) {
          console.debug(
            `[drape] ${garmentType}: вытолкнуто ${stats.pushed}, подтянуто ${stats.pulled} из ${stats.total} вершин`
          );
        }
      } catch (e) {
        console.warn('[drape] не удалось прижать одежду:', e.message);
      }
    }
  }, [garmentScene, profile, garmentType, layerOffset, fit, drape]);

  return (
    <group ref={ref}>
      <primitive object={garmentScene} />
    </group>
  );
}

/** Старый фиттер — для случая, когда аватар это GLB-файл */
function GarmentFitter({ avatarScene, garmentScene }) {
  const garmentRef = useRef();
  const fitted = useRef(false);

  useLayoutEffect(() => {
    if (!avatarScene || !garmentScene || !garmentRef.current || fitted.current) return;
    fitted.current = true;

    const avatarBox = new THREE.Box3().setFromObject(avatarScene);
    const avatarSize = avatarBox.getSize(new THREE.Vector3());
    const avatarCenterX = (avatarBox.min.x + avatarBox.max.x) / 2;
    const avatarCenterZ = (avatarBox.min.z + avatarBox.max.z) / 2;

    const garmentBox = new THREE.Box3().setFromObject(garmentScene);
    const garmentSize = garmentBox.getSize(new THREE.Vector3());
    if (garmentSize.y === 0) return;

    let preScale = 1;
    if (garmentSize.y > avatarSize.y * 10) preScale = 0.01;
    else if (garmentSize.y < avatarSize.y * 0.1) preScale = 100;

    const correctedHeight = garmentSize.y * preScale;
    const scaleFactor = (avatarSize.y / correctedHeight) * preScale * 0.55;
    garmentRef.current.scale.set(scaleFactor, scaleFactor, scaleFactor);

    const scaledBox = new THREE.Box3().setFromObject(garmentRef.current);
    garmentRef.current.position.x += (avatarCenterX - (scaledBox.min.x + scaledBox.max.x) / 2);
    garmentRef.current.position.y += (avatarBox.max.y * 0.82 - scaledBox.max.y);
    garmentRef.current.position.z += (avatarCenterZ - (scaledBox.min.z + scaledBox.max.z) / 2) + 0.01;
  }, [avatarScene, garmentScene]);

  return (
    <group ref={garmentRef}>
      <primitive object={garmentScene} />
    </group>
  );
}

function GlbGarment({ url, profile, garmentType, layerOffset, fit, drape }) {
  const { scene } = useGLTF(url);
  // клонируем с копией геометрии — drape меняет вершины,
  // без клона испортим кэшированную модель
  const cloned = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((child) => {
      if (child.isMesh && child.geometry) {
        child.geometry = child.geometry.clone();
      }
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
    />
  );
}

function AvatarOnly({ avatarUrl }) {
  const { scene } = useGLTF(avatarUrl);
  useLayoutEffect(() => {
    normalizeModel(scene, 1.7);
  }, [scene]);
  return <primitive object={scene} />;
}

function AvatarWithGarment({ avatarUrl, garmentUrl }) {
  const avatar = useGLTF(avatarUrl);
  const garment = useGLTF(garmentUrl);
  useLayoutEffect(() => {
    normalizeModel(avatar.scene, 1.7);
  }, [avatar.scene]);
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
 * Режимы аватара:
 *   profile — тело строится из обмеров покупателя, файл не нужен
 *   url     — аватар загружается из GLB
 *
 * garments — [{ url, garmentType, layer, fit }]
 * drape    — прижимать ли ткань к телу (по умолчанию да)
 */
export default function GlbViewer({
  url,
  profile = null,
  garmentUrl,
  garments = null,
  stressMap = null,
  height = 360,
  background = '#f9fafb',
  showGrid = true,
  drape = true,
}) {
  // ── все hooks до условий ──
  const items = useMemo(() => {
    if (Array.isArray(garments) && garments.length) {
      return [...garments].sort((a, b) => (a.layer || 1) - (b.layer || 1));
    }
    if (garmentUrl) return [{ url: garmentUrl, garmentType: 'dress', layer: 1 }];
    return [];
  }, [garments, garmentUrl]);

  const camY = useMemo(() => {
    return profile ? ((Number(profile.heightCm) || 170) / 100) * 0.5 : 0.85;
  }, [profile]);

  const hasBody = !!profile;
  if (!hasBody && !url) return null;

  return (
    <div
      style={{
        width: '100%',
        height,
        borderRadius: 12,
        overflow: 'hidden',
        background,
        border: '1px solid #e5e7eb',
      }}
    >
      <Canvas camera={{ position: [0, camY, 3.2], fov: 40, near: 0.1, far: 100 }}>
        <color attach="background" args={[background]} />
        <ambientLight intensity={0.7} />
        <directionalLight intensity={1.0} position={[2, 4, 2]} castShadow />
        <directionalLight intensity={0.3} position={[-2, 2, -2]} />

        <Suspense
          fallback={
            <Html center>
              <div style={{ color: '#4b5563', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                ⏳ Loading 3D...
              </div>
            </Html>
          }
        >
          {hasBody ? (
            <>
              <BodyAvatar profile={profile} stressMap={stressMap} />
              {items.map((g, i) => (
                <GlbGarment
                  key={`${g.url}-${i}`}
                  url={g.url}
                  profile={profile}
                  garmentType={g.garmentType || 'dress'}
                  layerOffset={i}
                  fit={g.fit || 'regular'}
                  drape={drape}
                />
              ))}
            </>
          ) : items.length ? (
            <AvatarWithGarment avatarUrl={url} garmentUrl={items[0].url} />
          ) : (
            <AvatarOnly avatarUrl={url} />
          )}
          <Environment preset="city" />
        </Suspense>

        {showGrid && (
          <gridHelper args={[4, 16, '#e5e7eb', '#f3f4f6']} position={[0, 0, 0]} />
        )}

        <OrbitControls
          target={[0, camY, 0]}
          enablePan={false}
          enableRotate
          enableZoom
          minDistance={1.2}
          maxDistance={6}
        />
      </Canvas>
    </div>
  );
}
