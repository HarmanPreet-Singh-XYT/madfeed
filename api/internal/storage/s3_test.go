package storage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"math/rand/v2"
	"net/http/httptest"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/google/uuid"
	"github.com/johannesboyne/gofakes3"
	"github.com/johannesboyne/gofakes3/backend/s3mem"
)

// newFakeS3 runs an in-process S3 (the same protocol Supabase Storage speaks) and returns a store on it.
func newFakeS3(t *testing.T) *S3 {
	t.Helper()
	backend := s3mem.New()
	if err := backend.CreateBucket("media"); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(gofakes3.New(backend).Server())
	t.Cleanup(srv.Close)
	s, err := NewS3(S3Config{Endpoint: srv.URL, Region: "us-east-1", Bucket: "media", AccessKeyID: "test", SecretAccessKey: "test-secret"})
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func randomBytes(n int, seed uint64) []byte {
	r := rand.New(rand.NewPCG(seed, seed))
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(r.UintN(256))
	}
	return b
}

func newKey() string { return Key(uuid.New(), uuid.New()) }

func TestS3ResumableUploadJoinsIntoOneObject(t *testing.T) {
	ctx := context.Background()
	s := newFakeS3(t)
	key := newKey()
	// pieces of unequal sizes, small and large, 21 MB in all: more than two multipart parts when joined
	sizes := []int{1_000, 6_500_000, 123, 9_000_000, 5_400_000}
	var all []byte
	var off int64
	for i, n := range sizes {
		piece := randomBytes(n, uint64(i+1))
		got, err := s.Append(ctx, key, off, bytes.NewReader(piece))
		if err != nil || got != off+int64(n) {
			t.Fatalf("append %d: %d %v", i, got, err)
		}
		off = got
		all = append(all, piece...)
		if sz, err := s.Size(ctx, key); err != nil || sz != off {
			t.Fatalf("size mid-upload: %d %v, want %d", sz, err, off)
		}
	}
	// a repeated or skipped piece is refused and changes nothing
	if _, err := s.Append(ctx, key, 0, bytes.NewReader([]byte("again"))); !errors.Is(err, ErrBadOffset) {
		t.Errorf("repeat at offset 0: %v", err)
	}
	if _, err := s.Append(ctx, key, off+10, bytes.NewReader([]byte("skip"))); !errors.Is(err, ErrBadOffset) {
		t.Errorf("skipping ahead: %v", err)
	}
	if sz, _ := s.Size(ctx, key); sz != off {
		t.Fatalf("a refused write changed the size to %d", sz)
	}

	o, err := s.Open(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	defer o.Close()
	if o.Size() != int64(len(all)) {
		t.Fatalf("size %d, want %d", o.Size(), len(all))
	}
	got, err := io.ReadAll(o)
	if err != nil || sha256.Sum256(got) != sha256.Sum256(all) {
		t.Fatalf("content differs after joining (%v)", err)
	}
	// seeking reads the right bytes without reading the rest
	if _, err := o.Seek(7_000_000, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	chunk := make([]byte, 5000)
	if _, err := io.ReadFull(o, chunk); err != nil || !bytes.Equal(chunk, all[7_000_000:7_005_000]) {
		t.Errorf("range read after seek differs (%v)", err)
	}
	if _, err := o.Seek(-100, io.SeekEnd); err != nil {
		t.Fatal(err)
	}
	tail, _ := io.ReadAll(o)
	if !bytes.Equal(tail, all[len(all)-100:]) {
		t.Error("tail differs")
	}

	// the pieces are gone; only the finished object remains, and it is the only key listed
	if ps, _ := s.pieces(ctx, key); len(ps) != 0 {
		t.Errorf("%d pieces left behind", len(ps))
	}
	keys, _ := s.Keys(ctx)
	if len(keys) != 1 || keys[0] != key {
		t.Errorf("keys: %v", keys)
	}
	// a finished object takes no more writes
	if _, err := s.Append(ctx, key, int64(len(all)), bytes.NewReader([]byte("more"))); !errors.Is(err, ErrBadOffset) {
		t.Errorf("appending to a finished object: %v", err)
	}
	if ps, _ := s.pieces(ctx, key); len(ps) != 0 {
		t.Error("a refused append left a piece behind")
	}
}

func TestS3TruncateAndDelete(t *testing.T) {
	ctx := context.Background()
	s := newFakeS3(t)
	key := newKey()
	off := int64(0)
	for i := 0; i < 3; i++ {
		off, _ = s.Append(ctx, key, off, bytes.NewReader(randomBytes(1000, uint64(i))))
	}
	// an over-size piece is taken back out, to the boundary before it
	if err := s.Truncate(ctx, key, 2000); err != nil {
		t.Fatal(err)
	}
	if sz, _ := s.Size(ctx, key); sz != 2000 {
		t.Errorf("size after truncate: %d", sz)
	}
	if err := s.Truncate(ctx, key, 1500); !errors.Is(err, ErrBadOffset) {
		t.Errorf("truncating inside a piece: %v", err)
	}
	// the upload continues from the boundary
	if got, err := s.Append(ctx, key, 2000, bytes.NewReader(randomBytes(500, 9))); err != nil || got != 2500 {
		t.Errorf("continue: %d %v", got, err)
	}
	if err := s.Delete(ctx, key); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Size(ctx, key); !errors.Is(err, ErrNotFound) {
		t.Errorf("size after delete: %v", err)
	}
	if err := s.Delete(ctx, key); err != nil {
		t.Errorf("deleting a missing object must not fail: %v", err)
	}
	if keys, _ := s.Keys(ctx); len(keys) != 0 {
		t.Errorf("keys after delete: %v", keys)
	}
}

func TestS3KeyShapeAndMissingObjects(t *testing.T) {
	ctx := context.Background()
	s := newFakeS3(t)
	for _, bad := range []string{"../etc/passwd", "a/b", "", newKey() + "/x", "../../" + newKey()} {
		if _, err := s.Append(ctx, bad, 0, bytes.NewReader([]byte("x"))); !errors.Is(err, ErrBadKey) {
			t.Errorf("Append(%q): %v", bad, err)
		}
		if _, err := s.Open(ctx, bad); !errors.Is(err, ErrBadKey) {
			t.Errorf("Open(%q): %v", bad, err)
		}
	}
	if _, err := s.Open(ctx, newKey()); !errors.Is(err, ErrNotFound) {
		t.Errorf("open missing: %v", err)
	}
	if _, err := s.Size(ctx, newKey()); !errors.Is(err, ErrNotFound) {
		t.Errorf("size missing: %v", err)
	}
	// someone else's objects in the same bucket are not ours
	if _, err := s.Client.PutObject(ctx, &s3.PutObjectInput{Bucket: aws.String("media"), Key: aws.String("unrelated.txt"), Body: bytes.NewReader([]byte("x"))}); err != nil {
		t.Fatal(err)
	}
	if keys, _ := s.Keys(ctx); len(keys) != 0 {
		t.Errorf("keys include foreign objects: %v", keys)
	}
}

func TestS3RequiresItsSettings(t *testing.T) {
	for _, c := range []S3Config{{}, {Bucket: "b"}, {Bucket: "b", Region: "r"}, {Bucket: "b", Region: "r", AccessKeyID: "k"}} {
		if _, err := NewS3(c); err == nil {
			t.Errorf("accepted %+v", c)
		}
	}
}
