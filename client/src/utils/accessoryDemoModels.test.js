// Демо-аксессуары на фигуре: настоящие модели TRELLIS.2 после scripts/accessories/prepare_models.py
// (client/public/models/demo-accessories — внутренний тест, папки нет в git; без неё тест пропускается).
// Масштаб по карточке: модель уже в метрах по карточке, примерка её почти не растягивает; вещь
// касается своей точки тела. ACCESSORY_RENDER_OUT=<файл.json> — сохранить фигуру и матрицы для
// рендера в Blender (scripts/accessories/render_on_avatar.py).
import fs from 'fs';
import path from 'path';
import * as THREE from 'three';
import calibration from '../data/avatarCalibration.json';
import { solveAvatar } from './avatarMorphs';
import { baseBodyShape, prepareBaseBody } from './baseBody';
import { readBaseBody, readGlb } from './testing/readGlb';
import {
  accessoryTransforms, anchorPoint, avatarFootLengthCm, footFrame, hatSeat, wristFrame, SHOE_OUTER_ALLOWANCE_CM,
} from './accessoryPlacement';

const DIR = path.join(__dirname, '../../public/models/demo-accessories');
const PREPARED = path.join(DIR, 'prepared.json');
const run = fs.existsSync(PREPARED) ? describe : describe.skip;

/** Габариты модели — из min/max атрибута POSITION (у подготовленных моделей узлы без поворота). */
function modelBox(file) {
  const { doc } = readGlb(fs.readFileSync(path.join(DIR, file)));
  const box = new THREE.Box3();
  doc.meshes.forEach((m) => m.primitives.forEach((p) => {
    const acc = doc.accessors[p.attributes.POSITION];
    box.expandByPoint(new THREE.Vector3(...acc.min)).expandByPoint(new THREE.Vector3(...acc.max));
  }));
  return box;
}

const at = (m, v) => v.clone().applyMatrix4(m);
const scaleOf = (m) => new THREE.Vector3().setFromMatrixScale(m);

run('demo accessories on the medium figure', () => {
  const r = calibration.validation.testFigures.medium.requested;
  const body = prepareBaseBody(readBaseBody(fs.readFileSync(path.join(__dirname, '../../public/models/base_avatar.glb'))));
  const shape = baseBodyShape(body, solveAvatar({
    heightCm: r.height, chest: r.bust, waist: r.waist, hips: r.hips, shoulderWidth: r.shoulder, armLength: r.arm_length, inseam: r.inseam,
  }));
  const P = shape.mesh.positions;
  const prepared = fs.existsSync(PREPARED) ? JSON.parse(fs.readFileSync(PREPARED, 'utf8')) : [];
  const placed = prepared.map((m) => {
    const box = modelBox(m.file);
    return { ...m, box, ...accessoryTransforms(m.kind, box, shape, m.card) };
  });
  const byKind = (kind) => placed.filter((p) => p.kind === kind);

  test('nine models, about 1 MB each', () => {
    expect(placed).toHaveLength(9);
    placed.forEach((p) => expect(fs.statSync(path.join(DIR, p.file)).size).toBeLessThan(1.25e6));
  });

  test('the try-on hardly rescales them: the model is already the size on the card', () => {
    placed.filter((p) => p.kind !== 'shoes').forEach((p) => {
      p.items.forEach(({ matrix }) => {
        const s = scaleOf(matrix);
        expect(Math.abs(s.x) / 1).toBeGreaterThan(0.97);
        expect(Math.abs(s.x)).toBeLessThan(1.03);
      });
    });
  });

  test('earrings hang from the lobes, as long as the card says', () => {
    const [e] = byKind('earrings');
    const c = e.box.getCenter(new THREE.Vector3());
    e.items.forEach(({ side, matrix }) => {
      const top = at(matrix, new THREE.Vector3(c.x, e.box.max.y, c.z));
      const bottom = at(matrix, new THREE.Vector3(c.x, e.box.min.y, c.z));
      expect(top.distanceTo(anchorPoint(P, `ear_lobe_${side}`))).toBeLessThan(1e-6);
      expect(top.y - bottom.y).toBeCloseTo(e.card.lengthCm / 100, 3);
    });
  });

  test('shoes: the buyer\'s foot plus the allowance, soles on the floor', () => {
    const foot = avatarFootLengthCm(P);
    byKind('shoes').forEach((s) => {
      expect(s.extra.footCm).toBeCloseTo(foot, 6);
      s.items.forEach(({ side, matrix }) => {
        const placedBox = s.box.clone().applyMatrix4(matrix);
        expect(placedBox.min.y).toBeCloseTo(footFrame(P, side).floor, 3);
        const len = at(matrix, new THREE.Vector3(0, 0, s.box.max.z)).distanceTo(at(matrix, new THREE.Vector3(0, 0, s.box.min.z)));
        expect(len * 100).toBeCloseTo(foot + SHOE_OUTER_ALLOWANCE_CM, 1);
      });
    });
  });

  test('watch on the wrist, handbag in the hand, glasses on the nose, hat on the head', () => {
    const [w] = byKind('watch');
    const wc = at(w.items[0].matrix, w.box.getCenter(new THREE.Vector3()));
    expect(wc.distanceTo(wristFrame(P, 'l').origin)).toBeLessThan(0.03);

    const [bag] = byKind('handbag');
    const bagBox = bag.box.clone().applyMatrix4(bag.items[0].matrix);
    expect(bagBox.max.y).toBeCloseTo(anchorPoint(P, 'grip_l').y, 3);
    expect(bagBox.max.x - bagBox.min.x).toBeCloseTo(bag.card.widthCm / 100, 2);

    const [g] = byKind('glasses');
    const gBox = g.box.clone().applyMatrix4(g.items[0].matrix);
    expect(gBox.max.z).toBeGreaterThan(anchorPoint(P, 'sellion').z);
    expect(gBox.max.x - gBox.min.x).toBeCloseTo(g.card.widthCm / 100, 2);

    const [h] = byKind('hat');
    const seat = hatSeat(P, Number(h.card.size));
    const hBox = h.box.clone().applyMatrix4(h.items[0].matrix);
    expect(hBox.min.y).toBeCloseTo(seat.y, 3);
    expect(hBox.max.y).toBeGreaterThan(anchorPoint(P, 'crown').y);   // макушка под шапкой
  });

  test('necklace and belt: the line as long as the card, the pendant and the buckle on it', () => {
    const [n] = byKind('necklace');
    expect(n.extra.chain.lengthCm).toBeCloseTo(n.card.lengthCm, 0);
    const [b] = byKind('belt');
    const bBox = b.box.clone().applyMatrix4(b.items[0].matrix);
    expect(bBox.max.y - bBox.min.y).toBeCloseTo((b.card.widthCm + 0.6) / 100, 2);
    expect(bBox.getCenter(new THREE.Vector3()).y).toBeCloseTo(shape.levels.waist, 2);
  });

  afterAll(() => {
    const out = process.env.ACCESSORY_RENDER_OUT;
    if (!out) return;
    fs.writeFileSync(out, JSON.stringify({
      body: { positions: Array.from(P), index: Array.from(body.index) },
      items: placed.map((p) => ({
        file: path.join(DIR, p.file), kind: p.kind,
        matrices: p.items.map((i) => ({ side: i.side, elements: i.matrix.elements })),
        line: (p.extra.chain || p.extra.belt)?.points.map((v) => v.toArray()) || null,
        lineWidth: p.extra.belt ? p.extra.belt.widthCm / 100 : null,
      })),
    }));
  });
});
