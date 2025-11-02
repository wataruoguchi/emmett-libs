# Scripts

Utility scripts for maintaining the monorepo.

## fix-npm-dist-tag.sh

Fixes npm dist-tags for packages when they get out of sync.

### Usage

```bash
./scripts/fix-npm-dist-tag.sh <package-name> <target-version>
```

### Example

```bash
# Fix the dist-tag for emmett-event-store-kysely to point to version 2.1.0
./scripts/fix-npm-dist-tag.sh @wataruoguchi/emmett-event-store-kysely 2.1.0
```

### When to use

This script is useful when:
- The npm `latest` dist-tag is pointing to an old version
- After manually publishing versions that bypassed semantic-release
- When recovering from version sync issues

### Note

Requires npm authentication. Make sure you're logged in with `npm login` or have `NPM_TOKEN` set in your environment.
