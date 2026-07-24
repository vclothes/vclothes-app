// Loaded from CDN at runtime, same reasoning as lib/poseDetection.ts: a
// runtime import() of a full URL never touches Vite/esbuild's local
// dependency pre-bundling, which is what caused a severe hang the one time
// a heavy visualization library (TensorFlow.js) was added as a normal npm
// dependency instead.
const THREE_VERSION = "0.160.0";
// esm.sh, not jsdelivr's raw files — three.js's own examples/jsm addons
// (OBJLoader, OrbitControls) import their `three` dependency as a bare
// specifier ("three"), which only resolves in a browser via an import map
// or a CDN that rewrites it. esm.sh does that rewrite and points both the
// core module and every addon at the same underlying build, so they share
// one instance of the library.
const THREE_BASE = `https://esm.sh/three@${THREE_VERSION}`;

export async function loadThree() {
  const [THREE, { OBJLoader }, { OrbitControls }] = await Promise.all([
    import(/* @vite-ignore */ THREE_BASE),
    import(/* @vite-ignore */ `${THREE_BASE}/examples/jsm/loaders/OBJLoader.js`),
    import(/* @vite-ignore */ `${THREE_BASE}/examples/jsm/controls/OrbitControls.js`),
  ]);
  return { THREE, OBJLoader, OrbitControls };
}
