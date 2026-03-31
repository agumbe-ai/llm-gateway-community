# Publishing Checklist

This repository is prepared to publish the community gateway to npm as `@agumbe/llm-gateway-community`.

## Package decision

- Package name: `@agumbe/llm-gateway-community`
- CLI name: `llm-gateway-community`
- Visibility: public scoped package
- Current initial version: `0.1.0`

## Before first publish

- Confirm the npm organization or user account has access to the `@agumbe` scope.
- Confirm `npm whoami` matches the account that can publish `@agumbe/*`.
- Review `README.md`, `LICENSE`, and `.env.example`.
- Confirm the release branch contains only community-edition changes.
- Run `npm install`.
- Run `npm run test:ci`.
- Run `npm run build`.
- Run `npm pack --dry-run`.

## First publish

```bash
npm publish --access public
```

## Release hygiene

- Create a git tag that matches the package version, for example `v0.1.0`.
- Push the release branch.
- Push the tag.
- Verify the package page on npm includes the README and license.
- Verify `npx @agumbe/llm-gateway-community` works from a clean directory.

## Future releases

1. Update `package.json` version.
2. Run `npm run test:ci`.
3. Run `npm run build`.
4. Run `npm pack --dry-run`.
5. Commit the release changes.
6. Create and push the matching git tag.
7. Run `npm publish --access public`.
