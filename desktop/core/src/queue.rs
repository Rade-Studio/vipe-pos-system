//! Local print queue in SQLite. A job id is stored once (dedupe, as
//! pos/dedupe.py did in memory) and kept for the 7-day history; failures retry
//! with exponential backoff until `max_attempts`, then wait for "Reintentar".
//! Times are milliseconds since the Unix epoch, passed in by the caller.

use crate::jobs::PrintJob;
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::path::Path;

/// History retention: 7 days.
pub const HISTORY_MS: i64 = 7 * 24 * 3600 * 1000;

#[derive(Debug, thiserror::Error)]
pub enum QueueError {
    #[error("queue database: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("queue payload: {0}")]
    Json(#[from] serde_json::Error),
}

type R<T> = Result<T, QueueError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Enqueued {
    Queued,
    Duplicate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Pending,
    Printing,
    Printed,
    Failed,
    Cancelled,
    Skipped,
}

impl JobStatus {
    fn as_str(self) -> &'static str {
        match self {
            JobStatus::Pending => "pending",
            JobStatus::Printing => "printing",
            JobStatus::Printed => "printed",
            JobStatus::Failed => "failed",
            JobStatus::Cancelled => "cancelled",
            JobStatus::Skipped => "skipped",
        }
    }

    fn parse(s: &str) -> JobStatus {
        match s {
            "printing" => JobStatus::Printing,
            "printed" => JobStatus::Printed,
            "failed" => JobStatus::Failed,
            "cancelled" => JobStatus::Cancelled,
            "skipped" => JobStatus::Skipped,
            _ => JobStatus::Pending,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct RetryPolicy {
    pub base_ms: i64,
    pub max_ms: i64,
    /// Automatic attempts before the job waits for a manual retry.
    pub max_attempts: i64,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        RetryPolicy { base_ms: 2_000, max_ms: 5 * 60_000, max_attempts: 6 }
    }
}

impl RetryPolicy {
    /// Wait after the `attempt`-th failure: base · 2^(attempt-1), capped.
    pub fn backoff_ms(&self, attempt: i64) -> i64 {
        let exp = (attempt - 1).clamp(0, 30) as u32;
        self.base_ms.saturating_mul(1_i64 << exp).min(self.max_ms)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedJob {
    pub job: PrintJob,
    pub status: JobStatus,
    pub attempts: i64,
    pub next_attempt_at: i64,
    pub last_error: Option<String>,
    pub enqueued_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy, Default, serde::Serialize)]
pub struct Counts {
    pub pending: i64,
    pub printing: i64,
    pub failed: i64,
}

pub struct Queue {
    conn: Connection,
    policy: RetryPolicy,
}

const COLUMNS: &str = "id, kind, station, created_at, payload, status, attempts, next_attempt_at, last_error, enqueued_at, updated_at";

impl Queue {
    pub fn open(path: &Path, policy: RetryPolicy) -> R<Self> {
        Self::init(Connection::open(path)?, policy)
    }

    pub fn open_in_memory(policy: RetryPolicy) -> R<Self> {
        Self::init(Connection::open_in_memory()?, policy)
    }

    fn init(conn: Connection, policy: RetryPolicy) -> R<Self> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS jobs (
               id TEXT PRIMARY KEY,
               kind TEXT NOT NULL,
               station TEXT,
               created_at TEXT,
               payload TEXT NOT NULL,
               status TEXT NOT NULL,
               attempts INTEGER NOT NULL DEFAULT 0,
               next_attempt_at INTEGER NOT NULL,
               last_error TEXT,
               acked INTEGER NOT NULL DEFAULT 0,
               enqueued_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS jobs_due ON jobs (status, next_attempt_at, enqueued_at);
             UPDATE jobs SET status = 'pending' WHERE status = 'printing';",
        )?;
        Ok(Queue { conn, policy })
    }

    pub fn enqueue(&self, job: &PrintJob, now: i64) -> R<Enqueued> {
        self.insert(job, JobStatus::Pending, None, now)
    }

    /// Store a job that will never print (acknowledged without printing).
    pub fn record_skipped(&self, job: &PrintJob, reason: &str, now: i64) -> R<()> {
        self.insert(job, JobStatus::Skipped, Some(reason), now).map(|_| ())
    }

    fn insert(&self, job: &PrintJob, status: JobStatus, error: Option<&str>, now: i64) -> R<Enqueued> {
        let changed = self.conn.execute(
            "INSERT OR IGNORE INTO jobs (id, kind, station, created_at, payload, status, next_attempt_at, last_error, enqueued_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?7, ?7)",
            params![job.id, job.kind, job.station, job.created_at, serde_json::to_string(&job.payload)?, status.as_str(), now, error],
        )?;
        Ok(if changed == 1 { Enqueued::Queued } else { Enqueued::Duplicate })
    }

    /// The oldest due pending job, marked as printing.
    pub fn claim_next(&self, now: i64) -> R<Option<QueuedJob>> {
        let sql = format!(
            "SELECT {COLUMNS} FROM jobs WHERE status = 'pending' AND next_attempt_at <= ?1 ORDER BY enqueued_at, rowid LIMIT 1"
        );
        let Some(mut row) = self.conn.query_row(&sql, params![now], read_row).optional()?.transpose()? else {
            return Ok(None);
        };
        self.set_status(&row.job.id, JobStatus::Printing, now)?;
        row.status = JobStatus::Printing;
        Ok(Some(row))
    }

    pub fn mark_printed(&self, id: &str, now: i64) -> R<()> {
        self.conn.execute(
            "UPDATE jobs SET status = 'printed', last_error = NULL, updated_at = ?2 WHERE id = ?1",
            params![id, now],
        )?;
        Ok(())
    }

    /// Count a failed attempt; returns `Pending` (will retry) or `Failed`.
    pub fn mark_failed(&self, id: &str, error: &str, now: i64) -> R<JobStatus> {
        let attempts: i64 = self.conn.query_row("SELECT attempts FROM jobs WHERE id = ?1", params![id], |r| r.get::<_, i64>(0))? + 1;
        let status = if attempts >= self.policy.max_attempts { JobStatus::Failed } else { JobStatus::Pending };
        self.conn.execute(
            "UPDATE jobs SET status = ?2, attempts = ?3, next_attempt_at = ?4, last_error = ?5, updated_at = ?6 WHERE id = ?1",
            params![id, status.as_str(), attempts, now + self.policy.backoff_ms(attempts), error, now],
        )?;
        Ok(status)
    }

    /// "Reintentar": a failed or waiting job becomes due now.
    pub fn retry(&self, id: &str, now: i64) -> R<bool> {
        let n = self.conn.execute(
            "UPDATE jobs SET status = 'pending', next_attempt_at = ?2, updated_at = ?2 WHERE id = ?1 AND status IN ('pending', 'failed')",
            params![id, now],
        )?;
        Ok(n == 1)
    }

    /// "Cancelar": only a waiting or failed job; a job being printed is not stopped.
    pub fn cancel(&self, id: &str, now: i64) -> R<bool> {
        let n = self.conn.execute(
            "UPDATE jobs SET status = 'cancelled', updated_at = ?2 WHERE id = ?1 AND status IN ('pending', 'failed')",
            params![id, now],
        )?;
        Ok(n == 1)
    }

    pub fn get(&self, id: &str) -> R<Option<QueuedJob>> {
        let sql = format!("SELECT {COLUMNS} FROM jobs WHERE id = ?1");
        Ok(self.conn.query_row(&sql, params![id], read_row).optional()?.transpose()?)
    }

    /// Waiting, printing and failed jobs, oldest first.
    pub fn active(&self) -> R<Vec<QueuedJob>> {
        self.select("status IN ('pending', 'printing', 'failed') ORDER BY enqueued_at, rowid", params![])
    }

    /// Finished jobs of the last 7 days, newest first.
    pub fn history(&self, now: i64) -> R<Vec<QueuedJob>> {
        self.select(
            "status IN ('printed', 'cancelled', 'skipped') AND updated_at > ?1 ORDER BY updated_at DESC, rowid DESC",
            params![now - HISTORY_MS],
        )
    }

    /// Forget finished jobs older than the history window.
    pub fn prune(&self, now: i64) -> R<usize> {
        Ok(self.conn.execute(
            "DELETE FROM jobs WHERE status IN ('printed', 'cancelled', 'skipped') AND updated_at <= ?1",
            params![now - HISTORY_MS],
        )?)
    }

    /// Finished jobs the API has not been told about yet.
    pub fn pending_acks(&self) -> R<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT id FROM jobs WHERE acked = 0 AND status IN ('printed', 'cancelled', 'skipped') ORDER BY updated_at, rowid",
        )?;
        let ids = stmt.query_map([], |r| r.get(0))?.collect::<Result<Vec<String>, _>>()?;
        Ok(ids)
    }

