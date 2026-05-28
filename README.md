# MFDS Regulatory PWA V1

Node/React/Vite + Express + Render version.

## Structure

```text
client/
server/
server/src/collectors/
package.json
render.yaml
render-build.sh
supabase_schema.sql
```

## Collector policy

- Fast collection: official MFDS RSS first, HTML fallback, detail-page registration-date verification.
- Period collection: HTML page traversal and detail-page registration-date verification.
- Zero-candidate collection is reported as warning, not silent success.

## Health check

```text
/api/health
```

Expected API version:

```text
v1-node-render-mfds-collector-rebuild
```
