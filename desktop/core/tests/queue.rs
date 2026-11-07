//! Local SQLite queue: dedupe by job id (pos/dedupe.py rules), retries with
//! backoff, manual retry/cancel, acknowledgements and the 7-day history.

use serde_json::json;
use vipe_desktop_core::jobs::PrintJob;
use vipe_desktop_core::queue::{Enqueued, JobStatus, Queue, RetryPolicy, HISTORY_MS};

const T0: i64 = 1_000_000;

fn job(id: &str) -> PrintJob {
    PrintJob {
        id: id.into(),
        kind: "command".into(),
        station: Some("cocina".into()),
        created_at: None,
        payload: json!({"invoiceNumber": id, "items": [{"name": "Arepa", "quantity": 1}], "waiter": "Juan"}),
    }
}

fn queue() -> Queue {
    Queue::open_in_memory(RetryPolicy { base_ms: 1_000, max_ms: 8_000, max_attempts: 4 }).unwrap()
}

#[test]
fn the_same_job_id_is_queued_once() {
    let q = queue();
    assert_eq!(q.enqueue(&job("a"), T0).unwrap(), Enqueued::Queued);
    assert_eq!(q.enqueue(&job("a"), T0 + 10).unwrap(), Enqueued::Duplicate);
    assert_eq!(q.enqueue(&job("b"), T0 + 20).unwrap(), Enqueued::Queued);
    assert_eq!(q.active().unwrap().len(), 2);
}

#[test]
fn a_printed_job_delivered_again_is_a_duplicate_and_stays_printed() {
    let q = queue();
    q.enqueue(&job("a"), T0).unwrap();
    let claimed = q.claim_next(T0).unwrap().unwrap();
    q.mark_printed(&claimed.job.id, T0 + 5).unwrap();
    assert_eq!(q.enqueue(&job("a"), T0 + 100).unwrap(), Enqueued::Duplicate);
    assert_eq!(q.get("a").unwrap().unwrap().status, JobStatus::Printed);
    assert!(q.claim_next(T0 + 200).unwrap().is_none());
}

#[test]
fn claims_are_fifo_and_a_claimed_job_is_not_claimed_twice() {
    let q = queue();
    q.enqueue(&job("first"), T0).unwrap();
    q.enqueue(&job("second"), T0 + 1).unwrap();
    assert_eq!(q.claim_next(T0 + 2).unwrap().unwrap().job.id, "first");
    assert_eq!(q.claim_next(T0 + 2).unwrap().unwrap().job.id, "second");
    assert!(q.claim_next(T0 + 2).unwrap().is_none());
}

#[test]
fn failures_back_off_exponentially_then_stop_for_a_manual_retry() {
    let q = queue();
    q.enqueue(&job("a"), T0).unwrap();
    let mut now = T0;
    for (attempt, wait) in [(1, 1_000), (2, 2_000), (3, 4_000)] {
        q.claim_next(now).unwrap().unwrap();
        let status = q.mark_failed("a", "sin papel", now).unwrap();
        assert_eq!(status, JobStatus::Pending, "attempt {attempt}");
        let row = q.get("a").unwrap().unwrap();
        assert_eq!(row.attempts, attempt);
        assert_eq!(row.next_attempt_at, now + wait);
        assert!(q.claim_next(now + wait - 1).unwrap().is_none(), "not due before the backoff");
        now += wait;
    }
    q.claim_next(now).unwrap().unwrap();
    assert_eq!(q.mark_failed("a", "sin papel", now).unwrap(), JobStatus::Failed);
    let row = q.get("a").unwrap().unwrap();
    assert_eq!((row.attempts, row.last_error.as_deref()), (4, Some("sin papel")));
    assert!(q.claim_next(now + 1_000_000).unwrap().is_none(), "failed jobs wait for Reintentar");

    assert!(q.retry("a", now + 10).unwrap());
    assert_eq!(q.claim_next(now + 10).unwrap().unwrap().job.id, "a");
}

#[test]
fn backoff_is_capped() {
    let policy = RetryPolicy { base_ms: 1_000, max_ms: 8_000, max_attempts: 20 };
    assert_eq!(policy.backoff_ms(1), 1_000);
    assert_eq!(policy.backoff_ms(4), 8_000);
    assert_eq!(policy.backoff_ms(15), 8_000);
}

