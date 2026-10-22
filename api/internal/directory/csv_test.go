package directory

import (
	"fmt"
	"strings"
	"testing"
)

func mustParse(t *testing.T, csv string, m Mapping) *Parsed {
	t.Helper()
	p, err := Parse([]byte(csv), m)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	return p
}

const clean = `Name,Email,Company,ARR,Plan,Renewal Date
Dana Lee,dana@acme.com,Acme Inc,"$120,000",Enterprise,2026-12-31
Raj Patel,raj@acme.com,Acme Inc,120000,Enterprise,2026-12-31
Sam Cho,sam@globex.io,Globex,45000.50,Team,"Mar 31, 2027"
`

func TestCleanFileIsDetectedAndParsed(t *testing.T) {
	p := mustParse(t, clean, nil)
	if p.Delimiter != ',' || p.TotalRows != 3 || len(p.Records) != 3 || p.ErrorCount != 0 {
		t.Fatalf("%+v", p)
	}
	for f, h := range map[Field]string{FieldName: "Name", FieldEmail: "Email", FieldAccount: "Company", FieldRevenue: "ARR", FieldPlan: "Plan", FieldRenewal: "Renewal Date"} {
		if p.Mapping[f] != h {
			t.Errorf("mapping[%s] = %q, want %q", f, p.Mapping[f], h)
		}
	}
	r := p.Records[0]
	if r.Revenue != "120000" || r.Renewal != "2026-12-31" || r.Email != "dana@acme.com" {
		t.Errorf("%+v", r)
	}
	if p.Records[2].Revenue != "45000.50" || p.Records[2].Renewal != "2027-03-31" {
		t.Errorf("%+v", p.Records[2])
	}
}

func TestMessyButValidFormatsAreAccepted(t *testing.T) {
	clean := strings.Replace(clean, `"Mar 31, 2027"`, "2027-03-31", 1) // so swapping delimiters below cannot split the date
	cases := map[string]string{
		"BOM":              "\xef\xbb\xbf" + clean,
		"CRLF":             strings.ReplaceAll(clean, "\n", "\r\n"),
		"semicolons":       strings.ReplaceAll(strings.ReplaceAll(clean, `"$120,000"`, "120000"), ",", ";"),
		"tabs":             strings.ReplaceAll(strings.ReplaceAll(clean, `"$120,000"`, "120000"), ",", "\t"),
		"blank lines":      strings.Replace(clean, "\nRaj", "\n\n\nRaj", 1),
		"no final newline": strings.TrimSuffix(clean, "\n"),
		"pipes":            strings.ReplaceAll(strings.ReplaceAll(clean, `"$120,000"`, "120000"), ",", "|"),
	}
	for name, in := range cases {
		p, err := Parse([]byte(in), nil)
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		if len(p.Records) != 3 || p.ErrorCount != 0 {
			t.Errorf("%s: records=%d errors=%v", name, len(p.Records), p.Errors)
		}
	}
}

func TestQuotedFieldsWithCommasAndNewlines(t *testing.T) {
	in := "name,email,company\n\"Lee, Dana\",dana@acme.com,\"Acme, Inc.\"\n\"Multi\nLine\",m@x.io,\"Say \"\"hi\"\" Co\"\n"
	p := mustParse(t, in, nil)
	if len(p.Records) != 2 || p.Records[0].Name != "Lee, Dana" || p.Records[0].Account != "Acme, Inc." || p.Records[1].Account != `Say "hi" Co` {
		t.Fatalf("%+v %v", p.Records, p.Errors)
	}
}

func TestSwappedAndRenamedColumnsStillMap(t *testing.T) {
	in := "Contract Value,Organisation,E-mail,Full Name\n9000,Initech,pete@initech.com,Pete Gibbons\n"
	p := mustParse(t, in, nil)
	if p.Mapping[FieldRevenue] != "Contract Value" || p.Mapping[FieldAccount] != "Organisation" || p.Mapping[FieldEmail] != "E-mail" || p.Mapping[FieldName] != "Full Name" {
		t.Fatalf("%v", p.Mapping)
	}
	if p.Records[0].Name != "Pete Gibbons" || p.Records[0].Revenue != "9000" {
		t.Fatalf("%+v", p.Records[0])
	}
	// An explicit mapping overrides detection.
	p = mustParse(t, "a,b,c\nx,y@z.io,Acme\n", Mapping{FieldName: "a", FieldEmail: "b", FieldAccount: "c"})
	if p.Records[0].Account != "Acme" {
		t.Fatalf("%+v", p.Records)
	}
}

func TestEveryProblemNamesItsRowAndColumn(t *testing.T) {
	in := `Name,Email,Company,ARR,Renewal
Dana,not-an-email,Acme,100,2026-01-01
,,Acme,100,2026-01-01
Raj,raj@x.io,Acme,twelve,2026-01-01
Sam,sam@x.io,Acme,100,01/02/2026
Pat,pat@x.io,Acme,100
Kim,kim@x.io,,500,2026-01-01
Good,good@x.io,Globex,10,2026-01-01
`
	p := mustParse(t, in, nil)
	if len(p.Records) != 1 || p.Records[0].Name != "Good" {
		t.Fatalf("only the good row may survive: %+v", p.Records)
	}
	want := map[int]string{2: "Email", 3: "Name", 4: "ARR", 5: "Renewal", 6: "", 7: "Company"}
	got := map[int]string{}
	for _, e := range p.Errors {
		got[e.Row] = e.Column
		if e.Message == "" {
			t.Errorf("blank message for %v", e)
		}
	}
	for row, col := range want {
		if c, ok := got[row]; !ok || c != col {
			t.Errorf("row %d: want error on column %q, got %q (present=%v) all=%v", row, col, c, ok, p.Errors)
		}
	}
}

