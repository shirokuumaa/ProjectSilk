// server/utils/uploadChecks.js
//
// Проверка загруженных файлов по содержимому. MIME-тип и расширение присылает
// клиент — им верить нельзя, поэтому смотрим на первые байты файла.

import fs from 'fs';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_MODEL_BYTES = 50 * 1024 * 1024;

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
export const MODEL_EXTENSIONS = ['.glb'];

const IMAGE_KINDS = ['png', 'jpeg', 'webp'];

/** Тип файла по сигнатуре: 'png' | 'jpeg' | 'webp' | 'glb' | null */
export async function detectFileKind(filePath) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(12);
    const { bytesRead } = await fh.read(buf, 0, 12, 0);
    const b = buf.subarray(0, bytesRead);

    if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
    if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
    if (b.length >= 4 && b.toString('ascii', 0, 4) === 'glTF') return 'glb';
    return null;
  } finally {
    await fh.close();
  }
}

/** Все файлы, которые multer записал в этом запросе. */
export function uploadedFiles(req) {
  return Object.values(req.files || {}).flat();
}

export function removeFiles(paths) {
  for (const p of paths) {
    if (!p) continue;
    try { fs.unlinkSync(p); } catch { /* уже нет — не страшно */ }
  }
}

/**
 * Проверить image и model3d после записи на диск.
 * @returns {null | { status: number, message: string }} — сообщение видит продавец
 */
export async function validateUploads(req) {
  const image = req.files?.image?.[0];
  const model = req.files?.model3d?.[0];

  if (image) {
    if (image.size > MAX_IMAGE_BYTES) {
      return { status: 413, message: 'Image is too large (maximum 10 MB).' };
    }
    if (!IMAGE_KINDS.includes(await detectFileKind(image.path))) {
      return { status: 400, message: 'Image must be a JPEG, PNG or WebP file.' };
    }
  }

  if (model) {
    if (model.size > MAX_MODEL_BYTES) {
      return { status: 413, message: '3D model is too large (maximum 50 MB).' };
    }
    if ((await detectFileKind(model.path)) !== 'glb') {
      return { status: 400, message: '3D model must be a binary glTF (.glb) file.' };
    }
  }

  return null;
}
