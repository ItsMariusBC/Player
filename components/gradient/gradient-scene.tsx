// components/gradient/gradient-scene.tsx
// Background mesh gradient. Same shaders, geometry, camera and grain pass as
// shadergradient 1.3.5, but rendered on our own terms:
// - colours are uniforms mutated in the frame loop (no React re-render, no shader recompile)
// - 30 frames per second on demand instead of an unbounded loop
// - no preserveDrawingBuffer, no antialias, no camera controls
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { gradientFragmentShader, gradientVertexShader } from "./gradient-shaders";
import { halftoneShader } from "./halftone-shader";
import { GradientColors, hexToRgb, interpolateGradient } from "@/lib/palette";
import { TRACK_TRANSITION } from "@/lib/transitions";

// The shaders predate three r152: these chunks no longer exist and must resolve to nothing.
for (const name of ["uv2_pars_vertex", "uv2_vertex", "uv2_pars_fragment", "encodings_fragment"]) {
  (THREE.ShaderChunk as unknown as Record<string, string>)[name] = "";
}

const FRAMES_PER_SECOND = 30;
const CAMERA_DISTANCE = 2.8;
const CAMERA_POLAR = (80 * Math.PI) / 180;
const CAMERA_AZIMUTH = Math.PI;
const CAMERA_POSITION: [number, number, number] = [
  CAMERA_DISTANCE * Math.sin(CAMERA_POLAR) * Math.sin(CAMERA_AZIMUTH),
  CAMERA_DISTANCE * Math.cos(CAMERA_POLAR),
  CAMERA_DISTANCE * Math.sin(CAMERA_POLAR) * Math.cos(CAMERA_AZIMUTH),
];

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function GradientCanvas({ colors }: { colors: GradientColors }) {
  return (
    <Canvas
      dpr={1}
      linear
      flat
      frameloop="demand"
      resize={{ offsetSize: true }}
      camera={{ fov: 45, near: 0.1, far: 1000, position: CAMERA_POSITION }}
      gl={{ antialias: false, preserveDrawingBuffer: false, stencil: false, alpha: false }}
      onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
      style={{ position: "relative", width: "100%", height: "100%", pointerEvents: "none" }}
    >
      <ambientLight intensity={1.2 * Math.PI} />
      <GradientMesh colors={colors} />
      <Grain />
      <FramePacer />
    </Canvas>
  );
}

type ColorUniforms = Record<"uC1r" | "uC1g" | "uC1b" | "uC2r" | "uC2g" | "uC2b" | "uC3r" | "uC3g" | "uC3b", THREE.IUniform<number>>;

function applyColors(uniforms: ColorUniforms, colors: GradientColors) {
  const [c1, c2, c3] = colors.map(hexToRgb);
  uniforms.uC1r.value = c1[0] / 255;
  uniforms.uC1g.value = c1[1] / 255;
  uniforms.uC1b.value = c1[2] / 255;
  uniforms.uC2r.value = c2[0] / 255;
  uniforms.uC2g.value = c2[1] / 255;
  uniforms.uC2b.value = c2[2] / 255;
  uniforms.uC3r.value = c3[0] / 255;
  uniforms.uC3g.value = c3[1] / 255;
  uniforms.uC3b.value = c3[2] / 255;
}

function GradientMesh({ colors }: { colors: GradientColors }) {
  const current = useRef<GradientColors>(colors);
  const from = useRef<GradientColors>(colors);
  const target = useRef<GradientColors>(colors);
  const startedAt = useRef(0);

  const uniforms = useMemo(() => {
    const u = {
      uTime: { value: 8 },
      uSpeed: { value: 0.3 },
      uLoadingTime: { value: 1 },
      uNoiseDensity: { value: 1.5 },
      uNoiseStrength: { value: 1.7 },
      uFrequency: { value: 0 },
      uAmplitude: { value: 0 },
      uIntensity: { value: 0.5 },
      uC1r: { value: 0 },
      uC1g: { value: 0 },
      uC1b: { value: 0 },
      uC2r: { value: 0 },
      uC2g: { value: 0 },
      uC2b: { value: 0 },
      uC3r: { value: 0 },
      uC3g: { value: 0 },
      uC3b: { value: 0 },
    } satisfies Record<string, THREE.IUniform<number>>;
    applyColors(u, colors);
    return u;
    // Initial colours only; later changes are animated in the frame loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const material = useMemo(() => {
    const m = new THREE.MeshPhysicalMaterial({ metalness: 0.2, side: THREE.DoubleSide });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = gradientVertexShader;
      shader.fragmentShader = gradientFragmentShader;
    };
    return m;
  }, [uniforms]);

  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    if (colors.join() === target.current.join()) return;
    from.current = current.current;
    target.current = colors;
    startedAt.current = performance.now();
  }, [colors]);

  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.getElapsedTime();
    if (current.current === target.current) return;

    const t = Math.min(1, (performance.now() - startedAt.current) / TRACK_TRANSITION.gradientDuration);
    current.current = t >= 1 ? target.current : interpolateGradient(from.current, target.current, easeInOut(t));
    applyColors(uniforms, current.current);
  });

  return (
    <mesh position={[0, 0, 0]} rotation={[50, 0, -60]} material={material}>
      <planeGeometry args={[10, 10, 192, 192]} />
    </mesh>
  );
}

function Grain() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const [composer, grainPass] = useMemo(() => {
    const c = new EffectComposer(gl);
    c.addPass(new RenderPass(scene, camera));
    const pass = new ShaderPass(halftoneShader);
    c.addPass(pass);
    return [c, pass] as const;
  }, [gl, scene, camera]);

  useEffect(() => {
    composer.setSize(size.width, size.height);
    grainPass.uniforms.width.value = size.width;
    grainPass.uniforms.height.value = size.height;
  }, [composer, grainPass, size]);

  useEffect(() => () => composer.dispose(), [composer]);

  useFrame((_, delta) => {
    gl.autoClear = true;
    composer.render(delta);
  }, 1);

  return null;
}

/** Requests a frame at a fixed cadence; the gradient moves slowly, 30 fps is visually identical to 60. */
function FramePacer() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) invalidate();
    }, 1000 / FRAMES_PER_SECOND);
    return () => clearInterval(id);
  }, [invalidate]);
  return null;
}
