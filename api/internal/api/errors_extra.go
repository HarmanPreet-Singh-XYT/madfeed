package api

import "errors"

var errNoAuth = errors.New("api: a TokenVerifier is required")
