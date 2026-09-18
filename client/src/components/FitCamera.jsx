// client/src/components/FitCamera.jsx
//
// Frames the camera so the scene's actual contents fill the viewport.
//
// WHY THIS EXISTS
// Every earlier version placed the camera at a hard-coded distance (2.9 m,
// 3.2 m). That distance only looks right for one body height and one panel
// size, so the figure came out tiny in narrow panels and cropped in wide ones.
//
// This component measures the real bounding box of everything rendered and
// solves for the distance that makes it occupy `fill` of the frame. It keeps
// working when the body height changes, when a garment is added, when the
// panel is resized, and it will keep working after the procedural body is
// replaced by the artist's base mesh.
//
// It polls instead of running once: geometry built inside useMemo or loaded
// from a GLB is often not in the scene graph yet on the first frame. Polling
// every few frames catches it whenever it appears, then goes quiet once the
// measurements stop changing.

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();

export default function FitCamera({
  controlsRef,
  fill = 0.92,      // доля кадра, которую занимает фигура
  back = false,     // смотреть сзади
  resetKey = '',    // смена значения заставляет пересчитать
  every = 4,        // как часто опрашивать сцену, в кадрах
}) {
  const { camera, scene, size } = useThree();
  const tick = useRef(0);
  const lastFit = useRef('');

  useFrame(() => {
    tick.current += 1;
    if (tick.current % every !== 0) return;

    _box.makeEmpty();
    let found = false;

    scene.traverse((o) => {
      if (!o.visible) return;
      if (o.isGridHelper || o.isLine || o.isPoints) return;
      if (o.isMesh && o.geometry) { _box.expandByObject(o); found = true; }
    });

    if (!found || _box.isEmpty()) return;

    _box.getSize(_size);
    _box.getCenter(_center);
    if (_size.y < 1e-6) return;

    // Пересчитываем только когда что-то реально изменилось: иначе камера
    // дёргалась бы каждый кадр и пользователь не смог бы её повернуть.
    const key = [
      _size.x.toFixed(3), _size.y.toFixed(3), _size.z.toFixed(3),
      _center.x.toFixed(3), _center.y.toFixed(3), _center.z.toFixed(3),
      size.width, size.height, back ? 'b' : 'f', resetKey,
    ].join('|');

    if (key === lastFit.current) return;
    lastFit.current = key;

    const vFov = (camera.fov * Math.PI) / 180;
    const aspect = size.width / Math.max(size.height, 1);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

    const distV = _size.y / (2 * fill * Math.tan(vFov / 2));
    const distH = Math.max(_size.x, _size.z) / (2 * fill * Math.tan(hFov / 2));
    const dist = Math.max(distV, distH);

    camera.position.set(_center.x, _center.y, _center.z + (back ? -dist : dist));
    camera.near = Math.max(dist / 500, 0.01);
    camera.far = dist * 500;
    camera.updateProjectionMatrix();
    camera.lookAt(_center);

    const c = controlsRef?.current;
    if (c) {
      c.target.copy(_center);
      c.minDistance = dist * 0.35;
      c.maxDistance = dist * 2.6;
      c.update();
    }
  });

  return null;
}
