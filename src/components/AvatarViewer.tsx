import { useEffect, useRef, useState } from "react";

import { loadThree } from "@/lib/modelViewer";

// Minimal structural type instead of importing Three.js's real types —
// this is CDN-loaded (see lib/modelViewer.ts), not an npm dependency, so
// there's nothing to import statically. All that's needed here is the one
// method used to retint the material live.
type TintedMaterial = { color: { set: (value: string) => void } };

// Renders the .obj mesh 3DLOOK generates from the two photos (see
// volume_params.body_model in the person record — not documented in their
// public API docs, found by inspecting a real successful scan directly).
// It has no texture/color baked in, so this gives it a flat color instead
// of showing an untextured-white blob — `color` is how the skin tone
// picker retints it.
export function AvatarViewer({
  modelUrl,
  color = "#b7bcc4",
}: {
  modelUrl: string;
  color?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const materialRef = useRef<TintedMaterial | null>(null);
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

        const material = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.7,
          metalness: 0.02,
        });
        materialRef.current = material;

        function shadowTexture() {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 256;
          const ctx = canvas.getContext("2d");
          if (!ctx) return new THREE.CanvasTexture(canvas);
          const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
          gradient.addColorStop(0, "rgba(0,0,0,0.35)");
          gradient.addColorStop(0.7, "rgba(0,0,0,0.12)");
          gradient.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, 256, 256);
          return new THREE.CanvasTexture(canvas);
        }

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

            // Center the mesh horizontally and rest its feet on y=0, regardless
            // of the units/scale 3DLOOK exported it at (their .obj files are in
            // millimeters, not meters, confirmed by inspecting a real file — a
            // person ~1780 units tall).
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

            // Ground shadow ellipse under the feet, matching 3DLOOK's own viewer.
            const shadow = new THREE.Mesh(
              new THREE.PlaneGeometry(maxDim * 0.9, maxDim * 0.5),
              new THREE.MeshBasicMaterial({
                map: shadowTexture(),
                transparent: true,
                depthWrite: false,
              }),
            );
            shadow.rotation.x = -Math.PI / 2;
            shadow.position.set(0, maxDim * 0.001, 0);
            scene.add(shadow);

            // Near/far and orbit distance limits scale with the model's own size
            // instead of assuming meter-scale units (the old 0.1–100 / 1–6 range
            // clipped the whole mesh at mm scale).
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
          materialRef.current = null;
          scene.traverse((child: InstanceType<typeof THREE.Object3D>) => {
            const mesh = child as InstanceType<typeof THREE.Mesh>;
            if (!mesh.isMesh) return;
            mesh.geometry?.dispose();
            if (mesh.material !== material) {
              const meshMaterial = mesh.material as InstanceType<typeof THREE.MeshBasicMaterial>;
              meshMaterial.map?.dispose();
              meshMaterial.dispose();
            }
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
    // `color` is only read as the material's initial value here — changing
    // the skin tone shouldn't reload the whole model, so it's applied via
    // the effect below instead of being a dependency of this one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl]);

  useEffect(() => {
    materialRef.current?.color.set(color);
  }, [color]);

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