    pub fn mark_acked(&self, id: &str) -> R<()> {
        self.conn.execute("UPDATE jobs SET acked = 1 WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn counts(&self) -> R<Counts> {
        let mut c = Counts::default();
        let mut stmt = self.conn.prepare("SELECT status, COUNT(*) FROM jobs GROUP BY status")?;
        for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
            let (status, n) = row?;
            match JobStatus::parse(&status) {
                JobStatus::Pending => c.pending = n,
                JobStatus::Printing => c.printing = n,
                JobStatus::Failed => c.failed = n,
                _ => {}
            }
        }
        Ok(c)
    }

    fn set_status(&self, id: &str, status: JobStatus, now: i64) -> R<()> {
        self.conn.execute("UPDATE jobs SET status = ?2, updated_at = ?3 WHERE id = ?1", params![id, status.as_str(), now])?;
        Ok(())
    }

    fn select(&self, filter: &str, args: impl rusqlite::Params) -> R<Vec<QueuedJob>> {
        let mut stmt = self.conn.prepare(&format!("SELECT {COLUMNS} FROM jobs WHERE {filter}"))?;
        let rows = stmt.query_map(args, read_row)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row??);
        }
        Ok(out)
    }
}

fn read_row(r: &Row<'_>) -> rusqlite::Result<Result<QueuedJob, QueueError>> {
    let payload: String = r.get(4)?;
    let status: String = r.get(5)?;
    let build = |payload: serde_json::Value| QueuedJob {
        job: PrintJob { id: String::new(), kind: String::new(), station: None, created_at: None, payload },
        status: JobStatus::parse(&status),
        attempts: 0,
        next_attempt_at: 0,
        last_error: None,
        enqueued_at: 0,
        updated_at: 0,
    };
    let mut q = match serde_json::from_str(&payload) {
        Ok(p) => build(p),
        Err(e) => return Ok(Err(e.into())),
    };
    q.job.id = r.get(0)?;
    q.job.kind = r.get(1)?;
    q.job.station = r.get(2)?;
    q.job.created_at = r.get(3)?;
    q.attempts = r.get(6)?;
    q.next_attempt_at = r.get(7)?;
    q.last_error = r.get(8)?;
    q.enqueued_at = r.get(9)?;
    q.updated_at = r.get(10)?;
    Ok(Ok(q))
}
