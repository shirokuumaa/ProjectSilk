import fs from 'fs';
import path from 'path';
import * as THREE from 'three';
import calibration from '../data/avatarCalibration.json';
import { solveAvatar } from './avatarMorphs';
import { baseBodyShape, prepareBaseBody } from './baseBody';
import { readBaseBody } from './testing/readGlb';
import {
  accessoryKind, accessoryTransforms, anchorPoint, avatarFootLengthCm, footFrame, hatSeat,
  necklaceCurve, beltLoop, placeAccessory, ringFingerFrame, ringInnerDiameterMm, shoeFit,
  shoeFootLengthCm, wristFrame, SHOE_OUTER_ALLOWANCE_CM,
} from './accessoryPlacement';

const GLB = path.join(__dirname, '../../public/models/base_avatar.glb');
const body = prepareBaseBody(readBaseBody(fs.readFileSync(GLB)));

const asProfile = (r) => ({
  heightCm: r.height, chest: r.bust, waist: r.waist, hips: r.hips,
  shoulderWidth: r.shoulder, armLength: r.arm_length, inseam: r.inseam,
});
const figures = Object.entries(calibration.validation.testFigures).filter(([, f]) => f.inRange);
const shapeOf = (name) => baseBodyShape(body, solveAvatar(asProfile(calibration.validation.testFigures[name].requested)));
const medium = shapeOf('medium');
const P = medium.mesh.positions;

