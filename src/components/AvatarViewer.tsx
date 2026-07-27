import { useEffect, useRef, useState } from "react";

import { loadThree } from "@/lib/modelViewer";
import hairTextureUrl from "@/assets/hair-texture.jpg";
import {
  HAIR_MODEL_URL,
  HAIR_SCALE,
  HAIR_STYLES,
  HAIR_TOP_OFFSET_MM,
  REFERENCE_HEAD_WIDTH_MM,
} from "@/lib/hairStyles";

// Minimal structural type instead of importing Three.js's real types —
// this is CDN-loaded (see lib/modelViewer.ts), not an npm dependency, so
// there's nothing to import statically. All that's needed here is the one
// method used to retint the material live.
type TintedMaterial = { color: { set: (value: string) => void } };
// Loose structural types for the pieces of Three.js this component juggles
// across effects (scene/objects), same reasoning as TintedMaterial above.
type Object3DLike = {
  visible: boolean;
  position: { y: number };
  scale: { setScalar: (s: number) => void };
  traverse: (cb: (child: unknown) => void) => void;
};
type SceneLike = { add: (obj: Object3DLike) => void };

// Renders the .obj mesh 3DLOOK generates from the two photos (see
// volume_params.body_model in the person record — not documented in their
// public API docs, found by inspecting a real successful scan directly).
// It has no texture/color baked in, so this gives it a flat color instead
// of showing an untextured-white blob — `color` is how the skin tone
// picker retints it. `hairStyle` (see lib/hairStyles.ts) overlays one of a
// fixed set of hairstyles from a separate CC-BY model pack, fitted onto
// this mesh with empirically-calibrated scale/offset constants — those
// styles were modeled for a different, unknown reference head, so this is
// an approximate fit, not an anatomically exact one.
export function AvatarViewer({
  modelUrl,
  color = "#b7bcc4",
  hairStyle,
  focus = "body",
}: {
  modelUrl: string;
  color?: string;
  hairStyle?: string;
  // "head" frames a close-up on the head/shoulders instead of the whole
  // body — used on the hairstyle picker, where the body isn't the point.
  focus?: "body" | "head";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const materialRef = useRef<TintedMaterial | null>(null);
  const sceneRef = useRef<SceneLike | null>(null);
  const bodyTopYRef = useRef<number>(0);
  const headWidthRef = useRef<number>(0);
  const hairNodesRef = useRef<Record<string, Object3DLike> | null>(null);
  const hairLoadingRef = useRef<Promise<void> | null>(null);
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

        // Samples every vertex within a horizontal band near the crown
        // (1%-3.5% of total height below the top, in world space — matches
        // where this was calibrated by hand against a real scan) and
        // returns how wide the head reads there. Proportional to height
        // rather than a fixed mm band, so it still lands on the head
        // regardless of how tall this particular scan is.
        function measureHeadWidth(obj: InstanceType<typeof THREE.Object3D>, topY: number): number {
          let minX = Infinity;
          let maxX = -Infinity;
          const sliceTop = topY - topY * 0.01;
          const sliceBottom = topY - topY * 0.035;
          const v = new THREE.Vector3();
          obj.traverse((child: InstanceType<typeof THREE.Object3D>) => {
            const mesh = child as InstanceType<typeof THREE.Mesh>;
            if (!mesh.isMesh) return;
            const posAttr = mesh.geometry.attributes.position;
            for (let i = 0; i < posAttr.count; i++) {
              v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
              mesh.localToWorld(v);
              if (v.y >= sliceBottom && v.y <= sliceTop) {
                if (v.x < minX) minX = v.x;
                if (v.x > maxX) maxX = v.x;
              }
            }
          });
          return maxX > minX ? maxX - minX : 0;
        }

        const width = container.clientWidth;
        const height = container.clientHeight;

        const scene = new THREE.Scene();
        sceneRef.current = scene as unknown as SceneLike;
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
            // Feet are now at y=0, so the mesh's own height is the y of its
            // highest point — the top of the head. The hair effect below
            // uses this to sit hairstyles on top of whichever body loads.
            bodyTopYRef.current = size.y;

            // Every scan is a different size — measure THIS avatar's actual
            // head width (a horizontal slice near the crown, in world space
            // after the centering above) instead of assuming everyone
            // matches the one real scan the hair scale was calibrated
            // against. The hair effect below scales proportionally to
            // whatever this comes out to.
            headWidthRef.current = measureHeadWidth(object, size.y);

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
            let targetY: number;
            let distance: number;
            if (focus === "head") {
              // Head + a bit of neck/shoulder, not the whole body — hair
              // styles are hard to judge zoomed all the way out. Only
              // height-constrained: at this crop the arms are out of frame
              // anyway, so the body's full arm-span width doesn't matter.
              const headFrameHeight = size.y * 0.32;
              targetY = size.y - headFrameHeight * 0.4;
              distance = (headFrameHeight / 2 / Math.tan(fovRad / 2)) * 1.6;
            } else {
              targetY = size.y * 0.5;
              const distanceForHeight = size.y / 2 / Math.tan(fovRad / 2);
              const distanceForWidth = size.x / 2 / Math.tan(fovRad / 2) / camera.aspect;
              distance = Math.max(distanceForHeight, distanceForWidth) * 1.35;
            }
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

  // Loads the (separate, ~4.7MB) hair pack lazily — only once a hairstyle
  // is actually selected, not on every avatar view — and only once ever
  // per mounted viewer; after that, switching styles just flips which
  // pre-positioned node is visible; nothing gets refetched or rebuilt.
  useEffect(() => {
    let cancelled = false;

    async function ensureHairLoaded() {
      if (hairNodesRef.current) return;
      if (!hairLoadingRef.current) {
        hairLoadingRef.current = (async () => {
          const { THREE, GLTFLoader } = await loadThree();
          const scene = sceneRef.current;
          if (!scene) return;

          const gltf = await new Promise<{ scene: InstanceType<typeof THREE.Group> }>(
            (resolve, reject) => {
              new GLTFLoader().load(HAIR_MODEL_URL, resolve, undefined, reject);
            },
          );
          if (cancelled) return;

          // AI-generated (nano_banana_2, prompted for a seamless tileable
          // strand pattern) — the pack came with no textures at all, just
          // a flat gray material, so this is what actually makes it read
          // as hair up close instead of a solid-color shape. Repeated
          // rather than mapped 1:1, since a flat close-up strand pattern
          // still looks like hair at reasonable tiling regardless of
          // exactly how this mesh's own UVs are laid out — color comes
          // from the texture itself now, so the material's own color is
          // left white rather than tinting on top of it.
          const hairTexture = new THREE.TextureLoader().load(hairTextureUrl);
          hairTexture.wrapS = THREE.RepeatWrapping;
          hairTexture.wrapT = THREE.RepeatWrapping;
          hairTexture.repeat.set(1.5, 1.5);
          hairTexture.colorSpace = THREE.SRGBColorSpace;

          const hairMaterial = new THREE.MeshStandardMaterial({
            map: hairTexture,
            color: 0xffffff,
            roughness: 0.45,
            metalness: 0.05,
            // The source photo has real shadow between strands baked in,
            // and on top of that PBR shading darkens it further wherever
            // the scene's own lights don't hit — combined, it read as
            // almost solid black. A modest emissive pass of the same
            // texture keeps the darks from crushing without going flat.
            emissiveMap: hairTexture,
            emissive: 0xffffff,
            emissiveIntensity: 0.25,
          });

          const nodes: Record<string, Object3DLike> = {};
          for (const style of HAIR_STYLES) {
            let source: InstanceType<typeof THREE.Object3D> | undefined;
            gltf.scene.traverse((obj: InstanceType<typeof THREE.Object3D>) => {
              if (obj.name === style.node) source = obj;
            });
            if (!source) continue;

            const hair = source.clone(true);
            hair.traverse((child: InstanceType<typeof THREE.Object3D>) => {
              if ((child as InstanceType<typeof THREE.Mesh>).isMesh) {
                (child as InstanceType<typeof THREE.Mesh>).material = hairMaterial;
              }
            });
            // Ignore whatever transform this node had in the original
            // (discarded) reference scene, then recenter on its own raw
            // geometry — see the standalone fitting test this was
            // calibrated against.
            hair.position.set(0, 0, 0);
            hair.rotation.set(0, 0, 0);
            hair.scale.set(1, 1, 1);
            hair.updateMatrixWorld(true);

            const box = new THREE.Box3().setFromObject(hair);
            const center = new THREE.Vector3();
            box.getCenter(center);
            hair.position.set(-center.x, -box.max.y, -center.z);

            // Scales (and lifts) proportionally to how this specific
            // avatar's head measured, relative to the one real scan this
            // was calibrated against — not the same fixed size for every
            // person.
            const headWidthFactor =
              headWidthRef.current > 0 ? headWidthRef.current / REFERENCE_HEAD_WIDTH_MM : 1;

            const group = new THREE.Group();
            group.add(hair);
            group.scale.setScalar((style.scale ?? HAIR_SCALE) * headWidthFactor);
            group.position.set(
              0,
              bodyTopYRef.current + (style.topOffsetMm ?? HAIR_TOP_OFFSET_MM) * headWidthFactor,
              0,
            );
            group.visible = false;

            scene.add(group as unknown as Object3DLike);
            nodes[style.id] = group as unknown as Object3DLike;
          }

          if (!cancelled) hairNodesRef.current = nodes;
        })();
      }
      await hairLoadingRef.current;
    }

    (async () => {
      if (!hairStyle) {
        if (hairNodesRef.current) {
          for (const node of Object.values(hairNodesRef.current)) node.visible = false;
        }
        return;
      }

      await ensureHairLoaded();
      if (cancelled || !hairNodesRef.current) return;
      const headWidthFactor =
        headWidthRef.current > 0 ? headWidthRef.current / REFERENCE_HEAD_WIDTH_MM : 1;
      for (const [id, node] of Object.entries(hairNodesRef.current)) {
        // Re-set every time (cheap) rather than only at creation, in case
        // the body was still loading (bodyTopYRef/headWidthRef still 0)
        // when this ran.
        const style = HAIR_STYLES.find((s) => s.id === id);
        const offsetMm = style?.topOffsetMm ?? HAIR_TOP_OFFSET_MM;
        node.scale.setScalar((style?.scale ?? HAIR_SCALE) * headWidthFactor);
        node.position.y = bodyTopYRef.current + offsetMm * headWidthFactor;
        node.visible = id === hairStyle;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hairStyle]);

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
