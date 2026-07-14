import Link from 'next/link';

import OpenChatButton from '@/components/site/OpenChatButton';
import type { SiteContent } from '@/lib/site-content';

import styles from '@/components/S3Sections.module.css';

type Stats = {
  generatedAt: string;
  methodology: string;
  claudeCode: {
    sessions: number | null;
    projects: number | null;
    activeDaysLast90: number | null;
  };
};

export default function RestoredHomeSections({
  content,
  stats,
}: {
  content: SiteContent;
  stats: Stats;
}) {
  const metrics = [
    { label: 'AI 协作会话', value: stats.claudeCode.sessions },
    { label: '项目覆盖', value: stats.claudeCode.projects },
    { label: '近 90 天活跃', value: stats.claudeCode.activeDaysLast90 },
  ];

  return (
    <>
      <section className={styles.section} id="systems" aria-labelledby="systems-title">
        <div className={styles.container}>
          <header className={styles.sectionHeader}>
            <span className={styles.sectionIndex}>SEC.01</span>
            <div>
              <p className={styles.sectionCaption}>SELECTED SYSTEMS</p>
              <h2 id="systems-title">系统展厅</h2>
              <p className={styles.sectionIntro}>{content.home.worksIntro}</p>
            </div>
          </header>

          <div className={styles.galleryGrid}>
            {content.projects.map((project, index) => (
              <article className={styles.systemCard} key={project.slug} data-reveal>
                <header className={styles.cardHeader}>
                  <span className={styles.cardKicker}>
                    SYS-{String(index + 1).padStart(2, '0')}
                  </span>
                  <span className={styles.stateBadge}>{project.status}</span>
                </header>
                <h3>{project.name}</h3>
                <dl className={styles.cardFacts}>
                  <div>
                    <dt>类型</dt>
                    <dd>{project.type}</dd>
                  </div>
                  <div>
                    <dt>说明</dt>
                    <dd>{project.summary}</dd>
                  </div>
                </dl>
                <div className={styles.projectActions} aria-label={`${project.name}操作`}>
                  {project.actions.map((action) => (
                    <a
                      className={styles.projectAction}
                      href={action.href}
                      key={action.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {action.label}
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section} id="about" aria-labelledby="about-title">
        <div className={styles.container}>
          <header className={styles.sectionHeader} data-reveal>
            <span className={styles.sectionIndex}>SEC.02</span>
            <div>
              <p className={styles.sectionCaption}>ONE PERSON + AI SYSTEMS</p>
              <h2 id="about-title">关于摩斯</h2>
              <p className={styles.sectionIntro}>{content.profile.summary}</p>
            </div>
          </header>

          <div className={styles.principleGrid}>
            {content.profile.principles.map((principle, index) => (
              <article className={styles.principle} key={principle} data-reveal>
                <span>0{index + 1}</span>
                <h3>{principle}</h3>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section} id="ledger" aria-labelledby="ledger-title">
        <div className={styles.container}>
          <header className={styles.sectionHeader} data-reveal>
            <span className={styles.sectionIndex}>SEC.03</span>
            <div>
              <p className={styles.sectionCaption}>VERIFIED ACTIVITY</p>
              <h2 id="ledger-title">杠杆账本</h2>
              <p className={styles.sectionIntro}>只展示本地统计管线可以追溯的聚合数据。</p>
            </div>
          </header>

          <div className={styles.ledgerGrid}>
            {metrics.map((metric) => metric.value === null ? null : (
              <article className={styles.ledgerMetric} key={metric.label} data-reveal>
                <span className={styles.realTag}>真实统计</span>
                <strong>{metric.value}</strong>
                <span>{metric.label}</span>
              </article>
            ))}
          </div>
          <p className={styles.methodology} data-reveal>
            统计生成于 {new Date(stats.generatedAt).toLocaleDateString('zh-CN')}。{stats.methodology}
          </p>
        </div>
      </section>

      <section className={styles.section} id="faq" aria-labelledby="faq-title">
        <div className={styles.container}>
          <header className={styles.sectionHeader} data-reveal>
            <span className={styles.sectionIndex}>SEC.04</span>
            <div>
              <p className={styles.sectionCaption}>ASK MORSE</p>
              <h2 id="faq-title">高频问题</h2>
            </div>
          </header>

          <div className={styles.faqGrid}>
            {content.faq.map((item) => (
              <article className={styles.faqItem} key={item.question} data-reveal>
                <h3>{item.question}</h3>
                <p>{item.answer}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.contactSection} aria-labelledby="contact-title">
        <div className={styles.container}>
          <div className={styles.contactPanel} data-reveal>
            <p className={styles.sectionCaption}>NEXT STEP</p>
            <h2 id="contact-title">继续了解</h2>
            <p>查看完整项目证据，或者直接向数字摩斯提问。</p>
            <div className={styles.contactActions}>
              <Link className={styles.projectAction} href="/works">查看全部作品</Link>
              <OpenChatButton className={styles.projectAction}>问数字摩斯</OpenChatButton>
            </div>
          </div>
        </div>
      </section>

      <footer className={styles.footer} data-site-footer>
        <div className={styles.container}>
          <p className={styles.footerMorse} title="MORSE">{content.site.footer.morse}</p>
          <p>{content.site.footer.statement}</p>
          <small>{content.site.footer.copyright}</small>
        </div>
      </footer>
    </>
  );
}
