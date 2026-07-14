import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getAllProjects,
  getFeaturedProjects,
  getProjectBySlug,
  getProjectStaticParams,
  projectSlugs,
  siteContent,
} from "../lib/site-content.ts";

const expectedSlugs = [
  "content-agent",
  "auto-operations",
  "deep-research",
  "digital-morse",
] as const;

const expectedProjects = {
  "content-agent": {
    name: "内容创作 Agent 系统",
    status: "内网已部署",
    actions: [
      { kind: "case", label: "查看案例", href: "/works/content-agent" },
    ],
  },
  "auto-operations": {
    name: "自动运营 Agent 系统",
    status: "生产环境运行中",
    actions: [
      {
        kind: "case",
        label: "查看案例",
        href: "/works/auto-operations",
      },
      {
        kind: "external",
        label: "访问系统",
        href: "https://aitavix.com",
      },
    ],
  },
  "deep-research": {
    name: "深度研究 Agent 系统",
    status: "已接受能力持续扩展中",
    actions: [
      {
        kind: "case",
        label: "查看案例",
        href: "/works/deep-research",
      },
      {
        kind: "external",
        label: "GitHub",
        href: "https://github.com/Morse-Moss/Deep-research-sys",
      },
    ],
  },
  "digital-morse": {
    name: "数字摩斯",
    status: "本地闭环已验证 · 尚未部署",
    actions: [
      {
        kind: "case",
        label: "查看案例",
        href: "/works/digital-morse",
      },
      {
        kind: "external",
        label: "GitHub",
        href: "https://github.com/Morse-Moss/Self-Website",
      },
    ],
  },
} as const;

test("exports the exact project slugs and static params", () => {
  assert.deepEqual(projectSlugs, expectedSlugs);
  assert.deepEqual(
    getAllProjects().map((project) => project.slug),
    expectedSlugs,
  );
  assert.deepEqual(
    getProjectStaticParams(),
    expectedSlugs.map((slug) => ({ slug })),
  );
});

test("returns the featured auto-operations project and undefined when missing", () => {
  assert.deepEqual(
    getFeaturedProjects().map((project) => project.slug),
    ["auto-operations"],
  );
  assert.equal(getProjectBySlug("missing-project"), undefined);
});

test("keeps project names, statuses, and CTAs exact", () => {
  for (const slug of expectedSlugs) {
    const project = getProjectBySlug(slug);
    assert.ok(project);
    assert.equal(project.name, expectedProjects[slug].name);
    assert.equal(project.status, expectedProjects[slug].status);
    assert.deepEqual(project.actions, expectedProjects[slug].actions);
    assert.ok(project.actions.length <= 2);
  }
});

test("provides six case-study fields for every project", () => {
  for (const project of getAllProjects()) {
    assert.equal(Object.keys(project.caseStudy).length, 6);
    assert.match(project.caseStudy.role, /负责整个项目的开发/);
    for (const key of [
      "decisions",
      "structure",
      "evidence",
      "boundaries",
    ] as const) {
      assert.ok(project.caseStudy[key].length > 0);
      assert.ok(project.caseStudy[key].every((value) => value.trim().length > 0));
    }
    assert.ok(project.caseStudy.problem.trim().length > 0);
  }
});

test("publishes media only for auto-operations", () => {
  for (const project of getAllProjects()) {
    if (project.slug === "auto-operations") {
      assert.ok(project.media);
      assert.equal(
        project.media.src,
        "/works/auto-operations/login-workbench-2026-07-13.png",
      );
      assert.equal(project.media.width, 510);
      assert.equal(project.media.height, 580);
    } else {
      assert.equal(project.media, null);
    }
  }
});

test("keeps the approved global copy and four FAQ topics", () => {
  assert.deepEqual(siteContent.site, {
    name: "数字生命摩斯",
    description: "摩斯的多页 AI 原生作品集与数字分身。",
    nav: [
      { label: "首页", href: "/" },
      { label: "作品", href: "/works" },
    ],
    resumeMode: {
      storageKey: "morse.resumeMode",
      bodyClass: "resume-mode",
      toggleLabel: "简历模式",
      printLabel: "打印 / 存 PDF",
    },
    footer: {
      morse: "-- --- .-. ... .",
      statement: "数字摩斯在场，真人摩斯验收。",
      copyright: "© 2026 数字生命摩斯",
    },
  });
  assert.deepEqual(siteContent.profile.capabilities, [
    "Agent 系统",
    "RAG",
    "多 Agent",
    "全栈开发",
  ]);
  assert.equal(siteContent.faq.length, 4);
  assert.match(siteContent.faq[0].question, /技术栈/);
  assert.match(siteContent.faq[1].question, /AI native/i);
  assert.match(siteContent.faq[2].question, /职责/);
  assert.match(siteContent.faq[3].question, /快速了解/);
});

test("keeps all public JSON free of placeholders and private-source leakage", () => {
  const source = readFileSync(
    new URL("../content/site-content.json", import.meta.url),
    "utf8",
  );
  const banned = [
    /"href"\s*:\s*"#"/i,
    /Email|WeChat/i,
    /content[\\/]drafts/i,
    /[A-Z]:\\/i,
    /output[\\/]system-captures/i,
    /imagegen/i,
    /Mock Provider/i,
    /节省工时|增长率|产能提升/,
  ];

  for (const pattern of banned) {
    assert.doesNotMatch(source, pattern);
  }
  assert.equal(siteContent.projects.length, 4);
});
