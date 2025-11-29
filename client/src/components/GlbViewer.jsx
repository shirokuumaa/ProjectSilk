// client/src/components/GlbViewer.jsx
import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, useGLTF } from '@react-three/drei';

function Model({ url }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

export default function GlbViewer({
  url,
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
        <Suspense fallback={null}>
          <Model url={url} />
          <Environment preset="city" />
        </Suspense>
        <OrbitControls
          enablePan
          enableRotate
          enableZoom
          minDistance={1.2}
          maxDistance={5}
        />
      </Canvas>
    </div>
  );
}