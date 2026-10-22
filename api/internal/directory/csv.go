// Package directory manages people and accounts and imports them from CSV.
// The import is strict about what it writes: nothing is stored until the whole
// file is understood, and every problem names its row and column.
package directory

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	MaxCSVBytes   = 5 << 20
	MaxCSVRows    = 50_000
	MaxCSVColumns = 40
	maxFieldBytes = 1000
	maxErrors     = 100
)

// Field is something a column can be mapped to.
type Field string

const (
	FieldName    Field = "name"
	FieldEmail   Field = "email"
	FieldAccount Field = "account"
	FieldDomain  Field = "domain"
	FieldRevenue Field = "revenue"
	FieldPlan    Field = "plan"
	FieldRenewal Field = "renewal"
)

var AllFields = []Field{FieldName, FieldEmail, FieldAccount, FieldDomain, FieldRevenue, FieldPlan, FieldRenewal}

// Mapping says which header supplies each field. Fields may be absent.
type Mapping map[Field]string

type RowError struct {
	Row     int // 1-based, counting the header as row 1
	Column  string
	Message string
}

func (e RowError) String() string {
	if e.Column != "" {
		return fmt.Sprintf("row %d, column %q: %s", e.Row, e.Column, e.Message)
	}
	return fmt.Sprintf("row %d: %s", e.Row, e.Message)
}

// Record is one valid row, normalised.
type Record struct {
	Row                                int
	Name, Email, Account, Domain, Plan string
	Revenue                            string // decimal text like "12000.50", empty if none
	Renewal                            string // YYYY-MM-DD, empty if none
}

type Parsed struct {
	Delimiter  rune
	Headers    []string
	Mapping    Mapping
	Records    []Record // valid rows only
	Sample     [][]string
	TotalRows  int // data rows seen
	Errors     []RowError
	ErrorCount int // may exceed len(Errors), which is capped
	Warnings   []string
}

// ErrFile is a problem with the file as a whole.
type ErrFile string

func (e ErrFile) Error() string { return string(e) }

var synonyms = map[Field][]string{
	FieldName:    {"name", "full name", "fullname", "person", "contact", "contact name", "customer name", "user", "user name"},
	FieldEmail:   {"email", "e-mail", "email address", "mail"},
	FieldAccount: {"account", "company", "company name", "organization", "organisation", "org", "customer", "account name", "business"},
	FieldDomain:  {"domain", "website", "company domain", "url", "web"},
	FieldRevenue: {"revenue", "arr", "mrr", "annual revenue", "value", "contract value", "acv", "amount", "annual contract value", "spend"},
	FieldPlan:    {"plan", "tier", "subscription", "package", "plan name"},
	FieldRenewal: {"renewal", "renewal date", "renews", "renews on", "contract end", "contract end date", "term end"},
}

func normHeader(h string) string {
	h = strings.ToLower(strings.TrimSpace(h))
	h = strings.NewReplacer("_", " ", "-", " ").Replace(h)
	return strings.Join(strings.Fields(h), " ")
}

// DetectMapping guesses a mapping from header names. Each header is used once.
func DetectMapping(headers []string) Mapping {
	m := Mapping{}
	used := map[int]bool{}
	for _, f := range AllFields {
		for i, h := range headers {
			if used[i] {
				continue
			}
			nh := normHeader(h)
			for _, s := range synonyms[f] {
				if nh == normHeader(s) {
					m[f] = h
					used[i] = true
					break
				}
			}
			if _, ok := m[f]; ok {
				break
			}
		}
	}
	return m
}

// detectDelimiter picks the delimiter whose count per line is most consistent.
func detectDelimiter(text string) rune {
	lines := strings.SplitN(text, "\n", 12)
	best, bestScore := ',', -1
	for _, d := range []rune{',', ';', '\t', '|'} {
		counts := []int{}
		for _, l := range lines {
			l = strings.TrimRight(l, "\r")
			if strings.TrimSpace(l) == "" {
				continue
			}
			counts = append(counts, strings.Count(l, string(d)))
		}
		if len(counts) == 0 || counts[0] == 0 {
			continue
		}
		consistent := 0
		for _, c := range counts {
			if c == counts[0] {
				consistent++
			}
		}
		if score := consistent*100 + counts[0]; score > bestScore {
			best, bestScore = d, score
		}
	}
	return best
}

