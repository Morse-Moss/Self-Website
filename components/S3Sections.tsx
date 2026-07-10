import styles from './S3Sections.module.css';
import { ResumePrintButton, type ResumeModeConfig } from './ResumeMode';

interface GalleryCard {
  id: string;
  kicker: string;
  title: string;
  state: string;
  problem: string;
  solution: string;
  humanAiSplit: string;
  status: string;
  sampleLabel: string;
  progress: number;
  cta?: { label: string };
}

interface LedgerMetric {
  id: string;
  label: string;
  sourcePath: string;
  suffix: string;
  dataLabel: string;
  methodologyLabel: string;
}

interface S3Content {
  resumeMode: ResumeModeConfig;
  narrative: {
    galleryIntro: string;
    methodIntro: string;
    contactIntro: string;
  };
  gallery: { cards: GalleryCard[] };
  ledger: {
    metrics: LedgerMetric[];
    sampleItems: Array<{ label: string; value: string; sampleLabel: string }>;
  };
  principles: Array<{ index: string; title: string; body: string }>;
  contact: {
    title: string;
    body: string;
    links: Array<{ label: string; href: string; sampleLabel: string }>;
  };
}

interface StatsShape {
  generatedAt: string;
  methodology: string;
  claudeCode: Record<string, number | string | null>;
  codex: Record<string, number | boolean | null>;
  thisRepo: Record<string, number | string | null>;
}

function getStatValue(stats: StatsShape, sourcePath: string): number | null {
  const value = sourcePath.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return null;
  }, stats);

  return typeof value === 'number' ? value : null;
}

function formatNumber(value: number | null): string {
  if (value === null) return '整理中';
  return new Intl.NumberFormat('zh-CN').format(value);
}

function MorseDivider({ label }: { label: string }) {
  return (
    <div className={styles.morseDivider} data-morse-pulse aria-hidden="true">
      <span className={styles.morseLabel}>{label}</span>
      <span className={styles.morseTrack}>
        <i className={styles.dot} data-morse-tick />
        <i className={styles.dash} data-morse-tick />
        <i className={styles.dash} data-morse-tick />
        <i className={styles.dot} data-morse-tick />
        <i className={styles.dash} data-morse-tick />
      </span>
    </div>
  );
}

function SectionHeader({
  index,
  title,
  caption,
  intro,
}: {
  index: string;
  title: string;
  caption: string;
  intro: string;
}) {
  return (
    <header className={styles.sectionHeader} data-reveal>
      <span className={styles.sectionIndex}>{index}</span>
      <div>
        <p className={styles.sectionCaption}>{caption}</p>
        <h2>{title}</h2>
        <p className={styles.sectionIntro}>{intro}</p>
      </div>
    </header>
  );
}

