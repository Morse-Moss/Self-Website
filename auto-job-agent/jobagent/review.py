"""Persistent calibration samples and human reviews for collected jobs."""

from __future__ import annotations

import json
import re
import sqlite3
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path


DEFAULT_SAMPLE_QUOTAS = {
    "favorites": 20,
    "core": 15,
    "stretch": 15,
    "exclude": 10,
}
INTEREST_VALUES = {"want", "maybe", "reject"}
ROLE_LABELS = {"agent", "fde", "rag", "ai_application", "delivery", "other"}
EMPLOYMENT_MODELS = {
    "direct",
    "suspected_agency",
    "confirmed_outsourcing",
    "unknown",
}


class ReviewValidationError(ValueError):
    pass


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _json_list(value: str | None) -> list:
    try:
        parsed = json.loads(value or "[]")
    except (TypeError, json.JSONDecodeError):
        return []
    return parsed if isinstance(parsed, list) else []


def _matching_sentences(text: str, patterns: tuple[str, ...], limit: int = 2) -> list[str]:
    sentences = [part.strip(" -:：") for part in re.split(r"[。！？!?\n]", text) if part.strip()]
    matched = [sentence for sentence in sentences if any(re.search(pattern, sentence, re.I) for pattern in patterns)]
    return [sentence[:180] for sentence in matched[:limit]]


def extract_evidence(job: dict) -> dict[str, list[str]]:
    """Turn a JD into short, inspectable signals for human calibration."""
    title = str(job.get("title") or "")
    jd = str(job.get("jd_text") or job.get("jd") or "")
    recruiter = " ".join(str(job.get(field) or "") for field in ("recruiter_name", "recruiter_role"))
    text = f"{title}\n{jd}"
    technical = _matching_sentences(
        text,
        (r"Agent", r"智能体", r"RAG", r"大模型", r"LLM", r"Python", r"API", r"工作流", r"模型"),
    )
    business = _matching_sentences(
        text,
        (r"客户", r"业务", r"需求", r"交付", r"部署", r"实施", r"解决方案", r"现场", r"复盘"),
    )
    relationship = _matching_sentences(
        f"{text}\n{recruiter}",
        (r"第三方", r"外包", r"派遣", r"猎头", r"驻场", r"RPO", r"招聘顾问"),
    )
    risks = _json_list(str(job.get("risks_json") or "[]"))
    caution = [
        {
            "third_party": "招聘渠道或用工关系需要确认",
            "outsourcing_risk": "JD 出现外包 / 派遣 / 驻场线索",
            "seniority_gap": "经验门槛可能高于当前阶段",
            "salary_stretch": "薪资区间可能对应更高责任范围",
            "pure_java": "技术方向可能偏传统 Java",
            "onsite_heavy": "驻场或出差要求需要确认",
            "graduate_only": "应届资格需要单独确认",
        }.get(risk, risk)
        for risk in risks
    ]
    return {
        "technical": technical,
        "business": business,
        "relationship": relationship,
        "caution": caution,
    }


def _balanced_take(rows: list[sqlite3.Row], count: int) -> list[sqlite3.Row]:
    """Take a deterministic round-robin across tracks."""
    grouped: dict[str, deque[sqlite3.Row]] = defaultdict(deque)
    for row in sorted(
        rows,
        key=lambda item: (-int(item["relevance_score"]), str(item["job_id"])),
    ):
        grouped[str(row["track"])].append(row)

    selected: list[sqlite3.Row] = []
    tracks = sorted(grouped)
    while tracks and len(selected) < count:
        remaining: list[str] = []
        for track in tracks:
            if len(selected) >= count:
                break
            queue = grouped[track]
            if queue:
                selected.append(queue.popleft())
            if queue:
                remaining.append(track)
        tracks = remaining
    return selected


