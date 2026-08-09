import json
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import main as main_module
from jobagent.review import ReviewStore, ReviewValidationError, extract_evidence
from jobagent.review_server import create_server


def create_fixture_db(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE job_details (
          platform TEXT NOT NULL,
          job_id TEXT NOT NULL,
          source_url TEXT NOT NULL,
          source_key TEXT,
          title TEXT,
          company TEXT,
          detail_status TEXT NOT NULL,
          jd_text TEXT,
          detail_text TEXT,
          salary_raw TEXT,
          location TEXT,
          experience_raw TEXT,
          education_raw TEXT,
          recruiter_name TEXT,
          recruiter_role TEXT,
          skills_json TEXT,
          labels_json TEXT,
          collected_at TEXT NOT NULL,
          PRIMARY KEY(platform, job_id)
        );
        CREATE TABLE job_positioning_analysis (
          platform TEXT NOT NULL,
          job_id TEXT NOT NULL,
          analyzed_at TEXT NOT NULL,
          track TEXT NOT NULL,
          fit_tier TEXT NOT NULL,
          relevance_score INTEGER NOT NULL,
          fde_value_score INTEGER NOT NULL,
          risks_json TEXT NOT NULL,
          reasons_json TEXT NOT NULL,
          PRIMARY KEY(platform, job_id)
        );
        """
    )
    rows = []
    for index in range(24):
        source_key = "favorites" if index < 8 else "search:深圳:AI Agent 开发"
        fit_tier = ("core", "stretch", "exclude")[index % 3]
        track = ("agent_engineering", "fde", "ai_application", "rag_engineering")[
            index % 4
        ]
        job_id = f"job-{index:02d}"
        rows.append((job_id, source_key, fit_tier, track, index))
    for job_id, source_key, fit_tier, track, index in rows:
        connection.execute(
            """
            INSERT INTO job_details (
              platform, job_id, source_url, source_key, title, company,
              detail_status, jd_text, detail_text, salary_raw, location,
              experience_raw, education_raw, recruiter_name, recruiter_role,
              skills_json, labels_json, collected_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                "boss",
                job_id,
                f"https://example.invalid/{job_id}",
                source_key,
                f"AI Agent 工程师 {index}",
                f"公司 {index}",
                "collected",
                f"完整 JD {index}",
                f"详情 {index}",
                "12-20K",
                "深圳",
                "1-3年",
                "本科",
                "招聘者",
                "HR",
                json.dumps(["Python", "Agent"], ensure_ascii=False),
                json.dumps(["agent_rag", "direct"], ensure_ascii=False),
                "2026-08-05T00:00:00+08:00",
            ),
        )
        connection.execute(
            """
            INSERT INTO job_positioning_analysis VALUES (?,?,?,?,?,?,?,?,?)
            """,
            (
                "boss",
                job_id,
                "2026-08-05T00:00:00+08:00",
                track,
                fit_tier,
                90 - index,
                80 - index,
                json.dumps(["third_party"] if index == 2 else []),
                json.dumps(["测试依据"], ensure_ascii=False),
            ),
        )
    connection.commit()
    connection.close()


