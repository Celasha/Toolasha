# Changelog

## [0.6.1](https://github.com/Celasha/Toolasha/compare/toolasha-v0.6.0...toolasha-v0.6.1) (2026-01-30)


### Bug Fixes

* correctly identify quantity input for equipment items in missing materials auto-fill ([f321760](https://github.com/Celasha/Toolasha/commit/f321760ff5fc74383d02b5917d2d50c7d8ee8ba1))
* prettier complaining ([f5c1937](https://github.com/Celasha/Toolasha/commit/f5c193731388e4c3bf4097b31cb3b45b86eb4a92))
* prettier complaining ([7f03751](https://github.com/Celasha/Toolasha/commit/7f0375170495cbca2bef20e352686e9c8b9d274c))

## [0.6.0](https://github.com/Celasha/Toolasha/compare/toolasha-v0.5.36...toolasha-v0.6.0) (2026-01-30)

### Features

- Add achievement tier bonus support for gathering profit ([459ca85](https://github.com/Celasha/Toolasha/commit/459ca8507c5ddb8ae0ce4114fdd6597cefa5ebe7))
- Add alchemy item dimming for level requirements ([3b7ca86](https://github.com/Celasha/Toolasha/commit/3b7ca863498b35da75563b9f5641c2ca813b183c))
- Add auto-fill marketplace order price feature ([9a45dc0](https://github.com/Celasha/Toolasha/commit/9a45dc07cdb34fcdbbbe1a04472ab95123ee8795))
- Add automatic feature health check and retry system ([6dfa661](https://github.com/Celasha/Toolasha/commit/6dfa6613ecaaad7f57400ac83cdbf6c18178f76e))
- Add collapsible groups and nested settings in settings UI ([484e6be](https://github.com/Celasha/Toolasha/commit/484e6be15717c08bdbcb48797dec65cd2b3dabfe))
- Add combat score feature to profile panels ([67d8080](https://github.com/Celasha/Toolasha/commit/67d80806d5aee28225c5d9eb4c7bb2346b43d335))
- add compact action bar mode setting ([ec1afff](https://github.com/Celasha/Toolasha/commit/ec1afff09f0e2fbaab7fb0889f3902ac4b310c00))
- add enhancement session state management (Phase 1 Day 1) ([d094f3c](https://github.com/Celasha/Toolasha/commit/d094f3c68098bc965ad61f904cafad492ebe0a83))
- Add feature toggle system for opt-in/opt-out control ([1c27699](https://github.com/Celasha/Toolasha/commit/1c27699e54e529028f3d1cf12ce9d6e2da419257))
- Add house upgrade cost calculator (initial implementation) ([281457c](https://github.com/Celasha/Toolasha/commit/281457c027cd4d5183dad2c5a996f282ce7c9474))
- Add marketplace filter feature ([24b1f9d](https://github.com/Celasha/Toolasha/commit/24b1f9d8efc7983a09e69cc7672c013d62d0e1cc))
- Add network alert, enhancement tracker visibility, fix descriptions ([ca90397](https://github.com/Celasha/Toolasha/commit/ca9039775894f92428bb7532da53a13cb18280db))
- Add task profit calculator with expandable breakdown ([0da429c](https://github.com/Celasha/Toolasha/commit/0da429c07bfa71a7ed77818efd59cadc59e16211))
- Add task reroll diagnostic system ([6b05e51](https://github.com/Celasha/Toolasha/commit/6b05e5168a6a2259511ad9923a869ce715b22744))
- Add time estimate to task profit display (Option B format) ([9016c09](https://github.com/Celasha/Toolasha/commit/9016c09e66cfe444a3806f7dd553261b3cda29b7))
- add version sync script and integrate with release workflow ([5962d5a](https://github.com/Celasha/Toolasha/commit/5962d5aaec16aea7238035a115040d66b4ad68f0))
- auto-sort completed tasks to bottom ([15afb9c](https://github.com/Celasha/Toolasha/commit/15afb9cb4b01eb72a8960e6241e14d14c9ea2adc))
- **combat-score:** Add thousands separators to all score values ([6b7b093](https://github.com/Celasha/Toolasha/commit/6b7b093aaca29e6feb67c6edb2500b4879841d63))
- Complete house upgrade cost display with market pricing ([68e2ee6](https://github.com/Celasha/Toolasha/commit/68e2ee6561334c69f9bb9e5d8406f0e974998c9c))
- disable inventory badges when sort mode is 'None' ([dd8b441](https://github.com/Celasha/Toolasha/commit/dd8b4413e25125a87d2a3321208b34c74eb74933))
- **enhancement:** Add predictions and fix XP/hour display ([ea17f3d](https://github.com/Celasha/Toolasha/commit/ea17f3db48e7017603e72231f5d28592991fcf8b))
- implement task icon filtering with live counts (v0.5.32) ([8fa9070](https://github.com/Celasha/Toolasha/commit/8fa9070f969124bbebfbea88cfee1c9f3656217c))
- Remember collapse states using localStorage ([d153933](https://github.com/Celasha/Toolasha/commit/d1539331c62d612101b12228b760b1c3af2ebcb4))
- **settings:** Add professional settings UI with MWIt-E styling ([fe012d7](https://github.com/Celasha/Toolasha/commit/fe012d745b92df5156a45e18adbca5c568ae249c))

### Bug Fixes

- Action Level bonuses scale with DC but get floored in requirement calculation ([93d85a0](https://github.com/Celasha/Toolasha/commit/93d85a0d9ca6f8fb0cd5d8899d80d676f49350c9))
- **actions:** Correct efficiency calculation in time estimates ([9ffc6ff](https://github.com/Celasha/Toolasha/commit/9ffc6ffc906cbcf1fc579523b39e0bcc8e637dca))
- Add [@grant](https://github.com/grant) unsafeWindow for Firefox Tampermonkey compatibility ([80a764c](https://github.com/Celasha/Toolasha/commit/80a764c953f267c9727b841fbeb2627e4c0fbd4a))
- Add comprehensive logging for settings tab initialization debugging ([a010923](https://github.com/Celasha/Toolasha/commit/a010923311a08d9fe11299690db160a26b991777))
- Add fallback for Firefox race condition on character initialization ([2458faf](https://github.com/Celasha/Toolasha/commit/2458fafbcd820a81ba475f68bde69ae329bfcaea))
- Add missing toggleGroup method ([bafe995](https://github.com/Celasha/Toolasha/commit/bafe99531cd500d87ea184820945bfb10a381ff7))
- Bind toggleGroup method to preserve this context ([95a7c46](https://github.com/Celasha/Toolasha/commit/95a7c466e22bffff9a8e3eaffdc3a7b5a006910a))
- Change "Philosopher's Equipment" to "Philosopher's Necklace" ([a463e67](https://github.com/Celasha/Toolasha/commit/a463e67e2b9e4b5c7b15d417e206d1ea124d4769))
- compact mode no longer affects header layout ([176d11a](https://github.com/Celasha/Toolasha/commit/176d11aa0c2b2da8262283545442d1f40d077bf4))
- Complete memory leak cleanup for gathering-stats.js ([4c1d3ee](https://github.com/Celasha/Toolasha/commit/4c1d3eedc348660f7fc5bef0fc7a5b0fc0c37a72))
- correct action queue timing display positioning ([5048c1c](https://github.com/Celasha/Toolasha/commit/5048c1c2be3ef0d6e48f9a0d4ee53d2390b5b334))
- Correct gitignore pattern to allow built userscript ([a3625c9](https://github.com/Celasha/Toolasha/commit/a3625c93ba6e485d205afc7dadf3282b525ae0a5))
- CRITICAL - Primary memory leak in updateAllCounts/updateAllStats ([5ae0e09](https://github.com/Celasha/Toolasha/commit/5ae0e09e4c95dfb133e5039e55a8f770bec45224))
- Critical memory leak - remove DOM elements before clearing Maps ([0ffc57c](https://github.com/Celasha/Toolasha/commit/0ffc57c666ebe3f8c7eb91d7d5ab4b467f0f744d))
- **enhancement:** Use dataManager for character data in predictions ([f089136](https://github.com/Celasha/Toolasha/commit/f0891365ce8e9bceedf6c77210be655b5d150735))
- **market:** correct profit calculations and tooltip displays ([83318f4](https://github.com/Celasha/Toolasha/commit/83318f46f13bb20b613e1e61257db35e91bd5bda))
- Null out element references after .remove() for GC ([8d9a8f4](https://github.com/Celasha/Toolasha/commit/8d9a8f493ecc1370cfee98050ba603bfe66b4554))
- prevent duplicate clicks in auto-fill market price ([539190d](https://github.com/Celasha/Toolasha/commit/539190d835da802ca3c081a7e895075f40c79a4b))
- Reduce console spam and improve settings tab detection on Firefox ([e398dbd](https://github.com/Celasha/Toolasha/commit/e398dbd0153a6b52e213dcc1c94eb6dca499e09e))
- Remove all remaining InventorySort console spam ([5b2f792](https://github.com/Celasha/Toolasha/commit/5b2f7927198b84819013c6d3e9f66e457ce0788a))
- Remove parentNode check blocking DOM cleanup ([42899ee](https://github.com/Celasha/Toolasha/commit/42899ee88c827dc9817c0b093654e148f18a9647))
- remove unnecessary escape characters in regex patterns ([00ce270](https://github.com/Celasha/Toolasha/commit/00ce270da8b1c5b5b4e40d5818015a6d0353685e))
- resolve 63 ESLint warnings (complete) ([64d5e60](https://github.com/Celasha/Toolasha/commit/64d5e609f5a407bd122f6dfb1f3b355ae724ffea))
- restructure release-please config for monorepo format ([a68eb4f](https://github.com/Celasha/Toolasha/commit/a68eb4fc434ebfe75de48f52066f387bee2572da))
- restructure release-please config for monorepo format ([f02000f](https://github.com/Celasha/Toolasha/commit/f02000f195e90319e2dbe8833abb45e9135aed1c))
- **tasks:** Disable task reroll tracker by default ([47046ec](https://github.com/Celasha/Toolasha/commit/47046ec79d971a018c1cb020911dd56400ba5517))
- **tasks:** Make reroll tracker fully non-blocking ([c4a54a2](https://github.com/Celasha/Toolasha/commit/c4a54a27a610639bbc4cb8346cedd74e512ef23a))
- **tasks:** Prevent UI freeze on task reroll ([56101cd](https://github.com/Celasha/Toolasha/commit/56101cdb39b8257d1a21b97949a8e9effc65c74e))
- tooltip now shows on entire action bar in compact mode ([a55388d](https://github.com/Celasha/Toolasha/commit/a55388df7469fd85aee30627b2c57ae95d79c9c7))
- Update default enhancement tool success bonus to 5.42% ([b49fabb](https://github.com/Celasha/Toolasha/commit/b49fabb050df5f4b233b98f9dd9bf621275d4f66))
- use 'settings' store instead of non-existent 'features' store ([0d809f8](https://github.com/Celasha/Toolasha/commit/0d809f8f790f4b7ff156f3b7257c603a6a9608db))
- Use correct dataManager API method for house room level ([5870e02](https://github.com/Celasha/Toolasha/commit/5870e02d34862653681e5debf92a14ee00fc80f6))
- Use wrapper container for side-by-side column layout ([a696dbf](https://github.com/Celasha/Toolasha/commit/a696dbfd2b30e6e8722a1b323ea72d43c13548b6))

### Performance Improvements

- Major performance optimizations for action panel features ([9f5098a](https://github.com/Celasha/Toolasha/commit/9f5098aa71c7586c10915b5f236726a546d266a1))
