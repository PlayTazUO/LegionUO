# Contributing to LegionUO

Thanks for helping improve LegionUO. This project is a browser-based Ultima
Online client with a Node.js asset server, so changes usually touch one of three
areas:

- `client/` - browser client (rendering, networking, UI, assets, crypto)
- `server/` - asset decoding and the WebSocket TCP relay
- `tools/` - synthetic test data, the mock shard and test scripts

## Getting started

1. Install Node.js 18 or newer (Node 20 is used in CI).
2. Fork the repository and clone your fork.
3. Create a local config from the template:

   ```bash
   cp config.example.json config.json
   ```

4. Set `uoDir` in `config.json` to your UO installation, or pass `--uo-dir`.
5. Start the server:

   ```bash
   npm start
   ```

No `npm install` is required because the project has no runtime dependencies.

### Testing without UO data

`tools/make-test-data.mjs` creates a small synthetic data directory and
`tools/mock-uo.mjs` is a mock login/game shard. See the README for the exact
commands. This is the fastest way to reproduce world, gump and packet issues.

## Before opening a pull request

Run both checks:

```bash
npm run check
npm test
```

`npm run check` parses every JavaScript file with `node --check`. `npm test`
generates the synthetic data, starts the server on a free port and verifies the
core HTTP endpoints.

If you changed networking or rendering behaviour, also exercise the change
against the mock shard or a real shard and describe what you tested in the pull
request.

## Coding style

- Keep the existing structure, naming and formatting of the file you edit.
- Use modern ES modules, `const`/`let`, and two-space indentation.
- Prefer small, focused functions over large refactors.
- Do not add runtime dependencies without discussing it first. The zero-dependency
  design is deliberate.
- Keep client/server boundaries intact: the browser must not read local files
  directly, and the server must not hold shard credentials.
- Do not commit generated test data, local configuration, certificates, logs or
  editor/OS files.

## Commit and pull request guidelines

- Write commit messages in the imperative mood, for example
  `Fix mobile journal resize` rather than `Fixed mobile journal resize`.
- Keep each pull request focused. Separate unrelated refactors from bug fixes.
- Describe the user-visible change, the reason for it, and how you tested it.
- Link related issues with `Fixes #123` or `Refs #123`.
- Update the README when you add or change a config option, endpoint or script.
- Add or update the synthetic test data if a decoder change depends on a new
  format.

## Reporting bugs and requesting features

Use the issue templates. Include your OS, Node.js version, browser, shard type
and the relevant server/browser logs. Redact account names, passwords, server
addresses, `webIdentitySecret` and `shutdownPassphrase` before posting.

For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a
public issue.

## License

By contributing, you agree that your contributions are licensed under the
BSD 2-Clause License used by this project. See [LICENSE.md](LICENSE.md).