class ReviewSampleTests(unittest.TestCase):
    def test_sample_is_stratified_and_stable(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            create_fixture_db(db_path)
            store = ReviewStore(db_path)
            try:
                quotas = {"favorites": 4, "core": 3, "stretch": 3, "exclude": 2}
                first = store.ensure_sample("calibration", quotas=quotas)
                second = store.ensure_sample("calibration", quotas=quotas)

                self.assertEqual(len(first), 12)
                self.assertEqual(
                    {bucket: sum(job["sample_bucket"] == bucket for job in first) for bucket in quotas},
                    quotas,
                )
                self.assertEqual(
                    [job["job_id"] for job in first],
                    [job["job_id"] for job in second],
                )
            finally:
                store.close()


class ReviewPersistenceTests(unittest.TestCase):
    def test_reject_review_needs_no_scoring_fields(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            create_fixture_db(db_path)
            store = ReviewStore(db_path)
            try:
                store.ensure_sample("positioning-v1", quotas={"favorites": 1})
                job_id = store.list_jobs("positioning-v1")[0]["job_id"]
                review = store.save_review(
                    job_id,
                    {"interest": "reject", "rejection_reason": "role_mismatch"},
                )
                self.assertEqual(review["interest"], "reject")
                self.assertEqual(review["technical_depth"], 1)
                self.assertEqual(review["role_labels"], ["other"])
            finally:
                store.close()

    def test_review_round_trip_preserves_multilabel_scores_and_notes(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            create_fixture_db(db_path)
            store = ReviewStore(db_path)
            try:
                store.ensure_sample("calibration", quotas={"favorites": 1})
                job_id = store.list_jobs("calibration")[0]["job_id"]
                saved = store.save_review(
                    job_id,
                    {
                        "interest": "want",
                        "role_labels": ["agent", "fde"],
                        "technical_depth": 4,
                        "business_value": 5,
                        "attainability": 3,
                        "salary_realism": 4,
                        "employment_model": "suspected_agency",
                        "rejection_reason": "",
                        "note": "技术匹配，确认是否直签。",
                    },
                    sample_name="calibration",
                )
                loaded = store.get_job(job_id, "calibration")

                self.assertEqual(saved["role_labels"], ["agent", "fde"])
                self.assertEqual(loaded["review"]["business_value"], 5)
                self.assertEqual(loaded["review"]["employment_model"], "suspected_agency")
                self.assertEqual(store.stats("calibration")["reviewed"], 1)
            finally:
                store.close()


class EvidenceExtractionTests(unittest.TestCase):
    def test_extracts_short_jd_evidence_for_four_decisions(self):
        evidence = extract_evidence(
            {
                "title": "AI Agent FDE 工程师",
                "jd_text": "负责 Agent 和 RAG 应用开发。\n需要走访客户，梳理业务需求并完成部署交付。\n岗位由第三方招聘，要求 5 年经验。",
                "recruiter_role": "猎头顾问",
                "risks_json": "[\"third_party\", \"seniority_gap\"]",
            }
        )
        self.assertTrue(any("Agent 和 RAG 应用开发" in item for item in evidence["technical"]))
        self.assertTrue(any("梳理业务需求并完成部署交付" in item for item in evidence["business"]))
        self.assertTrue(any("第三方招聘" in item for item in evidence["relationship"]))
        self.assertTrue(evidence["caution"])

    def test_invalid_review_does_not_write_partial_data(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            create_fixture_db(db_path)
            store = ReviewStore(db_path)
            try:
                store.ensure_sample("calibration", quotas={"favorites": 1})
                job_id = store.list_jobs("calibration")[0]["job_id"]
                with self.assertRaises(ReviewValidationError):
                    store.save_review(
                        job_id,
                        {
                            "interest": "want",
                            "role_labels": ["agent"],
                            "technical_depth": 7,
                            "business_value": 5,
                            "attainability": 3,
                            "salary_realism": 4,
                            "employment_model": "direct",
                        },
                        sample_name="calibration",
                    )

                self.assertIsNone(store.get_job(job_id, "calibration")["review"])
            finally:
                store.close()

    def test_review_cannot_write_outside_the_active_sample(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            create_fixture_db(db_path)
            store = ReviewStore(db_path)
            try:
                store.ensure_sample("positioning-v1", quotas={"favorites": 1})
                with self.assertRaises(ReviewValidationError):
                    store.save_review(
                        "job-23",
                        {
                            "interest": "reject",
                            "role_labels": ["other"],
                            "technical_depth": 1,
                            "business_value": 1,
                            "attainability": 1,
                            "salary_realism": 1,
                            "employment_model": "unknown",
                        },
                    )
            finally:
                store.close()


class ReviewApiTests(unittest.TestCase):
    def test_api_lists_detail_and_persists_review(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            create_fixture_db(db_path)
            store = ReviewStore(db_path)
            try:
                store.ensure_sample("positioning-v1", quotas={"favorites": 2})
                job_id = store.list_jobs("positioning-v1")[0]["job_id"]
            finally:
                store.close()

            server = create_server(db_path, host="127.0.0.1", port=0)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base_url = f"http://127.0.0.1:{server.server_port}"
            try:
                with urlopen(base_url) as response:
                    page = response.read().decode("utf-8")
                self.assertIn("岗位定位审阅台", page)

                with urlopen(f"{base_url}/api/jobs") as response:
                    listing = json.load(response)
                self.assertEqual(listing["stats"]["total"], 2)
                self.assertEqual(len(listing["jobs"]), 2)

                with urlopen(f"{base_url}/api/jobs/{job_id}") as response:
                    detail = json.load(response)
                self.assertEqual(detail["job"]["jd_text"], "完整 JD 0")
                self.assertIn("Agent", " ".join(detail["job"]["evidence"]["technical"]))

                payload = {
                    "interest": "maybe",
                    "role_labels": ["agent"],
                    "technical_depth": 4,
                    "business_value": 3,
                    "attainability": 4,
                    "salary_realism": 5,
                    "employment_model": "unknown",
                    "rejection_reason": "",
                    "note": "需要确认团队和业务。",
                }
                request = Request(
                    f"{base_url}/api/jobs/{job_id}",
                    data=json.dumps(payload).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="PUT",
                )
                with urlopen(request) as response:
                    saved = json.load(response)
                self.assertEqual(saved["review"]["interest"], "maybe")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_api_rejects_invalid_review_with_actionable_message(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "jobs.db"
            create_fixture_db(db_path)
            store = ReviewStore(db_path)
            try:
                store.ensure_sample("positioning-v1", quotas={"favorites": 1})
                job_id = store.list_jobs("positioning-v1")[0]["job_id"]
            finally:
                store.close()

            server = create_server(db_path, host="127.0.0.1", port=0)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                request = Request(
                    f"http://127.0.0.1:{server.server_port}/api/jobs/{job_id}",
                    data=b"{}",
                    headers={"Content-Type": "application/json"},
                    method="PUT",
                )
                with self.assertRaises(HTTPError) as caught:
                    urlopen(request)
                self.assertEqual(caught.exception.code, 400)
                error = json.loads(caught.exception.read().decode("utf-8"))
                self.assertIn("请选择", error["error"])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)


class ReviewCliTests(unittest.TestCase):
    def test_review_cli_starts_local_server_without_ai_or_browser(self):
        config = {"collection": {"db_path": "../output/jobagent.db"}}
        with (
            patch.object(main_module, "load_config", return_value=config),
            patch.object(main_module, "run_review_server") as run_server,
            patch.object(main_module, "OpenAICompatibleClient") as ai,
            patch.object(main_module, "BossCollector") as collector,
            patch("sys.argv", ["main.py", "--review-jobs", "--review-port", "8899"]),
        ):
            main_module.main()

        run_server.assert_called_once_with(
            "../output/jobagent.db", host="127.0.0.1", port=8899
        )
        ai.assert_not_called()
        collector.assert_not_called()


if __name__ == "__main__":
    unittest.main()
