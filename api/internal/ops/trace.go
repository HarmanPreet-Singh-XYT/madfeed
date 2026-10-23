package ops

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
)

type ctxKey struct{}

// WithRequestID remembers which request this work belongs to.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxKey{}, id)
}

func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(ctxKey{}).(string)
	return id
}

// StampJobs is a River hook that writes the current request id onto every job
// as it is created, so a job that fails an hour later can be traced back to
// the request that caused it.
type StampJobs struct{ river.HookDefaults }

var _ rivertype.HookInsertBegin = &StampJobs{}

func (*StampJobs) InsertBegin(ctx context.Context, p *rivertype.JobInsertParams) error {
	id := RequestID(ctx)
	if id == "" {
		return nil
	}
	meta := map[string]any{}
	if len(p.Metadata) > 0 {
		_ = json.Unmarshal(p.Metadata, &meta)
	}
	meta["request_id"] = id
	b, err := json.Marshal(meta)
	if err != nil {
		return err
	}
	p.Metadata = b
	return nil
}

func requestIDOf(job *rivertype.JobRow) string {
	var m struct {
		RequestID string `json:"request_id"`
	}
	_ = json.Unmarshal(job.Metadata, &m)
	return m.RequestID
}

// ReportFailures is River's error handler: it logs every failed attempt with
// enough to find the cause (kind, job id, attempt, request id, short error
// class) and raises an alert when a job has run out of attempts or panicked.
type ReportFailures struct {
	Alerts *Alerter
	Log    *slog.Logger
}

var _ river.ErrorHandler = (*ReportFailures)(nil)

func (r *ReportFailures) log() *slog.Logger {
	if r.Log != nil {
		return r.Log
	}
	return slog.Default()
}

func (r *ReportFailures) HandleError(ctx context.Context, job *rivertype.JobRow, err error) *river.ErrorHandlerResult {
	rid := requestIDOf(job)
	r.log().Warn("job attempt failed", "kind", job.Kind, "job_id", job.ID, "attempt", job.Attempt, "max_attempts", job.MaxAttempts, "request_id", rid, "error", clean(err.Error()))
	if job.Attempt >= job.MaxAttempts && r.Alerts != nil {
		r.Alerts.Fire(ctx, Alert{
			Name: "job_failed", Severity: Critical,
			Summary: fmt.Sprintf("A background job (%s) failed all %d attempts and has been given up on.", job.Kind, job.MaxAttempts),
			Details: map[string]string{"kind": job.Kind, "job_id": fmt.Sprint(job.ID), "attempt": fmt.Sprint(job.Attempt), "request_id": rid, "error": err.Error()},
		}, job.Kind)
	}
	return nil
}

func (r *ReportFailures) HandlePanic(ctx context.Context, job *rivertype.JobRow, v any, _ string) *river.ErrorHandlerResult {
	rid := requestIDOf(job)
	r.log().Error("job panicked", "kind", job.Kind, "job_id", job.ID, "request_id", rid, "panic", clean(fmt.Sprint(v)))
	if r.Alerts != nil {
		r.Alerts.Fire(ctx, Alert{
			Name: "job_panicked", Severity: Critical,
			Summary: fmt.Sprintf("A background job (%s) crashed.", job.Kind),
			Details: map[string]string{"kind": job.Kind, "job_id": fmt.Sprint(job.ID), "request_id": rid, "panic": fmt.Sprint(v)},
		}, job.Kind)
	}
	return &river.ErrorHandlerResult{SetCancelled: false}
}
