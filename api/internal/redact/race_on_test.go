//go:build race

package redact

// The race detector makes regular expressions about 20 times slower.
const slowdown = 25
