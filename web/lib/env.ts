// Public, non-secret settings only. Anything secret lives in the Go API.
export const apiBaseUrl =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8080";
