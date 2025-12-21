# Translation & Localization - EXCLUDED

This refactored version does **NOT** include Chinese language support.

## What We Removed:

### From Original Code
- All `isZH` checks and conditionals
- Chinese translation functions (`getItemEnNameFromZhName`, etc.)
- Chinese string literals
- `milkywayidlecn.com` domain support
- Locale-specific formatting based on language

### Functions We Will NOT Extract:
- `inverseKV(obj)` - Used only for ZH/EN translation mapping
- `getItemEnNameFromZhName(zhName)` - Lines 2060-2072
- `getActionEnNameFromZhName(zhName)` - Lines 2074-2086
- `getOthersFromZhName(zhName)` - Lines 2088-2102

### Simplified Functions:
- `timeReadable(sec)` - Now English-only, removed `isZH` parameter
- `numberFormatter(num, digits)` - Uses locale default (US format)
- All UI text - English only

## Rationale:

The original MWITools supported both English and Chinese players. For this refactor, we're focusing on:
- **Simplicity**: Single language reduces complexity
- **Maintainability**: Easier to test and debug
- **Performance**: Less conditional logic
- **Primary audience**: English-speaking players

If Chinese support is needed in the future, it can be added as a separate i18n module using proper internationalization libraries like i18next.

---

**Note**: This means we skip ~150 lines of translation code from the original 6,706 line file.
