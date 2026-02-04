# Greasyfork Publishing Workflow

## Overview

This document describes the process for publishing and maintaining the library-split version of Toolasha on Greasyfork.

## Prerequisites

- Greasyfork account with access to Toolasha script
- GitHub repository with library-split branch merged
- All libraries built and tested locally
- Core library optimized to under 2MB (if needed)

## Initial Setup

### 1. Create Library Entries on Greasyfork

Create 6 separate library entries:

1. **Toolasha Core Library**
    - Name: `Toolasha Core Library`
    - Type: Library
    - Sync: GitHub (raw file URL for `dist/libraries/toolasha-core.user.js`)

2. **Toolasha Utils Library**
    - Name: `Toolasha Utils Library`
    - Type: Library
    - Sync: GitHub (raw file URL for `dist/libraries/toolasha-utils.user.js`)

3. **Toolasha Market Library**
    - Name: `Toolasha Market Library`
    - Type: Library
    - Sync: GitHub (raw file URL for `dist/libraries/toolasha-market.user.js`)

4. **Toolasha Actions Library**
    - Name: `Toolasha Actions Library`
    - Type: Library
    - Sync: GitHub (raw file URL for `dist/libraries/toolasha-actions.user.js`)

5. **Toolasha Combat Library**
    - Name: `Toolasha Combat Library`
    - Type: Library
    - Sync: GitHub (raw file URL for `dist/libraries/toolasha-combat.user.js`)

6. **Toolasha UI Library**
    - Name: `Toolasha UI Library`
    - Type: Library
    - Sync: GitHub (raw file URL for `dist/libraries/toolasha-ui.user.js`)

### 2. Get Library URLs

After creating each library entry, Greasyfork will assign a stable URL:

```
https://greasyfork.org/scripts/XXXXX-toolasha-core-library/code/toolasha-core.user.js
https://greasyfork.org/scripts/XXXXX-toolasha-utils-library/code/toolasha-utils.user.js
https://greasyfork.org/scripts/XXXXX-toolasha-market-library/code/toolasha-market.user.js
https://greasyfork.org/scripts/XXXXX-toolasha-actions-library/code/toolasha-actions.user.js
https://greasyfork.org/scripts/XXXXX-toolasha-combat-library/code/toolasha-combat.user.js
https://greasyfork.org/scripts/XXXXX-toolasha-ui-library/code/toolasha-ui.user.js
```

### 3. Update Entrypoint Header

Update `library-headers/entrypoint.txt` with actual Greasyfork URLs:

```javascript
// @require      https://greasyfork.org/scripts/XXXXX-toolasha-core-library/code/toolasha-core.user.js
// @require      https://greasyfork.org/scripts/XXXXX-toolasha-utils-library/code/toolasha-utils.user.js
// @require      https://greasyfork.org/scripts/XXXXX-toolasha-market-library/code/toolasha-market.user.js
// @require      https://greasyfork.org/scripts/XXXXX-toolasha-actions-library/code/toolasha-actions.user.js
// @require      https://greasyfork.org/scripts/XXXXX-toolasha-combat-library/code/toolasha-combat.user.js
// @require      https://greasyfork.org/scripts/XXXXX-toolasha-ui-library/code/toolasha-ui.user.js
```

### 4. Rebuild and Test

```bash
npm run build:prod
```

Test the entrypoint locally in Tampermonkey to ensure all libraries load correctly.

### 5. Update Main Script

Update the main Toolasha script on Greasyfork to sync from the production entrypoint:

```
https://raw.githubusercontent.com/Celasha/Toolasha/main/dist/Toolasha.user.js
```

## Release Workflow

### Making Changes

1. **Develop on feature branch**

    ```bash
    git checkout -b feature/my-feature
    # Make changes...
    npm run build     # Test dev build
    npm test          # Run tests
    git commit -m "feat: add feature"
    git push origin feature/my-feature
    ```

2. **Create PR and merge to main**
    - All tests must pass
    - Pre-commit hooks validate code
    - Merge to main branch

3. **Build production bundles**

    ```bash
    git checkout main
    git pull origin main
    npm run build:prod
    ```

4. **Commit production builds**

    ```bash
    git add dist/
    git commit -m "build: production release v0.X.Y"
    git tag v0.X.Y
    git push origin main --tags
    ```

5. **Sync updates on Greasyfork**
    - Greasyfork automatically syncs from GitHub
    - Check each library updates correctly
    - Verify entrypoint updates last

### Version Pinning Strategy

**Option A: Unpinned (Latest)**

```javascript
// @require https://greasyfork.org/scripts/XXXXX/code/toolasha-core.user.js
```

- Pros: Users always get latest version
- Cons: Breaking changes can break users' installations

**Option B: Pinned Versions (Recommended)**

```javascript
// @require https://greasyfork.org/scripts/XXXXX/code/toolasha-core.user.js?version=12345
```

- Pros: Stable, predictable behavior
- Cons: Requires manual version bumps

**Recommendation:** Use unpinned URLs initially for easier iteration. Switch to pinned versions once the library split stabilizes.

## Breaking Changes

### What Counts as Breaking

- Removing public API functions from global namespace
- Changing initialization order requirements
- Renaming library exports
- Removing feature modules
- Changing feature keys in registry

### Breaking Change Process

