// client/src/ai/initAI.js
import * as posedetection from '@tensorflow-models/pose-detection';
import * as bodySegmentation from '@tensorflow-models/body-segmentation';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';

function getQuery() {
  try { return new URLSearchParams(window.location.search); } catch { return new URLSearchParams(); }
}

export async function initAI() {
  await tf.ready();
  await tf.setBackend('webgl');

  // --- MoveNet: Lightning (по умолчанию) или Thunder через ?m=thunder
  const qs = getQuery();
  const useThunder = (qs.get('m') || '').toLowerCase() === 'thunder';
  const detector = await posedetection.createDetector(
    posedetection.SupportedModels.MoveNet,
    {
      modelType: useThunder
        ? posedetection.movenet.modelType.SINGLEPOSE_THUNDER
        : posedetection.movenet.modelType.SINGLEPOSE_LIGHTNING
    }
  );

  // --- Body segmentation (TFJS BodyPix): стабильная, без wasm
  const segmenter = await bodySegmentation.createSegmenter(
    bodySegmentation.SupportedModels.BodyPix,
    {
      runtime: 'tfjs',
      // 'resnet50' — точнее, но медленнее; 'mobileNetV1' — быстрее
      modelType: qs.get('seg') === 'mobile' ? 'mobileNetV1' : 'resnet50',
      internalResolution: 'medium',         // можно 'high' на мощном ПК
      segmentationThreshold: 0.7,
      scoreThreshold: 0.3,
      enableSmoothing: true,
      multiPersonProbabilityThreshold: 0.7
    }
  );

  return { tf, detector, segmenter, bodySegmentation };
}