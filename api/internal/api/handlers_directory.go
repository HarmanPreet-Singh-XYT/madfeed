package api

import (
	"context"
	"encoding/base64"
	"strings"
	"time"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"product/api/internal/directory"
)

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func pageSize(p *Limit) int {
	if p == nil {
		return 50
	}
	return int(*p)
}

// nameCursor pages A to Z by (lowercased name, id), the same order the queries use.
func encodeNameCursor(name string, id uuid.UUID) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strings.ToLower(name) + "|" + id.String()))
}

func decodeNameCursor(c *Cursor) (string, uuid.UUID, error) {
	if c == nil || *c == "" {
		return "", uuid.Nil, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(string(*c))
	if err != nil {
		return "", uuid.Nil, err
	}
	i := strings.LastIndex(string(raw), "|")
	if i < 0 {
		return "", uuid.Nil, errNotFound
	}
	id, err := uuid.Parse(string(raw[i+1:]))
	return string(raw[:i]), id, err
}

func (s *Server) ListAccounts(ctx context.Context, req ListAccountsRequestObject) (ListAccountsResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	after, afterID, err := decodeNameCursor(req.Params.Cursor)
	if err != nil {
		return nil, badRequest("The page cursor is not valid.")
	}
	limit := pageSize(req.Params.Limit)
	rows, err := s.Directory.ListAccounts(ctx, t, after, afterID, limit+1)
	if err != nil {
		return nil, err
	}
	var next *string
	if len(rows) > limit {
		rows = rows[:limit]
		c := encodeNameCursor(rows[len(rows)-1].Name, rows[len(rows)-1].ID)
		next = &c
	}
	out := make([]Account, 0, len(rows))
	for _, a := range rows {
		item := Account{Id: a.ID, Name: a.Name, Domain: a.Domain, Plan: a.Plan, Revenue: a.Revenue, PeopleCount: a.PeopleCount}
		if a.RenewalDate != nil {
			if d, err := time.Parse("2006-01-02", *a.RenewalDate); err == nil {
				item.RenewalDate = &openapi_types.Date{Time: d}
			}
		}
		out = append(out, item)
	}
	return ListAccounts200JSONResponse{Accounts: out, NextCursor: next}, nil
}

func accountInput(b *AccountInput) directory.AccountInput {
	return directory.AccountInput{Name: b.Name, Domain: derefStr(b.Domain), Plan: derefStr(b.Plan), Revenue: derefStr(b.Revenue), RenewalDate: derefStr(b.RenewalDate)}
}

func (s *Server) CreateAccount(ctx context.Context, req CreateAccountRequestObject) (CreateAccountResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("Account details are required.")
	}
	id, err := s.Directory.CreateAccount(ctx, t, accountInput(req.Body))
	if err != nil {
		return nil, err
	}
	return CreateAccount201JSONResponse{Id: id}, nil
}

func (s *Server) UpdateAccount(ctx context.Context, req UpdateAccountRequestObject) (UpdateAccountResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("Account details are required.")
	}
	if err := s.Directory.UpdateAccount(ctx, t, req.AccountId, accountInput(req.Body)); err != nil {
		return nil, err
	}
	return UpdateAccount204Response{}, nil
}

func (s *Server) ListPeople(ctx context.Context, req ListPeopleRequestObject) (ListPeopleResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	after, afterID, err := decodeNameCursor(req.Params.Cursor)
	if err != nil {
		return nil, badRequest("The page cursor is not valid.")
	}
	limit := pageSize(req.Params.Limit)
	rows, err := s.Directory.ListPeople(ctx, t, after, afterID, limit+1)
	if err != nil {
		return nil, err
	}
	var next *string
	if len(rows) > limit {
		rows = rows[:limit]
		c := encodeNameCursor(rows[len(rows)-1].Name, rows[len(rows)-1].ID)
		next = &c
	}
	out := make([]Person, 0, len(rows))
	for _, p := range rows {
		item := Person{Id: p.ID, Name: p.Name, Email: p.Email, AccountName: p.AccountName}
		if p.AccountID != nil {
			id := *p.AccountID
			item.AccountId = &id
		}
		out = append(out, item)
	}
	return ListPeople200JSONResponse{People: out, NextCursor: next}, nil
}