1. **Major version bump** (0.14.x → 0.15.0)
2. **Document migration** in CHANGELOG.md
3. **Announce in Greasyfork description**
4. **Consider deprecation period** (old + new API coexist)

### Non-Breaking Changes

- Adding new features
- Fixing bugs
- Performance improvements
- Internal refactoring
- Adding optional parameters

## Optimization Checklist

Before publishing, ensure all libraries are under 2MB:

### Core Library (Currently 100.11%)

Options to reduce size:

1. **Remove unused exports**
    - Audit what's actually used by features
    - Remove dead code

2. **Split into core + api**
    - Create separate `toolasha-api.user.js` (marketplace API)
    - Reduces core to just infrastructure

3. **Minify in production**
    - Add terser plugin to prod config
    - Typically saves 20-30%

4. **Remove source comments**
    - Strip JSDoc in production build
    - Saves ~5-10%

### Size Verification

```bash
npm run build:prod
for file in dist/libraries/*.user.js; do
    size=$(wc -c < "$file")
    limit=2097152
    if [ $size -gt $limit ]; then
        echo "❌ $file is over 2MB limit ($size bytes)"
    else
        echo "✅ $file is under limit ($size bytes)"
    fi
done
```

## Testing Checklist

### Local Testing

- [ ] Dev build works: `npm run build && npm test`
- [ ] Prod build succeeds: `npm run build:prod`
- [ ] All libraries under 2MB
- [ ] No console errors in browser
- [ ] Core features work (market, actions, combat)

### Tampermonkey Testing

- [ ] Install all 7 scripts in correct order
- [ ] Verify load order (Core → Utils → Features → Entrypoint)
- [ ] Test each feature category:
    - [ ] Market prices and tooltips
    - [ ] Action panel enhancements
    - [ ] Combat tracker and stats
    - [ ] UI enhancements
    - [ ] Settings panel
- [ ] Test character switching
- [ ] Test feature toggles via settings
- [ ] Check for memory leaks (long session)

### Greasyfork Testing

- [ ] All libraries sync from GitHub
- [ ] Entrypoint loads all dependencies
- [ ] Script updates automatically
- [ ] No errors in Greasyfork console
- [ ] Users can install and use normally

## Rollback Plan

If issues arise after publishing:

### Quick Rollback

1. **Revert to single-bundle version**

    ```bash
    # Update main script to sync from pre-split commit
    https://raw.githubusercontent.com/Celasha/Toolasha/COMMIT_HASH/dist/Toolasha.user.js
    ```

2. **Disable broken libraries**
    - Comment out `@require` in entrypoint header
    - Temporarily remove from sync

3. **Fix and re-publish**
    - Fix issues on feature branch
    - Test thoroughly
    - Re-sync libraries

### Full Rollback

1. Revert Greasyfork main script to last working single-bundle version
2. Remove library entries (or mark as deprecated)
3. Communicate rollback to users
4. Fix issues before attempting library split again

## Monitoring

### Health Checks

- **Greasyfork sync status:** Check daily for sync failures
- **User reports:** Monitor Greasyfork feedback section
- **Error logs:** Check browser console for common errors
- **Size trends:** Monitor library sizes on each release

### Metrics to Track

- Install count (main script vs library scripts)
- Update success rate
- Error rates by library
- Load time performance
- User feedback sentiment

## Support

### User Issues

**"Script doesn't load"**

- Check library install order
- Verify all 7 scripts installed
- Check console for missing dependency errors

**"Features missing after update"**

- Force update all libraries
- Clear Tampermonkey cache
- Reinstall scripts in correct order

**"Too many scripts to install"**

- This is the trade-off for staying under 2MB
- Alternative: Use single-bundle version (if available)

### Developer Issues

**"Build fails with dependency errors"**

- Check rollup config
- Verify library entry points exist
- Run `npm install` to update dependencies

**"Library over 2MB after changes"**

- Run size optimization checklist
- Consider splitting further
- Use minification in production

## Future Improvements

### Potential Optimizations

1. **Dynamic imports**: Load features on-demand
2. **Tree shaking**: Remove unused code paths
3. **Shared chunks**: Extract common dependencies
4. **CDN hosting**: Host stable libraries externally
5. **Compression**: Use gzip/brotli in transit

### Long-term Goals

1. Reduce total bundle size below 3MB
2. Improve load time with parallel downloads
3. Better error handling for missing libraries
4. Automatic fallback to single-bundle mode
5. User-configurable feature loading

## Appendix

### Useful Commands

```bash
# Development
npm run build          # Single bundle (dev)
npm run build:prod     # Multi-bundle (prod)
npm test              # Run tests
npm run lint          # Check code quality

# Size analysis
ls -lh dist/libraries/*.user.js
du -sh dist/
for file in dist/libraries/*.user.js; do
    wc -c "$file" | awk '{printf "%s: %d bytes (%.2f%% of 2MB)\n", "'$file'", $1, ($1/2097152)*100}'
done

# Git workflow
git checkout main
git pull origin main
npm run build:prod
git add dist/
git commit -m "build: production release v0.X.Y"
git tag v0.X.Y
git push origin main --tags
```

### External Resources

- [Greasyfork library documentation](https://greasyfork.org/help/writing-user-scripts)
- [Rollup documentation](https://rollupjs.org/)
- [Tampermonkey API](https://www.tampermonkey.net/documentation.php)
- [Toolasha repository](https://github.com/Celasha/Toolasha)
