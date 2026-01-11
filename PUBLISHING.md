# Publishing to npm

This document is for maintainers publishing Lisa to npm.

## Prerequisites

1. npm account with publish access to `@tonycasey/lisa`
2. Logged in: `npm login`
3. All changes committed and pushed
4. Tests passing

## Pre-Release Checklist

- [ ] Update version in `package.json`
- [ ] Update `CHANGELOG.md` with release notes
- [ ] Run `npm run build` successfully
- [ ] Run `npm test` with all tests passing
- [ ] Run `npm run lint` with no errors
- [ ] Test package locally (see below)

## Testing Before Publish

```bash
# Create tarball
npm pack

# Test in a fresh directory
mkdir ~/test-lisa && cd ~/test-lisa
npm install -g ../path/to/lisa-0.x.x.tgz

# Verify CLI works
lisa --version
lisa doctor

# Test setup in a project
mkdir test-project && cd test-project
lisa init -y
lisa doctor

# Clean up
npm uninstall -g @tonycasey/lisa
cd ~ && rm -rf test-lisa
```

## Publish

```bash
# Ensure you're on main branch
git checkout main
git pull

# Build
npm run build

# Publish (will prompt for 2FA if enabled)
npm publish

# Verify
npm info @tonycasey/lisa
```

## Post-Release

1. Create git tag:
   ```bash
   git tag v0.x.x
   git push origin v0.x.x
   ```

2. Create GitHub release with changelog notes

3. Announce release (if applicable)

## Version Strategy

- **0.x.x** - Pre-release, breaking changes allowed
- **1.0.0** - First stable release
- **1.x.x** - Semantic versioning (major.minor.patch)

## Troubleshooting

### "You must be logged in"

```bash
npm login
```

### "Permission denied"

Verify you have publish access to `@tonycasey` scope.

### "Version already exists"

Bump version in `package.json` and rebuild.
