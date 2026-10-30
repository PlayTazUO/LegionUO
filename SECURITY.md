# Security Policy

## Supported versions

LegionUO is developed on the `main` branch. Security fixes are applied there;
older snapshots are not maintained separately.

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private
vulnerability reporting:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Include a description, affected files or endpoints, reproduction steps and
   any suggested fix.

If private reporting is unavailable, contact the maintainers through the
repository and ask for a private channel before sharing details.

We aim to acknowledge reports within a few days. Please allow time for a fix and
a coordinated disclosure before publishing details.

## Scope

Useful reports include, but are not limited to:

- Path traversal or arbitrary file reads in the asset server
- Authentication bypass on the `?shutdown` endpoint
- Server-side request forgery or host allow-list bypass in the relay
- Memory exhaustion or denial of service from crafted assets or packets
- Cross-site scripting in gump, journal or chat rendering
- Leaked secrets in the repository or build output

## Deployment hardening

LegionUO is a local-first development client. Before exposing it beyond
localhost:

- Keep `host` on `127.0.0.1` unless remote access is required.
- Set `allowProxyHosts` to the exact login hosts you trust. An empty list allows
  the relay to connect to any host.
- Terminate TLS with `httpsPort` or a reverse proxy. Do not send credentials over
  plain HTTP on an untrusted network.
- Set a long random `shutdownPassphrase`, or leave it empty to keep the endpoint
  disabled.
- Never commit `config.json`, `webIdentitySecret`, `shutdownPassphrase`,
  certificates or private keys.
- Treat the relay as security-sensitive infrastructure: it forwards raw TCP bytes
  on behalf of remote clients.

## If a secret is committed

Rotate the secret first; removing it from history does not make it private again.
Then purge it from the repository history with `git filter-repo` or the BFG
Repo-Cleaner and force-push the rewritten branches. Revoke any credentials that
may have been exposed while the secret was public.

## Credentials in the browser

The optional "Remember account/password" feature stores credentials in
`localStorage` in plain text. It is opt-in and intended for trusted machines
only. The asset server itself never stores account credentials.