func personInput(b *PersonInput) directory.PersonInput {
	in := directory.PersonInput{Name: derefStr(b.Name), Email: derefStr(b.Email)}
	if b.AccountId != nil {
		id := uuid.UUID(*b.AccountId)
		in.AccountID = &id
	}
	return in
}

func (s *Server) CreatePerson(ctx context.Context, req CreatePersonRequestObject) (CreatePersonResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("Person details are required.")
	}
	id, err := s.Directory.CreatePerson(ctx, t, personInput(req.Body))
	if err != nil {
		return nil, err
	}
	return CreatePerson201JSONResponse{Id: id}, nil
}

func (s *Server) UpdatePerson(ctx context.Context, req UpdatePersonRequestObject) (UpdatePersonResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("Person details are required.")
	}
	if err := s.Directory.UpdatePerson(ctx, t, req.PersonId, personInput(req.Body)); err != nil {
		return nil, err
	}
	return UpdatePerson204Response{}, nil
}

func toMapping(m *ImportMapping) directory.Mapping {
	if m == nil {
		return nil
	}
	out := directory.Mapping{}
	for f, v := range map[directory.Field]*string{
		directory.FieldName: m.Name, directory.FieldEmail: m.Email, directory.FieldAccount: m.Account, directory.FieldDomain: m.Domain,
		directory.FieldRevenue: m.Revenue, directory.FieldPlan: m.Plan, directory.FieldRenewal: m.Renewal,
	} {
		if v != nil && *v != "" {
			out[f] = *v
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func fromMapping(m directory.Mapping) ImportMapping {
	get := func(f directory.Field) *string {
		if v, ok := m[f]; ok {
			return &v
		}
		return nil
	}
	return ImportMapping{Name: get(directory.FieldName), Email: get(directory.FieldEmail), Account: get(directory.FieldAccount), Domain: get(directory.FieldDomain),
		Revenue: get(directory.FieldRevenue), Plan: get(directory.FieldPlan), Renewal: get(directory.FieldRenewal)}
}

func (s *Server) PreviewPeopleImport(ctx context.Context, req PreviewPeopleImportRequestObject) (PreviewPeopleImportResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A CSV file is required.")
	}
	if !t.CanWrite() {
		return nil, errForbidden
	}
	p, err := directory.Parse([]byte(req.Body.Csv), toMapping(req.Body.Mapping))
	if err != nil {
		return nil, fileError(err)
	}
	out := PreviewPeopleImport200JSONResponse{
		Delimiter: string(p.Delimiter), Headers: p.Headers, Mapping: fromMapping(p.Mapping), TotalRows: p.TotalRows, ValidRows: len(p.Records),
		Sample: p.Sample, ErrorCount: p.ErrorCount, Warnings: p.Warnings,
	}
	if out.Sample == nil {
		out.Sample = [][]string{}
	}
	if out.Warnings == nil {
		out.Warnings = []string{}
	}
	for _, e := range p.Errors {
		item := struct {
			Column  *string `json:"column,omitempty"`
			Message string  `json:"message"`
			Row     int     `json:"row"`
		}{Message: e.Message, Row: e.Row}
		if e.Column != "" {
			c := e.Column
			item.Column = &c
		}
		out.Errors = append(out.Errors, item)
	}
	if out.Errors == nil {
		out.Errors = []struct {
			Column  *string `json:"column,omitempty"`
			Message string  `json:"message"`
			Row     int     `json:"row"`
		}{}
	}
	return out, nil
}

func fileError(err error) error {
	if ef, ok := err.(directory.ErrFile); ok {
		return badRequest(ef.Error())
	}
	return err
}

func (s *Server) ImportPeople(ctx context.Context, req ImportPeopleRequestObject) (ImportPeopleResponseObject, error) {
	t, err := s.tenant(ctx, req.WorkspaceId)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, badRequest("A CSV file is required.")
	}
	skip := req.Body.SkipInvalidRows != nil && *req.Body.SkipInvalidRows
	res, err := s.Directory.Import(ctx, t, []byte(req.Body.Csv), toMapping(req.Body.Mapping), skip)
	if err != nil {
		return nil, err
	}
	return ImportPeople200JSONResponse{AccountsCreated: res.AccountsCreated, AccountsUpdated: res.AccountsUpdated,
		PeopleCreated: res.PeopleCreated, PeopleUpdated: res.PeopleUpdated, Skipped: res.Skipped}, nil
}
