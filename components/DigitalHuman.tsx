'use client';

/* ============================================================================
 * DigitalHuman.tsx — 数字人占位组件
 *
 * 接口按最终形态设计:素材到位只改 videoSrc 一个 prop。
 *   - videoSrc 为空(当前) → 占位态:Lifeform 光球 + 右下角「数字人筹备中」
 *     小标注(纯视觉,aria-hidden,不进无障碍树)
 *   - videoSrc 有值(未来) → 待机循环视频(playsInline / preload=none /
 *     muted / loop / autoPlay),posterSrc 作为加载前占位帧
 *
 * 整个舞台是装饰性背景层(pointer-events: none,aria-hidden),
 * 不承载信息,速览层文字全部在左侧内容列。
 * ========================================================================== */

import Lifeform from './Lifeform';
import styles from './DigitalHuman.module.css';

export interface DigitalHumanProps {
  /** 待机循环视频地址;为空时渲染 Lifeform 光球占位态 */
  videoSrc?: string;
  /** 视频加载前的占位帧 */
  posterSrc?: string;
}

export default function DigitalHuman({ videoSrc, posterSrc }: DigitalHumanProps) {
  if (videoSrc) {
    return (
      <div className={styles.stage} aria-hidden="true">
        <video
          className={styles.video}
          src={videoSrc}
          poster={posterSrc}
          playsInline
          preload="none"
          muted
          loop
          autoPlay
        />
      </div>
    );
  }

  return (
    <div className={styles.stage}>
      <Lifeform />
      <span className={styles.note} aria-hidden="true">数字人筹备中</span>
    </div>
  );
}