class ReviewStore:
    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path)
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS job_review_samples (
              sample_name TEXT NOT NULL,
              platform TEXT NOT NULL,
              job_id TEXT NOT NULL,
              sample_bucket TEXT NOT NULL,
              position INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              PRIMARY KEY(sample_name, platform, job_id),
              UNIQUE(sample_name, position)
            );
            CREATE TABLE IF NOT EXISTS job_reviews (
              platform TEXT NOT NULL,
              job_id TEXT NOT NULL,
              interest TEXT NOT NULL,
              role_labels_json TEXT NOT NULL,
              technical_depth INTEGER NOT NULL,
              business_value INTEGER NOT NULL,
              attainability INTEGER NOT NULL,
              salary_realism INTEGER NOT NULL,
              employment_model TEXT NOT NULL,
              rejection_reason TEXT NOT NULL DEFAULT '',
              note TEXT NOT NULL DEFAULT '',
              reviewed_at TEXT NOT NULL,
              PRIMARY KEY(platform, job_id)
            );
            """
        )
        self.conn.commit()

    def ensure_sample(
        self,
        sample_name: str = "positioning-v1",
        quotas: dict[str, int] | None = None,
    ) -> list[dict]:
        existing = self.conn.execute(
            "SELECT 1 FROM job_review_samples WHERE sample_name = ? LIMIT 1",
            (sample_name,),
        ).fetchone()
        if existing:
            return self.list_jobs(sample_name)

        requested = dict(quotas or DEFAULT_SAMPLE_QUOTAS)
        allowed = set(DEFAULT_SAMPLE_QUOTAS)
        if not requested or set(requested) - allowed or any(value < 0 for value in requested.values()):
            raise ReviewValidationError("样本分层配置无效")

        candidates = self.conn.execute(
            """
            SELECT d.platform, d.job_id, d.source_key, a.fit_tier,
                   a.track, a.relevance_score
            FROM job_details d
            JOIN job_positioning_analysis a
              ON a.platform = d.platform AND a.job_id = d.job_id
            WHERE d.detail_status = 'collected'
              AND COALESCE(d.jd_text, '') <> ''
            """
        ).fetchall()
        selected_ids: set[tuple[str, str]] = set()
        selected: list[tuple[str, sqlite3.Row]] = []

        for bucket, count in requested.items():
            if bucket == "favorites":
                pool = [row for row in candidates if row["source_key"] == "favorites"]
            else:
                pool = [row for row in candidates if row["fit_tier"] == bucket]
            pool = [row for row in pool if (row["platform"], row["job_id"]) not in selected_ids]
            taken = _balanced_take(pool, count)
            if len(taken) != count:
                raise ReviewValidationError(f"{bucket} 样本不足：需要 {count}，只有 {len(taken)}")
            for row in taken:
                selected_ids.add((row["platform"], row["job_id"]))
                selected.append((bucket, row))

        created_at = _now()
        with self.conn:
            self.conn.executemany(
                """
                INSERT INTO job_review_samples (
                  sample_name, platform, job_id, sample_bucket, position, created_at
                ) VALUES (?,?,?,?,?,?)
                """,
                [
                    (sample_name, row["platform"], row["job_id"], bucket, index, created_at)
                    for index, (bucket, row) in enumerate(selected)
                ],
            )
        return self.list_jobs(sample_name)

    def list_jobs(self, sample_name: str = "positioning-v1") -> list[dict]:
        rows = self.conn.execute(
            """
            SELECT s.position, s.sample_bucket, d.platform, d.job_id, d.title,
                   d.company, d.salary_raw, d.location, d.experience_raw,
                   d.source_key, a.fit_tier, a.track, a.relevance_score,
                   a.fde_value_score, r.interest, r.role_labels_json,
                   r.employment_model, r.reviewed_at
            FROM job_review_samples s
            JOIN job_details d
              ON d.platform = s.platform AND d.job_id = s.job_id
            JOIN job_positioning_analysis a
              ON a.platform = d.platform AND a.job_id = d.job_id
            LEFT JOIN job_reviews r
              ON r.platform = d.platform AND r.job_id = d.job_id
            WHERE s.sample_name = ?
            ORDER BY s.position
            """,
            (sample_name,),
        ).fetchall()
        return [
            {
                **dict(row),
                "role_labels": _json_list(row["role_labels_json"]),
                "reviewed": row["reviewed_at"] is not None,
            }
            for row in rows
        ]

    def get_job(self, job_id: str, sample_name: str = "positioning-v1") -> dict | None:
        row = self.conn.execute(
            """
            SELECT s.sample_bucket, s.position, d.*, a.track, a.fit_tier,
                   a.relevance_score, a.fde_value_score, a.risks_json,
                   a.reasons_json, r.interest, r.role_labels_json,
                   r.technical_depth, r.business_value, r.attainability,
                   r.salary_realism, r.employment_model, r.rejection_reason,
                   r.note, r.reviewed_at
            FROM job_review_samples s
            JOIN job_details d
              ON d.platform = s.platform AND d.job_id = s.job_id
            JOIN job_positioning_analysis a
              ON a.platform = d.platform AND a.job_id = d.job_id
            LEFT JOIN job_reviews r
              ON r.platform = d.platform AND r.job_id = d.job_id
            WHERE s.sample_name = ? AND d.job_id = ?
            LIMIT 1
            """,
            (sample_name, job_id),
        ).fetchone()
        if row is None:
            return None

        result = dict(row)
        result["skills"] = _json_list(row["skills_json"])
        result["system_labels"] = _json_list(row["labels_json"])
        result["risks"] = _json_list(row["risks_json"])
        result["reasons"] = _json_list(row["reasons_json"])
        result["evidence"] = extract_evidence(result)
        if row["reviewed_at"] is None:
            result["review"] = None
        else:
            result["review"] = {
                "interest": row["interest"],
                "role_labels": _json_list(row["role_labels_json"]),
                "technical_depth": row["technical_depth"],
                "business_value": row["business_value"],
                "attainability": row["attainability"],
                "salary_realism": row["salary_realism"],
                "employment_model": row["employment_model"],
                "rejection_reason": row["rejection_reason"],
                "note": row["note"],
                "reviewed_at": row["reviewed_at"],
            }
        return result

    def save_review(
        self,
        job_id: str,
        payload: dict,
        sample_name: str = "positioning-v1",
    ) -> dict:
        review = self._validate_review(payload)
        job = self.conn.execute(
            """
            SELECT platform
            FROM job_review_samples
            WHERE sample_name = ? AND job_id = ?
            LIMIT 1
            """,
            (sample_name, job_id),
        ).fetchone()
        if job is None:
            raise ReviewValidationError("岗位不在当前审阅样本中")

        reviewed_at = _now()
        with self.conn:
            self.conn.execute(
                """
                INSERT INTO job_reviews (
                  platform, job_id, interest, role_labels_json,
                  technical_depth, business_value, attainability,
                  salary_realism, employment_model, rejection_reason,
                  note, reviewed_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(platform, job_id) DO UPDATE SET
                  interest = excluded.interest,
                  role_labels_json = excluded.role_labels_json,
                  technical_depth = excluded.technical_depth,
                  business_value = excluded.business_value,
                  attainability = excluded.attainability,
                  salary_realism = excluded.salary_realism,
                  employment_model = excluded.employment_model,
                  rejection_reason = excluded.rejection_reason,
                  note = excluded.note,
                  reviewed_at = excluded.reviewed_at
                """,
                (
                    job["platform"],
                    job_id,
                    review["interest"],
                    json.dumps(review["role_labels"], ensure_ascii=False),
                    review["technical_depth"],
                    review["business_value"],
                    review["attainability"],
                    review["salary_realism"],
                    review["employment_model"],
                    review["rejection_reason"],
                    review["note"],
                    reviewed_at,
                ),
            )
        return {**review, "reviewed_at": reviewed_at}

    def _validate_review(self, payload: dict) -> dict:
        interest = str(payload.get("interest") or "")
        if interest not in INTEREST_VALUES:
            raise ReviewValidationError("请选择岗位意向")

        role_labels = payload.get("role_labels")
        if interest == "reject" and not role_labels:
            role_labels = ["other"]
        if not isinstance(role_labels, list) or not role_labels:
            raise ReviewValidationError("请至少选择一个岗位方向")
        if any(label not in ROLE_LABELS for label in role_labels):
            raise ReviewValidationError("岗位方向包含无效值")
        role_labels = list(dict.fromkeys(role_labels))

        scores = {}
        for field in ("technical_depth", "business_value", "attainability", "salary_realism"):
            value = payload.get(field)
            if interest == "reject" and value is None:
                value = 1
            if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 5:
                raise ReviewValidationError("四项判断都需要选择 1-5 分")
            scores[field] = value

        employment_model = str(payload.get("employment_model") or "")
        if interest == "reject" and not employment_model:
            employment_model = "unknown"
        if employment_model not in EMPLOYMENT_MODELS:
            raise ReviewValidationError("请选择用工关系")

        return {
            "interest": interest,
            "role_labels": role_labels,
            **scores,
            "employment_model": employment_model,
            "rejection_reason": str(payload.get("rejection_reason") or "").strip(),
            "note": str(payload.get("note") or "").strip(),
        }

    def stats(self, sample_name: str = "positioning-v1") -> dict:
        row = self.conn.execute(
            """
            SELECT COUNT(*) AS total,
                   COUNT(r.reviewed_at) AS reviewed,
                   SUM(CASE WHEN r.interest = 'want' THEN 1 ELSE 0 END) AS wanted,
                   SUM(CASE WHEN r.interest = 'maybe' THEN 1 ELSE 0 END) AS maybe,
                   SUM(CASE WHEN r.interest = 'reject' THEN 1 ELSE 0 END) AS rejected
            FROM job_review_samples s
            LEFT JOIN job_reviews r
              ON r.platform = s.platform AND r.job_id = s.job_id
            WHERE s.sample_name = ?
            """,
            (sample_name,),
        ).fetchone()
        return {key: int(row[key] or 0) for key in row.keys()}

    def close(self) -> None:
        self.conn.close()
