'use client';

import type { EnvironmentTarget } from './admin-api-client';
import { testStateLabels } from './provider-ui-state';
import styles from './AdminApiConsole.module.css';

interface Props {
  targets: EnvironmentTarget[];
  onEditDatabase: (target: EnvironmentTarget) => void;
  onEditEnvironment: (target: EnvironmentTarget) => void;
  onJoinRoute: (target: EnvironmentTarget) => void;
  onReplaceAndActivate: (target: EnvironmentTarget) => void;
  onTest: (target: EnvironmentTarget) => void;
  routeContains: (target: EnvironmentTarget) => boolean;
  takeoverEligible: (target: EnvironmentTarget) => boolean;
}

export default function AdminEnvironmentProviders({
  targets,
  onEditDatabase,
  onEditEnvironment,
  onJoinRoute,
  onReplaceAndActivate,
  onTest,
  routeContains,
  takeoverEligible,
}: Props) {
  return (
    <section className={styles.environmentProviders} aria-labelledby="environment-providers-title">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>SERVER ENVIRONMENT SOURCES</p>
          <h2 id="environment-providers-title">环境 Provider</h2>
        </div>
      </div>
      <div className={styles.environmentProviderList}>
        {targets.map((target) => {
          const state = testStateLabels(target.testState);
          const inRoute = routeContains(target);
          const eligible = takeoverEligible(target);
          const lifecycle = target.takeover
            ? `数据库草稿 ${target.takeover.connectionSeriesId.slice(0, 8)} / ${target.takeover.modelSeriesId.slice(0, 8)}`
            : '服务器环境源';
          return (
            <article
              key={target.environmentTargetKey}
              className={styles.environmentProviderRow}
              data-testid={`environment-provider-${target.environmentTargetKey}`}
            >
              <div className={styles.environmentIdentity}>
                <strong>{target.connectionDisplayName}</strong>
                <span>{target.endpointHost ?? '服务器来源不可用'} · {target.modelId} · {target.protocol}</span>
              </div>
              <dl className={styles.environmentState}>
                <div><dt>生命周期</dt><dd data-state="lifecycle">{lifecycle}</dd></div>
                <div><dt>资格</dt><dd data-state="eligibility">{state.eligibility}</dd></div>
                <div><dt>最近测试</dt><dd data-state="latest">{state.latest}</dd></div>
              </dl>
              <div className={styles.environmentActions}>
                {target.takeover ? (
                  <>
                    <button type="button" className={styles.quietButton} onClick={() => onEditDatabase(target)}>编辑数据库版本</button>
                    <button type="button" className={styles.secondaryButton} onClick={() => onTest(target)}>诊断 测试环境源</button>
                    {inRoute && eligible ? (
                      <button type="button" className={styles.primaryButton} onClick={() => onReplaceAndActivate(target)}>替换并激活</button>
                    ) : null}
                    {!inRoute ? (
                      <button type="button" className={styles.primaryButton} onClick={() => onJoinRoute(target)}>加入路由</button>
                    ) : null}
                  </>
                ) : (
                  <>
                    <button type="button" className={styles.quietButton} onClick={() => onEditEnvironment(target)}>编辑</button>
                    <button type="button" className={styles.secondaryButton} onClick={() => onTest(target)}>测试</button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
