package api

import (
	"net/http/httptest"
	"testing"

	"github.com/johannesboyne/gofakes3"
	"github.com/johannesboyne/gofakes3/backend/s3mem"

	"product/api/internal/storage"
)

// fakeS3Store is a store on an in-process S3 server (the protocol Supabase Storage speaks).
func fakeS3Store(t *testing.T) storage.Store {
	t.Helper()
	backend := s3mem.New()
	if err := backend.CreateBucket("media"); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(gofakes3.New(backend).Server())
	t.Cleanup(srv.Close)
	s, err := storage.NewS3(storage.S3Config{Endpoint: srv.URL, Region: "us-east-1", Bucket: "media", AccessKeyID: "test", SecretAccessKey: "test-secret"})
	if err != nil {
		t.Fatal(err)
	}
	return s
}
