// Посадка в примерке: ткань прижимается к телу, обувь и аксессуары остаются твёрдыми.
import * as THREE from 'three';
import { DRAPED_TYPES, isDrapedType, seatGarment } from './garmentPlacement';
import { proceduralBodyShape } from './bodyShape';

const shape = proceduralBodyShape({ heightCm: 166, chest: 88, waist: 70, hips: 96 });

/** Узкий цилиндр — уже тела, поэтому прижатие обязательно сдвинет вершины. */
function garment() {
  const group = new THREE.Group();
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 24, 12)));
  group.add(root);
  group.updateWorldMatrix(true, true);
  return { group, root, positions: () => Array.from(root.children[0].geometry.attributes.position.array) };
}

test('only fabric types are draped', () => {
  expect(DRAPED_TYPES).toEqual(['top', 'bottom', 'dress', 'outerwear']);
  expect(isDrapedType('shoes')).toBe(false);
  expect(isDrapedType('accessory')).toBe(false);
});

test.each(['shoes', 'accessory'])('%s is placed by height but not pressed onto the body like fabric', (garmentType) => {
  const g = garment();
  const before = g.positions();
  expect(seatGarment(g.group, g.root, shape, { garmentType })).toBe('rigid');
  expect(g.positions()).toEqual(before);           // форма вещи не тронута
  expect(g.group.scale.x).not.toBe(1);             // а по росту поставлена
});

test.each(['top', 'dress'])('%s is still draped onto the body', (garmentType) => {
  const g = garment();
  const before = g.positions();
  expect(seatGarment(g.group, g.root, shape, { garmentType })).toBe('draped');
  expect(g.positions()).not.toEqual(before);
});
