package api

import (
	"context"

	"github.com/google/uuid"

	"product/api/internal/inbox"
	"product/api/internal/media"
	"product/api/internal/store/dbgen"
	"product/api/internal/survey"
)

// PersonErasers is every tool's way of forgetting a person. The server hands it to media.Service so that deleting
// a person removes their surveys and support conversations too. A new tool that keeps data about people adds its
// eraser here; Validate refuses to start a server that has none.
func PersonErasers(hashKey []byte) []media.PersonEraser {
	return []media.PersonEraser{
		func(ctx context.Context, q *dbgen.Queries, ws, person uuid.UUID, _ string) error {
			return survey.ErasePerson(ctx, q, hashKey, ws, person)
		},
		func(ctx context.Context, q *dbgen.Queries, ws, person uuid.UUID, email string) error {
			return inbox.ErasePerson(ctx, q, ws, person, email)
		},
	}
}
