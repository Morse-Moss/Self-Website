import Link from 'next/link';

import OpenChatButton from '@/components/site/OpenChatButton';
import {
  projectHashHref,
  type Project,
  type SiteContent,
} from '@/lib/site-content';
import type { DevelopmentStats } from '@/lib/stats';

import styles from './MorseHomeSections.module.css';

const compactTokenFormatter = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const fullNumberFormatter = new Intl.NumberFormat('zh-CN');
const generatedAtFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Shanghai',
});

function TokenValue({ value }: { value: number }) {
  const fullValue = fullNumberFormatter.format(value);

  return (
    <span className={styles.tokenValue} title={fullValue}>
      <span aria-hidden="true">{compactTokenFormatter.format(value)}</span>
      <span className={styles.srOnly}>{fullValue} Token</span>
    </span>
  );
}

export default function MorseHomeSections({
  content,
  featuredProjects,
  stats,
}: {
  content: SiteContent;
  featuredProjects: Project[];
  stats: DevelopmentStats;
}) {
  const metrics = [
    { label: 'AI 协作会话', value: stats.totals.sessions },
    { label: '项目覆盖', value: stats.totals.projects },
    { label: '近 90 天活跃', value: stats.totals.activeDaysLast90, suffix: '天' },
  ].flatMap((metric) => metric.value === null ? [] : [{ ...metric, value: metric.value }]);
  const toolUsage = [
    { label: 'Codex', activity: stats.codex },
    { label: 'Claude Code', activity: stats.claudeCode },
  ].filter(({ activity }) => activity.allTime !== null || activity.last30Days !== null);

  return (
    <>
      <section className={`${styles.band} ${styles.featuredBand}`} aria-labelledby="featured-title">
        <div className={styles.container}>
          <header className={styles.sectionHeader}>
            <p className={styles.kicker}>SELECTED PUBLIC WORK</p>
            <h2 id="featured-title">公开代表作品</h2>
            <p>两项可公开核验的系统，状态、能力与边界以项目证据为准。</p>
          </header>

          <div className={styles.projectGrid}>
            {featuredProjects.map((project, index) => (
              <article className={styles.projectCard} key={project.slug} data-reveal>
                <header className={styles.projectMeta}>
                  <span>PUBLIC / 0{index + 1}</span>
                  <span>{project.status}</span>
                </header>
                <h3>
                  <Link href={projectHashHref(project.slug)}>{project.name}</Link>
                </h3>
                <p className={styles.projectSummary}>{project.summary}</p>
                <ul className={styles.capabilityList} aria-label={`${project.name}能力`}>
                  {project.capabilities.map((capability) => (
                    <li key={capability}>{capability}</li>
                  ))}
                </ul>
                <Link className={styles.textLink} href={projectHashHref(project.slug)}>
                  查看项目证据
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.band} aria-labelledby="capabilities-title" data-capability-section>
        <div className={styles.container}>
          <header className={`${styles.sectionHeader} ${styles.capabilityHeader}`} data-reveal>
            <p className={styles.kicker}>CAPABILITY PROFILE</p>
            <h2 id="capabilities-title">能力矩阵</h2>
            <p>从多个真实项目中沉淀的可复用开发能力。</p>
          </header>

          <ul className={styles.matrix} data-capability-matrix>
            {content.profile.capabilityMatrix.map((capability, index) => (
              <li key={capability.id} data-capability-card data-reveal>
                <span className={styles.matrixIndex} aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className={styles.matrixBody}>
                  <h3>{capability.title}</h3>
                  <p>{capability.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.band} aria-labelledby="facts-title">
        <div className={styles.container}>
          <header className={styles.sectionHeader} data-reveal>
            <p className={styles.kicker}>TRACEABLE DEVELOPMENT</p>
            <h2 id="facts-title">开发事实</h2>
            <p>只展示本地聚合管线可追溯的会话、项目、活跃与 Token 统计。</p>
          </header>

          {metrics.length > 0 ? (
            <dl className={styles.metrics} data-reveal>
              {metrics.map((metric) => (
                <div key={metric.label}>
                  <dt>{metric.label}</dt>
                  <dd>
                    {fullNumberFormatter.format(metric.value)}
                    {'suffix' in metric ? metric.suffix : null}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {toolUsage.length > 0 ? (
            <div className={styles.toolGrid}>
              {toolUsage.map(({ label, activity }) => (
                <article className={styles.toolFact} key={label} data-reveal>
                  <header>
                    <h3>{label}</h3>
                    {activity.coverageStart || activity.coverageEnd ? (
                      <p>
                        覆盖期{' '}
                        {activity.coverageStart ? <time dateTime={activity.coverageStart}>{activity.coverageStart}</time> : '未知'}
                        {' 至 '}
                        {activity.coverageEnd ? <time dateTime={activity.coverageEnd}>{activity.coverageEnd}</time> : '未知'}
                      </p>
                    ) : null}
                  </header>
                  <dl>
                    {activity.allTime ? (
                      <div>
                        <dt>历史累计 Token</dt>
                        <dd><TokenValue value={activity.allTime.totalTokens} /></dd>
                      </div>
                    ) : null}
                    {activity.last30Days ? (
                      <div>
                        <dt>最近 30 天 Token</dt>
                        <dd><TokenValue value={activity.last30Days.totalTokens} /></dd>
                      </div>
                    ) : null}
                  </dl>
                </article>
              ))}
            </div>
          ) : null}

          <p className={styles.cutoff} data-reveal>
            数据生成于{' '}
            <time dateTime={stats.generatedAt}>{generatedAtFormatter.format(new Date(stats.generatedAt))}</time>
            ，缺失 usage 不估算。
          </p>
        </div>
      </section>

      <section className={`${styles.band} ${styles.promptBand}`} aria-labelledby="prompt-title">
        <div className={styles.promptInner} data-reveal>
          <div>
            <p className={styles.kicker}>ASK MORSE</p>
            <h2 id="prompt-title">从一个具体问题开始</h2>
            <p>“解释深度研究系统如何处理证据不足。”</p>
          </div>
          <OpenChatButton className={styles.promptAction}>开始对话</OpenChatButton>
        </div>
      </section>
    </>
  );
}