#[test]
fn cancel_only_applies_to_waiting_or_failed_jobs() {
    let q = queue();
    q.enqueue(&job("a"), T0).unwrap();
    q.enqueue(&job("b"), T0).unwrap();
    q.claim_next(T0).unwrap();
    assert!(!q.cancel("a", T0 + 1).unwrap(), "a printing job cannot be cancelled");
    assert!(q.cancel("b", T0 + 1).unwrap());
    assert_eq!(q.get("b").unwrap().unwrap().status, JobStatus::Cancelled);
    assert!(!q.cancel("missing", T0).unwrap());
}

#[test]
fn skipped_jobs_are_recorded_and_need_an_ack() {
    let q = queue();
    q.record_skipped(&job("old"), "command older than 12 h", T0).unwrap();
    let row = q.get("old").unwrap().unwrap();
    assert_eq!(row.status, JobStatus::Skipped);
    assert_eq!(q.enqueue(&job("old"), T0 + 1).unwrap(), Enqueued::Duplicate);
    assert_eq!(q.pending_acks().unwrap(), vec!["old".to_string()]);
    q.mark_acked("old").unwrap();
    assert!(q.pending_acks().unwrap().is_empty());
}

#[test]
fn printed_cancelled_and_skipped_jobs_need_an_ack_but_waiting_ones_do_not() {
    let q = queue();
    for id in ["p", "c", "w"] {
        q.enqueue(&job(id), T0).unwrap();
    }
    q.claim_next(T0).unwrap();
    q.mark_printed("p", T0 + 1).unwrap();
    q.cancel("c", T0 + 1).unwrap();
    let mut acks = q.pending_acks().unwrap();
    acks.sort();
    assert_eq!(acks, vec!["c".to_string(), "p".to_string()]);
}

#[test]
fn history_keeps_seven_days_and_prune_forgets_older_ids() {
    let q = queue();
    q.enqueue(&job("old"), T0).unwrap();
    q.claim_next(T0).unwrap();
    q.mark_printed("old", T0).unwrap();
    q.enqueue(&job("new"), T0 + HISTORY_MS).unwrap();
    q.claim_next(T0 + HISTORY_MS).unwrap();
    q.mark_printed("new", T0 + HISTORY_MS).unwrap();

    let now = T0 + HISTORY_MS + 1;
    let ids: Vec<String> = q.history(now).unwrap().into_iter().map(|r| r.job.id).collect();
    assert_eq!(ids, vec!["new".to_string()], "newest first, older than 7 days hidden");

    assert_eq!(q.prune(now).unwrap(), 1);
    assert!(q.get("old").unwrap().is_none());
    // After the retention window the id behaves like dedupe.py after its TTL.
    assert_eq!(q.enqueue(&job("old"), now).unwrap(), Enqueued::Queued);
}

#[test]
fn prune_never_drops_waiting_jobs() {
    let q = queue();
    q.enqueue(&job("waiting"), T0).unwrap();
    assert_eq!(q.prune(T0 + 10 * HISTORY_MS).unwrap(), 0);
    assert_eq!(q.active().unwrap().len(), 1);
}

#[test]
fn a_job_left_printing_by_a_crash_is_retried_after_reopening() {
    let dir = std::env::temp_dir().join(format!("vipe-queue-{}-{}", std::process::id(), T0));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("queue.sqlite3");
    {
        let q = Queue::open(&path, RetryPolicy::default()).unwrap();
        q.enqueue(&job("a"), T0).unwrap();
        q.claim_next(T0).unwrap().unwrap();
    }
    let q = Queue::open(&path, RetryPolicy::default()).unwrap();
    assert_eq!(q.get("a").unwrap().unwrap().status, JobStatus::Pending);
    assert_eq!(q.claim_next(T0 + 1).unwrap().unwrap().job.payload["waiter"], "Juan");
    drop(q);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn counts_summarise_the_queue() {
    let q = queue();
    q.enqueue(&job("a"), T0).unwrap();
    q.enqueue(&job("b"), T0).unwrap();
    q.claim_next(T0).unwrap();
    let c = q.counts().unwrap();
    assert_eq!((c.pending, c.printing, c.failed), (1, 1, 0));
}
