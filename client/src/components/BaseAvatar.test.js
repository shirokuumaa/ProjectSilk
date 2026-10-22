// Сняли вещь — колец натяжения больше нет, страница не падает.
import { render } from '@testing-library/react';
import * as THREE from 'three';
import BaseAvatar from './BaseAvatar';

jest.mock('three/examples/jsm/utils/SkeletonUtils.js', () => ({ clone: (s) => s }));

function fakeBody() {
  // вершин столько, сколько у болванки: ориентиры колец — номера её вершин
  const n = 30000;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(n * 4), 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
  mesh.morphTargetDictionary = { a: 0 };
  mesh.morphTargetInfluences = [0];
  mesh.bind(new THREE.Skeleton([]));
  const scene = new THREE.Group();
  scene.add(mesh);
  return { scene };
}

test('removing the stress map (garment taken off) does not crash the avatar', () => {
  const body = fakeBody();
  const props = { body, solution: { weights: { a: 0.1 } }, skinTone: 'skin-4', profile: { chest: 80, waist: 62, hips: 86 } };
  // react-three-fiber не нужен: primitive/mesh в DOM просто игнорируются
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  const { rerender } = render(<BaseAvatar {...props} stressMap={{ waist: '#2f9e44' }} />);
  expect(() => rerender(<BaseAvatar {...props} stressMap={null} />)).not.toThrow();
  err.mockRestore();
});
