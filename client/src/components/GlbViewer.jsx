import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
// 👇 ИСПРАВЛЕНИЕ: Добавили Html и Center в импорт
import { OrbitControls, Environment, useGLTF, Html, Center } from '@react-three/drei';

function Model({ url }) {
  // Явно указываем надежный CDN от Google для распаковки Draco-моделей
  const { scene } = useGLTF(url, 'https://www.gstatic.com/draco/versioned/decoders/1.5.5/');
  
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
      {/* 👇 ИСПРАВЛЕНИЕ: Чуть опустили и отодвинули камеру, чтобы модель влезла целиком */}
      <Canvas camera={{ position: [0, 0, 4.5], fov: 45 }}>
        <color attach="background" args={[background]} />
        <ambientLight intensity={0.6} />
        <directionalLight intensity={0.9} position={[2, 4, 2]} />
        
        {/* 👇 ИСПРАВЛЕНИЕ: Добавили видимый текст загрузки */}
        <Suspense fallback={<Html center><div style={{color: '#4b5563', fontWeight: 'bold', whiteSpace: 'nowrap'}}>⏳ Загрузка 3D...</div></Html>}>
          
          {/* 👇 ИСПРАВЛЕНИЕ: Магия выравнивания по центру! */}
          <Center>
            <Model url={url} />
          </Center>
          
          <Environment preset="city" />
        </Suspense>
        
        <OrbitControls
          enablePan
          enableRotate
          enableZoom
          minDistance={1}
          maxDistance={10}
          target={[0, 0, 0]} // 👇 ИСПРАВЛЕНИЕ: Центр вращения теперь точно по центру модели
        />
      </Canvas>
    </div>
  );
}