var (
	revenueRe = regexp.MustCompile(`^\$?\s*(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$`)
	emailRe   = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
)

func parseRevenue(s string) (string, error) {
	s = strings.TrimSpace(s)
	if !revenueRe.MatchString(s) {
		return "", errors.New("revenue must be a number such as 12000 or $12,000.50")
	}
	s = strings.NewReplacer("$", "", ",", "", " ", "").Replace(s)
	if _, err := strconv.ParseFloat(s, 64); err != nil || len(strings.SplitN(s, ".", 2)[0]) > 12 {
		return "", errors.New("revenue is too large")
	}
	return s, nil
}

var dateLayouts = []string{"2006-01-02", "Jan 2, 2006", "January 2, 2006", "2 Jan 2006", "2 January 2006"}

func parseDate(s string) (string, error) {
	s = strings.TrimSpace(s)
	for _, l := range dateLayouts {
		if t, err := time.Parse(l, s); err == nil {
			if t.Year() < 1990 || t.Year() > 2100 {
				return "", errors.New("date is out of range")
			}
			return t.Format("2006-01-02"), nil
		}
	}
	// Day/month order is ambiguous, so numeric slashes are refused rather than guessed.
	return "", errors.New("date must look like 2026-03-31 or Mar 31, 2026")
}

