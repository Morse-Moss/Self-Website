const state = {
  jobs: [],
  stats: { total: 0, reviewed: 0 },
  filter: "all",
  selectedId: null,
  detailRequest: 0,
};

const labels = {
  buckets: { favorites: "收藏样本", core: "核心样本", stretch: "挑战样本", exclude: "排除样本" },
  tiers: { core: "旧规则：核心", stretch: "旧规则：挑战", exclude: "旧规则：排除" },
  risks: {
    third_party: "第三方招聘待确认",
    outsourcing_risk: "疑似外包",
    seniority_gap: "经验门槛偏高",
    salary_stretch: "薪资跨度偏高",
    graduate_only: "应届资格待确认",
    internship: "实习岗位",
    pure_java: "偏纯 Java",
    onsite_heavy: "驻场较多",
    non_engineering_role: "非研发岗",
    product_role: "偏产品岗",
    overseas_assignment: "海外派驻",
    non_ai_role: "AI 相关度低",
  },
};

const elements = {
  list: document.querySelector("#jobList"),
  visibleCount: document.querySelector("#visibleCount"),
  progressText: document.querySelector("#progressText"),
  progressBar: document.querySelector("#progressBar"),
  detailEmpty: document.querySelector("#detailEmpty"),
  detailContent: document.querySelector("#detailContent"),
  form: document.querySelector("#reviewForm"),
  formError: document.querySelector("#formError"),
  saveButton: document.querySelector("#saveButton"),
  saveState: document.querySelector("#saveState"),
};

function createScoreControls() {
  document.querySelectorAll(".score-control").forEach((control) => {
    const name = control.dataset.score;
    for (let value = 1; value <= 5; value += 1) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      const visible = document.createElement("span");
      input.type = "radio";
      input.name = name;
      input.value = String(value);
      input.required = true;
      visible.textContent = String(value);
      label.append(input, visible);
      control.append(label);
    }
  });
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({ error: "服务返回了无法读取的内容" }));
  if (!response.ok) throw new Error(payload.error || `请求失败 (${response.status})`);
  return payload;
}

function filteredJobs() {
  if (state.filter === "all") return state.jobs;
  if (state.filter === "unreviewed") return state.jobs.filter((job) => !job.reviewed);
  return state.jobs.filter((job) => job.interest === state.filter);
}

function renderProgress() {
  const total = state.stats.total || 0;
  const reviewed = state.stats.reviewed || 0;
  elements.progressText.textContent = `${reviewed} / ${total}`;
  elements.progressBar.style.width = `${total ? (reviewed / total) * 100 : 0}%`;
}

function renderQueue() {
  const jobs = filteredJobs();
  elements.visibleCount.textContent = String(jobs.length);
  elements.list.replaceChildren();
  if (!jobs.length) {
    const empty = document.createElement("p");
    empty.className = "list-empty";
    empty.textContent = "这个筛选下没有岗位。切换状态继续审阅。";
    elements.list.append(empty);
    return;
  }

  jobs.forEach((job) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `job-item${job.reviewed ? " reviewed" : ""}${job.job_id === state.selectedId ? " active" : ""}`;
    button.dataset.jobId = job.job_id;

    const top = document.createElement("span");
    top.className = "job-item-top";
    const bucket = document.createElement("span");
    bucket.className = "mini-bucket";
    bucket.textContent = labels.buckets[job.sample_bucket] || job.sample_bucket;
    const mark = document.createElement("span");
    mark.className = `interest-mark ${job.interest || ""}`;
    mark.setAttribute("aria-label", job.reviewed ? `已判断：${job.interest}` : "未判断");
    top.append(bucket, mark);

    const title = document.createElement("span");
    title.className = "job-item-title";
    title.textContent = job.title || "未命名岗位";
    const company = document.createElement("span");
    company.className = "job-item-company";
    company.textContent = job.company || "公司信息缺失";
    const meta = document.createElement("span");
    meta.className = "job-item-meta";
    const salary = document.createElement("span");
    salary.textContent = job.salary_raw || "薪资未知";
    const track = document.createElement("span");
    track.textContent = job.track || "other";
    meta.append(salary, track);
    button.append(top, title, company, meta);
    button.addEventListener("click", () => selectJob(job.job_id));
    elements.list.append(button);
  });
}

