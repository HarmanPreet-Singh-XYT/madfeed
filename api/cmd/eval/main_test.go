package main

import "testing"

func TestReportCountsOnlyMetricsBelowTheirThreshold(t *testing.T) {
	th := thresholds{"qa": {"a": 0.8, "b": 0.9}}
	if n := report(map[string]metrics{"qa": {"a": 0.80, "b": 0.95}}, th); n != 0 {
		t.Errorf("meeting a threshold exactly (or beating one) must pass: %d failures", n)
	}
	if n := report(map[string]metrics{"qa": {"a": 0.79, "b": 0.5}}, th); n != 2 {
		t.Errorf("two metrics are below: %d", n)
	}
	// A metric with no threshold is shown but cannot fail; a threshold with no result is not a failure either
	// (the suite was simply not run).
	if n := report(map[string]metrics{"qa": {"extra": 0.0}}, th); n != 0 {
		t.Errorf("%d", n)
	}
}

func TestRatioOfNothingIsFullMarksBecauseRecallCatchesEmptiness(t *testing.T) {
	if ratio(0, 0) != 1 || ratio(1, 2) != 0.5 {
		t.Error("ratio")
	}
}