// Parse reads the file and validates every row against the mapping (detected
// from the headers when mapping is nil). It never writes anything.
func Parse(raw []byte, mapping Mapping) (*Parsed, error) {
	if len(raw) == 0 {
		return nil, ErrFile("the file is empty")
	}
	if len(raw) > MaxCSVBytes {
		return nil, ErrFile(fmt.Sprintf("the file is too large (limit %d MB)", MaxCSVBytes>>20))
	}
	raw = bytes.TrimPrefix(raw, []byte("\xef\xbb\xbf")) // byte order mark
	if bytes.IndexByte(raw, 0) >= 0 || !utf8.Valid(raw) {
		return nil, ErrFile("the file is not readable as UTF-8 text; export it as CSV (UTF-8) and try again")
	}
	text := string(raw)
	delim := detectDelimiter(text)

	r := csv.NewReader(strings.NewReader(text))
	r.Comma = delim
	r.FieldsPerRecord = -1 // we report a ragged row ourselves, with its number
	r.TrimLeadingSpace = true

	header, err := r.Read()
	if err != nil {
		return nil, ErrFile("the first row could not be read as column names")
	}
	if len(header) > MaxCSVColumns {
		return nil, ErrFile(fmt.Sprintf("too many columns (limit %d)", MaxCSVColumns))
	}
	for i := range header {
		header[i] = strings.TrimSpace(header[i])
	}
	if mapping == nil {
		mapping = DetectMapping(header)
	}
	idx := map[Field]int{}
	for f, h := range mapping {
		found := -1
		for i, c := range header {
			if c == h {
				found = i
				break
			}
		}
		if found < 0 {
			return nil, ErrFile(fmt.Sprintf("the column %q you mapped to %s is not in the file", h, f))
		}
		idx[f] = found
	}
	if _, ok := idx[FieldName]; !ok {
		if _, ok := idx[FieldEmail]; !ok {
			return nil, ErrFile("we couldn't find a name or email column; choose which column holds each person")
		}
	}

	p := &Parsed{Delimiter: delim, Headers: header, Mapping: mapping}
	addErr := func(row int, col, msg string) {
		p.ErrorCount++
		if len(p.Errors) < maxErrors {
			p.Errors = append(p.Errors, RowError{Row: row, Column: col, Message: msg})
		}
	}
	type acctSeen struct {
		row                    int
		revenue, plan, renewal string
	}
	accounts := map[string]acctSeen{}
	emails := map[string]int{}

	for row := 2; ; row++ {
		rec, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			addErr(row, "", "this row is not valid CSV (check for a missing quote)")
			var pe *csv.ParseError
			if errors.As(err, &pe) && pe.Err == csv.ErrQuote {
				break // quoting is broken from here on; later rows cannot be trusted
			}
			continue
		}
		if len(rec) == 1 && strings.TrimSpace(rec[0]) == "" {
			row-- // blank line: not a data row
			continue
		}
		p.TotalRows++
		if p.TotalRows > MaxCSVRows {
			return nil, ErrFile(fmt.Sprintf("too many rows (limit %d)", MaxCSVRows))
		}
		if len(p.Sample) < 5 {
			p.Sample = append(p.Sample, append([]string(nil), rec...))
		}
		if len(rec) != len(header) {
			addErr(row, "", fmt.Sprintf("has %d columns but the header has %d", len(rec), len(header)))
			continue
		}
		get := func(f Field) string {
			i, ok := idx[f]
			if !ok {
				return ""
			}
			return strings.TrimSpace(rec[i])
		}
		bad := false
		fail := func(f Field, msg string) { addErr(row, mapping[f], msg); bad = true }
		for _, f := range AllFields {
			if len(get(f)) > maxFieldBytes {
				fail(f, "is too long")
			}
		}
		if bad {
			continue
		}

		out := Record{Row: row, Name: get(FieldName), Email: strings.ToLower(get(FieldEmail)), Account: get(FieldAccount), Domain: strings.ToLower(get(FieldDomain)), Plan: get(FieldPlan)}
		if out.Name == "" && out.Email == "" {
			fail(FieldName, "has neither a name nor an email")
		}
		if out.Email != "" && (!emailRe.MatchString(out.Email) || len(out.Email) > 320) {
			fail(FieldEmail, "is not a valid email address")
		}
		if utf8.RuneCountInString(out.Name) > 200 {
			fail(FieldName, "is longer than 200 characters")
		}
		if utf8.RuneCountInString(out.Account) > 200 {
			fail(FieldAccount, "is longer than 200 characters")
		}
		if len(out.Plan) > 100 {
			fail(FieldPlan, "is longer than 100 characters")
		}
		if len(out.Domain) > 253 {
			fail(FieldDomain, "is longer than 253 characters")
		}
		if s := get(FieldRevenue); s != "" {
			if v, err := parseRevenue(s); err != nil {
				fail(FieldRevenue, err.Error())
			} else {
				out.Revenue = v
			}
		}
		if s := get(FieldRenewal); s != "" {
			if v, err := parseDate(s); err != nil {
				fail(FieldRenewal, err.Error())
			} else {
				out.Renewal = v
			}
		}
		if (out.Revenue != "" || out.Plan != "" || out.Renewal != "" || out.Domain != "") && out.Account == "" {
			fail(FieldAccount, "has account details but no account name")
		}
		if bad {
			continue
		}

		// Cross-row checks: one account cannot have two different values.
		if out.Account != "" {
			key := strings.ToLower(out.Account)
			if prev, ok := accounts[key]; ok {
				for _, c := range []struct {
					f     Field
					a, b  string
					label string
				}{{FieldRevenue, prev.revenue, out.Revenue, "revenue"}, {FieldPlan, prev.plan, out.Plan, "plan"}, {FieldRenewal, prev.renewal, out.Renewal, "renewal date"}} {
					if c.a != "" && c.b != "" && !strings.EqualFold(c.a, c.b) && c.a != c.b {
						fail(c.f, fmt.Sprintf("says %s %q but row %d says %q for %s", c.label, c.b, prev.row, c.a, out.Account))
					}
				}
				if !bad {
					if prev.revenue == "" {
						prev.revenue = out.Revenue
					}
					if prev.plan == "" {
						prev.plan = out.Plan
					}
					if prev.renewal == "" {
						prev.renewal = out.Renewal
					}
					accounts[key] = prev
				}
			} else {
				accounts[key] = acctSeen{row: row, revenue: out.Revenue, plan: out.Plan, renewal: out.Renewal}
			}
		}
		if bad {
			continue
		}
		if out.Email != "" {
			if first, dup := emails[out.Email]; dup {
				p.Warnings = append(p.Warnings, fmt.Sprintf("row %d repeats the email on row %d; they will be treated as the same person", row, first))
			} else {
				emails[out.Email] = row
			}
		}
		p.Records = append(p.Records, out)
	}
	if p.TotalRows == 0 && p.ErrorCount == 0 {
		return nil, ErrFile("the file has column names but no rows")
	}
	if _, ok := mapping[FieldAccount]; !ok {
		p.Warnings = append(p.Warnings, "no company column was found, so people will be added without an account")
	}
	if _, ok := mapping[FieldRevenue]; !ok {
		p.Warnings = append(p.Warnings, "no revenue column was found; requests won't be weighted by value until you add it")
	}
	if len(p.Warnings) > maxErrors {
		p.Warnings = p.Warnings[:maxErrors]
	}
	return p, nil
}
