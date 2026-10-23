package storage_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/google/uuid"

	"product/api/internal/storage"
)

var ctx = context.Background()

func TestAppendIsResumableAndRefusesWrongOffsets(t *testing.T) {
	l := &storage.Local{Dir: t.TempDir()}
	key := storage.Key(uuid.New(), uuid.New())
	n, err := l.Append(ctx, key, 0, strings.NewReader("hello "))
	if err != nil || n != 6 {
		t.Fatalf("%d %v", n, err)
	}
	// A retried chunk (same offset again) and a skipped chunk are both refused, leaving the file intact.
	for _, off := range []int64{0, 3, 99} {
		if _, err := l.Append(ctx, key, off, strings.NewReader("XX")); !errors.Is(err, storage.ErrBadOffset) {
			t.Errorf("offset %d: %v", off, err)
		}
	}
	if n, err := l.Append(ctx, key, 6, strings.NewReader("world")); err != nil || n != 11 {
		t.Fatalf("%d %v", n, err)
	}
	o, err := l.Open(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	defer o.Close()
	b, _ := io.ReadAll(o)
	if string(b) != "hello world" || o.Size() != 11 {
		t.Fatalf("%q %d", b, o.Size())
	}
	if sz, _ := l.Size(ctx, key); sz != 11 {
		t.Fatal(sz)
	}
}

type failingReader struct{ n int }

func (f *failingReader) Read(p []byte) (int, error) {
	if f.n == 0 {
		return 0, errors.New("connection reset")
	}
	f.n--
	return copy(p, "abc"), nil
}

func TestAHalfWrittenChunkLeavesNoTrace(t *testing.T) {
	l := &storage.Local{Dir: t.TempDir()}
	key := storage.Key(uuid.New(), uuid.New())
	_, _ = l.Append(ctx, key, 0, strings.NewReader("0123"))
	if _, err := l.Append(ctx, key, 4, &failingReader{n: 3}); err == nil {
		t.Fatal("expected the failure")
	}
	if sz, _ := l.Size(ctx, key); sz != 4 {
		t.Fatalf("size after a failed chunk: %d, want 4", sz)
	}
	if n, err := l.Append(ctx, key, 4, bytes.NewReader([]byte("45"))); err != nil || n != 6 {
		t.Fatalf("resume: %d %v", n, err)
	}
}

func TestKeysCannotEscapeTheDirectory(t *testing.T) {
	l := &storage.Local{Dir: t.TempDir()}
	for _, k := range []string{"", "../etc/passwd", "a/b", "/abs/path", uuid.NewString(), uuid.NewString() + "/../" + uuid.NewString(), uuid.NewString() + "/" + uuid.NewString() + "/x", "UPPER/CASE"} {
		if _, err := l.Append(ctx, k, 0, strings.NewReader("x")); !errors.Is(err, storage.ErrBadKey) {
			t.Errorf("%q: %v", k, err)
		}
		if err := l.Delete(ctx, k); !errors.Is(err, storage.ErrBadKey) {
			t.Errorf("delete %q: %v", k, err)
		}
	}
}

func TestMissingObjectsAndDeleteAreIdempotent(t *testing.T) {
	l := &storage.Local{Dir: t.TempDir()}
	key := storage.Key(uuid.New(), uuid.New())
	if _, err := l.Open(ctx, key); !errors.Is(err, storage.ErrNotFound) {
		t.Fatal(err)
	}
	if err := l.Delete(ctx, key); err != nil {
		t.Fatal(err)
	}
	_, _ = l.Append(ctx, key, 0, strings.NewReader("x"))
	if keys, _ := l.Keys(ctx); len(keys) != 1 || keys[0] != key {
		t.Fatalf("%v", keys)
	}
	_ = l.Delete(ctx, key)
	if keys, _ := l.Keys(ctx); len(keys) != 0 {
		t.Fatalf("%v", keys)
	}
}
