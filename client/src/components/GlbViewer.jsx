// client/src/components/GlbViewer.jsx
import React, { Suspense, useLayoutEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, useGLTF, Html } from '@react-three/drei';
import * as THREE from 'three';

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

    // Auto-detect unit mismatch: if garment > 10x taller than avatar → centimeters
    let preScale = 1;
    if (garmentSize.y > avatarSize.y * 10) {
      preScale = 0.01;
    } else if (garmentSize.y < avatarSize.y * 0.1) {
      preScale = 100;
    }

    const correctedHeight = garmentSize.y * preScale;
    const scaleFactor = (avatarSize.y / correctedHeight) * preScale;
    garmentRef.current.scale.set(scaleFactor, scaleFactor, scaleFactor);

    const scaledBox = new THREE.Box3().setFromObject(garmentRef.current);
    garmentRef.current.position.x += (avatarCenterX - (scaledBox.min.x + scaledBox.max.x) / 2);
    garmentRef.current.position.y += (avatarBox.min.y - scaledBox.min.y);
    garmentRef.current.position.z += (avatarCenterZ - (scaledBox.min.z + scaledBox.max.z) / 2) + 0.01;

  }, [avatarScene, garmentScene]);

  return (
    <group ref={garmentRef}>
      <primitive object={garmentScene} />
    </group>
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

function Models({ avatarUrl, garmentUrl }) {
  if (garmentUrl) {
    return <AvatarWithGarment avatarUrl={avatarUrl} garmentUrl={garmentUrl} />;
  }
  return <AvatarOnly avatarUrl={avatarUrl} />;
}

export default function GlbViewer({
  url,
  garmentUrl,
  height = 360,
  background = '#f9fafb',
}) {
  if (!url) return null;

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
      <Canvas camera={{ position: [0, 0.85, 3.5], fov: 40, near: 0.1, far: 100 }}>
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
          <Models avatarUrl={url} garmentUrl={garmentUrl} />
          <Environment preset="city" />
        </Suspense>
        <OrbitControls
          target={[0, 0.85, 0]}
          enablePan={false}
          enableRotate
          enableZoom
          minDistance={1.5}
          maxDistance={6}
        />
      </Canvas>
    </div>
  );
}