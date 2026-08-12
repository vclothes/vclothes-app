import { useEffect, useRef, useState } from "react";

import { loadThree } from "@/lib/modelViewer";

// Prototype viewer for the RigNet output: a GLB that bundles the scanned
// body mesh together with a predicted skeleton + skinning weights (built via
// a local Blender script that parses RigNet's rig.txt and exports a proper
// armature). This is NOT wired to a live 3DLOOK scan yet — `modelUrl` points
// at a fixed test file, same idea as AvatarViewer but proving the rig itself
// works: the skeleton overlay is drawn on top, and one arm bone is animated
// every frame to show the mesh actually deforms with the skeleton.
export function RiggedPreview({ modelUrl }: { modelUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        const { THREE, GLTFLoader, OrbitControls } = await loadThree();
        const container = containerRef.current;
        if (cancelled || !container) return;

        const width = container.clientWidth;
        const height = container.clientHeight;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(width, height);
        container.appendChild(renderer.domElement);

        scene.add(new THREE.AmbientLight(0xffffff, 1.1));
        const key = new THREE.DirectionalLight(0xffffff, 1.6);
        key.position.set(2, 4, 3);
        scene.add(key);
        const fill = new THREE.DirectionalLight(0xffffff, 0.5);
        fill.position.set(-3, 1, -2);
        scene.add(fill);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 2.2;
        controls.enablePan = false;

        const loader = new GLTFLoader();
        let armBone: InstanceType<typeof THREE.Bone> | null = null;

        loader.load(
          modelUrl,
          (gltf: { scene: InstanceType<typeof THREE.Group> }) => {
            if (cancelled) return;

            const object = gltf.scene;

            // Same mm-scale centering as AvatarViewer — RigNet's output keeps
            // the original scan's units (3DLOOK exports in millimeters).
            const box = new THREE.Box3().setFromObject(object);
            const size = new THREE.Vector3();
            const center = new THREE.Vector3();
            box.getSize(size);
            box.getCenter(center);
            object.position.x -= center.x;
            object.position.z -= center.z;
            object.position.y -= box.min.y;
            object.updateMatrixWorld(true);

            const maxDim = Math.max(size.x, size.y, size.z) || 1;

            camera.near = maxDim * 0.01;
            camera.far = maxDim * 20;
            camera.updateProjectionMatrix();
            controls.minDistance = maxDim * 0.6;
            controls.maxDistance = maxDim * 4;

            const fovRad = (camera.fov * Math.PI) / 180;
            const targetY = size.y * 0.5;
            const distanceForHeight = size.y / 2 / Math.tan(fovRad / 2);
            const distanceForWidth = size.x / 2 / Math.tan(fovRad / 2) / camera.aspect;
            const distance = Math.max(distanceForHeight, distanceForWidth) * 1.35;
            camera.position.set(0, targetY, distance);
            controls.target.set(0, targetY, 0);
            controls.update();

            // Find the right-upper-arm bone (shoulder→elbow) predicted by
            // RigNet, so we can animate it — the same bone used in the
            // Blender pose test that proved the rig deforms correctly.
            object.traverse((child: InstanceType<typeof THREE.Object3D>) => {
              if ((child as InstanceType<typeof THREE.Bone>).isBone && child.name === "joint_22") {
                armBone = child as InstanceType<typeof THREE.Bone>;
              }
            });

            const skeletonHelper = new THREE.SkeletonHelper(object);
            (skeletonHelper.material as InstanceType<typeof THREE.LineBasicMaterial>).linewidth = 2;
            scene.add(skeletonHelper);

            scene.add(object);
            setLoading(false);
          },
          undefined,
          (err: unknown) => {
            console.error("[RiggedPreview] failed to load model", err);
            if (!cancelled) {
              setError("Não conseguimos carregar o modelo rigado.");
              setLoading(false);
            }
          },
        );

        let frameId: number;
        function animate(time: number) {
          frameId = requestAnimationFrame(animate);
          if (armBone) {
            // Gentle wave: oscillate the upper-arm bone so the mesh visibly
            // deforms with the skeleton instead of sitting in a static pose.
            armBone.rotation.z = -0.35 + Math.sin(time / 900) * 0.35;
          }
          controls.update();
          renderer.render(scene, camera);
        }
        animate(0);

        function handleResize() {
          if (!container) return;
          const w = container.clientWidth;
          const h = container.clientHeight;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        }
        window.addEventListener("resize", handleResize);

        cleanup = () => {
          window.removeEventListener("resize", handleResize);
          cancelAnimationFrame(frameId);
          controls.dispose();
          renderer.dispose();
          if (renderer.domElement.parentElement === container) {
            container.removeChild(renderer.domElement);
          }
        };
      } catch (err) {
        console.error("[RiggedPreview] failed to set up viewer", err);
        if (!cancelled) {
          setError("Não conseguimos carregar o visualizador 3D.");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [modelUrl]);

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-2xl border hairline bg-secondary">
      <div ref={containerRef} className="h-full w-full" />
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Carregando modelo rigado…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {error}
        </div>
      )}
    </div>
  );
}
