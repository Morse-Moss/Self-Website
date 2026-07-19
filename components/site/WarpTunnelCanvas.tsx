'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  LineBasicMaterial,
  LineSegments,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';

import MorseSignalCanvas from './MorseSignalCanvas';
import styles from './WarpTunnelCanvas.module.css';

const DESKTOP_RAY_COUNT = 760;
const MOBILE_RAY_COUNT = 300;
const FIELD_DEPTH = 48;
const NEAR_PLANE_Z = -1.4;
const TAU = Math.PI * 2;

type WarpRay = {
  colorIndex: number;
  length: number;
  speed: number;
  x: number;
  y: number;
  z: number;
};

function createRandom(seed: number) {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createRay(random: () => number, colorCount: number): WarpRay {
  const angle = random() * TAU;
  const radius = 0.9 + Math.pow(random(), 0.56) * 17;
  const horizontalStretch = 0.72 + random() * 0.58;
  const verticalStretch = 0.58 + random() * 0.46;

  return {
    colorIndex: Math.min(colorCount - 1, Math.floor(random() * colorCount)),
    length: 0.65 + random() * 4.7,
    speed: 4.4 + random() * 8.8,
    x: Math.cos(angle) * radius * horizontalStretch,
    y: Math.sin(angle) * radius * verticalStretch,
    z: -2 - random() * FIELD_DEPTH,
  };
}

function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export default function WarpTunnelCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const compact = window.matchMedia('(max-width: 640px), (pointer: coarse)').matches;
    const rayCount = compact ? MOBILE_RAY_COUNT : DESKTOP_RAY_COUNT;
    const palette = [
      new Color(readToken('--accent')),
      new Color(readToken('--status-blue')),
      new Color(readToken('--status-amber')),
    ];
    const background = new Color(readToken('--bg'));
    const random = createRandom(compact ? 0x4d4f5253 : 0x57415250);
    const rays = Array.from({ length: rayCount }, () => createRay(random, palette.length));
    const positions = new Float32Array(rayCount * 6);
    const colors = new Float32Array(rayCount * 6);
    const geometry = new BufferGeometry();
    const positionAttribute = new BufferAttribute(positions, 3);
    const colorAttribute = new BufferAttribute(colors, 3);
    const material = new LineBasicMaterial({
      blending: AdditiveBlending,
      depthWrite: false,
      opacity: compact ? 0.54 : 0.72,
      transparent: true,
      vertexColors: true,
    });
    const glowMaterial = new LineBasicMaterial({
      blending: AdditiveBlending,
      depthWrite: false,
      opacity: compact ? 0.08 : 0.13,
      transparent: true,
      vertexColors: true,
    });
    const camera = new PerspectiveCamera(68, 1, 0.1, 90);
    const scene = new Scene();
    let renderer: WebGLRenderer;
    let frameId = 0;
    let running = false;
    let lastFrameAt = 0;

    geometry.setAttribute('position', positionAttribute);
    geometry.setAttribute('color', colorAttribute);

    rays.forEach((ray, index) => {
      const color = palette[ray.colorIndex];
      const tail = color.clone().multiplyScalar(0.08);
      const head = color.clone().multiplyScalar(0.82 + (index % 5) * 0.035);
      const offset = index * 6;

      colors[offset] = tail.r;
      colors[offset + 1] = tail.g;
      colors[offset + 2] = tail.b;
      colors[offset + 3] = head.r;
      colors[offset + 4] = head.g;
      colors[offset + 5] = head.b;
    });

    const field = new LineSegments(geometry, material);
    const glow = new LineSegments(geometry, glowMaterial);
    glow.scale.setScalar(1.0035);
    scene.add(glow, field);

    try {
      renderer = new WebGLRenderer({
        antialias: false,
        canvas,
        failIfMajorPerformanceCaveat: true,
        powerPreference: 'high-performance',
      });
    } catch {
      geometry.dispose();
      material.dispose();
      glowMaterial.dispose();
      setFailed(true);
      return undefined;
    }

    renderer.setClearColor(background, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    function resize() {
      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }

    function updateGeometry(deltaSeconds: number, advance: boolean) {
      rays.forEach((ray, index) => {
        if (advance) {
          ray.z += ray.speed * deltaSeconds;
          if (ray.z > NEAR_PLANE_Z) {
            const replacement = createRay(random, palette.length);
            ray.x = replacement.x;
            ray.y = replacement.y;
            ray.z = -FIELD_DEPTH - random() * 8;
            ray.length = replacement.length;
            ray.speed = replacement.speed;
          }
        }

        const offset = index * 6;
        positions[offset] = ray.x;
        positions[offset + 1] = ray.y;
        positions[offset + 2] = ray.z - ray.length;
        positions[offset + 3] = ray.x;
        positions[offset + 4] = ray.y;
        positions[offset + 5] = ray.z;
      });
      positionAttribute.needsUpdate = true;
    }

    function render(deltaSeconds: number, advance: boolean) {
      updateGeometry(deltaSeconds, advance);
      field.rotation.z += advance ? deltaSeconds * 0.006 : 0;
      glow.rotation.z = field.rotation.z;
      renderer.render(scene, camera);
    }

    function stop() {
      running = false;
      if (frameId) {
        window.cancelAnimationFrame(frameId);
        frameId = 0;
      }
    }

    function animate(timestamp: number) {
      if (!running) return;
      frameId = window.requestAnimationFrame(animate);

      const frameInterval = compact ? 1000 / 36 : 1000 / 60;
      const elapsed = timestamp - lastFrameAt;
      if (elapsed < frameInterval) return;

      lastFrameAt = timestamp - (elapsed % frameInterval);
      render(Math.min(elapsed / 1000, 0.05), true);
    }

    function start() {
      if (running || reducedMotion.matches || document.hidden) return;
      running = true;
      lastFrameAt = performance.now();
      frameId = window.requestAnimationFrame(animate);
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        stop();
        return;
      }
      render(0, false);
      start();
    }

    function handleMotionChange() {
      stop();
      render(0, false);
      start();
    }

    function handleContextLost(event: Event) {
      event.preventDefault();
      stop();
      setFailed(true);
    }

    resize();
    render(0, false);
    start();
    window.addEventListener('resize', resize, { passive: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);
    reducedMotion.addEventListener('change', handleMotionChange);
    canvas.addEventListener('webglcontextlost', handleContextLost, false);

    return () => {
      stop();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      reducedMotion.removeEventListener('change', handleMotionChange);
      canvas.removeEventListener('webglcontextlost', handleContextLost, false);
      scene.remove(glow, field);
      geometry.dispose();
      material.dispose();
      glowMaterial.dispose();
      renderer.dispose();
    };
  }, []);

  if (failed) return <MorseSignalCanvas />;

  return (
    <div className={styles.layer} aria-hidden="true">
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        data-testid="warp-tunnel-canvas"
        aria-hidden="true"
      />
    </div>
  );
}
