# The API and worker are one binary (APP_MODE=api|worker); the migration tool is a second.
FROM golang:1.27.3 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ENV CGO_ENABLED=0
RUN go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server \
 && go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate

# No shell, no package manager, not root.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/server /out/migrate /app/
# Model routing ships with the image: ids and prices only, never a key. AI_CONFIG points here.
COPY --from=build /src/config/ai.production.json /app/config/ai.production.json
WORKDIR /app
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/app/server"]
