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
