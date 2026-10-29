package views_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"product/api/internal/store"
	"product/api/internal/testdb"
	"product/api/internal/views"
)

var ctx = context.Background()

func setup(t *testing.T) (*testdb.DB, *views.Service, store.Tenant, store.Tenant) {
	t.Helper()
	db := testdb.New(t)
	ws, user := uuid.New(), uuid.New()
	viewerUser := uuid.New()
	if _, err := db.Super.Exec(ctx, `INSERT INTO workspace (id, name) VALUES ($1,'W')`, ws); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Super.Exec(ctx, `INSERT INTO member (workspace_id, user_id, role) VALUES ($1,$2,'admin'), ($1,$3,'viewer')`, ws, user, viewerUser); err != nil {
		t.Fatal(err)
	}
	return db, &views.Service{Pool: db.Backend}, store.Tenant{WorkspaceID: ws, UserID: user, Role: store.RoleAdmin}, store.Tenant{WorkspaceID: ws, UserID: viewerUser, Role: store.RoleViewer}
}

func TestAQuoteViewKeepsItsFilters(t *testing.T) {
	_, svc, admin, viewer := setup(t)
	v, err := svc.CreateQuote(ctx, admin, views.QuoteInput{Name: "  Negative security  ", Kind: "evidence", Sentiment: "negative", SourceKind: "chat", Search: "sso", Days: 30, Sort: "oldest"})
	if err != nil {
		t.Fatal(err)
	}
	if v.Name != "Negative security" || v.Kind != "evidence" || v.Sentiment != "negative" || v.SourceKind != "chat" || v.Search != "sso" || v.Days != 30 || v.Sort != "oldest" {
		t.Fatalf("view = %+v", v)
	}
	all, err := svc.ListQuotes(ctx, viewer)
	if err != nil || len(all) != 1 || all[0].ID != v.ID {
		t.Fatalf("list = %+v, %v", all, err)
	}

	if _, err := svc.CreateQuote(ctx, admin, views.QuoteInput{Name: "negative security"}); err == nil {
		t.Fatal("a second view with the same name must be refused")
	}
	if _, err := svc.CreateQuote(ctx, admin, views.QuoteInput{Name: "Nothing"}); err == nil {
		t.Fatal("a view with no filters and the default order must be refused")
	}
	if _, err := svc.CreateQuote(ctx, admin, views.QuoteInput{Name: "Odd", Days: 5}); err == nil {
		t.Fatal("a date range that is not one of the choices must be refused")
	}
	if _, err := svc.CreateQuote(ctx, admin, views.QuoteInput{Name: "Odd", Sort: "sideways"}); err == nil {
		t.Fatal("an unknown order must be refused")
	}
	if _, err := svc.CreateQuote(ctx, viewer, views.QuoteInput{Name: "Mine", Sentiment: "positive"}); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("viewer create = %v, want forbidden", err)
	}
}

func TestAQuoteViewCanOnlyBeRemovedByItsMakerOrAnAdmin(t *testing.T) {
	_, svc, admin, viewer := setup(t)
	v, err := svc.CreateQuote(ctx, admin, views.QuoteInput{Name: "Admins view", Sentiment: "negative"})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteQuote(ctx, viewer, v.ID); !errors.Is(err, store.ErrForbidden) {
		t.Fatalf("viewer delete = %v, want forbidden", err)
	}
	if err := svc.DeleteQuote(ctx, admin, v.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteQuote(ctx, admin, v.ID); !errors.Is(err, views.ErrNotFound) {
		t.Fatalf("second delete = %v, want not found", err)
	}
}

func TestQuoteViewsDoNotCrossWorkspaces(t *testing.T) {
	_, svc, admin, _ := setup(t)
	if _, err := svc.CreateQuote(ctx, admin, views.QuoteInput{Name: "Only here", Sentiment: "mixed"}); err != nil {
		t.Fatal(err)
	}
	other := store.Tenant{WorkspaceID: uuid.New(), UserID: uuid.New(), Role: store.RoleAdmin}
	if _, err := svc.ListQuotes(ctx, other); err != nil {
		t.Fatal(err)
	}
	// The other workspace has no rows; reading it must not see the first workspace's view.
	rows, err := svc.ListQuotes(ctx, other)
	if err != nil || len(rows) != 0 {
		t.Fatalf("other workspace list = %+v, %v; want empty", rows, err)
	}
}

func TestAQuoteViewKeepsAPersonOrAccountAndCanBeRenamed(t *testing.T) {
	db, svc, admin, _ := setup(t)
	var person, account uuid.UUID
	if err := db.Super.QueryRow(ctx, `INSERT INTO person (workspace_id, name) VALUES ($1,'Ada') RETURNING id`, admin.WorkspaceID).Scan(&person); err != nil {
		t.Fatal(err)
	}
	if err := db.Super.QueryRow(ctx, `INSERT INTO account (workspace_id, name) VALUES ($1,'Engines') RETURNING id`, admin.WorkspaceID).Scan(&account); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateQuote(ctx, admin, views.QuoteInput{Name: "Ada", PersonID: &person}); err != nil {
		t.Fatal(err)
	}
	v, err := svc.CreateQuote(ctx, admin, views.QuoteInput{Name: "Engines", AccountID: &account})
	if err != nil {
		t.Fatal(err)
	}
	if v.AccountID == nil || *v.AccountID != account {
		t.Fatalf("view = %+v; want the account kept", v)
	}
	renamed, err := svc.RenameQuote(ctx, admin, v.ID, "  Engines, renamed ")
	if err != nil || renamed.Name != "Engines, renamed" {
		t.Fatalf("rename = %+v, %v", renamed, err)
	}
	if _, err := svc.RenameQuote(ctx, admin, v.ID, " "); err == nil {
		t.Fatal("an empty name must be refused")
	}
	other := store.Tenant{WorkspaceID: uuid.New(), UserID: uuid.New(), Role: store.RoleAdmin}
	if _, err := svc.RenameQuote(ctx, other, v.ID, "Theirs"); !errors.Is(err, views.ErrNotFound) {
		t.Fatalf("other workspace rename = %v, want not found", err)
	}
}