/** Габариты коробки модели после матрицы. */
function placedBox(box, matrix) {
  return box.clone().applyMatrix4(matrix);
}
const at = (m, x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(m);

describe('anchor points follow every calibrated figure', () => {
  test.each(figures)('%s', (name, fig) => {
    const shape = shapeOf(name);
    const p = shape.mesh.positions;
    const H = shape.landmarks.height;
    const lobeL = anchorPoint(p, 'ear_lobe_l');
    const lobeR = anchorPoint(p, 'ear_lobe_r');
    const earTop = anchorPoint(p, 'ear_top_l');
    const crown = anchorPoint(p, 'crown');
    const sellion = anchorPoint(p, 'sellion');

    expect(lobeL.x).toBeCloseTo(-lobeR.x, 3);                  // симметрично
    expect(lobeL.x).toBeGreaterThan(0.05);                       // +X — левая сторона
    expect(earTop.y - lobeL.y).toBeGreaterThan(0.04);            // ухо 5–7 см
    expect(earTop.y - lobeL.y).toBeLessThan(0.09);
    expect(crown.y).toBeCloseTo(H, 2);
    expect(crown.y - lobeL.y).toBeGreaterThan(0.12);
    expect(crown.y - lobeL.y).toBeLessThan(0.20);
    expect(Math.abs(sellion.x)).toBeLessThan(0.003);
    expect(sellion.z).toBeGreaterThan(lobeL.z + 0.05);           // переносица впереди ушей
    expect(sellion.y).toBeGreaterThan(lobeL.y);
    expect(sellion.y).toBeLessThan(earTop.y + 0.01);

    const c7 = anchorPoint(p, 'cervicale');
    const jug = anchorPoint(p, 'jugular');
    expect(jug.z).toBeGreaterThan(c7.z + 0.06);
    expect(jug.y).toBeLessThan(c7.y);
    const sh = anchorPoint(p, 'shoulder_top_l');
    expect(sh.y).toBeGreaterThan(shape.levels.chest + 0.08);
    expect(sh.y).toBeLessThan(c7.y);

    const wrist = wristFrame(p, 'l');
    expect(wrist.axis.dot(new THREE.Vector3(1, -1, 0).normalize())).toBeGreaterThan(0.8);   // A-поза: вниз-наружу
    expect(Math.abs(wrist.dorsal.dot(wrist.axis))).toBeLessThan(1e-6);
    expect(wrist.perimeter * 100).toBeGreaterThan(10.5);         // у MPFB запястья тонкие: petite — 11 см
    expect(wrist.perimeter * 100).toBeLessThan(19);
    const finger = ringFingerFrame(p, 'r');
    expect(finger.perimeter * 100).toBeGreaterThan(4.5);
    expect(finger.perimeter * 100).toBeLessThan(7.5);

    const foot = footFrame(p, 'l');
    expect(foot.dir.z).toBeGreaterThan(0.95);                   // носок вперёд
    expect(foot.floor).toBeCloseTo(0, 2);
    expect(avatarFootLengthCm(p)).toBeGreaterThan(18);
    expect(avatarFootLengthCm(p)).toBeLessThan(27);
    expect(fig.inRange).toBe(true);
  });

  test('a taller figure has longer feet', () => {
    const petite = avatarFootLengthCm(shapeOf('petite').mesh.positions);
    const large = avatarFootLengthCm(shapeOf('large').mesh.positions);
    expect(large).toBeGreaterThan(petite);
  });
});

describe('sizes from the product card', () => {
  test('shoe sizes → foot length', () => {
    expect(shoeFootLengthCm(38, 'EU')).toBeCloseTo(23.83, 2);
    expect(shoeFootLengthCm('38,5', 'EU')).toBeCloseTo(24.17, 2);
    expect(Math.abs(shoeFootLengthCm(5, 'UK') - shoeFootLengthCm(38, 'EU'))).toBeLessThan(0.3);
    expect(shoeFootLengthCm(7, 'US-W')).toBeCloseTo(shoeFootLengthCm(5, 'UK'), 5);
    expect(shoeFootLengthCm(6, 'US-M')).toBeCloseTo(shoeFootLengthCm(5, 'UK'), 5);
    expect(shoeFootLengthCm(24.5, 'cm')).toBe(24.5);
    expect(shoeFootLengthCm('', 'EU')).toBeNull();
    expect(shoeFootLengthCm(38, 'XX')).toBeNull();
  });

  test('shoe fit verdict', () => {
    expect(shoeFit(23.8, 24.5)).toBe('small');
    expect(shoeFit(24.2, 24.0)).toBe('fits');
    expect(shoeFit(25.5, 24.0)).toBe('large');
    expect(shoeFit(null, 24)).toBeNull();
  });

  test('ring sizes → inner diameter', () => {
    expect(ringInnerDiameterMm(7, 'US')).toBeCloseTo(17.32, 2);
    expect(ringInnerDiameterMm(54, 'EU')).toBeCloseTo(17.19, 2);
    expect(ringInnerDiameterMm('x', 'US')).toBeNull();
  });

  test('kind of a product', () => {
    expect(accessoryKind('shoes', undefined)).toBe('shoes');
    expect(accessoryKind('accessory', { kind: 'watch' })).toBe('watch');
    expect(accessoryKind('accessory', { kind: 'spaceship' })).toBeNull();
    expect(accessoryKind('dress', { kind: 'watch' })).toBeNull();
  });
});

describe('placement scales by the card and sits on the anchor', () => {
  const cube = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));

  test('earrings: drop length from the card, top at each lobe', () => {
    const { items } = accessoryTransforms('earrings', cube, medium, { lengthCm: 4 });
    expect(items.map((i) => i.side)).toEqual(['l', 'r']);
    items.forEach(({ side, matrix }) => {
      const b = placedBox(cube, matrix);
      expect(b.max.y - b.min.y).toBeLessThan(0.0401 * 1.5);          // повёрнута вокруг Y, по высоте ровно 4 см
      expect(at(matrix, 0, 0, 0).distanceTo(at(matrix, 0, 1, 0))).toBeCloseTo(0.04, 5);
      expect(at(matrix, 0, 1, 0).distanceTo(anchorPoint(P, `ear_lobe_${side}`))).toBeLessThan(1e-6);
      expect(at(matrix, 0, 0, 0).y).toBeLessThan(at(matrix, 0, 1, 0).y);   // висит вниз
    });
  });

  test('shoes: length from the buyer foot, sole on the floor, right shoe mirrored', () => {
    const shoe = new THREE.Box3(new THREE.Vector3(-0.05, 0, 0), new THREE.Vector3(0.05, 0.08, 0.25));
    const { items, extra } = accessoryTransforms('shoes', shoe, medium, { size: 38, sizeSystem: 'EU' }, { footLengthCm: 24 });
    expect(extra.footCm).toBe(24);
    expect(extra.fit).toBe('fits');
    items.forEach(({ side, matrix }) => {
      const heel = at(matrix, 0, 0, 0);
      const toe = at(matrix, 0, 0, 0.25);
      expect(heel.distanceTo(toe)).toBeCloseTo((24 + SHOE_OUTER_ALLOWANCE_CM) / 100, 5);
      const f = footFrame(P, side);
      expect(heel.y).toBeCloseTo(f.floor, 6);
      expect(toe.clone().sub(heel).normalize().dot(f.dir)).toBeCloseTo(1, 6);
      expect(heel.clone().sub(f.heel).setY(0).dot(f.dir)).toBeLessThan(0);   // задник позади пятки
      expect(Math.sign(matrix.determinant())).toBe(side === 'r' ? -1 : 1);
    });
    // без длины стопы в профиле — стопа фигуры
    const own = accessoryTransforms('shoes', shoe, medium, { size: 44, sizeSystem: 'EU' });
    expect(own.extra.footCm).toBeCloseTo(avatarFootLengthCm(P), 6);
    expect(own.extra.fit).toBe('large');
  });

  test('handbag: width from the card, handle top in the hand', () => {
    const { items } = accessoryTransforms('handbag', cube, medium, { widthCm: 30, side: 'r' });
    const b = placedBox(cube, items[0].matrix);
    expect(b.max.x - b.min.x).toBeCloseTo(0.3, 5);
    expect(at(items[0].matrix, 0, 1, 0).distanceTo(anchorPoint(P, 'grip_r'))).toBeLessThan(1e-6);
    expect(b.max.y).toBeCloseTo(anchorPoint(P, 'grip_r').y, 6);
  });

  test('shoulder bag hangs at the side, clear of the hip', () => {
    const { items } = accessoryTransforms('shoulder_bag', cube, medium, { widthCm: 25, dropCm: 55 });
    const b = placedBox(cube, items[0].matrix);
    const top = anchorPoint(P, 'shoulder_top_l');
    expect(b.max.y).toBeCloseTo(top.y - 0.55, 5);
    expect(b.max.z - b.min.z).toBeCloseTo(0.25, 5);                 // ширина — спереди назад
    const hip = medium.surfaceAt(medium.levels.hips, 1, 0);
    expect(b.min.x).toBeGreaterThan(hip.cx + hip.r * 0.9);
  });

  test('ring: inner diameter from the size, hole centred on the finger', () => {
    const ring = new THREE.Box3(new THREE.Vector3(-1, 0, -0.3), new THREE.Vector3(1, 2.4, 0.3));
    const { items, extra } = accessoryTransforms('ring', ring, medium, { size: 7, sizeSystem: 'US' });
    const m = items[0].matrix;
    const f = ringFingerFrame(P, 'l');
    expect(at(m, -1, 1, 0).distanceTo(at(m, 1, 1, 0))).toBeCloseTo((17.32 + 4) / 1000, 4);
    const s = (17.32 + 4) / 1000 / 2;
    expect(at(m, 0, (0.002 + 0.01732 / 2) / s, 0).distanceTo(f.origin)).toBeLessThan(1e-6);
    expect(at(m, 0, 0, 1).sub(at(m, 0, 0, 0)).normalize().dot(f.axis)).toBeCloseTo(1, 6);
    expect(extra.ringCm).toBeCloseTo(5.44, 2);
  });

  test('watch face on the back of the wrist, 3 o\'clock towards the hand, strap round the wrist', () => {
    const watch = new THREE.Box3(new THREE.Vector3(-0.02, -0.12, -0.004), new THREE.Vector3(0.02, 0.12, 0.004));
    const { items } = accessoryTransforms('watch', watch, medium, { widthCm: 4 });
    const m = items[0].matrix;
    const f = wristFrame(P, 'l');
    expect(at(m, 0.02, 0, 0).distanceTo(at(m, -0.02, 0, 0))).toBeCloseTo(0.04, 6);
    expect(at(m, 0, 0, 1).sub(at(m, 0, 0, 0)).normalize().dot(f.dorsal)).toBeCloseTo(1, 6);
    expect(at(m, 1, 0, 0).sub(at(m, 0, 0, 0)).normalize().dot(f.axis)).toBeCloseTo(1, 6);
    expect(Math.abs(at(m, 0, 1, 0).sub(at(m, 0, 0, 0)).normalize().dot(f.axis))).toBeLessThan(1e-6);
    // плоская модель — задняя сторона корпуса на тыльной поверхности запястья
    expect(at(m, 0, 0, -0.004).sub(f.origin).dot(f.dorsal)).toBeGreaterThan(0.015);
  });

  test('glasses: frame width from the card, bridge in front of the sellion', () => {
    const { items } = accessoryTransforms('glasses', cube, medium, { widthCm: 14 });
    const m = items[0].matrix;
    expect(at(m, -0.5, 0.5, 0.5).distanceTo(at(m, 0.5, 0.5, 0.5))).toBeCloseTo(0.14, 6);
    const bridge = at(m, 0, 0.5, 0.5);
    expect(bridge.z).toBeGreaterThan(anchorPoint(P, 'sellion').z);
    expect(Math.abs(bridge.x)).toBeLessThan(0.003);
  });

  test('a hat sits where the head is as wide as the hat', () => {
    const crown = anchorPoint(P, 'crown').y;
    const small = hatSeat(P, 40);
    const big = hatSeat(P, 52);
    expect(small.perimeter * 100).toBeGreaterThanOrEqual(40);
    expect(small.perimeter * 100).toBeLessThan(43);
    expect(big.y).toBeLessThan(small.y);
    expect(small.y).toBeLessThan(crown);
    const huge = hatSeat(P, 80);                     // больше любой головы — лежит на бровях
    expect(huge.y).toBeCloseTo(anchorPoint(P, 'sellion').y + 0.02, 2);
    const { items } = accessoryTransforms('hat', cube, medium, { size: 52, widthCm: 30 });
    expect(at(items[0].matrix, 0, 0, 0).y).toBeCloseTo(big.y, 6);
  });

  test('necklace: the chain is as long as the card says, longer hangs lower', () => {
    const n45 = necklaceCurve(medium, P, 45);
    const n60 = necklaceCurve(medium, P, 60);
    expect(n45.lengthCm).toBeCloseTo(45, 0);
    expect(n60.lengthCm).toBeCloseTo(60, 0);
    expect(n60.lowest.y).toBeLessThan(n45.lowest.y);
    expect(n45.lowest.y).toBeLessThan(anchorPoint(P, 'neck_front').y);
    // чокер короче основания шеи — на основании шеи (33–40 см у фигур калибровки)
    const choker = necklaceCurve(medium, P, 20);
    expect(choker.lowest.y).toBeCloseTo(anchorPoint(P, 'neck_front').y, 3);
    expect(choker.lengthCm).toBeGreaterThan(33);
    expect(choker.lengthCm).toBeLessThan(40);
    // на груди (ниже яремной вырезки) цепочка не уходит в тело
    const jug = anchorPoint(P, 'jugular').y;
    n60.points.forEach((p) => {
      if (p.y > medium.levels.waist && p.y < jug) {
        const s = medium.surfaceAt(p.y, p.x, p.z);
        expect(Math.hypot(p.x - s.cx, p.z - s.cz)).toBeGreaterThan(s.r - 0.002);
      }
    });
  });

  test('belt goes round the waist over the clothes', () => {
    const belt = beltLoop(medium, 'waist');
    const girth = medium.girthAt(medium.levels.waist) * 100;
    expect(belt.lengthCm).toBeGreaterThan(girth);
    expect(belt.lengthCm).toBeLessThan(girth + 2 * Math.PI * 0.8 + 1);
    expect(belt.front.z).toBeGreaterThan(0);
    expect(beltLoop(medium, 'hips').y).toBeLessThan(belt.y);
  });
});

