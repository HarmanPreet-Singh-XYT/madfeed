package portability

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"time"

	"product/api/internal/store"
)

// SampleName is what the sample workspace is called, so a person can tell it from their own.
const SampleName = "Sample workspace"

// sampleJSON is an ordinary workspace-export-v1 file, written once with every quote's offsets computed from its
// source text, so Verify holds it to the same standard as a customer's own data.
//
//go:embed sample.json
var sampleJSON []byte

// ImportSample fills an empty workspace with a small made-up company: conversations, requests in every status,
// evidence quotes, tags, a highlight and a published release note. It goes through the same checks as any import.
// The file's dates are moved so its newest moment is now, because a sample whose charts are empty is no sample.
func (s *Service) ImportSample(ctx context.Context, t store.Tenant) error {
	if !t.Can(store.PermManage) {
		return ErrNotAdmin
	}
	var d Document
	if err := json.NewDecoder(bytes.NewReader(sampleJSON)).Decode(&d); err != nil {
		return fmt.Errorf("%w: sample file: %v", ErrBadFormat, err)
	}
	shift := time.Since(d.ExportedAt).Truncate(time.Minute)
	move := func(x time.Time) time.Time { return x.Add(shift) }
	d.ExportedAt = move(d.ExportedAt)
	for i := range d.Sources {
		d.Sources[i].CreatedAt = move(d.Sources[i].CreatedAt)
	}
	for i := range d.Requests {
		d.Requests[i].CreatedAt = move(d.Requests[i].CreatedAt)
	}
	for i := range d.Evidence {
		d.Evidence[i].CreatedAt = move(d.Evidence[i].CreatedAt)
	}
	for i := range d.Highlights {
		d.Highlights[i].CreatedAt = move(d.Highlights[i].CreatedAt)
	}
	for i := range d.ReleaseNotes {
		n := &d.ReleaseNotes[i]
		n.CreatedAt = move(n.CreatedAt)
		if n.PublishedAt != nil {
			p := move(*n.PublishedAt)
			n.PublishedAt = &p
		}
		if n.ScheduledFor != nil {
			p := move(*n.ScheduledFor)
			n.ScheduledFor = &p
		}
	}
	return s.importDocument(ctx, t, &d)
}
