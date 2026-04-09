// client/src/components/GlbViewer.jsx
import React, { Suspense, useLayoutEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, useGLTF, Html, Center } from '@react-three/drei';
import * as THREE from 'three';

// Smart GarmentFitter: automatically scales and positions the dress to fit the avatar
function GarmentFitter({ avatarScene, garmentScene }) {
  const garmentRef = useRef();

  useLayoutEffect(() => {
    if (!avatarScene || !garmentScene || !garmentRef.current) return;

    // Measure avatar bounding box
    const avatarBox = new THREE.Box3().setFromObject(avatarScene);
    const avatarSize = avatarBox.getSize(new THREE.Vector3());
    const avatarCenter = avatarBox.getCenter(new THREE.Vector3());

    // Measure garment bounding box
    const garmentBox = new THREE.Box3().setFromObject(garmentScene);
    const garmentSize = garmentBox.getSize(new THREE.Vector3());

    if (garmentSize.x === 0 || garmentSize.y === 0) {
      // Skip fitting for garments with zero dimensions (invalid or unloaded mesh)
      return;
    }

    // Scale garment to match avatar width.
    // 1.05 adds a 5% looser fit so the garment visually wraps around the avatar
    // rather than clipping tightly into the body mesh.
    const GARMENT_WIDTH_SCALE_FACTOR = 1.05;
    const scaleFactor = (avatarSize.x * GARMENT_WIDTH_SCALE_FACTOR) / garmentSize.x;
    garmentRef.current.scale.set(scaleFactor, scaleFactor, scaleFactor);

    // Re-measure after scaling to get new center
    const newGarmentBox = new THREE.Box3().setFromObject(garmentRef.current);
    const newGarmentCenter = newGarmentBox.getCenter(new THREE.Vector3());

    // Align garment center to avatar center.
    // +0.05 on Y shifts the garment slightly upward so hemlines align with hips.
    // +0.01 on Z pushes the garment just in front of the avatar to reduce z-fighting.
    const GARMENT_Y_OFFSET = 0.05;
    const GARMENT_Z_OFFSET = 0.01;
    garmentRef.current.position.x += (avatarCenter.x - newGarmentCenter.x);
    garmentRef.current.position.y += (avatarCenter.y - newGarmentCenter.y) + GARMENT_Y_OFFSET;
    garmentRef.current.position.z += (avatarCenter.z - newGarmentCenter.z) + GARMENT_Z_OFFSET;

  }, [avatarScene, garmentScene]);

  return (
    <group ref={garmentRef}>
      <primitive object={garmentScene} />
    </group>
  );
}

// Scene component — loads avatar and optionally a garment
function Models({ avatarUrl, garmentUrl }) {
  const avatar = useGLTF(avatarUrl);
  const garment = garmentUrl ? useGLTF(garmentUrl) : null;

  return (
    <group>
      <primitive object={avatar.scene} />
      {garment && (
        <GarmentFitter avatarScene={avatar.scene} garmentScene={garment.scene} />
      )}
    </group>
  );
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
      <Canvas camera={{ position: [0, 1.4, 3], fov: 40 }}>
        <color attach="background" args={[background]} />
        <ambientLight intensity={0.6} />
        <directionalLight intensity={0.9} position={[2, 4, 2]} />
        <Suspense
          fallback={
            <Html center>
              <div style={{ color: '#4b5563', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                ⏳ Loading 3D...
              </div>
            </Html>
          }
        >
          <Center>
            <Models avatarUrl={url} garmentUrl={garmentUrl} />
          </Center>
          <Environment preset="city" />
        </Suspense>
        <OrbitControls
          enablePan
          enableRotate
          enableZoom
          minDistance={1.2}
          maxDistance={8}
        />
      </Canvas>
    </div>
  );
}