export function StandardS3Sections({
  content,
  stats,
}: {
  content: S3Content;
  stats: StatsShape;
}) {
  return (
    <>
      <MorseDivider label="--" />

      <section className={styles.section} id="systems" aria-label="系统展厅">
        <div className={styles.container}>
          <SectionHeader
            index="SEC.01"
            title="系统展厅"
            caption="BUILDING IN PUBLIC"
            intro={content.narrative.galleryIntro}
          />

          <div className={styles.galleryGrid}>
            {content.gallery.cards.map((card) => (
              <article className={styles.systemCard} key={card.id} data-reveal>
                <header className={styles.cardHeader}>
                  <span className={styles.cardKicker}>{card.kicker}</span>
                  <span className={styles.stateBadge}>{card.state}</span>
                </header>
                <h3>{card.title}</h3>
                <dl className={styles.cardFacts}>
                  <div>
                    <dt>痛点</dt>
                    <dd>{card.problem}</dd>
                  </div>
                  <div>
                    <dt>方案</dt>
                    <dd>{card.solution}</dd>
                  </div>
                  <div>
                    <dt>人机分工</dt>
                    <dd>{card.humanAiSplit}</dd>
                  </div>
                  <div>
                    <dt>状态</dt>
                    <dd>{card.status}</dd>
                  </div>
                </dl>
                <div className={styles.progressRow} aria-label={`${card.title} 进度 ${card.progress}%`}>
                  <span className={styles.progressRail}>
                    <span className={styles.progressBar} style={{ width: `${card.progress}%` }} />
                  </span>
                  <span className={styles.sampleTag}>{card.sampleLabel}</span>
                </div>
                {card.cta ? (
                  <button className={styles.ghostButton} type="button" disabled>
                    {card.cta.label}
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      </section>

      <MorseDivider label="---" />

      <section className={styles.section} id="method" aria-label="方法论">
        <div className={styles.container}>
          <SectionHeader
            index="SEC.02"
            title="方法论"
            caption="REPEAT THREE TIMES, THEN SYSTEMIZE"
            intro={content.narrative.methodIntro}
          />

          <div className={styles.principleGrid}>
            {content.principles.map((item) => (
              <article className={styles.principle} key={item.index} data-reveal>
                <span>{item.index}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section} id="ledger" aria-label="杠杆账本">
        <div className={styles.container}>
          <SectionHeader
            index="SEC.03"
            title="杠杆账本"
            caption="REAL NUMBERS FIRST"
            intro="这里先接入已经产出的真实统计。没有证据链的数字,我会明确标成示例数据。"
          />

          <div className={styles.ledgerGrid}>
            {content.ledger.metrics.map((metric) => {
              const value = getStatValue(stats, metric.sourcePath);
              return (
                <article className={styles.ledgerMetric} key={metric.id} data-reveal>
                  <span className={styles.realTag}>{metric.dataLabel}</span>
                  <strong>
                    {formatNumber(value)}
                    {value !== null && metric.suffix ? <small>{metric.suffix}</small> : null}
                  </strong>
                  <span>{metric.label}</span>
                  <p>{metric.methodologyLabel}</p>
                </article>
              );
            })}
          </div>

          <div className={styles.sampleLedger} data-reveal>
            {content.ledger.sampleItems.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <em>{item.sampleLabel}</em>
              </div>
            ))}
          </div>

          <p className={styles.methodology} data-reveal>
            统计口径: {stats.methodology}
          </p>
        </div>
      </section>

      <MorseDivider label="." />

      <section className={styles.contactSection} id="contact" aria-label="联系">
        <div className={styles.container}>
          <div className={styles.contactPanel} data-reveal>
            <p className={styles.sectionCaption}>{content.narrative.contactIntro}</p>
            <h2>{content.contact.title}</h2>
            <p>{content.contact.body}</p>
            <div className={styles.contactLinks}>
              {content.contact.links.map((link) => (
                <a href={link.href} key={link.label}>
                  {link.label}
                  <span>{link.sampleLabel}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className={styles.footer} data-site-footer>
        <div className={styles.container}>
          <p className={styles.footerMorse} title="MORSE">-- --- .-. ... .</p>
          <p>数字摩斯在场,真人摩斯验收。</p>
          <small>© 2026 数字生命摩斯</small>
        </div>
      </footer>
    </>
  );
}

export function ResumeSection({
  content,
  stats,
}: {
  content: S3Content;
  stats: StatsShape;
}) {
  const sessions = formatNumber(getStatValue(stats, 'claudeCode.sessions'));
  const projects = formatNumber(getStatValue(stats, 'claudeCode.projects'));
  const activeDays = formatNumber(getStatValue(stats, 'claudeCode.activeDaysLast90'));

  return (
    <section className={styles.resumeSection} data-resume-section aria-label="一页纸简历">
      <div className={styles.resumeSheet}>
        <header className={styles.resumeHead}>
          <p>一页纸模式</p>
          <h2>数字生命摩斯</h2>
          <span>一个人 + 一套 AI 操作系统</span>
        </header>

        <div className={styles.resumeStats}>
          <div>
            <strong>{sessions}</strong>
            <span>AI 协作会话</span>
          </div>
          <div>
            <strong>{projects}</strong>
            <span>项目覆盖</span>
          </div>
          <div>
            <strong>{activeDays}天</strong>
            <span>近 90 天活跃</span>
          </div>
        </div>

        <section className={styles.resumeBlock}>
          <h3>核心能力</h3>
          <ul>
            <li>Agent 编排:把复杂任务拆成可检查、可复盘、可并行的工作流。</li>
            <li>LLM 应用:从提示词、上下文、评估到用户界面,做可上线的 AI 产品。</li>
            <li>自动化流水线:把重复劳动变成系统,让人只处理方向、标准和验收。</li>
            <li>全栈开发:用 Next.js、脚本管线和本地自动化快速交付可用版本。</li>
          </ul>
        </section>

        <section className={styles.resumeBlock}>
          <h3>系统经历</h3>
          {content.gallery.cards.slice(0, 3).map((card) => (
            <article className={styles.resumeExperience} key={card.id}>
              <div>
                <strong>{card.title}</strong>
                <span>{card.state}</span>
              </div>
              <p>{card.solution}</p>
            </article>
          ))}
        </section>

        <section className={styles.resumeBlock}>
          <h3>工作哲学</h3>
          <p>重复 3 遍的事,全部 AI 化。系统承担复杂性,用户只碰丝滑。</p>
        </section>

        <div className={styles.resumeActions}>
          <ResumePrintButton label={content.resumeMode.printLabel} />
        </div>
      </div>
    </section>
  );
}
