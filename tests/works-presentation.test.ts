import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getProjectBySlug, siteContent } from "../lib/site-content.ts";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("works page exposes only the concise representative-work heading", () => {
  const source = read("app/(portfolio)/works/page.tsx");

  assert.equal(siteContent.works.title, "代表作品");
  assert.match(source, /<h1>\{siteContent\.works\.title\}<\/h1>/);
  assert.doesNotMatch(source, /WORK INDEX|works\.intro/);
});

test("content agent uses the approved compact card and five-section detail contract", () => {
  const project = getProjectBySlug("content-agent") as ReturnType<
    typeof getProjectBySlug
  > & {
    details?: {
      overview: string[];
      coreCapabilities: string[];
      architecture: { modules: string[] };
      implementation: { contributions: string[] };
    };
  };

  assert.ok(project);
  assert.equal(
    project.summary,
    "面向企业的多模态内容创作系统，通过 GPT 式对话生成图片和视频，并持续沉淀 Prompt、Skill 与数字资产。",
  );
  assert.equal(project.status, "项目负责人 · 企业局域网已投入使用");
  assert.deepEqual(project.capabilities, [
    "GPT 式创作",
    "Prompt 沉淀",
    "Skill 复用",
    "多模型接入",
    "数字资产",
  ]);
  assert.equal(project.media?.label, "界面设计稿 · 示例数据");
  assert.equal(project.details?.overview.length, 2);
  assert.equal(project.details?.coreCapabilities.length, 6);
  assert.equal(project.details?.architecture.modules.length, 5);
  assert.equal(project.details?.implementation.contributions.length, 6);
});

test("deep research uses the approved compact card and five-section detail contract", () => {
  const project = getProjectBySlug("deep-research");

  assert.ok(project);
  assert.equal(
    project.summary,
    "本地优先的多 Agent 深度研究与报告系统，围绕研究问题完成方法发现、证据采集、横纵分析、质量审查与正式报告生成。",
  );
  assert.equal(project.status, "项目负责人 · 核心研究链可用");
  assert.deepEqual(project.capabilities, [
    "横纵研究",
    "证据台账",
    "论断映射",
    "缺口修复",
    "发布审批",
  ]);
  assert.equal(project.media?.src, "/works/deep-research/operator-workbench-example.png");
  assert.equal(project.media?.label, "运行界面 · 示例数据");
  assert.equal(project.details?.overview.length, 2);
  assert.equal(project.details?.coreCapabilities.length, 7);
  assert.equal(project.details?.architecture.modules.length, 5);
  assert.equal(project.details?.implementation.contributions.length, 7);
  assert.deepEqual(project.actions, [
    {
      kind: "external",
      label: "GitHub",
      href: "https://github.com/Morse-Moss/Deep-research-sys",
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(project.techStack.find((group) => group.label === "AI / Agent")),
    /GPT-[0-9]|Claude|Gemini/i,
  );
});

test("AI leadgen uses the approved compact card and project-specific detail headings", () => {
  const project = getProjectBySlug("ai-leadgen") as ReturnType<
    typeof getProjectBySlug
  > & {
    details?: {
      sectionTitles?: { overview?: string; implementation?: string };
      overview: string[];
      coreCapabilities: string[];
      architecture: { modules: string[] };
      implementation: { contributions: string[] };
    };
  };

  assert.ok(project);
  assert.equal(
    project.summary,
    "面向外贸销售团队的 AI 获客运营系统，打通线索入池、官网信息补全、AI 价值评分、飞书协同、邮件触达与回信跟进，将分散的获客动作整合为可追踪、可协作的销售流程。",
  );
  assert.equal(project.status, "项目负责人 · 本地 MVP 真实链路已验证");
  assert.deepEqual(project.capabilities, [
    "线索数据归一化",
    "官网信息富化",
    "AI 线索评分",
    "飞书协同",
    "阿里邮箱 OpenAPI",
  ]);
  assert.equal(project.media?.label, "真实运行界面");
  assert.deepEqual(project.details?.sectionTitles, {
    overview: "为什么做",
    implementation: "技术实现",
  });
  assert.equal(project.details?.overview.length, 1);
  assert.equal(project.details?.coreCapabilities.length, 5);
  assert.equal(project.details?.architecture.modules.length, 5);
  assert.equal(project.details?.implementation.contributions.length, 4);
});

test("live components render five concise sections and omit audit narration", () => {
  const page = read("app/(portfolio)/works/page.tsx");
  const card = read("components/works/ProjectCard.tsx");
  const caseStudy = read("components/works/CaseStudy.tsx");
  assert.doesNotMatch(page, /WORK INDEX|siteContent\.works\.intro/);
  assert.doesNotMatch(
    card,
    /project\.ownership|project\.futureDirection|mediaDisclosure/,
  );
  assert.match(card, /mediaBadge/);
  assert.match(card, /aria-expanded=\{expanded\}/);
  assert.match(
    caseStudy,
    /const overviewTitle = details\.sectionTitles\?\.overview \?\? ['"]项目简介['"]/,
  );
  assert.match(
    caseStudy,
    /const implementationTitle = details\.sectionTitles\?\.implementation \?\? ['"]我的技术实现['"]/,
  );
  assert.match(caseStudy, /<h3>\{overviewTitle\}<\/h3>/);
  assert.match(caseStudy, /<h3>核心能力<\/h3>/);
  assert.match(caseStudy, /<h3>系统架构<\/h3>/);
  assert.match(caseStudy, /<h3>\{implementationTitle\}<\/h3>/);
  assert.match(caseStudy, /<h3>技术栈<\/h3>/);
  assert.doesNotMatch(
    caseStudy,
    /验证证据|当前边界|采集时间|提交版本|运行方式|脱敏处理/,
  );
});
