# Local Secret Files

The production Compose service mounts this directory read-only at `/run/secrets`.

Place one secret per file and point the matching `*_FILE` environment variable in `.env` at its container path. For example, set `APP_SECRET_FILE=/run/secrets/app_secret` and create `secrets/app_secret` with at least 32 random characters.

Do not add secret values to Git. The application can also create persistent local keys under `/data/.secrets` when no file or environment value is configured.
