// Loaded from CDN at runtime via a dynamic import() of a full URL, not as an
// npm dependency. This fully bypasses Vite/esbuild's local dependency
// pre-bundling — a static `import "@tensorflow/tfjs-backend-webgl"` from
// node_modules previously hung that step indefinitely; a runtime
// import() of a remote URL never touches it.
const TASKS_VISION_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35";
const WASM_BASE_URL = `${TASKS_VISION_URL}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";

type NormalizedLandmark = { x: number; y: number; z: number; visibility?: number };

interface PoseLandmarkerResult {
  landmarks: NormalizedLandmark[][];
}

export interface PoseLandmarkerInstance {
  detectForVideo: (video: HTMLVideoElement, timestampMs: number) => PoseLandmarkerResult;
}

interface TasksVisionModule {
  FilesetResolver: { forVisionTasks: (wasmBaseUrl: string) => Promise<unknown> };
  PoseLandmarker: {
    createFromOptions: (
      fileset: unknown,
      options: {
        baseOptions: { modelAssetPath: string; delegate: "GPU" | "CPU" };
        runningMode: "VIDEO";
        numPoses: number;
      },
    ) => Promise<PoseLandmarkerInstance>;
  };
}

export type Keypoint = { x: number; y: number; score?: number; name?: string };

// MediaPipe's 33-point body landmark indices — the full set (face points
// excluded, they're not useful for framing a body photo).
const LANDMARK_NAMES: Record<number, string> = {
  0: "nose",
  11: "left_shoulder",
  12: "right_shoulder",
  13: "left_elbow",
  14: "right_elbow",
  15: "left_wrist",
  16: "right_wrist",
  23: "left_hip",
  24: "right_hip",
  25: "left_knee",
  26: "right_knee",
  27: "left_ankle",
  28: "right_ankle",
};

// Bones to draw for the skeleton overlay.
export const SKELETON_BONES: [string, string][] = [
  ["left_shoulder", "right_shoulder"],
  ["left_shoulder", "left_hip"],
  ["right_shoulder", "right_hip"],
  ["left_hip", "right_hip"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],
];

let landmarkerPromise: Promise<PoseLandmarkerInstance> | null = null;

async function createLandmarker(delegate: "GPU" | "CPU"): Promise<PoseLandmarkerInstance> {
  const vision = (await import(/* @vite-ignore */ TASKS_VISION_URL)) as TasksVisionModule;
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE_URL);
  return vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numPoses: 1,
  });
}

// GPU delegate is faster but unsupported on some older mobile browsers —
// fall back to CPU rather than failing outright.
export function getPoseLandmarker(): Promise<PoseLandmarkerInstance> {
  if (!landmarkerPromise) {
    landmarkerPromise = createLandmarker("GPU").catch(() => createLandmarker("CPU"));
  }
  return landmarkerPromise;
}

// Raw keypoints, score = MediaPipe's per-landmark "visibility" (0-1). Not
// filtered here — the caller decides what confidence is worth drawing.
export function detectKeypoints(
  landmarker: PoseLandmarkerInstance,
  video: HTMLVideoElement,
  timestampMs: number,
): Keypoint[] {
  const result = landmarker.detectForVideo(video, timestampMs);
  const landmarks = result.landmarks[0];
  if (!landmarks) return [];

  return Object.entries(LANDMARK_NAMES).map(([indexStr, name]) => {
    const lm = landmarks[Number(indexStr)];
    return {
      x: lm.x * video.videoWidth,
      y: lm.y * video.videoHeight,
      score: lm.visibility ?? 1,
      name,
    };
  });
}

const MIN_SCORE = 0.3;

function kp(keypoints: Keypoint[], name: string): Keypoint | undefined {
  const point = keypoints.find((k) => k.name === name);
  return point && (point.score ?? 0) >= MIN_SCORE ? point : undefined;
}

export type PoseStatus = "red" | "yellow" | "green";

export type PoseChecks = {
  bodyDetected: boolean;
  centered: boolean;
  fullyVisible: boolean;
  properSize: boolean;
  armsOk: boolean;
};

export type PoseEvaluation = { status: PoseStatus; checks: PoseChecks };

// Front A-pose: standing straight, centered, full body in frame, arms
// hanging down but slightly away from the torso. Scored as a handful of
// independent checks rather than one strict all-or-nothing rule, so the
// indicator moves smoothly through red -> yellow -> green as the person
// gets into position instead of jumping straight from "wrong" to "right".
export function evaluateFrontPose(
  keypoints: Keypoint[],
  videoWidth: number,
  videoHeight: number,
): PoseEvaluation {
  const leftShoulder = kp(keypoints, "left_shoulder");
  const rightShoulder = kp(keypoints, "right_shoulder");
  const leftHip = kp(keypoints, "left_hip");
  const rightHip = kp(keypoints, "right_hip");

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return {
      status: "red",
      checks: {
        bodyDetected: false,
        centered: false,
        fullyVisible: false,
        properSize: false,
        armsOk: false,
      },
    };
  }

  const leftAnkle = kp(keypoints, "left_ankle");
  const rightAnkle = kp(keypoints, "right_ankle");
  const leftWrist = kp(keypoints, "left_wrist");
  const rightWrist = kp(keypoints, "right_wrist");
  const nose = kp(keypoints, "nose");

  const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
  const hipMidX = (leftHip.x + rightHip.x) / 2;
  const centerX = (shoulderMidX + hipMidX) / 2;
  const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x);

  const centered = centerX > videoWidth * 0.2 && centerX < videoWidth * 0.8;

  const topY = nose ? nose.y : Math.min(leftShoulder.y, rightShoulder.y) - shoulderWidth * 0.6;
  const bottomY = leftAnkle && rightAnkle ? Math.max(leftAnkle.y, rightAnkle.y) : undefined;
  const fullyVisible =
    bottomY !== undefined && topY > videoHeight * 0.02 && bottomY < videoHeight * 0.98;

  const bodyHeight = bottomY !== undefined ? bottomY - topY : 0;
  const properSize = bodyHeight > videoHeight * 0.3 && bodyHeight < videoHeight * 1.0;

  function armOk(wrist: Keypoint | undefined, shoulder: Keypoint, hip: Keypoint) {
    if (!wrist) return false;
    const outward = Math.abs(wrist.x - hip.x);
    const hangingDown =
      wrist.y > shoulder.y - shoulderWidth * 0.2 && wrist.y < (bottomY ?? videoHeight);
    return hangingDown && outward > shoulderWidth * 0.03 && outward < shoulderWidth * 1.1;
  }

  const armsOk =
    armOk(leftWrist, leftShoulder, leftHip) && armOk(rightWrist, rightShoulder, rightHip);

  const checks: PoseChecks = { bodyDetected: true, centered, fullyVisible, properSize, armsOk };
  const passCount = [centered, fullyVisible, properSize, armsOk].filter(Boolean).length;

  const status: PoseStatus = passCount === 4 ? "green" : passCount >= 2 ? "yellow" : "red";
  return { status, checks };
}
