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

// Same bar as the skeleton overlay's drawing threshold — a check should
// never pass on a point too unreliable to even show as a dot.
const MIN_SCORE = 0.5;

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
  facingAngle: boolean;
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
        facingAngle: false,
      },
    };
  }

  const leftAnkle = kp(keypoints, "left_ankle");
  const rightAnkle = kp(keypoints, "right_ankle");
  const leftElbow = kp(keypoints, "left_elbow");
  const rightElbow = kp(keypoints, "right_elbow");
  const leftWrist = kp(keypoints, "left_wrist");
  const rightWrist = kp(keypoints, "right_wrist");
  const nose = kp(keypoints, "nose");

  const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
  const hipMidX = (leftHip.x + rightHip.x) / 2;
  const hipMidY = (leftHip.y + rightHip.y) / 2;
  const centerX = (shoulderMidX + hipMidX) / 2;
  const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x);
  const torsoHeight = Math.max(hipMidY - Math.min(leftShoulder.y, rightShoulder.y), 1);

  const centered = centerX > videoWidth * 0.25 && centerX < videoWidth * 0.75;
  // Facing the camera: shoulders should read as clearly wider than they are
  // tall relative to the torso — someone turned to profile collapses the
  // shoulder-to-shoulder distance down toward the side-pose case below.
  const facingAngle = shoulderWidth > torsoHeight * 0.4;

  const topY = nose ? nose.y : Math.min(leftShoulder.y, rightShoulder.y) - shoulderWidth * 0.6;
  // Ankles need to be both confidently detected AND clearly below the hips
  // — a seated or table-occluded person can still produce a low-but-passable
  // ankle guess near hip height, which isn't actually "legs visible."
  const legsVisible =
    !!leftAnkle &&
    !!rightAnkle &&
    Math.min(leftAnkle.y, rightAnkle.y) > hipMidY + shoulderWidth * 1.2;
  const bottomY = legsVisible ? Math.max(leftAnkle!.y, rightAnkle!.y) : undefined;
  const fullyVisible =
    bottomY !== undefined && topY > videoHeight * 0.02 && bottomY < videoHeight * 0.98;

  const bodyHeight = bottomY !== undefined ? bottomY - topY : 0;
  const properSize = bodyHeight > videoHeight * 0.45 && bodyHeight < videoHeight * 1.0;

  // A hanging arm: elbow below the shoulder, wrist below the elbow (bends
  // downward, not up toward the chest — that's what crossed/raised arms
  // look like), with the hand held at least a little away from the torso.
  // Deliberately doesn't require the wrist to land at any specific height —
  // that turned out to reject perfectly normal relaxed poses whenever one
  // side was a few percent off from the other (real photos are never
  // perfectly symmetric).
  function armOk(
    wrist: Keypoint | undefined,
    elbow: Keypoint | undefined,
    hip: Keypoint,
    shoulder: Keypoint,
  ) {
    if (!wrist || !elbow) return false;
    const outward = Math.abs(wrist.x - hip.x);
    const bendsDown = elbow.y > shoulder.y && wrist.y > elbow.y;
    return bendsDown && outward > shoulderWidth * 0.05 && outward < shoulderWidth * 0.9;
  }

  const armsOk =
    armOk(leftWrist, leftElbow, leftHip, leftShoulder) &&
    armOk(rightWrist, rightElbow, rightHip, rightShoulder);

  const checks: PoseChecks = {
    bodyDetected: true,
    centered,
    fullyVisible,
    properSize,
    armsOk,
    facingAngle,
  };
  const passCount = [centered, fullyVisible, properSize, armsOk, facingAngle].filter(
    Boolean,
  ).length;

  const status: PoseStatus = passCount === 5 ? "green" : passCount >= 3 ? "yellow" : "red";
  return { status, checks };
}

function avgPoint(...points: (Keypoint | undefined)[]): Keypoint | undefined {
  const valid = points.filter((p): p is Keypoint => !!p);
  if (valid.length === 0) return undefined;
  return {
    x: valid.reduce((sum, p) => sum + p.x, 0) / valid.length,
    y: valid.reduce((sum, p) => sum + p.y, 0) / valid.length,
  };
}

// Side (profile) pose: in a true profile the left/right shoulder points
// nearly coincide, so shoulder width isn't a usable scale reference like it
// is for the front pose — this uses shoulder-to-hip distance instead, and
// averages whichever left/right points are visible rather than requiring a
// specific side (either side of the body can be the one facing camera).
export function evaluateSidePose(
  keypoints: Keypoint[],
  videoWidth: number,
  videoHeight: number,
): PoseEvaluation {
  const leftShoulderRaw = kp(keypoints, "left_shoulder");
  const rightShoulderRaw = kp(keypoints, "right_shoulder");
  const shoulder = avgPoint(leftShoulderRaw, rightShoulderRaw);
  const hip = avgPoint(kp(keypoints, "left_hip"), kp(keypoints, "right_hip"));

  if (!shoulder || !hip) {
    return {
      status: "red",
      checks: {
        bodyDetected: false,
        centered: false,
        fullyVisible: false,
        properSize: false,
        armsOk: false,
        facingAngle: false,
      },
    };
  }

  const ankle = avgPoint(kp(keypoints, "left_ankle"), kp(keypoints, "right_ankle"));
  const elbow = avgPoint(kp(keypoints, "left_elbow"), kp(keypoints, "right_elbow"));
  const wrist = avgPoint(kp(keypoints, "left_wrist"), kp(keypoints, "right_wrist"));
  const nose = kp(keypoints, "nose");

  const torsoHeight = Math.max(hip.y - shoulder.y, 1);
  const centerX = (shoulder.x + hip.x) / 2;
  const centered = centerX > videoWidth * 0.25 && centerX < videoWidth * 0.75;

  // In a true profile the two shoulders nearly coincide in x. If both are
  // confidently detected and clearly apart, the person is still facing the
  // camera head-on, not turned to the side — this is what was missing
  // before: nothing here actually checked the person had turned at all.
  const shoulderSeparation =
    leftShoulderRaw && rightShoulderRaw ? Math.abs(leftShoulderRaw.x - rightShoulderRaw.x) : 0;
  const facingAngle = shoulderSeparation < torsoHeight * 0.35;

  const topY = nose ? nose.y : shoulder.y - torsoHeight * 0.8;
  const legsVisible = !!ankle && ankle.y > hip.y + torsoHeight * 1.0;
  const bottomY = legsVisible ? ankle!.y : undefined;
  const fullyVisible =
    bottomY !== undefined && topY > videoHeight * 0.02 && bottomY < videoHeight * 0.98;

  const bodyHeight = bottomY !== undefined ? bottomY - topY : 0;
  const properSize = bodyHeight > videoHeight * 0.45 && bodyHeight < videoHeight * 1.0;

  // Same "bends downward, doesn't need to land at a specific height" idea
  // as the front pose (see the comment there for why the stricter version
  // was rejecting normal poses).
  const armsOk = !!wrist && !!elbow && elbow.y > shoulder.y && wrist.y > elbow.y;

  const checks: PoseChecks = {
    bodyDetected: true,
    centered,
    fullyVisible,
    properSize,
    armsOk,
    facingAngle,
  };
  const passCount = [centered, fullyVisible, properSize, armsOk, facingAngle].filter(
    Boolean,
  ).length;

  const status: PoseStatus = passCount === 5 ? "green" : passCount >= 3 ? "yellow" : "red";
  return { status, checks };
}