function addMeta(label, value) {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value || "未提供";
  wrapper.append(term, description);
  document.querySelector("#jobMeta").append(wrapper);
}

function setReviewForm(review) {
  elements.form.reset();
  elements.form.querySelector('[name="employment_model"][value="unknown"]').checked = true;
  elements.formError.textContent = "";
  elements.saveState.textContent = review ? "已保存" : "";
  if (!review) return;
  const setRadio = (name, value) => {
    const input = elements.form.querySelector(`[name="${name}"][value="${value}"]`);
    if (input) input.checked = true;
  };
  setRadio("interest", review.interest);
  setRadio("employment_model", review.employment_model);
  ["technical_depth", "business_value", "attainability", "salary_realism"].forEach((name) => setRadio(name, review[name]));
  review.role_labels.forEach((value) => {
    const input = elements.form.querySelector(`[name="role_labels"][value="${value}"]`);
    if (input) input.checked = true;
  });
  elements.form.elements.rejection_reason.value = review.rejection_reason || "";
  elements.form.elements.note.value = review.note || "";
  updateSaveAction();
}

function renderEvidence(listId, values, emptyText) {
  const list = document.querySelector(`#${listId}`);
  list.replaceChildren();
  const items = values?.length ? values : [emptyText];
  items.forEach((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    list.append(item);
  });
}

function renderDetail(job) {
  elements.detailEmpty.hidden = true;
  elements.detailContent.hidden = false;
  document.querySelector("#sampleBucket").textContent = labels.buckets[job.sample_bucket] || job.sample_bucket;
  document.querySelector("#fitTier").textContent = labels.tiers[job.fit_tier] || job.fit_tier;
  document.querySelector("#jobTitle").textContent = job.title || "未命名岗位";
  document.querySelector("#companyLine").textContent = job.company || "公司信息缺失";
  const sourceLink = document.querySelector("#sourceLink");
  sourceLink.href = job.source_url || "#";
  sourceLink.hidden = !job.source_url;
  const meta = document.querySelector("#jobMeta");
  meta.replaceChildren();
  addMeta("薪资", job.salary_raw);
  addMeta("地点", job.location);
  addMeta("经验", job.experience_raw);
  addMeta("学历", job.education_raw);
  addMeta("招聘者", [job.recruiter_name, job.recruiter_role].filter(Boolean).join(" · "));
  addMeta("技能", (job.skills || []).join("、"));

  document.querySelector("#relevanceScore").textContent = job.relevance_score;
  document.querySelector("#fdeScore").textContent = job.fde_value_score;
  const risks = document.querySelector("#riskChips");
  risks.replaceChildren();
  (job.risks || []).forEach((risk) => {
    const chip = document.createElement("span");
    chip.textContent = labels.risks[risk] || risk;
    risks.append(chip);
  });
  if (!job.risks?.length) {
    const chip = document.createElement("span");
    chip.textContent = "旧规则未标风险";
    risks.append(chip);
  }
  const reasons = document.querySelector("#reasonList");
  reasons.replaceChildren();
  (job.reasons || []).forEach((reason) => {
    const item = document.createElement("li");
    item.textContent = reason;
    reasons.append(item);
  });
  const evidence = job.evidence || {};
  renderEvidence("focusTechnical", evidence.technical, "JD 没有出现明确的 AI 技术关键词");
  renderEvidence("focusBusiness", evidence.business, "JD 没有出现明确的业务交付线索");
  renderEvidence("focusCaution", evidence.caution, "旧规则没有标出明显风险");
  renderEvidence("focusRelationship", evidence.relationship, "JD 和招聘者信息没有明确用工关系线索");
  const jd = job.jd_text || job.detail_text || "没有采集到 JD 正文";
  document.querySelector("#jdText").textContent = jd;
  document.querySelector("#jdLength").textContent = `${jd.length} 字`;
  setReviewForm(job.review);
}

