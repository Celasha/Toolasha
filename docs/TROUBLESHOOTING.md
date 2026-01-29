# Troubleshooting Guide

Common issues and solutions for Toolasha users and developers.

## Table of Contents

- [Installation Issues](#installation-issues)
- [Feature Not Working](#feature-not-working)
- [Performance Issues](#performance-issues)
- [Data Not Saving](#data-not-saving)
- [UI Issues](#ui-issues)
- [Build Issues](#build-issues)
- [Getting Help](#getting-help)

---

## Installation Issues

### Userscript Not Loading

**Symptoms**: No Toolasha features appear in game

**Solutions**:

1. **Check Tampermonkey is enabled**
    - Click Tampermonkey icon in browser
    - Ensure it's not disabled

2. **Verify script is enabled**
    - Open Tampermonkey dashboard
    - Find "Toolasha" in list
    - Ensure toggle is ON

3. **Check script URL match**
    - Edit script in Tampermonkey
    - Verify `@match` includes `https://www.milkywayidle.com/*`

4. **Clear browser cache**
    - Hard refresh: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
    - Or clear cache in browser settings

5. **Check for conflicts**
    - Disable other MWI userscripts temporarily
    - Re-enable one at a time to find conflicts

### Script Errors on Load

**Symptoms**: Console shows errors when loading game

**Solutions**:

1. **Check browser console**
    - Press `F12` to open DevTools
    - Look for red error messages
    - Note the error message and line number

2. **Update to latest version**
    - Check [Releases](../../releases) for updates
    - Install latest version

3. **Reinstall script**
    - Delete old script from Tampermonkey
    - Install fresh copy from releases

---

## Feature Not Working

### Feature Enabled But Not Visible

**Symptoms**: Feature is enabled in settings but doesn't appear

**Solutions**:

1. **Refresh the page**
    - Some features require page reload
    - Hard refresh: `Ctrl+Shift+R` or `Cmd+Shift+R`

2. **Check feature requirements**
    - Some features only work in specific game areas
    - Example: Market features only work when market is open

3. **Check console for errors**
    - Press `F12` to open DevTools
    - Look for `[FeatureName]` prefixed errors

4. **Verify dependencies**
    - Some features depend on market data loading
    - Wait a few seconds after page load

### Settings Not Saving

**Symptoms**: Settings reset after page refresh

**Solutions**:

1. **Check IndexedDB**
    - Open DevTools → Application tab → IndexedDB
    - Look for `toolasha` database
    - Check if `settings` store exists

2. **Check browser permissions**
    - Ensure browser allows IndexedDB
    - Check if in private/incognito mode (may block storage)

3. **Clear and reset**
    - Open Toolasha settings
    - Click "Reset All Settings" (if available)
    - Reconfigure settings

4. **Check storage quota**
    - Browser may have storage limits
    - Clear other site data if needed

---

## Performance Issues

### Game Running Slowly

**Symptoms**: Game lags or freezes with Toolasha enabled

**Solutions**:

1. **Disable resource-intensive features**
    - Try disabling features one at a time
    - Common culprits: Real-time trackers, frequent updates

2. **Check browser performance**
    - Open DevTools → Performance tab
    - Record a session to identify bottlenecks

3. **Reduce update frequency**
    - Some features have update interval settings
    - Increase intervals to reduce CPU usage

4. **Clear browser cache**
    - Old cached data can cause issues
    - Clear cache and reload

### High Memory Usage

**Symptoms**: Browser uses excessive RAM

**Solutions**:

1. **Check for memory leaks**
    - Open DevTools → Memory tab
    - Take heap snapshots before/after actions
    - Look for growing object counts

2. **Disable tracking features**
    - Features that store history can accumulate data
    - Clear history in feature settings

3. **Restart browser**
    - Sometimes browser needs fresh start
    - Close all tabs and reopen

---

## Data Not Saving

### Dungeon Tracker Not Saving Runs

**Symptoms**: Run history disappears after refresh

**Solutions**:

1. **Check IndexedDB**
    - DevTools → Application → IndexedDB → toolasha
    - Look for `dungeonRuns` and `teamRuns` stores

2. **Verify character ID**
    - Data is stored per character
    - Check URL has `?characterId=` parameter

3. **Check storage permissions**
    - Browser may block storage in some modes
    - Disable private browsing

### Enhancement Tracker Losing Sessions

**Symptoms**: Enhancement sessions disappear

**Solutions**:

1. **Check if sessions are being saved**
    - Look for `enhancementSessions` in IndexedDB

2. **Verify session creation**
    - Ensure you're starting a new session properly
    - Check console for save confirmations

3. **Export data as backup**
    - Use export feature if available
    - Save to file before closing

---

## UI Issues

### UI Elements Overlapping

**Symptoms**: Toolasha UI covers game UI

**Solutions**:

1. **Adjust z-index**
    - Some features have position settings
    - Try moving panels to different locations

2. **Check browser zoom**
    - Reset zoom to 100%
    - Some layouts break at different zoom levels

3. **Resize browser window**
    - UI may not be responsive at all sizes
    - Try different window sizes

### UI Not Updating

**Symptoms**: Numbers/text don't update in real-time

**Solutions**:

1. **Check WebSocket connection**
    - Console should show WebSocket messages
    - Look for connection errors

2. **Refresh the page**
    - Sometimes connection needs reset

3. **Check feature settings**
    - Some features have "auto-update" toggles
    - Ensure they're enabled

### Missing Buttons or Controls

**Symptoms**: Expected buttons don't appear

**Solutions**:

1. **Check DOM selectors**
    - Game updates may change element classes
    - Report issue if after game update

2. **Wait for page load**
    - Some UI injects after delay
    - Wait 5-10 seconds after page load

3. **Check console for errors**
    - Look for DOM-related errors

---

## Build Issues

### Build Fails

**Symptoms**: `npm run build` shows errors

**Solutions**:

1. **Check Node.js version**

    ```bash
    node --version  # Should be 16+
    ```

2. **Reinstall dependencies**

    ```bash
    rm -rf node_modules package-lock.json
    npm install
    ```

3. **Check for syntax errors**
    - Run `npm run lint` to find issues
    - Fix reported errors

4. **Check file paths**
    - Ensure all imports have `.js` extension
    - Check for typos in file names

### Tests Failing

**Symptoms**: `npm test` shows failures

**Solutions**:

1. **Run tests individually**

    ```bash
    npm test -- formatters.test.js
    ```

2. **Check test output**
    - Read error messages carefully
    - Look for expected vs actual values

3. **Update snapshots** (if applicable)

    ```bash
    npm test -- -u
    ```

4. **Check for breaking changes**
    - Review recent commits
    - Revert if needed

### Linting Errors

**Symptoms**: `npm run lint` shows errors

**Solutions**:

1. **Auto-fix simple issues**

    ```bash
    npm run lint:fix
    ```

2. **Format code**

    ```bash
    npm run format
    ```

3. **Check specific errors**
    - Read error messages
    - Fix manually if auto-fix doesn't work

---

## Common Error Messages

### "Cannot read property 'X' of undefined"

**Cause**: Trying to access property on null/undefined object

**Solutions**:

- Add null checks: `if (obj && obj.property)`
- Use optional chaining: `obj?.property`
- Check if data is loaded before accessing

### "Failed to execute 'observe' on 'MutationObserver'"

**Cause**: Trying to observe element that doesn't exist

**Solutions**:

- Use `waitForElement()` helper
- Add existence check before observing
- Delay observation until element loads

### "QuotaExceededError"

**Cause**: Browser storage quota exceeded

**Solutions**:

- Clear old data from IndexedDB
- Reduce amount of data being stored
- Check browser storage settings

### "WebSocket connection failed"

**Cause**: Game WebSocket not connecting

**Solutions**:

- Check internet connection
- Refresh page
- Check if game servers are down

---

## Debugging Tips

### Enable Verbose Logging

Some features have verbose logging options:

1. Open feature settings
2. Look for "Verbose Logging" or "Debug Mode"
3. Enable and check console for detailed logs

### Use Browser DevTools

**Console Tab**:

- View error messages
- Check for warnings
- See feature logs

**Network Tab**:

- Monitor WebSocket messages
- Check API requests
- Verify data loading

**Application Tab**:

- Inspect IndexedDB data
- Check localStorage
- View cookies

**Performance Tab**:

- Profile CPU usage
- Find performance bottlenecks
- Identify slow operations

### Check Game Updates

Game updates can break userscripts:

1. Check game version in footer
2. Compare with last working version
3. Report issues if after game update

---

## Getting Help

### Before Asking for Help

1. **Check this guide** - Your issue may be listed above
2. **Search existing issues** - Someone may have had same problem
3. **Check console** - Error messages are helpful
4. **Try latest version** - Update to newest release

### Reporting Issues

When reporting issues, include:

1. **Toolasha version** - Check in settings or console
2. **Browser and version** - Chrome 120, Firefox 121, etc.
3. **Tampermonkey version** - Check in extension settings
4. **Steps to reproduce** - Detailed steps
5. **Expected behavior** - What should happen
6. **Actual behavior** - What actually happens
7. **Console errors** - Copy error messages
8. **Screenshots** - If UI-related

### Where to Get Help

- **GitHub Issues**: [Report bugs](../../issues)
- **GitHub Discussions**: [Ask questions](../../discussions)
- **Documentation**: [Read docs](../DOCUMENTATION.md)

---

## Developer Troubleshooting

### Feature Not Initializing

**Check**:

1. Feature registered in `feature-registry.js`?
2. Setting enabled in config?
3. Dependencies initialized first?
4. Console shows initialization log?

### WebSocket Messages Not Received

**Check**:

1. Hook registered correctly?
2. Message type name correct?
3. WebSocket connected?
4. Listener function called?

### DOM Elements Not Found

**Check**:

1. Selector correct?
2. Element exists in DOM?
3. Timing issue (element not loaded yet)?
4. Game update changed selectors?

### Data Not Persisting

**Check**:

1. Storage initialized?
2. Store name correct?
3. Await on async operations?
4. Debounce delay (3 seconds)?
5. Browser allows storage?

---

## Still Having Issues?

If you've tried everything and still have problems:

1. **Create a minimal reproduction**
    - Disable all other extensions
    - Use fresh browser profile
    - Test with only Toolasha

2. **Collect diagnostic info**
    - Browser console logs
    - Network tab activity
    - IndexedDB contents
    - Settings configuration

3. **Open an issue**
    - Use issue template
    - Provide all diagnostic info
    - Be patient and responsive

We're here to help! 🎉
