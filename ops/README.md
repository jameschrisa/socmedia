# Operator credentials

Keys used to administer the hosting accounts. None of them are used by the running
application: the API and client never read these. They exist so deploys, environment changes
and health checks can be driven from this machine.

## How to hand over a key without putting it in a conversation

1. `cp ops/.env.ops.example ops/.env.ops` (already done if the file exists)
2. `chmod 600 ops/.env.ops`
3. Open it in an editor and paste the values in. The file is gitignored.
4. `bash ops/check.sh`

The checker reports `ok`, `not set` or `FAILED` per credential and never prints a value, so its
output is safe to share. Commands that need a key read it from the file at run time:

```bash
set -a; . ops/.env.ops; set +a
curl -s -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/$RENDER_SERVICE_ID" | jq .name
```

## GitHub is different, and simpler

The GitHub token stays in the macOS keychain rather than in this file, because git already puts
it there and it can be read back programmatically without ever being displayed. To replace it,
run these yourself in a terminal:

```bash
printf "protocol=https\nhost=github.com\n" | git credential-osxkeychain erase
printf "protocol=https\nhost=github.com\nusername=jameschrisa\npassword=NEW_TOKEN\n\n" | git credential-osxkeychain store
```

Give the replacement `workflow` scope (classic token) or Workflows set to *Read and write*
(fine-grained), which is also what the CI workflow needs in order to be pushed. Then
`bash ops/check.sh` confirms both the token and the scope.

## What each key can do

| Credential | Scope of damage if leaked | Replace by |
| --- | --- | --- |
| GitHub token | Push code to a repository that deploys to production | Keychain, as above |
| Render API key | Read and change every API environment variable, redeploy, delete the service | Render → Account Settings → API Keys |
| Vercel token | Redeploy or reconfigure the client, read its environment | Vercel → Account Settings → Tokens |

Revoking the Render or Vercel key breaks nothing in the running application. It only removes the
ability to administer those accounts from here until a new one is filled in.

## Not in this file

The application's own secrets live on the API host as environment variables and are never copied
here: the session signing key, the platform OAuth client secrets, the AI provider keys and the
mail provider key. `SECRET_KEY` in particular should never be rotated casually, because it both
signs session cookies and encrypts stored platform credentials at rest.
