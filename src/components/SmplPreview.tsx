import { useEffect, useRef, useState } from "react";

import { loadThree } from "@/lib/modelViewer";

// Temporary demo viewer for a single, already-fitted SMPL body
// (public/smpl-preview.glb — produced offline by fitting SMPL's shape
// parameters to a real 3DLOOK scan, see the conversation this shipped from).
// Not wired to any real per-user pipeline yet — this shows one precomputed
// result so it can be judged in the actual deployed app, not a live feature.
export function SmplPreview({ color = "#c98a5c" }: { color?: string }) {
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
        const camera = new THREE.PerspectiveCamera(35, width / height, 0.01, 100);
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

        const material = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.02 });

        const gltf = await new Promise<{ scene: InstanceType<typeof THREE.Group> }>(
          (resolve, reject) => {
            new GLTFLoader().load("/smpl-preview.glb", resolve, undefined, reject);
          },
        );
        if (cancelled) return;

        const object = gltf.scene;
        object.traverse((child: InstanceType<typeof THREE.Object3D>) => {
          if ((child as InstanceType<typeof THREE.Mesh>).isMesh) {
            (child as InstanceType<typeof THREE.Mesh>).material = material;
          }
        });

        const box = new THREE.Box3().setFromObject(object);
        const size = new THREE.Vector3();
        box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;

        camera.near = maxDim * 0.01;
        camera.far = maxDim * 20;
        camera.updateProjectionMatrix();
        controls.minDistance = maxDim * 0.8;
        controls.maxDistance = maxDim * 5;

        const fovRad = (camera.fov * Math.PI) / 180;
        const targetY = size.y * 0.55;
        const distance = (size.y / 2 / Math.tan(fovRad / 2)) * 1.5;
        camera.position.set(0, targetY, distance);
        controls.target.set(0, targetY, 0);
        controls.update();

        scene.add(object);
        setLoading(false);

        let frameId: number;
        function animate() {
          frameId = requestAnimationFrame(animate);
          controls.update();
          renderer.render(scene, camera);
        }
        animate();

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
          material.dispose();
          scene.traverse((child: InstanceType<typeof THREE.Object3D>) => {
            const mesh = child as InstanceType<typeof THREE.Mesh>;
            if (!mesh.isMesh) return;
            mesh.geometry?.dispose();
          });
          if (renderer.domElement.parentElement === container) {
            container.removeChild(renderer.domElement);
          }
        };
      } catch (err) {
        console.error("[SmplPreview] failed to load model", err);
        if (!cancelled) {
          setError("Não conseguimos carregar a prévia.");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [color]);

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-2xl border hairline bg-secondary">
      <div ref={containerRef} className="h-full w-full" />
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Carregando prévia…
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
