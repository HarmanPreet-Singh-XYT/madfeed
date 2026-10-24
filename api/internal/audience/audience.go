// Package audience decides which people a survey is for. An audience is a small tree of rules ("all of",
// "any of", "not") over fields of a person and their account. The same rule is checked two ways: compiled
// to a parameterised SQL condition (what runs for real) and evaluated in plain Go (the reference the tests
// compare it against). Every field is two-valued: a person with no account simply does not match an
// account rule, so "not" behaves the way it reads.
package audience

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ErrInvalid means the rule cannot be used; the message is safe to show.
type ErrInvalid string

func (e ErrInvalid) Error() string { return string(e) }

const (
	maxDepth  = 4
	maxNodes  = 30
	maxValues = 50
	maxString = 200
)

// Rule is one node: exactly one of All, Any, Not, or a field test (Field, Op, Value).
type Rule struct {
	All   []Rule
	Any   []Rule
	Not   *Rule
	Field string
	Op    string
	Value json.RawMessage

	kind string // "all", "any", "not" or "leaf"
	// parsed leaf values
	strs []string
	num  string
	date time.Time
	days int
	flag bool
	id   uuid.UUID
}

// Everyone is the rule that matches every person (an explicit choice, never a default).
func Everyone() Rule { return Rule{kind: "all"} }

func (r *Rule) UnmarshalJSON(b []byte) error {
	var m map[string]json.RawMessage
	dec := json.NewDecoder(bytes.NewReader(b))
	if err := dec.Decode(&m); err != nil {
		return ErrInvalid("the audience is not valid")
	}
	has := func(k string) bool { _, ok := m[k]; return ok }
	switch {
	case has("all") && len(m) == 1:
		r.kind = "all"
		return json.Unmarshal(m["all"], &r.All)
	case has("any") && len(m) == 1:
		r.kind = "any"
		return json.Unmarshal(m["any"], &r.Any)
	case has("not") && len(m) == 1:
		r.kind = "not"
		r.Not = new(Rule)
		return json.Unmarshal(m["not"], r.Not)
	case has("field") && has("op") && has("value") && len(m) == 3:
		r.kind = "leaf"
		if err := json.Unmarshal(m["field"], &r.Field); err != nil {
			return ErrInvalid("a rule's field must be text")
		}
		if err := json.Unmarshal(m["op"], &r.Op); err != nil {
			return ErrInvalid("a rule's comparison must be text")
		}
		r.Value = m["value"]
		return nil
	}
	return ErrInvalid("each rule needs exactly one of all, any, not, or field with op and value")
}

func (r Rule) MarshalJSON() ([]byte, error) {
	switch r.kind {
	case "all":
		if r.All == nil {
			return []byte(`{"all":[]}`), nil
		}
		return json.Marshal(map[string]any{"all": r.All})
	case "any":
		if r.Any == nil {
			return []byte(`{"any":[]}`), nil
		}
		return json.Marshal(map[string]any{"any": r.Any})
	case "not":
		return json.Marshal(map[string]any{"not": r.Not})
	}
	return json.Marshal(map[string]any{"field": r.Field, "op": r.Op, "value": r.Value})
}