async function selectJob(jobId) {
  state.selectedId = jobId;
  renderQueue();
  const requestId = ++state.detailRequest;
  elements.detailEmpty.hidden = false;
  elements.detailEmpty.querySelector("strong").textContent = "正在读取完整 JD";
  elements.detailEmpty.querySelector("span").textContent = "数据来自本地数据库。";
  elements.detailContent.hidden = true;
  try {
    const payload = await fetchJson(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (requestId !== state.detailRequest) return;
    renderDetail(payload.job);
  } catch (error) {
    if (requestId !== state.detailRequest) return;
    elements.detailEmpty.querySelector("strong").textContent = "这条岗位读取失败";
    elements.detailEmpty.querySelector("span").textContent = error.message;
  }
}

async function loadJobs(selectFirst = true) {
  const payload = await fetchJson("/api/jobs");
  state.jobs = payload.jobs;
  state.stats = payload.stats;
  renderProgress();
  renderQueue();
  if (selectFirst && !state.selectedId && state.jobs.length) await selectJob(state.jobs[0].job_id);
}

function reviewPayload() {
  const data = new FormData(elements.form);
  const roleLabels = data.getAll("role_labels");
  const interest = data.get("interest");
  if (!roleLabels.length && interest !== "reject") throw new Error("请至少选择一个岗位方向");
  const score = (name) => Number(data.get(name) || (interest === "reject" ? 1 : 0));
  return {
    interest,
    role_labels: roleLabels.length ? roleLabels : ["other"],
    technical_depth: score("technical_depth"),
    business_value: score("business_value"),
    attainability: score("attainability"),
    salary_realism: score("salary_realism"),
    employment_model: data.get("employment_model") || "unknown",
    rejection_reason: data.get("rejection_reason"),
    note: data.get("note"),
  };
}

async function saveReview(event) {
  event.preventDefault();
  if (!state.selectedId) return;
  elements.formError.textContent = "";
  const interest = elements.form.querySelector('[name="interest"]:checked')?.value;
  if (interest !== "reject" && !elements.form.reportValidity()) return;
  let payload;
  try {
    payload = reviewPayload();
  } catch (error) {
    elements.formError.textContent = error.message;
    return;
  }

  elements.saveButton.disabled = true;
  elements.saveButton.textContent = "正在保存...";
  try {
    await fetchJson(`/api/jobs/${encodeURIComponent(state.selectedId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const currentIndex = state.jobs.findIndex((job) => job.job_id === state.selectedId);
    await loadJobs(false);
    const next = state.jobs.slice(currentIndex + 1).find((job) => !job.reviewed)
      || state.jobs.find((job) => !job.reviewed);
    if (next) await selectJob(next.job_id);
    else await selectJob(state.selectedId);
  } catch (error) {
    elements.formError.textContent = error.message;
  } finally {
    elements.saveButton.disabled = false;
    elements.saveButton.textContent = "保存并看下一条";
  }
}

function updateSaveAction() {
  const rejected = elements.form.querySelector('[name="interest"][value="reject"]')?.checked;
  elements.saveButton.textContent = rejected ? "放弃并看下一条" : "保存并看下一条";
}

document.querySelector("#filters").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  document.querySelectorAll("#filters button").forEach((item) => item.classList.toggle("active", item === button));
  renderQueue();
});

elements.form.addEventListener("submit", saveReview);
document.querySelectorAll('[name="interest"]').forEach((input) => input.addEventListener("change", updateSaveAction));
document.querySelector("#quickReject").addEventListener("click", () => {
  const reject = elements.form.querySelector('[name="interest"][value="reject"]');
  reject.checked = true;
  updateSaveAction();
  saveReview({ preventDefault() {} });
});
createScoreControls();
loadJobs().catch((error) => {
  elements.list.innerHTML = "";
  const message = document.createElement("p");
  message.className = "list-empty";
  message.textContent = `${error.message} 请确认本地数据库存在后刷新页面。`;
  elements.list.append(message);
});
