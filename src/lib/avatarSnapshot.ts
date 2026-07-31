import { loadThree } from "@/lib/modelViewer";

// Renders the same .obj body model AvatarViewer shows interactively, but as
// a single static front-on shot instead of a live, rotatable scene — for the
// "Experimentar" step, which wants a flat 2D photo of the avatar rather than
// the 3D viewer. Uses an off-screen canvas (never attached to the page), so
// this doesn't touch or compete with any AvatarViewer instance also on
// screen. `preserveDrawingBuffer: true` is required here — without it,
// toDataURL() can read back a blank buffer once the browser has already
// swapped/cleared it after compositing the frame.
export async function captureAvatarFrontPhoto(modelUrl: string, color: string): Promise<string> {
  const { THREE, OBJLoader } = await loadThree();

  const width = 900;
  const height = 900;
  const canvas = document.createElement("canvas");
  // Kept off-screen but still attached to the document — a canvas that's
  // never part of the page at all has been unreliable for readback in this
  // environment (mirrors a rendering quirk already hit elsewhere this
  // session: a WebGL surface that never gets composited can silently read
  // back blank even with preserveDrawingBuffer set).
  canvas.style.position = "fixed";
  canvas.style.left = "-9999px";
  canvas.style.top = "0";
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);

  const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(2, 4, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(-3, 1, -2);
  scene.add(fill);

  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.02 });

  try {
    const object = await new Promise<InstanceType<typeof THREE.Group>>((resolve, reject) => {
      new OBJLoader().load(modelUrl, resolve, undefined, reject);
    });

    object.traverse((child: InstanceType<typeof THREE.Object3D>) => {
      if ((child as InstanceType<typeof THREE.Mesh>).isMesh) {
        (child as InstanceType<typeof THREE.Mesh>).material = material;
      }
    });

    // Same centering as AvatarViewer — 3DLOOK's .obj files are in
    // millimeters with an arbitrary origin, not centered/floor-relative.
    const box = new THREE.Box3().setFromObject(object);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    object.position.x -= center.x;
    object.position.z -= center.z;
    object.position.y -= box.min.y;
    object.updateMatrixWorld(true);
    scene.add(object);

    // 3DLOOK's .obj files are in millimeters (thousands of units), so the
    // camera's default near/far (0.1-100) clips the entire model — same fix
    // as AvatarViewer, scaling both planes off the model's own size instead
    // of assuming meter-scale units.
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    camera.near = maxDim * 0.01;
    camera.far = maxDim * 20;

    // Same framing math as AvatarViewer's initial (pre-rotation) camera
    // placement — this is that same front angle, just captured once
    // instead of left live for OrbitControls to spin.
    const fovRad = (camera.fov * Math.PI) / 180;
    const targetY = size.y * 0.5;
    const distanceForHeight = size.y / 2 / Math.tan(fovRad / 2);
    const distanceForWidth = size.x / 2 / Math.tan(fovRad / 2) / camera.aspect;
    const distance = Math.max(distanceForHeight, distanceForWidth) * 1.35;
    camera.position.set(0, targetY, distance);
    camera.lookAt(0, targetY, 0);
    camera.updateProjectionMatrix();

    renderer.render(scene, camera);
    return canvas.toDataURL("image/png");
  } finally {
    material.dispose();
    scene.traverse((child: InstanceType<typeof THREE.Object3D>) => {
      const mesh = child as InstanceType<typeof THREE.Mesh>;
      mesh.geometry?.dispose?.();
    });
    renderer.dispose();
    canvas.remove();
  }
}
