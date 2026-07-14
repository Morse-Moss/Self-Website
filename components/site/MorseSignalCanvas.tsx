'use client';

import { useEffect, useRef } from 'react';

import styles from './MorseSignalCanvas.module.css';

const GLYPHS = ['.', '-', 'M', 'O', 'R', 'S', 'E', '0', '1', '/', '>'] as const;

type SignalColumn = {
  x: number;
  y: number;
  glyphIndex: number;
  velocity: number;
};

export default function MorseSignalCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvasNode = canvasRef.current;
    if (!canvasNode) return undefined;

    const contextNode = canvasNode.getContext('2d');
    if (!contextNode) return undefined;

    const canvas: HTMLCanvasElement = canvasNode;
    const context: CanvasRenderingContext2D = contextNode;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frameId = 0;
    let running = false;
    let lastDrawAt = 0;
    let width = 1;
    let height = 1;
    let fontSize = 14;
    let gap = 52;
    let fps = 30;
    let speed = 18;
    let accent = '';
    let columns: SignalColumn[] = [];

    function resize() {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(bounds.width));
      height = Math.max(1, Math.floor(bounds.height));

      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const compact = width <= 640;
      fontSize = compact ? 12 : 14;
      gap = compact ? 64 : 52;
      fps = compact ? 24 : 30;
      speed = compact ? 10 : 18;

      const rootStyles = getComputedStyle(document.documentElement);
      accent = rootStyles.getPropertyValue('--accent').trim();
      const fontFamily = rootStyles.getPropertyValue('--font-mono').trim();
      context.font = `${fontSize}px ${fontFamily}`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';

      const columnCount = Math.max(1, Math.ceil(width / gap));
      columns = Array.from({ length: columnCount }, (_, index) => ({
        x: gap / 2 + index * gap,
        y: ((index * 97) % (height + gap)) - gap,
        glyphIndex: (index * 5) % GLYPHS.length,
        velocity: speed * (0.76 + (index % 4) * 0.08),
      }));
    }

    function draw(deltaSeconds: number, advance: boolean) {
      context.clearRect(0, 0, width, height);
      context.save();
      context.globalAlpha = 0.16;
      context.fillStyle = accent;

      for (const column of columns) {
        context.fillText(GLYPHS[column.glyphIndex], column.x, column.y);
        if (!advance) continue;

        column.y += column.velocity * deltaSeconds;
        if (column.y > height + fontSize) {
          column.y = -fontSize;
          column.glyphIndex = (column.glyphIndex + 1) % GLYPHS.length;
        }
      }

      context.restore();
    }

    function animate(timestamp: number) {
      if (!running) return;

      frameId = window.requestAnimationFrame(animate);
      const interval = 1000 / fps;
      const elapsed = timestamp - lastDrawAt;
      if (elapsed < interval) return;

      lastDrawAt = timestamp - (elapsed % interval);
      draw(Math.min(elapsed / 1000, 0.1), true);
    }

    function stop() {
      running = false;
      if (frameId) {
        window.cancelAnimationFrame(frameId);
        frameId = 0;
      }
    }

    function start() {
      if (running || reducedMotion.matches || document.hidden) return;
      running = true;
      lastDrawAt = performance.now();
      frameId = window.requestAnimationFrame(animate);
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        stop();
        return;
      }

      draw(0, false);
      start();
    }

    function handleMotionChange() {
      stop();
      draw(0, false);
      start();
    }

    const resizeObserver = new ResizeObserver(() => {
      resize();
      draw(0, false);
    });

    resize();
    draw(0, false);
    if (!reducedMotion.matches) start();
    resizeObserver.observe(canvas);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    reducedMotion.addEventListener('change', handleMotionChange);

    return () => {
      stop();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      reducedMotion.removeEventListener('change', handleMotionChange);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      data-testid="morse-signal-canvas"
      aria-hidden="true"
    />
  );
}
