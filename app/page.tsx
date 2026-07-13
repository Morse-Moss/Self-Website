import DigitalHuman from '@/components/DigitalHuman';
import ScrollEffects from '@/components/ScrollEffects';
import { StandardS3Sections } from '@/components/S3Sections';
import s3Content from '@/content/s3-content.json';
import stats from '@/content/stats.json';
import styles from './styles/hero.module.css';

/* ============================================================
 * 首页 · 首屏 = 30 秒速览层 + 数字人占位(光球氛围层)
 * 文案沿用原型示例内容,所有数字带「示例数据」标注。
 * DigitalHuman 素材到位后只需传入 videoSrc 一个 prop。
 * ============================================================ */

export default function Home() {
  return (
    <>
      <ScrollEffects />

      <main>
        <div data-standard-content>
          <section className={styles.hero} aria-label="速览">
            <DigitalHuman />

            <div className={styles.container}>
              <div className={styles.content}>
                <p className={styles.eyebrow}>DIGITAL LIFEFORM · FORMAL v1</p>
                <h1 className={styles.title}>数字生命摩斯</h1>
                <p className={styles.sub}>一个人 + 一套 AI 操作系统。把重复 3 遍的事,全部 AI 化。</p>

                <ul className={styles.chips} aria-label="核心技术栈">
                  <li className={styles.chip}>Agent 编排</li>
                  <li className={styles.chip}>LLM 应用</li>
                  <li className={styles.chip}>自动化流水线</li>
                  <li className={styles.chip}>全栈开发</li>
                </ul>

                <div className={styles.highlights} aria-label="核心亮点(示例数据)">
                  <div className={styles.highlightCard}>
                    <span className={styles.highlightValue}>
                      <span className={styles.highlightNum}>3</span>
                    </span>
                    <span className={styles.highlightLabel}>在建系统</span>
                  </div>
                  <div className={styles.highlightCard}>
                    <span className={styles.highlightValue}>
                      <span className={styles.highlightNum}>1,200</span>
                      <span className={styles.highlightSuffix}>+</span>
                    </span>
                    <span className={styles.highlightLabel}>知识库条目</span>
                  </div>
                  <div className={styles.highlightCard}>
                    <span className={styles.highlightValue}>
                      <span className={styles.highlightNum}>480</span>
                      <span className={styles.highlightSuffix}>+</span>
                    </span>
                    <span className={styles.highlightLabel}>本月 AI 协作会话</span>
                  </div>
                  <span className={styles.mockTag}>示例数据</span>
                </div>

                <p className={styles.contact} aria-label="联系方式">
                  <span className={styles.contactPlaceholder} aria-disabled="true">GitHub</span>
                  <span className={styles.sep} aria-hidden="true">·</span>
                  <span className={styles.contactPlaceholder} aria-disabled="true">Email</span>
                  <span className={styles.sep} aria-hidden="true">·</span>
                  <span className={styles.contactPlaceholder} aria-disabled="true">WeChat</span>
                  <span className={styles.mockTag}>示例数据</span>
                </p>
              </div>
            </div>
          </section>

          <StandardS3Sections content={s3Content} stats={stats} />
        </div>
      </main>
    </>
  );
}
