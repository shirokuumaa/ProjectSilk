// server/utils/accessory.js
//
// Карточка аксессуара или обуви: вид и размеры, по которым примерка ставит твёрдую
// модель на тело и масштабирует её (client/src/utils/accessoryPlacement.js).
// Тот же список видов и полей — в client/src/utils/accessoryKinds.js (ACCESSORY_KINDS);
// совпадение проверяет test/accessory.test.js.

export const ACCESSORY_KINDS = {
  earrings: ['lengthCm'],
  necklace: ['lengthCm', 'heightCm'],
  ring: ['size'],
  bracelet: ['lengthCm'],
  watch: ['widthCm'],
  belt: ['widthCm', 'lengthCm', 'level'],
  shoulder_bag: ['widthCm', 'heightCm', 'depthCm', 'dropCm'],
  handbag: ['widthCm', 'heightCm', 'depthCm'],
  hat: ['size', 'widthCm'],
  glasses: ['widthCm'],
  shoes: ['size'],
};

export const SIZE_SYSTEMS = { ring: ['US', 'EU'], shoes: ['EU', 'UK', 'US-W', 'US-M', 'cm'] };
export const ALL_SIZE_SYSTEMS = [...new Set(Object.values(SIZE_SYSTEMS).flat())];
const LENGTH_FIELDS = ['lengthCm', 'widthCm', 'heightCm', 'depthCm', 'dropCm'];
const MAX_CM = 300;

const num = (v) => Number(String(v).replace(',', '.'));

/**
 * Карточка из формы (JSON-строка или объект). У обуви вид всегда shoes; у других типов, кроме
 * аксессуара, карточки нет. Пусто — карточку снять.
 * @returns {{ accessory: object|null } | { error: string }}
 */
export function parseAccessory(raw, garmentType) {
  if (garmentType !== 'shoes' && garmentType !== 'accessory') return { accessory: null };
  if (raw == null || raw === '') return { accessory: null };
  let v = raw;
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw); } catch { return { error: 'Accessory details are not readable.' }; }
  }
  if (!v || typeof v !== 'object') return { accessory: null };

  const kind = garmentType === 'shoes' ? 'shoes' : v.kind;
  const fields = ACCESSORY_KINDS[kind];
  if (!fields) return { error: 'Please choose the accessory kind.' };

  const out = { kind };
  for (const f of fields) {
    const x = v[f];
    if (x == null || x === '') continue;
    if (LENGTH_FIELDS.includes(f)) {
      const n = num(x);
      if (!Number.isFinite(n) || n <= 0 || n > MAX_CM) return { error: `Sizes must be between 0 and ${MAX_CM} cm.` };
      out[f] = n;
    } else if (f === 'level') {
      if (!['waist', 'hips'].includes(x)) return { error: 'A belt is worn at the waist or on the hips.' };
      out.level = x;
    } else if (f === 'size') {
      const n = num(x);
      if (kind === 'hat') {
        if (!(n >= 40 && n <= 70)) return { error: 'Hat size is the head circumference, 40–70 cm.' };
        out.size = String(n);
      } else {
        const system = v.sizeSystem || SIZE_SYSTEMS[kind][0];
        if (!SIZE_SYSTEMS[kind].includes(system)) return { error: 'Unknown size system.' };
        if (!(n > 0 && n < 100)) {
          return { error: kind === 'shoes' ? 'Shoe size must be a number, e.g. 38 or 38.5.' : 'Ring size must be a number, e.g. 7 or 54.' };
        }
        out.size = String(n);
        out.sizeSystem = system;
      }
    }
  }
  if (['l', 'r'].includes(v.side)) out.side = v.side;
  return { accessory: out };
}