func TestConflictingAccountValuesAreCaughtAcrossRows(t *testing.T) {
	in := "Name,Company,ARR\nA,Acme,100\nB,acme,100\nC,ACME,250\nD,Globex,5\n"
	p := mustParse(t, in, nil)
	if p.ErrorCount != 1 || p.Errors[0].Row != 4 || p.Errors[0].Column != "ARR" || !strings.Contains(p.Errors[0].Message, "row 2") {
		t.Fatalf("%+v", p.Errors)
	}
	if len(p.Records) != 3 {
		t.Fatalf("records=%d", len(p.Records))
	}
}

func TestFileLevelProblemsAreExplained(t *testing.T) {
	big := "Name,Email\n" + strings.Repeat("x,y@z.io\n", MaxCSVBytes/8)
	cases := map[string]string{
		"empty":         "",
		"header only":   "Name,Email\n",
		"no person col": "Company,ARR\nAcme,100\n",
		"invalid utf8":  "Name,Email\n\xff\xfe,a@b.io\n",
		"nul byte":      "Name,Email\na\x00b,a@b.io\n",
		"too large":     big,
	}
	for name, in := range cases {
		if _, err := Parse([]byte(in), nil); err == nil {
			t.Errorf("%s accepted", name)
		} else if _, ok := err.(ErrFile); !ok {
			t.Errorf("%s: %T %v", name, err, err)
		}
	}
	if _, err := Parse([]byte("a,b\n1,2\n"), Mapping{FieldName: "nope"}); err == nil {
		t.Error("mapping to a missing column accepted")
	}
}

func TestBrokenQuotingStopsWithAnErrorNotAGuess(t *testing.T) {
	in := "Name,Email\nDana,\"dana@x.io\nRaj,raj@x.io\nSam,sam@x.io\n"
	p := mustParse(t, in, nil)
	if p.ErrorCount == 0 || len(p.Records) != 0 {
		t.Fatalf("records=%d errors=%v", len(p.Records), p.Errors)
	}
}

func TestLimitsAndErrorCaps(t *testing.T) {
	var b strings.Builder
	b.WriteString("Name,Email\n")
	for i := 0; i < 500; i++ {
		fmt.Fprintf(&b, "p%d,bad-email\n", i)
	}
	p := mustParse(t, b.String(), nil)
	if p.ErrorCount != 500 || len(p.Errors) != maxErrors {
		t.Fatalf("count=%d listed=%d", p.ErrorCount, len(p.Errors))
	}
	var many strings.Builder
	many.WriteString("Name,Email\n")
	for i := 0; i <= MaxCSVRows; i++ {
		fmt.Fprintf(&many, "p%d,p%d@x.io\n", i, i)
	}
	if _, err := Parse([]byte(many.String()), nil); err == nil || !strings.Contains(err.Error(), "too many rows") {
		t.Fatalf("row limit: %v", err)
	}
}

func TestFiftyThousandRowsParseQuickly(t *testing.T) {
	var b strings.Builder
	b.WriteString("Name,Email,Company,ARR\n")
	for i := 0; i < MaxCSVRows; i++ {
		fmt.Fprintf(&b, "Person %d,p%d@co%d.io,Company %d,%d\n", i, i, i%2000, i%2000, 1000+i%2000)
	}
	p := mustParse(t, b.String(), nil)
	if len(p.Records) != MaxCSVRows || p.ErrorCount != 0 {
		t.Fatalf("records=%d errors=%d (%v)", len(p.Records), p.ErrorCount, p.Errors[:min(3, len(p.Errors))])
	}
}

func TestRevenueAndDateParsing(t *testing.T) {
	for in, want := range map[string]string{"100": "100", "$1,000": "1000", "1,234,567.89": "1234567.89", " 5.5 ": "5.5", "$ 10": "10"} {
		if got, err := parseRevenue(in); err != nil || got != want {
			t.Errorf("revenue %q: %q %v", in, got, err)
		}
	}
	for _, bad := range []string{"", "abc", "-5", "1.234", "12,34", "1e6", "NaN", "99999999999999"} {
		if _, err := parseRevenue(bad); err == nil {
			t.Errorf("revenue %q accepted", bad)
		}
	}
	for in, want := range map[string]string{"2026-02-28": "2026-02-28", "Feb 28, 2026": "2026-02-28", "28 February 2026": "2026-02-28"} {
		if got, err := parseDate(in); err != nil || got != want {
			t.Errorf("date %q: %q %v", in, got, err)
		}
	}
	for _, bad := range []string{"", "01/02/2026", "2026-02-30", "1850-01-01", "soon"} {
		if _, err := parseDate(bad); err == nil {
			t.Errorf("date %q accepted", bad)
		}
	}
}

func FuzzParse(f *testing.F) {
	f.Add([]byte(clean))
	f.Add([]byte("a,b\n\"x\n"))
	f.Add([]byte("\xef\xbb\xbfName;Email\nA;a@b.io\n"))
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > 1<<16 {
			t.Skip()
		}
		p, err := Parse(data, nil) // must never panic
		if err != nil {
			return
		}
		for _, r := range p.Records {
			if r.Name == "" && r.Email == "" {
				t.Fatalf("record without a person: %+v", r)
			}
			if r.Revenue != "" {
				if _, e := parseRevenue(r.Revenue); e != nil {
					t.Fatalf("stored revenue does not parse: %q", r.Revenue)
				}
			}
		}
	})
}
