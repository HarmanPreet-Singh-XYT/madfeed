package fulltext

import "testing"

func TestQueryKeepsOnlyWordsAndCapsTheWork(t *testing.T) {
	cases := map[string]string{
		"":                            "",
		"   ":                         "",
		"sign-on":                     "sign & on",
		"the export is slow":          "the & export & is & slow",
		"a & b | c ! d":               "a & b & c & d",
		"'; DROP TABLE highlight; --": "DROP & TABLE & highlight",
		"one two three four five six seven eight nine ten": "one & two & three & four & five & six & seven & eight",
	}
	for in, want := range cases {
		if got := Query(in); got != want {
			t.Errorf("Query(%q) = %q, want %q", in, got, want)
		}
	}
}
