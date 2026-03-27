# Governance

## Project Stewardship

`llm-gateway` is currently maintained by the repository owners and designated maintainers.

## Decision Making

- Maintainers are responsible for roadmap, architecture, release readiness, and security response.
- Significant API, auth, storage, or provider-behavior changes should be reviewed before merge.
- When consensus is unclear, maintainers make the final decision and document the reasoning in the relevant issue or pull request.

## Change Management

- Public API compatibility should be preserved by default.
- Breaking changes should be intentional, documented, and called out ahead of release.
- Internal or deployment-specific coupling should be avoided unless clearly documented.

## Release Readiness

Before public release, maintainers should confirm:

- sensitive environment and infrastructure references are removed or generalized
- repo documentation matches the supported public product boundary
- dependency, security, and operational expectations are documented

## Maintainer Expectations

Maintainers are expected to:

- review contributions in a timely way
- communicate clearly about scope and tradeoffs
- keep security and user trust ahead of speed
- avoid committing secrets or environment-specific credentials
