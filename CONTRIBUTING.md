# Contributing

Thanks for contributing to `llm-gateway`.

## How We Work

- Open an issue or start a short design discussion before making large changes.
- Keep pull requests focused. Small, reviewable changes are preferred over broad refactors.
- Preserve backward compatibility for the public HTTP API unless the change is explicitly planned as breaking.
- Add or update tests when behavior changes.
- Update docs and example configuration when you add or remove runtime options.

## Development

```bash
npm install
cp .env.example .env
npm run build
npm run test:ci
```

## Pull Request Checklist

- The code builds locally.
- Tests were added or updated when needed.
- Docs were updated for user-visible changes.
- Secrets, tokens, and environment-specific values were not committed.
- Breaking changes are called out clearly in the PR description.

## Commit and Review Expectations

- Prefer descriptive commit messages.
- Keep implementation details and rationale in the PR description when the change is non-obvious.
- Be responsive to review feedback and ask for clarification when needed.

## Security

Do not open public issues for security-sensitive bugs. Follow the process in [SECURITY.md](./SECURITY.md).
