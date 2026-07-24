import { useEffect, useRef, useState } from "react";

import { loadThree } from "@/lib/modelViewer";

// Renders the .obj mesh 3DLOOK generates from the two photos (see
// volume_params.body_model in the person record — not documented in their
// public API docs, found by inspecting a real successful scan directly).
// It has no texture/color baked in, so this gives it a plain matte
// material rather than showing an untextured-white blob.
export function AvatarViewer({ modelUrl }: { modelUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        const { THREE, OBJLoader, OrbitControls } = await loadThree();
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
        controls.minDistance = 1;
        controls.maxDistance = 6;

        const material = new THREE.MeshStandardMaterial({
          color: 0x2a4fa0,
          roughness: 0.55,
          metalness: 0.05,
        });

        const loader = new OBJLoader();
        loader.load(
          modelUrl,
          (object: InstanceType<typeof THREE.Group>) => {
            if (cancelled) return;

            object.traverse((child: InstanceType<typeof THREE.Object3D>) => {
              if ((child as InstanceType<typeof THREE.Mesh>).isMesh) {
                (child as InstanceType<typeof THREE.Mesh>).material = material;
              }
            });

            // Center the mesh and frame it regardless of the units/scale
            // 3DLOOK exported it at.
            const box = new THREE.Box3().setFromObject(object);
            const size = new THREE.Vector3();
            const center = new THREE.Vector3();
            box.getSize(size);
            box.getCenter(center);
            object.position.sub(center);

            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            camera.position.set(0, size.y * 0.05, maxDim * 1.8);
            controls.target.set(0, 0, 0);
            controls.update();

            scene.add(object);
            setLoading(false);
          },
          undefined,
          (err: unknown) => {
            console.error("[AvatarViewer] failed to load model", err);
            if (!cancelled) {
              setError("Não conseguimos carregar o modelo 3D.");
              setLoading(false);
            }
          },
        );

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
            if (mesh.isMesh) mesh.geometry?.dispose();
          });
          if (renderer.domElement.parentElement === container) {
            container.removeChild(renderer.domElement);
          }
        };
      } catch (err) {
        console.error("[AvatarViewer] failed to set up viewer", err);
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
          Carregando modelo 3D…
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