describe('placeAccessory in the scene', () => {
  const model = () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.25).translate(0, 0.04, 0.125), new THREE.MeshBasicMaterial()));
    const group = new THREE.Group();
    group.add(root);
    return { root, group };
  };

  test('a pair: the group goes to the left foot, a mirrored copy to the right', () => {
    const { root, group } = model();
    const extra = placeAccessory(group, root, medium, 'shoes', { size: 38 }, { footLengthCm: 24 });
    expect(extra.fit).toBe('fits');
    const copies = group.children.filter((o) => o.userData.accessoryPart);
    expect(copies).toHaveLength(1);
    group.updateWorldMatrix(true, true);
    const right = new THREE.Box3().setFromObject(copies[0]);
    const left = new THREE.Box3().setFromObject(root);
    expect(left.getCenter(new THREE.Vector3()).x).toBeGreaterThan(0);
    expect(right.getCenter(new THREE.Vector3()).x).toBeLessThan(0);
    expect(right.max.z - right.min.z).toBeCloseTo(left.max.z - left.min.z, 3);

    // повторная посадка (другая фигура) не копит копии
    group.position.set(0, 0, 0); group.quaternion.identity(); group.scale.set(1, 1, 1);
    placeAccessory(group, root, shapeOf('large'), 'shoes', { size: 38 });
    expect(group.children.filter((o) => o.userData.accessoryPart)).toHaveLength(1);
  });

  test('a necklace adds its chain; nothing for an unknown kind or a figure without mesh', () => {
    const { root, group } = model();
    const extra = placeAccessory(group, root, medium, 'necklace', { lengthCm: 50, heightCm: 3 });
    expect(extra.chain.lengthCm).toBeCloseTo(50, 0);
    expect(group.children.filter((o) => o.userData.accessoryPart === 'line')).toHaveLength(1);
    expect(placeAccessory(group, root, medium, 'spaceship', {})).toBeNull();
    expect(placeAccessory(group, root, { kind: 'procedural' }, 'shoes', {})).toBeNull();
  });
});
