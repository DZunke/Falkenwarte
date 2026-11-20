# Local Secret Files

The production Compose service mounts this directory read-only at `/run/secrets`.

Place one secret per file and point the matching `*_FILE` environment variable in the untracked `.env.local` file at its container path. The `app-up`, `app-down`, and `app-logs` Make targets load `.env.local` after `.env`, so it can override shared defaults. For example, set `APP_SECRET_FILE=/run/secrets/app_secret` and create `secrets/app_secret` with at least 32 random characters.

Do not add secret values or secret files to Git. The application can also create persistent local keys under `/data/.secrets` when no file or environment value is configured.
