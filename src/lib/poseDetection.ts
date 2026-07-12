// Loaded from CDN at runtime, not as npm dependencies — importing
// @tensorflow/tfjs (and its webgl backend) as a normal npm dep previously
// caused Vite/esbuild's dependency pre-bundling to hang indefinitely during
// dev. Loading the prebuilt UMD bundles via <script> tags sidesteps that
// entirely; only minimal hand-written types are used here, no npm package.
const TFJS_SRC = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js";
const POSE_DETECTION_SRC =
  "https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js";

export type Keypoint = { x: number; y: number; score?: number; name?: string };

export interface PoseDetector {
  estimatePoses: (input: HTMLVideoElement) => Promise<{ keypoints: Keypoint[] }[]>;
}

interface PoseDetectionGlobal {
  SupportedModels: { MoveNet: string };
  movenet: { modelType: Record<string, string> };
  createDetector: (model: string, config: unknown) => Promise<PoseDetector>;
}

declare global {
  interface Window {
    poseDetection?: PoseDetectionGlobal;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(script);
  });
}

let detectorPromise: Promise<PoseDetector> | null = null;

export function getPoseDetector(): Promise<PoseDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      await loadScript(TFJS_SRC);
      await loadScript(POSE_DETECTION_SRC);
      const pd = window.poseDetection;
      if (!pd) throw new Error("Falha ao carregar o modelo de detecção de pose.");
      return pd.createDetector(pd.SupportedModels.MoveNet, {
        modelType: pd.movenet.modelType.SINGLEPOSE_LIGHTNING,
      });
    })();
  }
  return detectorPromise;
}

const MIN_SCORE = 0.35;

function kp(keypoints: Keypoint[], name: string): Keypoint | undefined {
  const point = keypoints.find((k) => k.name === name);
  return point && (point.score ?? 0) >= MIN_SCORE ? point : undefined;
}

export type PoseStatus = "red" | "yellow" | "green";

// Front A-pose: standing straight, centered, full body in frame, arms
// hanging down but slightly away from the torso. Scored as a handful of
// independent checks rather than one strict all-or-nothing rule, so the
// indicator moves smoothly through red -> yellow -> green as the person
// gets into position instead of jumping straight from "wrong" to "right".
export function scoreFrontPose(
  keypoints: Keypoint[],
  videoWidth: number,
  videoHeight: number,
): PoseStatus {
  const leftShoulder = kp(keypoints, "left_shoulder");
  const rightShoulder = kp(keypoints, "right_shoulder");
  const leftHip = kp(keypoints, "left_hip");
  const rightHip = kp(keypoints, "right_hip");

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return "red";

  const leftAnkle = kp(keypoints, "left_ankle");
  const rightAnkle = kp(keypoints, "right_ankle");
  const leftWrist = kp(keypoints, "left_wrist");
  const rightWrist = kp(keypoints, "right_wrist");
  const nose = kp(keypoints, "nose");

  const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
  const hipMidX = (leftHip.x + rightHip.x) / 2;
  const centerX = (shoulderMidX + hipMidX) / 2;
  const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x);

  const centered = centerX > videoWidth * 0.3 && centerX < videoWidth * 0.7;

  const topY = nose ? nose.y : Math.min(leftShoulder.y, rightShoulder.y) - shoulderWidth * 0.6;
  const bottomY = leftAnkle && rightAnkle ? Math.max(leftAnkle.y, rightAnkle.y) : undefined;
  const fullyVisible =
    bottomY !== undefined && topY > videoHeight * 0.03 && bottomY < videoHeight * 0.97;

  const bodyHeight = bottomY !== undefined ? bottomY - topY : 0;
  const properSize = bodyHeight > videoHeight * 0.45 && bodyHeight < videoHeight * 0.98;

  function armOk(wrist: Keypoint | undefined, shoulder: Keypoint, hip: Keypoint) {
    if (!wrist) return false;
    const outward = Math.abs(wrist.x - hip.x);
    const hangingDown = wrist.y > shoulder.y && wrist.y < (bottomY ?? videoHeight);
    return hangingDown && outward > shoulderWidth * 0.08 && outward < shoulderWidth * 0.9;
  }

  const armsOk =
    armOk(leftWrist, leftShoulder, leftHip) && armOk(rightWrist, rightShoulder, rightHip);

  const passCount = [centered, fullyVisible, properSize, armsOk].filter(Boolean).length;

  if (passCount === 4) return "green";
  if (passCount >= 2) return "yellow";
  return "red";
}
