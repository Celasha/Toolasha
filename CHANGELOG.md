# Changelog

## [2.2.0](https://github.com/Celasha/Toolasha/compare/v2.1.0...v2.2.0) (2026-04-09)


### Features

* add "Add to Tab" button to item action menu ([53d8c27](https://github.com/Celasha/Toolasha/commit/53d8c279fb15f14f4c65172c2d59d15ab3f19f77))
* add "From Loadout" section in tab editor to bulk-add loadout items ([5061283](https://github.com/Celasha/Toolasha/commit/50612830d27250fd457665422faafe2a8a0e5b38))
* add color picker and hex input to custom tab color selector ([1b83c2c](https://github.com/Celasha/Toolasha/commit/1b83c2c52b6cd6e059248ab95f16c8a038e6b55c))
* add drag-and-drop item reordering in tab editor ([a9e5e60](https://github.com/Celasha/Toolasha/commit/a9e5e60fd699ca2539fae0071b1dd92b3482fbed))
* add export/import for custom inventory tab layouts ([8fcc6db](https://github.com/Celasha/Toolasha/commit/8fcc6db7b69c8eb93c4d33e6fa57f54581ef20c9))


### Bug Fixes

* pin tab editor footer buttons outside the scrollable modal body ([cfd2b7b](https://github.com/Celasha/Toolasha/commit/cfd2b7b31f2f5562cb4c929bd929d2b89ba76919))
* show summed badge value in custom tab section headers ([4bb15a2](https://github.com/Celasha/Toolasha/commit/4bb15a299dde6833765c95f488535f8b2f591b6d))
* show warning indicator when custom tab items are hidden by collapsed inventory category ([e6cc182](https://github.com/Celasha/Toolasha/commit/e6cc1829bdfd3afe9ed2a67e6544ce11657b6f05))
* sort Unorganized section by game sortIndex ([b3d97be](https://github.com/Celasha/Toolasha/commit/b3d97be8311366c4263fc468ef92670eae6af04b))
* support per-enhancement-level item assignment in custom tabs ([c1924b1](https://github.com/Celasha/Toolasha/commit/c1924b1cb65740421f24c16b3e123fda2c95c140))


### Code Refactoring

* move material tab click handler outside loop to fix no-loop-func lint warning ([cdb8fce](https://github.com/Celasha/Toolasha/commit/cdb8fcefd4fc81f58d55f6544d290451f1cd37b8))


### Styles

* fix Prettier formatting ([b56443b](https://github.com/Celasha/Toolasha/commit/b56443bcb43e073d2d95067322cacf1cb35d26e9))

## [2.1.0](https://github.com/Celasha/Toolasha/compare/v2.0.0...v2.1.0) (2026-04-08)

### Features

- add Clear All button and category remove in tab editor; fix layout order collision ([363120d](https://github.com/Celasha/Toolasha/commit/363120d96ff39ee3a421bfc6698678bdcf4b51e6))

### Bug Fixes

- re-sort custom tabs layout when inventory sort mode changes ([a44da6f](https://github.com/Celasha/Toolasha/commit/a44da6f71e2510c4750e50bcc08c6e87087f8b36))

## [2.0.0](https://github.com/Celasha/Toolasha/compare/v1.67.0...v2.0.0) (2026-04-08)

### ⚠ BREAKING CHANGES

- add Custom Inventory Tabs with drag-and-drop reordering

### Features

- add Custom Inventory Tabs with drag-and-drop reordering ([9d03ca5](https://github.com/Celasha/Toolasha/commit/9d03ca541b5e00470fb1f7610eff849d52fb13ce))

## [1.67.0](https://github.com/Celasha/Toolasha/compare/v1.66.0...v1.67.0) (2026-04-05)

### Features

- add "time to next tier" sort to Collections panel ([ae8d4a3](https://github.com/Celasha/Toolasha/commit/ae8d4a3a1e10a03b5367c7c07650f5870cb6c292))

### Code Refactoring

- decouple queue length estimator from estimated listing age ([2c38628](https://github.com/Celasha/Toolasha/commit/2c38628f45a20a2c7f7b3020af8e1a25e1c70129))
- move and rename combatStats_keyPricing to profitCalc_keyPricingMode ([6d2cbc5](https://github.com/Celasha/Toolasha/commit/6d2cbc56086c8c3c8f1facdb0d7a39b83b7b0323))

## [1.66.0](https://github.com/Celasha/Toolasha/compare/v1.65.5...v1.66.0) (2026-04-05)

### Features

- add Iron Cow mode to disable market and profit settings ([b0f038d](https://github.com/Celasha/Toolasha/commit/b0f038d5673b916e714d2f7d8d2d0647feb93437))

### Bug Fixes

- add mwilinks to external navigation links ([93b3dc8](https://github.com/Celasha/Toolasha/commit/93b3dc8146653c00e5ff96b93368a61fd3bf4e7a))

## [1.65.5](https://github.com/Celasha/Toolasha/compare/v1.65.4...v1.65.5) (2026-04-04)

### Bug Fixes

- restrict mirror path base item lookup to refined items only ([9b8853e](https://github.com/Celasha/Toolasha/commit/9b8853eb55f56e4204fde6815ff427809093f349))
- use same-item costs to determine mirror optimization trigger level ([187095a](https://github.com/Celasha/Toolasha/commit/187095a9ed73fec07917878bcfb6f29f23f4ef60))

## [1.65.4](https://github.com/Celasha/Toolasha/compare/v1.65.3...v1.65.4) (2026-04-04)

### Bug Fixes

- revert erroneous refined item exclusion from protection pricing ([9a3aa6a](https://github.com/Celasha/Toolasha/commit/9a3aa6a09900fb1a2116949c540adb5ebaa66aac))

## [1.65.3](https://github.com/Celasha/Toolasha/compare/v1.65.2...v1.65.3) (2026-04-04)

### Bug Fixes

- exclude refined items from enhancement protection and mirror path costs ([214b050](https://github.com/Celasha/Toolasha/commit/214b050086b7aad671d9e4c02b726c884627031f))
- skip dedup for actions_updated to process isDone:true removals ([08b38c4](https://github.com/Celasha/Toolasha/commit/08b38c4d9981ecb37b9fbc97b6563fec9e061bb1))

## [1.65.2](https://github.com/Celasha/Toolasha/compare/v1.65.1...v1.65.2) (2026-04-02)

### Bug Fixes

- break enhancement panel mutation watcher feedback loop ([ac534cb](https://github.com/Celasha/Toolasha/commit/ac534cbf87ca9d2284948c7d0b8539ba8e343fb8))

## [1.65.1](https://github.com/Celasha/Toolasha/compare/v1.65.0...v1.65.1) (2026-04-02)

### Bug Fixes

- autofill missing mats quantity from live inventory on each buy modal ([4bbb2c2](https://github.com/Celasha/Toolasha/commit/4bbb2c2b52444d455b448eef9c628936f788ea2e))

## [1.65.0](https://github.com/Celasha/Toolasha/compare/v1.64.0...v1.65.0) (2026-04-02)

### Features

- add option to pin item tooltips to top-center of screen ([41bfee3](https://github.com/Celasha/Toolasha/commit/41bfee35a540d058a793ff2eb3c693481bdfed40))

## [1.64.0](https://github.com/Celasha/Toolasha/compare/v1.63.1...v1.64.0) (2026-04-02)

### Features

- add expandable chest rows in net worth inventory panel ([7e2f171](https://github.com/Celasha/Toolasha/commit/7e2f171a1f96597738a606560d4c44d9586aeee4))
- deduct chest key cost from dungeon chest EV in net worth and tooltips ([2d8609f](https://github.com/Celasha/Toolasha/commit/2d8609f6c3a30393f5ddc77728f5ac565745700b))

### Code Refactoring

- eliminate top 5 duplications across profit and market modules ([25cd3d0](https://github.com/Celasha/Toolasha/commit/25cd3d0360b1381030b51f9d8c8f967815177467))

## [1.63.1](https://github.com/Celasha/Toolasha/compare/v1.63.0...v1.63.1) (2026-04-01)

### Bug Fixes

- update alchemy profit display to reflect live catalyst selection ([0282ef7](https://github.com/Celasha/Toolasha/commit/0282ef7f8159edde043de99d6369124eb070351c))

## [1.63.0](https://github.com/Celasha/Toolasha/compare/v1.62.0...v1.63.0) (2026-04-01)

### Features

- add pricing mode naming convention setting ([36efea9](https://github.com/Celasha/Toolasha/commit/36efea9e516d4f37093fcad99e866f1b45838e81))

## [1.62.0](https://github.com/Celasha/Toolasha/compare/v1.61.1...v1.62.0) (2026-03-31)

### Features

- add Buy on Marketplace button to ability book calculator ([154c59a](https://github.com/Celasha/Toolasha/commit/154c59aad4014a5f7838f340f812382606626048))

### Bug Fixes

- split collection filter 10k+ into 10k-100k and 100k+ ([4f824a8](https://github.com/Celasha/Toolasha/commit/4f824a8d69074bba956f940b119427ed6758cc5b))

## [1.61.1](https://github.com/Celasha/Toolasha/compare/v1.61.0...v1.61.1) (2026-03-30)

### Bug Fixes

- include coin costs in crafting cost calculation ([121c021](https://github.com/Celasha/Toolasha/commit/121c021c2af40156830d33e2d47fee1ad5f9cd13))

## [1.61.0](https://github.com/Celasha/Toolasha/compare/v1.60.5...v1.61.0) (2026-03-30)

### Features

- store character gameMode in dataManager ([20801e3](https://github.com/Celasha/Toolasha/commit/20801e39d696c33ccb0902ea2401507c14395e05))

### Bug Fixes

- harden dungeon tracker scrubbing, debounce, and deduplication ([1003dc9](https://github.com/Celasha/Toolasha/commit/1003dc93e4bda4b42a0c2878af370946f1f12507))
- use border-right on chart bars to ensure visible separator ([8103197](https://github.com/Celasha/Toolasha/commit/8103197de1431dff3e1d68c2107a788e1e4e1d25))

## [1.60.5](https://github.com/Celasha/Toolasha/compare/v1.60.4...v1.60.5) (2026-03-29)

### Bug Fixes

- color task profit and efficiency rating by profit/loss ([9fcc247](https://github.com/Celasha/Toolasha/commit/9fcc2470ef7196980f8e1b5d20ea110b6d1c3db6))

## [1.60.4](https://github.com/Celasha/Toolasha/compare/v1.60.3...v1.60.4) (2026-03-29)

### Bug Fixes

- apply collection filters when catsEl is replaced on first load ([ea94ec8](https://github.com/Celasha/Toolasha/commit/ea94ec8b34ea530a2ce84052a57813cec1b63c4c))
- use KMB formatting for task efficiency rating value ([3ea9090](https://github.com/Celasha/Toolasha/commit/3ea9090c8138edf6016d358e03636c8c0f444cef))

## [1.60.3](https://github.com/Celasha/Toolasha/compare/v1.60.2...v1.60.3) (2026-03-29)

### Bug Fixes

- correct per-action and N-actions breakdowns to handle efficiency consistently ([9e1b7d1](https://github.com/Celasha/Toolasha/commit/9e1b7d1bf80f80028c6af26d676489f12f157d96))

### Code Refactoring

- make ask the sole driver for base item crafting cost in enhancement path ([4326459](https://github.com/Celasha/Toolasha/commit/43264595aa1ae912dc107285c5b02f4a047865f7))
- rename pricing modes to Buy/Sell ask/bid labels throughout UI ([d0e94b0](https://github.com/Celasha/Toolasha/commit/d0e94b0e0e04c23af4d8ed1f487a1b88ae85eb7a))

## [1.60.2](https://github.com/Celasha/Toolasha/compare/v1.60.1...v1.60.2) (2026-03-29)

### Bug Fixes

- fall back to production cost when only ask or bid is missing in crafting path tooltip ([8c4e7ba](https://github.com/Celasha/Toolasha/commit/8c4e7ba29510d131d301e9afc049f843455efb4b))

## [1.60.1](https://github.com/Celasha/Toolasha/compare/v1.60.0...v1.60.1) (2026-03-29)

### Bug Fixes

- fix config shadowing and add crafting cost option for enhancement path base item ([f37b621](https://github.com/Celasha/Toolasha/commit/f37b621f3cfe78ea5e69b27aef20fe42bc0bc48f))

## [1.60.0](https://github.com/Celasha/Toolasha/compare/v1.59.2...v1.60.0) (2026-03-29)

### Features

- add setting to use crafting cost for base item in enhancement path ([4c975c5](https://github.com/Celasha/Toolasha/commit/4c975c5b2171fa82f825f979ad7b5447c9b3e364))

## [1.59.2](https://github.com/Celasha/Toolasha/compare/v1.59.1...v1.59.2) (2026-03-29)

### Miscellaneous Chores

- trigger release-please regeneration ([c1de77f](https://github.com/Celasha/Toolasha/commit/c1de77f69ceb14df919aec18198e9450e7f29741))

## [1.59.1](https://github.com/Celasha/Toolasha/compare/v1.59.0...v1.59.1) (2026-03-29)

### Bug Fixes

- prevent Show Uncollected toggle from getting stuck checked ([e39cd66](https://github.com/Celasha/Toolasha/commit/e39cd66a2c8be82499d22adc0ad192ccb6923a90))

## [1.59.0](https://github.com/Celasha/Toolasha/compare/v1.58.0...v1.59.0) (2026-03-29)

### Features

- add sort by items/gold cost to next tier in collection filters ([e216160](https://github.com/Celasha/Toolasha/commit/e216160c1e8aafac779b46f572e2c286243a201a))

## [1.58.0](https://github.com/Celasha/Toolasha/compare/v1.57.1...v1.58.0) (2026-03-29)

### Features

- add Collection Filters feature ([6802499](https://github.com/Celasha/Toolasha/commit/6802499e9a1e58cbae77ba0e99973fc93f0983ef))

## [1.57.1](https://github.com/Celasha/Toolasha/compare/v1.57.0...v1.57.1) (2026-03-28)

### Bug Fixes

- fall back to production cost for unpriced crafting materials ([c2f575c](https://github.com/Celasha/Toolasha/commit/c2f575c914b0f6ce1e8dadef6d87098116989c2f))

### Code Refactoring

- make Philosopher's Mirror color configurable ([1c21e2b](https://github.com/Celasha/Toolasha/commit/1c21e2b5dec49ade06da844140eee1d136d96f2d))

## [1.57.0](https://github.com/Celasha/Toolasha/compare/v1.56.0...v1.57.0) (2026-03-28)

### Features

- improve networth history chart with category lines and UX fixes ([8e8c4c4](https://github.com/Celasha/Toolasha/commit/8e8c4c4480e8de0389ee347d3722e75068852546))

## [1.56.0](https://github.com/Celasha/Toolasha/compare/v1.55.1...v1.56.0) (2026-03-28)

### Features

- show per-category rate stats in networth history chart stats row ([a48db9b](https://github.com/Celasha/Toolasha/commit/a48db9b1de27f5254b3731958dde526ae95db17e))

## [1.55.1](https://github.com/Celasha/Toolasha/compare/v1.55.0...v1.55.1) (2026-03-28)

### Bug Fixes

- use dynamic artisan tea and correct pricing mode in base item production cost ([163ee28](https://github.com/Celasha/Toolasha/commit/163ee2816eee84611adc80b72522ea2338941ade))
- use KMB formatting for all coin and profit values ([b59f25b](https://github.com/Celasha/Toolasha/commit/b59f25bb77f3c42b176f4abd946da73fb92ad243))

## [1.55.0](https://github.com/Celasha/Toolasha/compare/v1.54.0...v1.55.0) (2026-03-28)

### Features

- add per-category line toggles to networth history chart ([230e870](https://github.com/Celasha/Toolasha/commit/230e8700291f1df28fec450ae101067fa12125d0))

### Bug Fixes

- show correct session number in tracker header on load ([c4c6147](https://github.com/Celasha/Toolasha/commit/c4c6147d2bb1319c699e7ddfad8c49916eaacdeb))

## [1.54.0](https://github.com/Celasha/Toolasha/compare/v1.53.3...v1.54.0) (2026-03-28)

### Features

- sort completed tasks to top when using Sort Tasks button ([d72f308](https://github.com/Celasha/Toolasha/commit/d72f308f6d9d7475204129f13b56b0a0458402cb))

### Bug Fixes

- clean up tooltip display when output item has no market data ([6ab8509](https://github.com/Celasha/Toolasha/commit/6ab8509c793aa847989c52cfeda8b5700677707f))
- exclude enhanced items from material requirement inventory count ([dcf8de0](https://github.com/Celasha/Toolasha/commit/dcf8de07d4074a33c756206d38800a25734f8371))

## [1.53.3](https://github.com/Celasha/Toolasha/compare/v1.53.2...v1.53.3) (2026-03-28)

### Bug Fixes

- remove efficiency multiplier from per-action material cost display ([3e4178b](https://github.com/Celasha/Toolasha/commit/3e4178bed6df6b90225a190fb8e5b1b4c00e5df5))
- reserve upgrade item from input count when same item is used for both ([0021e22](https://github.com/Celasha/Toolasha/commit/0021e2294aed9d1030be242c59d797ebd05a1c89))

## [1.53.2](https://github.com/Celasha/Toolasha/compare/v1.53.1...v1.53.2) (2026-03-27)

### Bug Fixes

- apply disabledBy state after settings panel is in the document ([63798a6](https://github.com/Celasha/Toolasha/commit/63798a6a8e28dfc381bacdc4d2670b194194b3c2))

## [1.53.1](https://github.com/Celasha/Toolasha/compare/v1.53.0...v1.53.1) (2026-03-27)

### Bug Fixes

- default enhancement tracker to latest session on load ([7234db4](https://github.com/Celasha/Toolasha/commit/7234db49b40571f4805fde09317f92aa52dc27f2))
- read disabledBy state from currentSettings on panel open ([b32e488](https://github.com/Celasha/Toolasha/commit/b32e488e5b4a0dac12e4463e2bfbbf7e2643c734))

### Miscellaneous Chores

- add [@icon](https://github.com/icon) to userscript header ([b7179de](https://github.com/Celasha/Toolasha/commit/b7179de276c9ce9c200d96a7f4614a876a948378))

## [1.53.0](https://github.com/Celasha/Toolasha/compare/v1.52.0...v1.53.0) (2026-03-27)

### Features

- add loadout snapshot system for accurate profit calculations ([149fcbe](https://github.com/Celasha/Toolasha/commit/149fcbe0fc9960bfb3431083bec8cb3e84b4bf11))

## [1.52.0](https://github.com/Celasha/Toolasha/compare/v1.51.1...v1.52.0) (2026-03-26)

### Features

- add profit mode toggle button to action panel title bar ([0c4b4ba](https://github.com/Celasha/Toolasha/commit/0c4b4baa3b8a67bc262cedb0ef0bff7c39deaa65))

### Miscellaneous Chores

- **main:** release 1.51.1 ([778e102](https://github.com/Celasha/Toolasha/commit/778e102222e28216396ec4915ab76d417ae9255d))
- sync version and format release notes ([461f1a5](https://github.com/Celasha/Toolasha/commit/461f1a5f4367b4474d39cf7a88c5f34e4383c37a))
- trigger release-please re-run ([77644bc](https://github.com/Celasha/Toolasha/commit/77644bc1af7a4c8b26279910d9fd64195235fa48))
- trigger release-please re-run after tag fix ([8d68a42](https://github.com/Celasha/Toolasha/commit/8d68a426569a692b0a5eceeacfa8b8637d009645))
- trim CHANGELOG to last 10 releases ([1f6958e](https://github.com/Celasha/Toolasha/commit/1f6958ee6a8ae74f6189ab11001c60b3e9d40065))

## [1.51.1](https://github.com/Celasha/Toolasha/compare/v1.51.0...v1.51.1) (2026-03-26)

### Bug Fixes

- call disable() on all features during character switch ([20b89ae](https://github.com/Celasha/Toolasha/commit/20b89aedbd5f133d656eb33d3e4caff3f68f8831))

## [1.51.0](https://github.com/Celasha/Toolasha/compare/v1.50.0...v1.51.0) (2026-03-26)

### Features

- add ask/bid prices to Labyrinth Shop tab ([04f91d6](https://github.com/Celasha/Toolasha/commit/04f91d621ab13c314b151005b3226ddfff7b9ceb))

## [1.50.0](https://github.com/Celasha/Toolasha/compare/v1.49.5...v1.50.0) (2026-03-26)

### Features

- add Materials tab to pinned actions page ([286691c](https://github.com/Celasha/Toolasha/commit/286691c1c2833532d661aa665da2e05243796f9e))
- add z-index tier system and bring-to-front for floating panels ([644aef3](https://github.com/Celasha/Toolasha/commit/644aef32c65304c7e39a68a25a914184599626f6))

## [1.49.5](https://github.com/Celasha/Toolasha/compare/v1.49.4...v1.49.5) (2026-03-25)

### Bug Fixes

- correct milkonomy export equipment handling for non-self profiles ([71c1bf2](https://github.com/Celasha/Toolasha/commit/71c1bf286a1953507969fab24d76aa9ac21c96b3))

## [1.49.4](https://github.com/Celasha/Toolasha/compare/v1.49.3...v1.49.4) (2026-03-25)

### Bug Fixes

- always include enhanceLevel in milkonomy export for other profiles ([5a76675](https://github.com/Celasha/Toolasha/commit/5a76675b651002acf9007ca10ce04f6314f7f6a2))

## [1.49.3](https://github.com/Celasha/Toolasha/compare/v1.49.2...v1.49.3) (2026-03-25)

### Bug Fixes

- improve missing mats accuracy and enhancement display polish ([c363b42](https://github.com/Celasha/Toolasha/commit/c363b424da880a5d3fea2d8a92a89c79df32dca0))
- persist collapsed state of settings groups ([6cb7304](https://github.com/Celasha/Toolasha/commit/6cb730455939fb36e66552ef24538ba45e1e772e))

## [1.49.2](https://github.com/Celasha/Toolasha/compare/v1.49.1...v1.49.2) (2026-03-25)

### Code Refactoring

- convert enhancement tooltip costs to table format ([e2cacc2](https://github.com/Celasha/Toolasha/commit/e2cacc23c24bdb4a9f0fcf8470e67750205772d8))

## [1.49.1](https://github.com/Celasha/Toolasha/compare/v1.49.0...v1.49.1) (2026-03-25)

### Bug Fixes

- use tooltip color settings for enhancement total cost ([5c8a1f6](https://github.com/Celasha/Toolasha/commit/5c8a1f694b5c7783e542e7f0a9349d674fd19e30))

## [1.49.0](https://github.com/Celasha/Toolasha/compare/v1.48.1...v1.49.0) (2026-03-25)

### Features

- add missing mats marketplace button to enhancement panels ([ba55e1a](https://github.com/Celasha/Toolasha/commit/ba55e1aeda0aaae5168e3bff1f906142277825ac))

---

_Older entries have been trimmed. Full history is available in the [git log](https://github.com/Celasha/Toolasha/commits/main)._