var (
	decimal = regexp.MustCompile(`^\d{1,12}(\.\d{1,2})?$`)
	dateRe  = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

type fieldSpec struct {
	ops   map[string]string // op -> value kind: "string", "strings", "decimal", "date", "days", "bool", "uuid"
	label string
}

var fields = map[string]fieldSpec{
	"name_contains":   {ops: map[string]string{"contains": "string"}, label: "name"},
	"email_domain":    {ops: map[string]string{"eq": "string", "in": "strings"}, label: "email domain"},
	"person_added":    {ops: map[string]string{"before": "date", "after": "date"}, label: "date added"},
	"has_account":     {ops: map[string]string{"is": "bool"}, label: "has an account"},
	"account_plan":    {ops: map[string]string{"eq": "string", "in": "strings"}, label: "account plan"},
	"account_domain":  {ops: map[string]string{"eq": "string"}, label: "account domain"},
	"account_revenue": {ops: map[string]string{"gte": "decimal", "lte": "decimal"}, label: "account revenue"},
	"account_renewal": {ops: map[string]string{"before": "date", "after": "date", "within_days": "days"}, label: "renewal date"},
	"asked_for":       {ops: map[string]string{"is": "uuid"}, label: "asked for a request"},
}

// Parse reads and checks a rule. An empty input is refused: "everyone" must be written down.
func Parse(raw []byte) (Rule, error) {
	if len(bytes.TrimSpace(raw)) == 0 || string(bytes.TrimSpace(raw)) == "{}" || string(bytes.TrimSpace(raw)) == "null" {
		return Rule{}, ErrInvalid("choose who the survey is for (or choose everyone)")
	}
	var r Rule
	if err := json.Unmarshal(raw, &r); err != nil {
		var ei ErrInvalid
		if errors.As(err, &ei) {
			return Rule{}, ei
		}
		return Rule{}, ErrInvalid("the audience is not valid")
	}
	nodes := 0
	if err := r.check(1, &nodes); err != nil {
		return Rule{}, err
	}
	return r, nil
}

func (r *Rule) check(depth int, nodes *int) error {
	*nodes++
	if depth > maxDepth {
		return ErrInvalid("the audience is nested too deeply")
	}
	if *nodes > maxNodes {
		return ErrInvalid("the audience has too many rules")
	}
	switch r.kind {
	case "all", "any":
		kids := r.All
		if r.kind == "any" {
			kids = r.Any
		}
		if r.kind == "any" && len(kids) == 0 {
			return ErrInvalid("'any of' needs at least one rule")
		}
		for i := range kids {
			if err := kids[i].check(depth+1, nodes); err != nil {
				return err
			}
		}
		return nil
	case "not":
		return r.Not.check(depth+1, nodes)
	case "leaf":
		return r.checkLeaf()
	}
	return ErrInvalid("the audience is not valid")
}

func (r *Rule) checkLeaf() error {
	spec, ok := fields[r.Field]
	if !ok {
		return ErrInvalid("unknown audience field")
	}
	kind, ok := spec.ops[r.Op]
	if !ok {
		return ErrInvalid("that comparison does not apply to " + spec.label)
	}
	bad := ErrInvalid("the value for " + spec.label + " is not valid")
	switch kind {
	case "string":
		var s string
		if json.Unmarshal(r.Value, &s) != nil {
			return bad
		}
		s = strings.ToLower(strings.TrimSpace(s))
		if s == "" || len(s) > maxString || strings.ContainsRune(s, 0) {
			return bad
		}
		r.strs = []string{s}
	case "strings":
		var ss []string
		if json.Unmarshal(r.Value, &ss) != nil || len(ss) == 0 || len(ss) > maxValues {
			return bad
		}
		for _, s := range ss {
			s = strings.ToLower(strings.TrimSpace(s))
			if s == "" || len(s) > maxString || strings.ContainsRune(s, 0) {
				return bad
			}
			r.strs = append(r.strs, s)
		}
	case "decimal":
		var n json.Number
		if json.Unmarshal(r.Value, &n) != nil || !decimal.MatchString(n.String()) {
			return bad
		}
		r.num = n.String()
	case "date":
		var s string
		if json.Unmarshal(r.Value, &s) != nil || !dateRe.MatchString(s) {
			return bad
		}
		d, err := time.Parse("2006-01-02", s)
		if err != nil {
			return bad
		}
		r.date = d
	case "days":
		var n int
		if json.Unmarshal(r.Value, &n) != nil || n < 0 || n > 3650 {
			return bad
		}
		r.days = n
	case "bool":
		if json.Unmarshal(r.Value, &r.flag) != nil {
			return bad
		}
	case "uuid":
		var s string
		if json.Unmarshal(r.Value, &s) != nil {
			return bad
		}
		id, err := uuid.Parse(s)
		if err != nil {
			return bad
		}
		r.id = id
	}
	return nil
}

// ---- compiling to SQL ----

type compiler struct{ args []any }

func (c *compiler) arg(v any) string {
	c.args = append(c.args, v)
	return fmt.Sprintf("$%d", len(c.args))
}

// FROM is the shared source of every audience query: $1 is the workspace, $2 is today's date.
const from = ` FROM person p LEFT JOIN account a ON a.workspace_id = p.workspace_id AND a.id = p.account_id WHERE p.workspace_id = $1 AND $2::date IS NOT NULL AND `

func (c *compiler) node(r Rule) string {
	switch r.kind {
	case "all":
		return c.join(r.All, " AND ", "true")
	case "any":
		return c.join(r.Any, " OR ", "false")
	case "not":
		return "NOT (" + c.node(*r.Not) + ")"
	}
	return "COALESCE((" + c.leaf(r) + "), false)"
}

func (c *compiler) join(kids []Rule, sep, empty string) string {
	if len(kids) == 0 {
		return empty
	}
	parts := make([]string, len(kids))
	for i, k := range kids {
		parts[i] = "(" + c.node(k) + ")"
	}
	return strings.Join(parts, sep)
}

func (c *compiler) leaf(r Rule) string {
	switch r.Field + "/" + r.Op {
	case "name_contains/contains":
		return "strpos(lower(p.name), " + c.arg(r.strs[0]) + ") > 0"
	case "email_domain/eq":
		return domainExpr + " = " + c.arg(r.strs[0])
	case "email_domain/in":
		return domainExpr + " = ANY (" + c.arg(r.strs) + "::text[])"
	case "person_added/before":
		return "(p.created_at AT TIME ZONE 'UTC')::date < " + c.arg(r.date) + "::date"
	case "person_added/after":
		return "(p.created_at AT TIME ZONE 'UTC')::date > " + c.arg(r.date) + "::date"
	case "has_account/is":
		if r.flag {
			return "a.id IS NOT NULL"
		}
		return "a.id IS NULL"
	case "account_plan/eq":
		return "lower(a.plan) = " + c.arg(r.strs[0])
	case "account_plan/in":
		return "lower(a.plan) = ANY (" + c.arg(r.strs) + "::text[])"
	case "account_domain/eq":
		return "lower(a.domain) = " + c.arg(r.strs[0])
	case "account_revenue/gte":
		return "a.revenue >= " + c.arg(r.num) + "::numeric"
	case "account_revenue/lte":
		return "a.revenue <= " + c.arg(r.num) + "::numeric"
	case "account_renewal/before":
		return "a.renewal_date < " + c.arg(r.date) + "::date"
	case "account_renewal/after":
		return "a.renewal_date > " + c.arg(r.date) + "::date"
	case "account_renewal/within_days":
		return "a.renewal_date >= $2::date AND a.renewal_date <= $2::date + " + c.arg(int32(r.days)) + "::int"
	case "asked_for/is":
		return "EXISTS (SELECT 1 FROM evidence e WHERE e.workspace_id = p.workspace_id AND e.person_id = p.id AND e.request_id = " + c.arg(r.id) + ")"
	}
	return "false" // unreachable: Parse refuses anything else
}

const domainExpr = "lower(substring(p.email from '@([^@]*)$'))"

// Match is one person an audience selected.
type Match struct {
	ID    uuid.UUID
	Name  string
	Email string
}

// Select returns how many people match, and up to limit of them (ordered by name) with an email address
// first, since only those can be invited. The caller supplies a transaction that already has the
// workspace set, so row-level security applies on top of the explicit workspace condition.
func Select(ctx context.Context, tx pgx.Tx, ws uuid.UUID, r Rule, today time.Time, limit int) (total, withEmail int, sample []Match, err error) {
	c := &compiler{args: []any{ws, today.UTC().Format("2006-01-02")}}
	cond := c.node(r)
	if err = tx.QueryRow(ctx, `SELECT count(*), count(p.email) FILTER (WHERE p.email IS NOT NULL AND p.email <> '')`+from+"("+cond+")", c.args...).Scan(&total, &withEmail); err != nil {
		return 0, 0, nil, err
	}
	rows, err := tx.Query(ctx, `SELECT p.id, p.name, coalesce(p.email, '')`+from+"("+cond+") AND p.email IS NOT NULL AND p.email <> '' ORDER BY p.name, p.id LIMIT "+fmt.Sprint(limit), c.args...)
	if err != nil {
		return 0, 0, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m Match
		if err = rows.Scan(&m.ID, &m.Name, &m.Email); err != nil {
			return 0, 0, nil, err
		}
		sample = append(sample, m)
	}
	return total, withEmail, sample, rows.Err()
}

// Emailable returns up to limit matching people who have an email address, ordered by name.
func Emailable(ctx context.Context, tx pgx.Tx, ws uuid.UUID, r Rule, today time.Time, limit int) ([]Match, error) {
	c := &compiler{args: []any{ws, today.UTC().Format("2006-01-02")}}
	rows, err := tx.Query(ctx, `SELECT p.id, p.name, p.email`+from+"("+c.node(r)+") AND p.email IS NOT NULL AND p.email <> '' ORDER BY p.name, p.id LIMIT "+fmt.Sprint(limit), c.args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Match
	for rows.Next() {
		var m Match
		if err := rows.Scan(&m.ID, &m.Name, &m.Email); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// IDs returns every matching person's id (used by tests and by invitations, which cap the number).
func IDs(ctx context.Context, tx pgx.Tx, ws uuid.UUID, r Rule, today time.Time, limit int) ([]uuid.UUID, error) {
	c := &compiler{args: []any{ws, today.UTC().Format("2006-01-02")}}
	rows, err := tx.Query(ctx, `SELECT p.id`+from+"("+c.node(r)+") ORDER BY p.id LIMIT "+fmt.Sprint(limit), c.args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ---- the reference evaluator (plain Go; deliberately shares no code with the SQL above) ----

// Subject is everything a rule can look at for one person.
type Subject struct {
	Name         string
	Email        string // "" when none
	Added        time.Time
	HasAccount   bool
	Plan         string // "" when none
	AccountDom   string
	Revenue      string // decimal text, "" when none
	Renewal      *time.Time
	AskedRequest map[uuid.UUID]bool
}

// Eval reports whether the person matches. It is the reference the SQL is tested against.
func Eval(r Rule, s Subject, today time.Time) bool {
	switch r.kind {
	case "all":
		for _, k := range r.All {
			if !Eval(k, s, today) {
				return false
			}
		}
		return true
	case "any":
		for _, k := range r.Any {
			if Eval(k, s, today) {
				return true
			}
		}
		return false
	case "not":
		return !Eval(*r.Not, s, today)
	}
	day := func(t time.Time) time.Time {
		y, m, d := t.UTC().Date()
		return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	}
	switch r.Field + "/" + r.Op {
	case "name_contains/contains":
		return strings.Contains(strings.ToLower(s.Name), r.strs[0])
	case "email_domain/eq", "email_domain/in":
		at := strings.LastIndex(s.Email, "@")
		if s.Email == "" || at < 0 || strings.Contains(s.Email[at+1:], "@") {
			return false
		}
		return contains(r.strs, strings.ToLower(s.Email[at+1:]))
	case "person_added/before":
		return day(s.Added).Before(r.date)
	case "person_added/after":
		return day(s.Added).After(r.date)
	case "has_account/is":
		return s.HasAccount == r.flag
	case "account_plan/eq", "account_plan/in":
		return s.HasAccount && s.Plan != "" && contains(r.strs, strings.ToLower(s.Plan))
	case "account_domain/eq":
		return s.HasAccount && s.AccountDom != "" && strings.ToLower(s.AccountDom) == r.strs[0]
	case "account_revenue/gte":
		return s.HasAccount && s.Revenue != "" && cmpDecimal(s.Revenue, r.num) >= 0
	case "account_revenue/lte":
		return s.HasAccount && s.Revenue != "" && cmpDecimal(s.Revenue, r.num) <= 0
	case "account_renewal/before":
		return s.Renewal != nil && day(*s.Renewal).Before(r.date)
	case "account_renewal/after":
		return s.Renewal != nil && day(*s.Renewal).After(r.date)
	case "account_renewal/within_days":
		if s.Renewal == nil {
			return false
		}
		t, end := day(today), day(today).AddDate(0, 0, r.days)
		d := day(*s.Renewal)
		return !d.Before(t) && !d.After(end)
	case "asked_for/is":
		return s.AskedRequest[r.id]
	}
	return false
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// cmpDecimal compares two non-negative decimals written as text, with no floating point.
func cmpDecimal(a, b string) int {
	split := func(s string) (string, string) {
		i := strings.IndexByte(s, '.')
		if i < 0 {
			return s, ""
		}
		return s[:i], s[i+1:]
	}
	ai, af := split(a)
	bi, bf := split(b)
	ai, bi = strings.TrimLeft(ai, "0"), strings.TrimLeft(bi, "0")
	if len(ai) != len(bi) {
		if len(ai) < len(bi) {
			return -1
		}
		return 1
	}
	if ai != bi {
		return strings.Compare(ai, bi)
	}
	for len(af) < 2 {
		af += "0"
	}
	for len(bf) < 2 {
		bf += "0"
	}
	return strings.Compare(af, bf)
}
