# Changelog

## [2.63.0](https://github.com/Celasha/Toolasha/compare/v2.62.14...v2.63.0) (2026-06-13)

### Features

- add configurable number format mode and precision settings ([53349ba](https://github.com/Celasha/Toolasha/commit/53349bacc7d4b84a56285ebf661382fbd45ce313))
- add guild activity calculator and simulator ([955c78e](https://github.com/Celasha/Toolasha/commit/955c78e3242b550158934d98f1db2ab63d1354c6))

### Bug Fixes

- add missing Help channel to pop-out chat ([b497147](https://github.com/Celasha/Toolasha/commit/b49714755c57e2a603ee615e12b34c60e3dbc4af))
- calculate task gold/hr using total task time instead of time remaining ([09a6168](https://github.com/Celasha/Toolasha/commit/09a61687d0751dc4333a583c391977c9b4cf91ba))
- correct labyrinth combat skip recommendations and add MooPass buffs ([b44dd1b](https://github.com/Celasha/Toolasha/commit/b44dd1b3c7395d8f22accbe6c02b94ef41c40843))
- use matchCurrentActionFromText for queue ETA current action detection ([993bbd1](https://github.com/Celasha/Toolasha/commit/993bbd1247c1b87469e8d67d73b0670c92535b3e))

## [2.62.14](https://github.com/Celasha/Toolasha/compare/v2.62.13...v2.62.14) (2026-06-11)

### Code Refactoring

- unify date/time and number formatting across all features ([a4a609e](https://github.com/Celasha/Toolasha/commit/a4a609ea25674412a3c1bf7bdceffe6dbbb2ffa3))

## [2.62.13](https://github.com/Celasha/Toolasha/compare/v2.62.12...v2.62.13) (2026-06-11)

### Bug Fixes

- exclude enhanced items from inventory count and add dynamic toggle ([6103c4f](https://github.com/Celasha/Toolasha/commit/6103c4f01f08b3b24285eea6a4d31e742d0f74aa))

## [2.62.12](https://github.com/Celasha/Toolasha/compare/v2.62.11...v2.62.12) (2026-06-10)

### Bug Fixes

- prevent action filter from clearing panels registered in same mutation batch ([67a706a](https://github.com/Celasha/Toolasha/commit/67a706a5f5d29ded6463dec667b17e9fd0f56605))

## [2.62.11](https://github.com/Celasha/Toolasha/compare/v2.62.10...v2.62.11) (2026-06-09)

### Bug Fixes

- hide newly registered panels that don't match active filter ([8ff33ff](https://github.com/Celasha/Toolasha/commit/8ff33ffccb6c8f4f8337cb23d120726946296184))

## [2.62.10](https://github.com/Celasha/Toolasha/compare/v2.62.9...v2.62.10) (2026-06-08)

### Bug Fixes

- align move buttons in tab editor by rendering hidden placeholders ([e57d6aa](https://github.com/Celasha/Toolasha/commit/e57d6aa6c660f5b75d33232bd74c44e951c8962b))
- crash in \_checkBindingEnhancements when cache is nulled mid-loop ([8b2155e](https://github.com/Celasha/Toolasha/commit/8b2155eb13e839853fdef7dc82c1d83848dcf31f))

## [2.62.9](https://github.com/Celasha/Toolasha/compare/v2.62.8...v2.62.9) (2026-06-08)

### Bug Fixes

- add "Move to bottom" button in custom tab editor ([e47b4cb](https://github.com/Celasha/Toolasha/commit/e47b4cb396e80fc4ba5c119c931817765f94f904))
- preserve scroll position when removing items in tab editor ([d7e0f39](https://github.com/Celasha/Toolasha/commit/d7e0f3957801d1ba99167350cd2241bd062ecef6))
- prevent drag listener accumulation on custom inventory tab tiles ([cae18f3](https://github.com/Celasha/Toolasha/commit/cae18f370b9c3045748d63fee5bdc5bd55a3facf))

## [2.62.8](https://github.com/Celasha/Toolasha/compare/v2.62.7...v2.62.8) (2026-06-07)

### Bug Fixes

- action panel button labels resetting to defaults on page reload ([67ad2a3](https://github.com/Celasha/Toolasha/commit/67ad2a3548871764bdca10591c090ce7a1c18a88))
- hide Scroll Simulation button when setting is disabled ([58c1ef7](https://github.com/Celasha/Toolasha/commit/58c1ef7777b821066cf9c6e5d9db98fd3edfea6e))
- use live networth for rate/hr calculation instead of last snapshot ([ef61b79](https://github.com/Celasha/Toolasha/commit/ef61b79ee40c3e8f3764b392a40f1896a4fb63d4))

## [2.62.7](https://github.com/Celasha/Toolasha/compare/v2.62.6...v2.62.7) (2026-06-07)

### Bug Fixes

- add setting to disable task speed & time breakdown ([363582e](https://github.com/Celasha/Toolasha/commit/363582ed1efc77350fe0645d8c52623922e4dfe3))

## [2.62.6](https://github.com/Celasha/Toolasha/compare/v2.62.5...v2.62.6) (2026-06-07)

### Bug Fixes

- calculate enhancement time correctly when using Philosopher's Mirror ([60b1f2a](https://github.com/Celasha/Toolasha/commit/60b1f2afb672a45e556b4421342b74195139dc6c))
- show expandable speed breakdown on tasks without profit enabled ([7b71d99](https://github.com/Celasha/Toolasha/commit/7b71d9953a1d8bdf819315cc1b0df04918d215f0))

## [2.62.5](https://github.com/Celasha/Toolasha/compare/v2.62.4...v2.62.5) (2026-06-06)

### Bug Fixes

- use ResizeObserver to sync stats layout on hidden→visible tab switches ([84d29fd](https://github.com/Celasha/Toolasha/commit/84d29fd7b4cf9df0d95bb6b00d6bec5f9ef2b403))

## [2.62.4](https://github.com/Celasha/Toolasha/compare/v2.62.3...v2.62.4) (2026-06-06)

### Bug Fixes

- match enhanced items in queue by stripping +N level suffix ([11514be](https://github.com/Celasha/Toolasha/commit/11514beab84ae8156f7fb03dd2fe225c9f78ef8b))
- re-sync action panel marginBottom after layout and tab changes ([c9b9644](https://github.com/Celasha/Toolasha/commit/c9b964408d8d5d549e4bdeea35b67c81f34b52b4))

## [2.62.3](https://github.com/Celasha/Toolasha/compare/v2.62.2...v2.62.3) (2026-06-06)

### Bug Fixes

- add action speed & time breakdown to task profit display ([5ede675](https://github.com/Celasha/Toolasha/commit/5ede675adba889f15c5c624e1d1e2e2b54453252))
- prevent stat line text from briefly shrinking during tab switch ([60b2e03](https://github.com/Celasha/Toolasha/commit/60b2e039ff073bb145cfa934b24c858cb7eafd1b))
- show expected time for repeat-∞ enhancement queue actions ([ab3f26f](https://github.com/Celasha/Toolasha/commit/ab3f26f04869ac67d91c5afdcc4efd5815208d74))

## [2.62.2](https://github.com/Celasha/Toolasha/compare/v2.62.1...v2.62.2) (2026-06-06)

### Bug Fixes

- include task speed bonus in task completion time estimate ([2121c5d](https://github.com/Celasha/Toolasha/commit/2121c5d40219fc3abc2dad93bbfe49d2612ee39b))

## [2.62.1](https://github.com/Celasha/Toolasha/compare/v2.62.0...v2.62.1) (2026-06-06)

### Bug Fixes

- enhancement calculator speed uses manual override params ([2d41428](https://github.com/Celasha/Toolasha/commit/2d4142836b60a977870c3db5cf50e82c76f3d74a))
- respect 24-hour time format setting in action completion times ([1323558](https://github.com/Celasha/Toolasha/commit/1323558f413f5b279c53d01c8b348357f4178994))

## [2.62.0](https://github.com/Celasha/Toolasha/compare/v2.61.5...v2.62.0) (2026-06-06)

### Features

- add "Skip Back" toggle to combat sim upgrade analysis ([5375caf](https://github.com/Celasha/Toolasha/commit/5375caf711e2bd61186ec64f6e13177c15f693ca))

### Bug Fixes

- add effective (after-tax) price display to item tooltips ([10c1cf7](https://github.com/Celasha/Toolasha/commit/10c1cf77eaf39234f8f4738fd1f74f4ef7d9022c))
- exclude magic off-hands from melee upgrade recommendations ([9a11465](https://github.com/Celasha/Toolasha/commit/9a114655f1c04b126d8fd1edaa22186fb974b1ca))
- show labyrinth attempt number in battle counter ([5cbbcf3](https://github.com/Celasha/Toolasha/commit/5cbbcf30160e9d23d8fdb5ca6f2a0d26c4ef47ca))
- use correct config method for labyrinth number settings ([94b0802](https://github.com/Celasha/Toolasha/commit/94b08028b1351a5ae3b8dd8184e14dcb587b564e))
- use full zone data for boss task sim estimates ([8794215](https://github.com/Celasha/Toolasha/commit/8794215ab14b5b9cb66322d36ac389f051b865d3))

## [2.61.5](https://github.com/Celasha/Toolasha/compare/v2.61.4...v2.61.5) (2026-06-04)

### Bug Fixes

- add pricing mode toggle and XP/hr to best crafting plan ([55b1912](https://github.com/Celasha/Toolasha/commit/55b19126df2637cc13191640e5fc599c729862c6))

## [2.61.4](https://github.com/Celasha/Toolasha/compare/v2.61.3...v2.61.4) (2026-06-04)

### Bug Fixes

- initialize order book cache before listing price display ([ffb2779](https://github.com/Celasha/Toolasha/commit/ffb2779e955e58a06b515cbb82c3a1a5f82ee1ae))

## [2.61.3](https://github.com/Celasha/Toolasha/compare/v2.61.2...v2.61.3) (2026-06-04)

### Bug Fixes

- use approximate quantity matching for K/M/B abbreviated listings ([2bb092e](https://github.com/Celasha/Toolasha/commit/2bb092e86d0db816eca4680f586cabe50c6af9a8))

## [2.61.2](https://github.com/Celasha/Toolasha/compare/v2.61.1...v2.61.2) (2026-06-04)

### Bug Fixes

- add diagnostic logging for listing N/A display bug ([f01aed3](https://github.com/Celasha/Toolasha/commit/f01aed3cd99054d0ea9c260f013a7b734eef68a5))

## [2.61.1](https://github.com/Celasha/Toolasha/compare/v2.61.0...v2.61.1) (2026-06-04)

### Bug Fixes

- parse K/M/B suffixes in listing quantity matching ([98400c9](https://github.com/Celasha/Toolasha/commit/98400c92dfabc37e06f5de9cf3b2f0640c327bb6))

## [2.61.0](https://github.com/Celasha/Toolasha/compare/v2.60.0...v2.61.0) (2026-06-03)

### Features

- add item icons to pinned actions overview tab ([e980a16](https://github.com/Celasha/Toolasha/commit/e980a1618c6a392fb2273e69e8b4757eb1adc08d))
- add zone mode for combat task estimates with multi-task aggregate ([91dc511](https://github.com/Celasha/Toolasha/commit/91dc51114282402f130a9812b752813589ebc55f))
- auto-run combat estimates when task cards appear ([6727c0f](https://github.com/Celasha/Toolasha/commit/6727c0fd6298f9571a7f013586c3164c3d10f049))

### Bug Fixes

- add marketplace links to alchemy best items breakdown ([1a83a5d](https://github.com/Celasha/Toolasha/commit/1a83a5d74c22ebc7944a8b48d85fd1ecc858b44d))
- correct Chance Cape (R) HRID in enhancement auto-detect ([463352d](https://github.com/Celasha/Toolasha/commit/463352dd74f58c24424074c470833da1e66f3e30))
- prevent claim reward button from resizing with count ([01656bc](https://github.com/Celasha/Toolasha/commit/01656bcaebdf18e24280eaa33dba99867d4e1be0))

### Miscellaneous Chores

- add diagnostics for custom tab items disappearing on auto-switch ([885d42b](https://github.com/Celasha/Toolasha/commit/885d42b6ded0d978d2629136dc1d10be5a6d33b7))

## [2.60.0](https://github.com/Celasha/Toolasha/compare/v2.59.5...v2.60.0) (2026-06-03)

### Features

- add default loadout setting for combat sim estimates ([7f7d2fa](https://github.com/Celasha/Toolasha/commit/7f7d2fab6051d11d91ebe4cb180e3fec162d846c))
- show efficiency rating on combat task estimates ([d86a727](https://github.com/Celasha/Toolasha/commit/d86a7273c2ac186e1fa8ce335a1534f5d98a9b75))

### Bug Fixes

- detect earrings and back slot in gear scanner, add per-item breakdowns ([3af542d](https://github.com/Celasha/Toolasha/commit/3af542d9859f95ba9e16db5c7671b58062e0bf51))
- prevent combat quick input buttons from duplicating ([5cc9cf1](https://github.com/Celasha/Toolasha/commit/5cc9cf1a540a96e928bb0151722bb7e0612dd043))
- update market item counts when inventory changes ([c460c9c](https://github.com/Celasha/Toolasha/commit/c460c9c44cb0a469dce5846563d72e2f9fe46e81))

## [2.59.5](https://github.com/Celasha/Toolasha/compare/v2.59.4...v2.59.5) (2026-06-02)

### Bug Fixes

- add setting to hide combat estimate on task cards ([569fcdb](https://github.com/Celasha/Toolasha/commit/569fcdb95b00bae29f8b4f01a79ada307900a1b0))
- make enhancement stat breakdowns click-to-expand ([1683f25](https://github.com/Celasha/Toolasha/commit/1683f25a81a6b52103576effaabcd242077c5992))

## [2.59.4](https://github.com/Celasha/Toolasha/compare/v2.59.3...v2.59.4) (2026-06-02)

### Bug Fixes

- add marketplace navigation links to alchemy best items ([48f85ae](https://github.com/Celasha/Toolasha/commit/48f85aee814d2b5780d7f7a06c3746fe93087b3e))
- clear battle counter when switching from combat to skilling ([1047c0b](https://github.com/Celasha/Toolasha/commit/1047c0bbb42c55d679e0368e9d21eeb024dd0e33))
- include skillingRareFind in auto-detect gear calculations ([832ee94](https://github.com/Celasha/Toolasha/commit/832ee94c02b25304c71517ee8010b3d038ba32d4))

### Miscellaneous Chores

- display version number in settings tab title ([c3128f6](https://github.com/Celasha/Toolasha/commit/c3128f649d05dc55f65a0d490e4a77ed6afececc))

## [2.59.3](https://github.com/Celasha/Toolasha/compare/v2.59.2...v2.59.3) (2026-06-02)

### Bug Fixes

- recover WebSocket hook when primary interception fails ([bd538c2](https://github.com/Celasha/Toolasha/commit/bd538c29b2c408025b313c3695b3353a44c968ce))

## [2.59.2](https://github.com/Celasha/Toolasha/compare/v2.59.1...v2.59.2) (2026-06-01)

### Bug Fixes

- correct alchemy action type detection and missing level progress ([5f51513](https://github.com/Celasha/Toolasha/commit/5f51513185e1d4ee9a12d4808a1286bd3b27eb1c))

## [2.59.1](https://github.com/Celasha/Toolasha/compare/v2.59.0...v2.59.1) (2026-05-31)

### Bug Fixes

- action time display flickering due to missing space in parsed action name ([9c158eb](https://github.com/Celasha/Toolasha/commit/9c158eb9156d76e9cb28f30e75518efcf6d2db48))
- preserve alchemy target level calculator input across updates ([35d9409](https://github.com/Celasha/Toolasha/commit/35d9409059bff79226e0a71b0292e9a8b7e85455))

## [2.59.0](https://github.com/Celasha/Toolasha/compare/v2.58.5...v2.59.0) (2026-05-31)

### Features

- add gold-neutral effective XP/hr ranking for best overall action ([7bfa90b](https://github.com/Celasha/Toolasha/commit/7bfa90ba2cb9f7d41ff856a7f467b6f2699b1802))

## [2.58.5](https://github.com/Celasha/Toolasha/compare/v2.58.4...v2.58.5) (2026-05-31)

### Bug Fixes

- decouple action speed/time section from profit detail setting ([8e3793a](https://github.com/Celasha/Toolasha/commit/8e3793a1ed6b8ad98182a64100086cae1221473a))
- preserve target level calculator input across action completions ([a9661fa](https://github.com/Celasha/Toolasha/commit/a9661faa003b8d4804dbd0e96ec269a2ccdd7fea))

## [2.58.4](https://github.com/Celasha/Toolasha/compare/v2.58.3...v2.58.4) (2026-05-30)

### Bug Fixes

- always show all categories in net worth chart tooltip ([9c19648](https://github.com/Celasha/Toolasha/commit/9c1964845ad1043b25fc3fae3fda243a5247449a))

## [2.58.3](https://github.com/Celasha/Toolasha/compare/v2.58.2...v2.58.3) (2026-05-29)

### Bug Fixes

- add cross-slot weapon upgrade suggestions to combat advisor ([1b92f8e](https://github.com/Celasha/Toolasha/commit/1b92f8e12aa15ee14bc6c3f852f3f1eafbcc00cf))
- add quick input count presets to combat action modals ([df5fe78](https://github.com/Celasha/Toolasha/commit/df5fe78ad596a495880851334c1363ff048df00d))
- classify defensiveDamage-only items as defensive in upgrade advisor ([3ba942c](https://github.com/Celasha/Toolasha/commit/3ba942c8d72ec058d5f0be723f1799b26f8bd6ad))
- recommend tooltip now reflects actual target rate used ([e063be5](https://github.com/Celasha/Toolasha/commit/e063be51cf4f8ec8ac6576889754823e1bf6f358))
- sync recommend inputs with saved settings on re-inject ([6e1ec07](https://github.com/Celasha/Toolasha/commit/6e1ec0777e61328e21d550dc9cf394d72609c2da))

### Code Refactoring

- remove skilling buff candidates from combat upgrade analysis ([5446f6a](https://github.com/Celasha/Toolasha/commit/5446f6a451eddc6209352011928f7adf0901b67a))

## [2.58.2](https://github.com/Celasha/Toolasha/compare/v2.58.1...v2.58.2) (2026-05-29)

### Bug Fixes

- clear history now persists across page refresh ([af9a9f1](https://github.com/Celasha/Toolasha/commit/af9a9f154e7b4d198aa40d530fce19e63f4d46c1))

## [2.58.1](https://github.com/Celasha/Toolasha/compare/v2.58.0...v2.58.1) (2026-05-28)

### Bug Fixes

- add resizable lab sim panel and collapsible loadout section ([e1178f5](https://github.com/Celasha/Toolasha/commit/e1178f5d5f13942cde1d61b18ea346e0feb8de89))

## [2.58.0](https://github.com/Celasha/Toolasha/compare/v2.57.1...v2.58.0) (2026-05-28)

### Features

- add per-skill filter for skilling upgrade analysis ([c9091f0](https://github.com/Celasha/Toolasha/commit/c9091f015a3ec8b50e8b13c0d2297769a19387c9))
- add resizable combat simulator panel ([d30d0b8](https://github.com/Celasha/Toolasha/commit/d30d0b86731ee415d841a6990e0331efc55d08d2))
- add transmute recycle time estimate to action timer ([f1bfb84](https://github.com/Celasha/Toolasha/commit/f1bfb849d3c088bb9d8393be1a7e529348d5ebc9))

### Bug Fixes

- prevent skilling editor overlap when upgrade results display ([88b8a54](https://github.com/Celasha/Toolasha/commit/88b8a54b49cbd460ffd025565d6d5f0b712b4827))
- pull skilling loadouts from game lab automation settings ([b212e47](https://github.com/Celasha/Toolasha/commit/b212e473cae738556286a228296ad66e684e4eb7))
- sort upgrade tables by cost efficiency and skip irrelevant slots ([1b4a4b8](https://github.com/Celasha/Toolasha/commit/1b4a4b88441aa60d18238f21d4fa04a3b6749365))

## [2.57.1](https://github.com/Celasha/Toolasha/compare/v2.57.0...v2.57.1) (2026-05-28)

### Bug Fixes

- collection tiles displaced when unfavoriting an item ([ca97fb1](https://github.com/Celasha/Toolasha/commit/ca97fb1aac35a11776881322ff7723aaa85fb928))

## [2.57.0](https://github.com/Celasha/Toolasha/compare/v2.56.0...v2.57.0) (2026-05-28)

### Features

- add skilling room simulation tab to Lab Simulator ([3e85838](https://github.com/Celasha/Toolasha/commit/3e858385c3f68c37ec3650c165885f500687c85c))

### Bug Fixes

- show remaining/total time in live countdown timer ([1606675](https://github.com/Celasha/Toolasha/commit/160667521e33da4b60912e6c53f8b3cf2355ecee))

## [2.56.0](https://github.com/Celasha/Toolasha/compare/v2.55.1...v2.56.0) (2026-05-28)

### Features

- add inline target win rate and sim hours to recommend controls ([63bc8b9](https://github.com/Celasha/Toolasha/commit/63bc8b9dba8232bbf3701a0522a2bb68643f5dff))
- add Tokens/1% column and sortable headers to upgrade tables ([2df1c7a](https://github.com/Celasha/Toolasha/commit/2df1c7a8e27ef0f8ec2339f3298cc19310d7db32))
- use custom loadout order in sim editor dropdowns ([28d0867](https://github.com/Celasha/Toolasha/commit/28d086790848e1160fa8395c3ffae06885c8672d))

### Bug Fixes

- include bulkMultiplier in alchemy coin cost formulas ([4e6d9e2](https://github.com/Celasha/Toolasha/commit/4e6d9e233926c33144677f27c39317ea26e38f69))
- use correct dev-confirmed coin cost formulas for alchemy ([f29d1f4](https://github.com/Celasha/Toolasha/commit/f29d1f46e8fe72c19bb48c37575247b8420436df))

## [2.55.1](https://github.com/Celasha/Toolasha/compare/v2.55.0...v2.55.1) (2026-05-27)

### Bug Fixes

- match action bar display against front action by ordinal ([7149e1a](https://github.com/Celasha/Toolasha/commit/7149e1a202a6a337c2e9896f4e4b9fb8fcf8ebce))

## [2.55.0](https://github.com/Celasha/Toolasha/compare/v2.54.0...v2.55.0) (2026-05-27)

### Features

- add favorites section to collection panel ([65f9b0c](https://github.com/Celasha/Toolasha/commit/65f9b0c29acdbf7f41c358dc3427fd3b2449f2a1))

### Bug Fixes

- correct lab sim win rate to use attempt count ([735d34d](https://github.com/Celasha/Toolasha/commit/735d34d60b8b9cfdeadc45d3379bae549d5a9fc6))
- decouple task timing and materials from profit display setting ([5b09b73](https://github.com/Celasha/Toolasha/commit/5b09b73d2ad996e8c2e0d0b91313d85d67ef953c))
- improve action bar info reliability and alchemy cost calculation ([dded17b](https://github.com/Celasha/Toolasha/commit/dded17ba0992f0575060b18f8e1ba5c056d6928c))
- prevent queue monitor race from showing stale snapshots ([e03375b](https://github.com/Celasha/Toolasha/commit/e03375bcf883699ceba12f3d5907a9dd6da2a878))
- scale labyrinth token upgrade costs by level ([9875ca8](https://github.com/Celasha/Toolasha/commit/9875ca8d03c24e281294bd1143c5e8f8e27ab9d9))
- strip equipped food and drinks from labyrinth simulations ([457f75e](https://github.com/Celasha/Toolasha/commit/457f75e1dd75de310152e7d62abf5b3754d23a41))

## [2.54.0](https://github.com/Celasha/Toolasha/compare/v2.53.1...v2.54.0) (2026-05-26)

### Features

- add task auto-reroll reminder ([4bd3267](https://github.com/Celasha/Toolasha/commit/4bd326792cada05301f416ac530dbcf2540690a4))
- persist and display historical loot log entries ([0739f97](https://github.com/Celasha/Toolasha/commit/0739f97a8d6f6442c485c275fc0df604d7e191e3))

### Bug Fixes

- correct parameter passing in lab simulator max level search ([aedc6c5](https://github.com/Celasha/Toolasha/commit/aedc6c5940362001c739a79c79c4cd1afd334df1))
- refresh action bar stats when actions_updated arrives ([a8f7da9](https://github.com/Celasha/Toolasha/commit/a8f7da95d8416e8fd058934020715764817e220f))
- write queue snapshots immediately to prevent stale data on re-init ([640ba90](https://github.com/Celasha/Toolasha/commit/640ba900207626eff56371ef82d0ee78fec3160d))

## [2.53.1](https://github.com/Celasha/Toolasha/compare/v2.53.0...v2.53.1) (2026-05-25)

### Bug Fixes

- use additive formula for alchemy success rate with catalyst and tea ([4fd39f9](https://github.com/Celasha/Toolasha/commit/4fd39f91362861f329ffac745851d177493fc3d2))

## [2.53.0](https://github.com/Celasha/Toolasha/compare/v2.52.1...v2.53.0) (2026-05-25)

### Features

- add ÷2 and ×2 multiplier buttons to marketplace order dialogs ([d2c288f](https://github.com/Celasha/Toolasha/commit/d2c288f8071f5cd41174b8120009dcc04a264090))
- add labyrinth clear rate calculator with tooltips, recommendations, and live progress ([15eefb8](https://github.com/Celasha/Toolasha/commit/15eefb8fc774411abe8dfda40b6969b4bfe5be54))
- adjust tooltip prices for Artisan Tea material reduction ([ed3ade8](https://github.com/Celasha/Toolasha/commit/ed3ade872856def0b0a6a10e54f482489ff6f8c3))
- show owned item count in buy marketplace dialogs ([c4295cf](https://github.com/Celasha/Toolasha/commit/c4295cfbb747e4ada0864988783451054bdfbd8d))
- split combat sim into separate Combat Sim and Lab Sim dialogs ([0fc8ecd](https://github.com/Celasha/Toolasha/commit/0fc8ecdc000c8d9146e6639d16a38d12c56a1b9c))

### Bug Fixes

- alchemy tooltip per-action profit now includes tea costs and bonus drops ([c0157e9](https://github.com/Celasha/Toolasha/commit/c0157e9ad23123545e33b8a0bfc42fb719ce6777))
- restore action bar display when starting new actions after character switch ([3b2a9b0](https://github.com/Celasha/Toolasha/commit/3b2a9b0665dfb3ea671631462cb4346426de8b1c))
- update item level overlay when enhancement selector changes items ([987728e](https://github.com/Celasha/Toolasha/commit/987728e20c9119a9524d320f248e6fbf6a5dd7a6))
- use itemLevel instead of equip requirement for enhancement calculations ([27a6a36](https://github.com/Celasha/Toolasha/commit/27a6a36441bc162238a91f1b84f7cc734884a8fe))

## [2.52.1](https://github.com/Celasha/Toolasha/compare/v2.52.0...v2.52.1) (2026-05-23)

### Bug Fixes

- add individual toggles for skill page filter bar elements ([64fa177](https://github.com/Celasha/Toolasha/commit/64fa177d237e83f8770e25ff44ed191735234e54))

## [2.52.0](https://github.com/Celasha/Toolasha/compare/v2.51.3...v2.52.0) (2026-05-23)

### Features

- add option to hide item tooltips in enhance selector ([41ec17f](https://github.com/Celasha/Toolasha/commit/41ec17f62efa8239752a2d66b268a1a68c006744))

## [2.51.3](https://github.com/Celasha/Toolasha/compare/v2.51.2...v2.51.3) (2026-05-23)

### Bug Fixes

- remove double-counted catalyst cost from alchemy profit/hr ([00f7fdf](https://github.com/Celasha/Toolasha/commit/00f7fdfab8a0870ea43e1e81a2af6d741479ffce))

## [2.51.2](https://github.com/Celasha/Toolasha/compare/v2.51.1...v2.51.2) (2026-05-22)

### Bug Fixes

- include boss drops in combat sim Seek item list ([67ae395](https://github.com/Celasha/Toolasha/commit/67ae395c333a7023093778be781e922ede17d387))

## [2.51.1](https://github.com/Celasha/Toolasha/compare/v2.51.0...v2.51.1) (2026-05-22)

### Bug Fixes

- restore total action time when countdown is disabled ([a87f195](https://github.com/Celasha/Toolasha/commit/a87f195445947cd190601c8c210055e4019000dc))

### Code Refactoring

- replace action bar preset modes with granular toggles ([c95f106](https://github.com/Celasha/Toolasha/commit/c95f10623611436209145567bb5d777c095294e1))

## [2.51.0](https://github.com/Celasha/Toolasha/compare/v2.50.2...v2.51.0) (2026-05-21)

### Features

- add "Return to Action" tab in missing materials marketplace ([4d3fc7d](https://github.com/Celasha/Toolasha/commit/4d3fc7dd5ad57b73634ee9a5f476b27f392e9b9d))
- add expandable profit breakdown to alchemy Best Items rows ([bc2c0a6](https://github.com/Celasha/Toolasha/commit/bc2c0a63a6ed3f812455822373642761a75490ed))

### Bug Fixes

- use precise formatting for listing price columns ([80c497b](https://github.com/Celasha/Toolasha/commit/80c497b89259268909235351adfd9da797e0b106))

## [2.50.2](https://github.com/Celasha/Toolasha/compare/v2.50.1...v2.50.2) (2026-05-21)

### Bug Fixes

- refresh pinned actions page immediately when pins change ([5d8b11c](https://github.com/Celasha/Toolasha/commit/5d8b11c88dae336648ba64db8f9215e232742aa6))

### Performance Improvements

- memoize craft chain calculations and replace recursive fibonacci ([d047c54](https://github.com/Celasha/Toolasha/commit/d047c54c969d61fbc858b163dcf658048cd61f29))

## [2.50.1](https://github.com/Celasha/Toolasha/compare/v2.50.0...v2.50.1) (2026-05-20)

### Bug Fixes

- avoid double-wrapping WebSocket when other userscripts are present ([f966430](https://github.com/Celasha/Toolasha/commit/f966430b98d183273e1638895ca5ff0f99779bbc))
- show limiting material icon on active action timer ([3ed1db6](https://github.com/Celasha/Toolasha/commit/3ed1db6eb6279a37ddaf2636f3e95cd0a7a32e28))

## [2.50.0](https://github.com/Celasha/Toolasha/compare/v2.49.3...v2.50.0) (2026-05-20)

### Features

- add pin icon to alchemy actions for item-specific pinning ([eb77a5e](https://github.com/Celasha/Toolasha/commit/eb77a5e7b1057c205d00780517bccbd07a5a35ee))

### Bug Fixes

- check gold and catalyst limits in alchemy depletion timer ([420bec3](https://github.com/Celasha/Toolasha/commit/420bec3f1c6ed226a8718460d53685cfd88eabc0))

## [2.49.3](https://github.com/Celasha/Toolasha/compare/v2.49.2...v2.49.3) (2026-05-20)

### Bug Fixes

- include enhancement level in badge manager inventory lookup key ([f6a3832](https://github.com/Celasha/Toolasha/commit/f6a38323cff5d7fce8750105d1fbb7634d25b7a2))
- replace own-property anti-loop with WeakSet guard in WS hook ([cce3f2b](https://github.com/Celasha/Toolasha/commit/cce3f2be30e6e44074deac4153b6a2edde9ddd5c))
- use setSetting for craft toggle button ([107f943](https://github.com/Celasha/Toolasha/commit/107f943b93a087d5c7c8e26d1f30f5dc99e5771a))

## [2.49.2](https://github.com/Celasha/Toolasha/compare/v2.49.1...v2.49.2) (2026-05-19)

### Bug Fixes

- deduct key cost from chest badge values ([33f6de2](https://github.com/Celasha/Toolasha/commit/33f6de27b67f5d9bba7c1ca7d2dd8e0810e401e0))

### Code Refactoring

- add craft toggle button to action panel ([bd77461](https://github.com/Celasha/Toolasha/commit/bd774618be0c26540dad000b67657967b36a74f8))

## [2.49.1](https://github.com/Celasha/Toolasha/compare/v2.49.0...v2.49.1) (2026-05-19)

### Bug Fixes

- include crafting chain time in profit/hr for upgrade items ([0f656d6](https://github.com/Celasha/Toolasha/commit/0f656d69542d8002832dc6a7470a0705ca385181))

## [2.49.0](https://github.com/Celasha/Toolasha/compare/v2.48.3...v2.49.0) (2026-05-19)

### Features

- add colored delta indicators to net worth chart tooltip ([4638dd5](https://github.com/Celasha/Toolasha/commit/4638dd5e3d114ac841482286b0875d5dfbd590c0))
- auto-calculate optimal protection for enhancement missing mats ([a423a44](https://github.com/Celasha/Toolasha/commit/a423a44f53f7bcc47ed8fdab9d8e926695202333))

### Bug Fixes

- guard against null skills in auto-detected enhancement params ([6c7ad15](https://github.com/Celasha/Toolasha/commit/6c7ad15f39d1d1afdb9d2dc487edd43956fcd40f))
- improve enhancement tooltip protection labels ([eb8843d](https://github.com/Celasha/Toolasha/commit/eb8843dad53a9d3f6a5dbb2c28c65d65a62434a2))

## [2.48.3](https://github.com/Celasha/Toolasha/compare/v2.48.2...v2.48.3) (2026-05-18)

### Bug Fixes

- add ring, earring, and speed necklace to enhancement simulator ([a182d46](https://github.com/Celasha/Toolasha/commit/a182d46ea32e6e14d449ff628717c3ca219fb64e))
- protect Add to Queue button in alchemy action protection ([1794bb6](https://github.com/Celasha/Toolasha/commit/1794bb6295bb4083574cbdccb78ffded2245f1df))
- reposition alchemy protection shield above item icon box ([b6f95cb](https://github.com/Celasha/Toolasha/commit/b6f95cbb6f41689a8fba12efdf47978573ec6d95))
- update housing missing mats display when room level changes ([e375cff](https://github.com/Celasha/Toolasha/commit/e375cff2cec5e779dc0cd26ee8a265ae44ab6ac4))
- use correct property name for item tradeability checks ([bb6bcd3](https://github.com/Celasha/Toolasha/commit/bb6bcd3cae283c4daac6ff108de88bc3a889b886))

### Styles

- reduce alchemy protection popup spacing to avoid scrolling ([75d9342](https://github.com/Celasha/Toolasha/commit/75d934237811833044fadceb92d1bc6daaefe25d))

## [2.48.2](https://github.com/Celasha/Toolasha/compare/v2.48.1...v2.48.2) (2026-05-18)

### Bug Fixes

- show buy vs craft label on upgrade items in tooltip ([a3039c9](https://github.com/Celasha/Toolasha/commit/a3039c945d388b646d2f429cb15326e60debc793))

## [2.48.1](https://github.com/Celasha/Toolasha/compare/v2.48.0...v2.48.1) (2026-05-18)

### Bug Fixes

- use blob URL for popout chat to prevent Firefox game disconnect ([7c6230f](https://github.com/Celasha/Toolasha/commit/7c6230fcb4b984bcab44d3f5f812cb2bbb07f5bc))
- use min(market, craft) for upgrade items in tooltip material cost ([0fba5bb](https://github.com/Celasha/Toolasha/commit/0fba5bbf50a6024fbafdfb1ec02534ec92b23952))

## [2.48.0](https://github.com/Celasha/Toolasha/compare/v2.47.5...v2.48.0) (2026-05-17)

### Features

- add alchemy action protection for item categories ([b5abb5f](https://github.com/Celasha/Toolasha/commit/b5abb5fd97222ea14aceaa25e3474a36f1203279))

### Bug Fixes

- hide action queue profit display in iron cow mode ([5b9f86e](https://github.com/Celasha/Toolasha/commit/5b9f86ed26ba29051be278942c08a653f28a5712))

### Miscellaneous Chores

- add comprehensive debugging to chat popout for Firefox issue ([19bcb1d](https://github.com/Celasha/Toolasha/commit/19bcb1da22bfa4278ec41c2ebf258ef97621438d))

## [2.47.5](https://github.com/Celasha/Toolasha/compare/v2.47.4...v2.47.5) (2026-05-17)

### Bug Fixes

- include houses, abilities, and listings in 24h networth breakdown ([f8c33ce](https://github.com/Celasha/Toolasha/commit/f8c33ce5f876e322d389e376c2d0118740474a5e))

## [2.47.4](https://github.com/Celasha/Toolasha/compare/v2.47.3...v2.47.4) (2026-05-17)

### Bug Fixes

- clear combat sim cached state on destroy to prevent stale data after character switch ([1e74b18](https://github.com/Celasha/Toolasha/commit/1e74b182adcaa0f158f07bfc5f454c460bdf25de))
- separate gold from inventory in chart breakdown and prevent popout from closing chart ([7bba3c9](https://github.com/Celasha/Toolasha/commit/7bba3c92aa04b13317fb47e116a9c492beee23d9))
- use cheaper of market vs craft cost for upgrade items in production cost ([e5febe3](https://github.com/Celasha/Toolasha/commit/e5febe33fb74c70153bb20f52de949877375d1ec))

## [2.47.3](https://github.com/Celasha/Toolasha/compare/v2.47.2...v2.47.3) (2026-05-17)

### Bug Fixes

- remove orphaned timer element before creating new display panel ([40146c6](https://github.com/Celasha/Toolasha/commit/40146c6d62ad96a4fde390b45070e8fca043fbd7))

## [2.47.2](https://github.com/Celasha/Toolasha/compare/v2.47.1...v2.47.2) (2026-05-17)

### Bug Fixes

- exclude filter flags from buildFlags when filters setting is disabled ([a501f12](https://github.com/Celasha/Toolasha/commit/a501f12b4e402fe516f3b83918fcb0903bc4372d))
- use standard enhancement multiplier for XP bonus calculations ([06c2fd7](https://github.com/Celasha/Toolasha/commit/06c2fd70b0a7ecaa59693c2ec8c6b444943a6465))

## [2.47.1](https://github.com/Celasha/Toolasha/compare/v2.47.0...v2.47.1) (2026-05-16)

### Bug Fixes

- add charm slot and missing wisdom sources to enhancement sim ([c9bc783](https://github.com/Celasha/Toolasha/commit/c9bc783ee70f26d3f8dc0b7d4569d419cef81478))
- use auto-detected stats for untradeable item enhancement paths ([91a41eb](https://github.com/Celasha/Toolasha/commit/91a41ebfa9792f724350e1cac963b6dabb987f02))
- use live tab data for missing mats buy quantity autofill ([c8cb565](https://github.com/Celasha/Toolasha/commit/c8cb565f6648faebecd3982b3f87539c1d683ba7))

## [2.47.0](https://github.com/Celasha/Toolasha/compare/v2.46.1...v2.47.0) (2026-05-16)

### Features

- add custom quick input presets for marketplace dialogs ([6625952](https://github.com/Celasha/Toolasha/commit/66259523701fe0a8d2e4d7d13fb14651fa3bb681))

### Bug Fixes

- add toggle to exclude cowbell value from EV calculations ([b41bdde](https://github.com/Celasha/Toolasha/commit/b41bdde53d7b2b5a4c8fc89ab986e66a847c2d25))
- split collection filters and favorites into independent settings ([347c288](https://github.com/Celasha/Toolasha/commit/347c28827494f71415abba9a0cc0259e1966ba11))

## [2.46.1](https://github.com/Celasha/Toolasha/compare/v2.46.0...v2.46.1) (2026-05-15)

### Bug Fixes

- resolve PFormance empty data in library-split production build ([273b997](https://github.com/Celasha/Toolasha/commit/273b997214dbf9719541b6d2447285adbd4e0829))

## [2.46.0](https://github.com/Celasha/Toolasha/compare/v2.45.1...v2.46.0) (2026-05-15)

### Features

- add increment-based ability level targeting to upgrade advisor ([cdb0677](https://github.com/Celasha/Toolasha/commit/cdb0677f42d65ee15fe99c7483dee0f1e5131722))
- add PFormance panel and fix ability book cost calculation ([a23127d](https://github.com/Celasha/Toolasha/commit/a23127d3d6ee1a2f39a4fda95b9d7e4fc8cda021))

### Performance Improvements

- gate PFormance monitoring to only run when panel is open ([f7ad9f6](https://github.com/Celasha/Toolasha/commit/f7ad9f659dbc37be4e774a5b28f2498f86988937))

## [2.45.1](https://github.com/Celasha/Toolasha/compare/v2.45.0...v2.45.1) (2026-05-15)

### Bug Fixes

- populate auto-detected enhancement values on settings panel open ([24ff25c](https://github.com/Celasha/Toolasha/commit/24ff25cfc1ffb7db59e651c73716df7c9fbfa30d))

## [2.45.0](https://github.com/Celasha/Toolasha/compare/v2.44.1...v2.45.0) (2026-05-15)

### Features

- add live countdown timer to action progress bar ([a01b93d](https://github.com/Celasha/Toolasha/commit/a01b93d2a90d832ffc90c86802816a1046a172c5))

### Bug Fixes

- add equipment and ability picker dropdowns to combat sim ([bd4dcde](https://github.com/Celasha/Toolasha/commit/bd4dcde231918e0c3d5b795cba154042ca4a963a))
- detect achievement and community buff in enhancement auto-detect ([6bdebde](https://github.com/Celasha/Toolasha/commit/6bdebde1f9623d249186e18e85ccb7664c084042))
- prevent chat popout from loading full game URL in Firefox ([4c6ff67](https://github.com/Celasha/Toolasha/commit/4c6ff67ed9830968d29cc4324b70afceb8a82df0))
- update housing missing mats marketplace tabs on inventory change ([0d3888a](https://github.com/Celasha/Toolasha/commit/0d3888a0972797787cbe04c56fdcd3b713ce2812))
- use centered moving average for networth chart ([444bf8f](https://github.com/Celasha/Toolasha/commit/444bf8fb8e2692a204b9ef41bc43652e968c3726))

## [2.44.1](https://github.com/Celasha/Toolasha/compare/v2.44.0...v2.44.1) (2026-05-14)

### Bug Fixes

- recreate action timer display when React re-renders orphan it ([c5215de](https://github.com/Celasha/Toolasha/commit/c5215de2cdb6b0e92d4c34724d56e66a0b19cf07))

## [2.44.0](https://github.com/Celasha/Toolasha/compare/v2.43.0...v2.44.0) (2026-05-12)

### Features

- auto-sync custom tab items when loadout equipment changes ([2aea8f9](https://github.com/Celasha/Toolasha/commit/2aea8f9418dc1ab58794274d038b6a0ad1ab6467))
- auto-update bindings and snapshots when higher enhancement is acquired ([e51274a](https://github.com/Celasha/Toolasha/commit/e51274a91e39bc07597a1632b48eff72c1e50525))

### Bug Fixes

- export all Toolasha settings and filter imports by character ID ([7852573](https://github.com/Celasha/Toolasha/commit/7852573ce96459b44e645fd13073bf2d25141662))
- floating point precision in enhancement calculator level display ([577b8fa](https://github.com/Celasha/Toolasha/commit/577b8fabf2bbba95650a3e16e30a7cdda22ff14c))
- handle enhancement downgrades when higher version is sold ([e18ef23](https://github.com/Celasha/Toolasha/commit/e18ef23b0021c2b801f72705287d16b42c2fbe2f))
- update housing missing mats display when inventory changes ([99f0e54](https://github.com/Celasha/Toolasha/commit/99f0e54ebc81db2fd3689b941c495d57fbae0cf9))
- use all learned ability levels when applying loadout ([10cd391](https://github.com/Celasha/Toolasha/commit/10cd3914967324ef8c54d04d9048675f64b45bad))

### Code Refactoring

- replace raw enhancement sim inputs with gear-based settings ([8a15d64](https://github.com/Celasha/Toolasha/commit/8a15d64df657a7ea8d95bb50636437309e74af58))

## [2.43.0](https://github.com/Celasha/Toolasha/compare/v2.42.3...v2.43.0) (2026-05-11)

### Features

- add labyrinth combat simulator ([68ada69](https://github.com/Celasha/Toolasha/commit/68ada69e9bfd9dbb6b565b5b35efdb9cb7a2b50a))

## [2.42.3](https://github.com/Celasha/Toolasha/compare/v2.42.2...v2.42.3) (2026-05-11)

### Performance Improvements

- optimize fury stack calculations in combat sim ([ca2ebe3](https://github.com/Celasha/Toolasha/commit/ca2ebe371ed45a894efedcb90e96565c3d03d89b))

## [2.42.2](https://github.com/Celasha/Toolasha/compare/v2.42.1...v2.42.2) (2026-05-10)

### Bug Fixes

- exclude enhanced items when counting enhancement protection materials ([853f416](https://github.com/Celasha/Toolasha/commit/853f41675ca73002489704ec5c8ae3406bef52f3))
- show each enhancement level separately in exclude list ([7ba4a46](https://github.com/Celasha/Toolasha/commit/7ba4a4626b3e5ef37d3bbedb7b0f078e19f41e11))

## [2.42.1](https://github.com/Celasha/Toolasha/compare/v2.42.0...v2.42.1) (2026-05-10)

### Bug Fixes

- use auto-detected enhancing stats for back slot upgrade costs ([f3b4803](https://github.com/Celasha/Toolasha/commit/f3b480372f2a8c12c7badb0ef1070e62879bc3c3))

## [2.42.0](https://github.com/Celasha/Toolasha/compare/v2.41.6...v2.42.0) (2026-05-10)

### Features

- add ability upgrade testing and revamp results display in combat sim ([1fbf4c3](https://github.com/Celasha/Toolasha/commit/1fbf4c3c7546115e3d19dc732c9cfa3a5cba49ba))
- add search and price/profit filters to alchemy best items ([c689870](https://github.com/Celasha/Toolasha/commit/c689870b2a4aefa4adf3c26194c2cae4f4f87bce))
- add slot-specific enhancement breakpoints for upgrade advisor ([7d745ce](https://github.com/Celasha/Toolasha/commit/7d745ce678b9fb82affd92c7b5e4f812f620675b))

### Bug Fixes

- prevent chart from closing when clicking delete point popup ([4c1840a](https://github.com/Celasha/Toolasha/commit/4c1840a5c0c6228e874bd57279e3d8c54d8d593e))
- use crafting chain for defensive equipment tier upgrades in combat sim ([9341c99](https://github.com/Celasha/Toolasha/commit/9341c9972a89ee0b6e60e154b65c72efaa65dae9))

## [2.41.6](https://github.com/Celasha/Toolasha/compare/v2.41.5...v2.41.6) (2026-05-10)

### Bug Fixes

- add 48h, 7d, and custom duration options to chart moving average ([443a21f](https://github.com/Celasha/Toolasha/commit/443a21f36de68d8fff29832c774138b181ddfa56))
- factor alchemy success rate into estimated output totals ([81cb107](https://github.com/Celasha/Toolasha/commit/81cb107e6c837b35a42efe9cf9fc5ca86c838913))
- prevent bar chart whitespace and y-axis starting at zero ([4052653](https://github.com/Celasha/Toolasha/commit/4052653db99016dfa037a9308c2eaa701bc9b85b))
- prioritize selected tab over queued action in tea optimizer ([df92d56](https://github.com/Celasha/Toolasha/commit/df92d56c45371e15b95d3bbea6b79e2d68cfe693))

## [2.41.5](https://github.com/Celasha/Toolasha/compare/v2.41.4...v2.41.5) (2026-05-09)

### Bug Fixes

- use action category to identify processing instead of input count ([400ea88](https://github.com/Celasha/Toolasha/commit/400ea887fcaf01ac33c75bd51da2591dc156b466))

## [2.41.4](https://github.com/Celasha/Toolasha/compare/v2.41.3...v2.41.4) (2026-05-09)

### Bug Fixes

- open marketplace with material tabs instead of just first item ([9ff7daf](https://github.com/Celasha/Toolasha/commit/9ff7daf9efda3042a67dae417c6416aa03fad366))

## [2.41.3](https://github.com/Celasha/Toolasha/compare/v2.41.2...v2.41.3) (2026-05-09)

### Bug Fixes

- use game shop price in crafting plan when cheaper than market ([f0e95bf](https://github.com/Celasha/Toolasha/commit/f0e95bfb22ad12dba49d3b75512128cd61057def))

## [2.41.2](https://github.com/Celasha/Toolasha/compare/v2.41.1...v2.41.2) (2026-05-09)

### Bug Fixes

- use action-based filter for no-processing instead of depth limit ([61369d7](https://github.com/Celasha/Toolasha/commit/61369d738f80a4b9f116ee9a20eff05ebe36a86f))

## [2.41.1](https://github.com/Celasha/Toolasha/compare/v2.41.0...v2.41.1) (2026-05-09)

### Bug Fixes

- prioritize maxActionCountInput over generic number input lookup ([8b7e8fa](https://github.com/Celasha/Toolasha/commit/8b7e8fa67c372236aa0b4a69a5e52c506bca7e4d))

## [2.41.0](https://github.com/Celasha/Toolasha/compare/v2.40.7...v2.41.0) (2026-05-09)

### Features

- add task mode, no processing, and missing mats button to crafting plan ([8a8f96a](https://github.com/Celasha/Toolasha/commit/8a8f96a1a86521a8dd8200bb528dfa1e9d8c4639))
- add time cost factor to crafting plan buy-vs-craft decisions ([51e0966](https://github.com/Celasha/Toolasha/commit/51e096633e36b71bbe95e4b413d5d57b4e8ec90b))

### Bug Fixes

- add setting to hide green highlight on protected tasks ([1f322ae](https://github.com/Celasha/Toolasha/commit/1f322ae40816272d9ce6b280ef392bb9935ec7c7))
- clear autofill quantity after single use in buy modals ([8c99961](https://github.com/Celasha/Toolasha/commit/8c99961c16fb8478c296de255a72a331e2f7f71f))
- restrict action header match to current action only ([b5671c7](https://github.com/Celasha/Toolasha/commit/b5671c78fbec5c7c0e06ff8b0bd692a3f13ce0f9))

## [2.40.7](https://github.com/Celasha/Toolasha/compare/v2.40.6...v2.40.7) (2026-05-08)

### Bug Fixes

- correct combat level formula for party level gap debuff ([7a51549](https://github.com/Celasha/Toolasha/commit/7a515498e6698971150c1f56b98cf0ab2f87dba9))

## [2.40.6](https://github.com/Celasha/Toolasha/compare/v2.40.5...v2.40.6) (2026-05-07)

### Bug Fixes

- use incremental cost approach for upgrade advisor enhancement pricing ([0fa2275](https://github.com/Celasha/Toolasha/commit/0fa22753e2f57489fbd50408e1d30a9501feadd5))

## [2.40.5](https://github.com/Celasha/Toolasha/compare/v2.40.4...v2.40.5) (2026-05-07)

### Bug Fixes

- use direct market lookups for upgrade advisor cost to prevent false zero costs ([56d7281](https://github.com/Celasha/Toolasha/commit/56d72818a42c1c753f9945ef5863ba56e3b386a2))

## [2.40.4](https://github.com/Celasha/Toolasha/compare/v2.40.3...v2.40.4) (2026-05-07)

### Bug Fixes

- handle null market prices in upgrade advisor fallback and add debug logging ([0691b78](https://github.com/Celasha/Toolasha/commit/0691b781e3a2877a6345579ec3c85f817e96168f))

## [2.40.3](https://github.com/Celasha/Toolasha/compare/v2.40.2...v2.40.3) (2026-05-07)

### Bug Fixes

- correct upgrade advisor enhancement cost fallback pricing ([4635e80](https://github.com/Celasha/Toolasha/commit/4635e806e3e383d71e0e2ab6948e332e3e30e4e4))

## [2.40.2](https://github.com/Celasha/Toolasha/compare/v2.40.1...v2.40.2) (2026-05-07)

### Bug Fixes

- use market price deltas for upgrade advisor cost calculation ([6b9cc7d](https://github.com/Celasha/Toolasha/commit/6b9cc7da4769af04d176b8718c989c6d6795bd03))

## [2.40.1](https://github.com/Celasha/Toolasha/compare/v2.40.0...v2.40.1) (2026-05-07)

### Bug Fixes

- distinguish magic elements in upgrade advisor tier comparisons ([d4892f9](https://github.com/Celasha/Toolasha/commit/d4892f90637ae08b9849808bcf2c1b80249cf0ea))

## [2.40.0](https://github.com/Celasha/Toolasha/compare/v2.39.5...v2.40.0) (2026-05-07)

### Features

- add combat sim upgrade advisor tab ([a3fe6a4](https://github.com/Celasha/Toolasha/commit/a3fe6a4f849ccff0cc1843bf82469dd71644905b))
- add setting to show dungeon completion time as decimal minutes ([064d645](https://github.com/Celasha/Toolasha/commit/064d6454ad0283f66173f7a8b23965adbfd668e0))

### Bug Fixes

- allow disabling currency token tooltips setting ([c4a2941](https://github.com/Celasha/Toolasha/commit/c4a29415ca506f72bc579f1e1676e22e0b78a911))
- correct dungeon sim profit calculation and comparison deltas ([4aa724e](https://github.com/Celasha/Toolasha/commit/4aa724e764f6f421171073bf966862f386345cc8))
- use correct storage method and key in settings reset ([6fcc73e](https://github.com/Celasha/Toolasha/commit/6fcc73e4e8b669317bc05151df5451ed243e82d4))
- use index 0 for best bid in listing price display ([cf864be](https://github.com/Celasha/Toolasha/commit/cf864bece8e9e7c456ed4561ee7b9bea947e35bf))

## [2.39.5](https://github.com/Celasha/Toolasha/compare/v2.39.4...v2.39.5) (2026-05-07)

### Bug Fixes

- correct 11 combat sim engine discrepancies vs reference implementation ([8e6bbc3](https://github.com/Celasha/Toolasha/commit/8e6bbc36a7c3d56cfe6fa82529cfdb373fbf0a20))
- remove premature storage read in networth chart constructor ([3c8c485](https://github.com/Celasha/Toolasha/commit/3c8c485a705fc94c009fabd339a68b9972d43af2))

## [2.39.4](https://github.com/Celasha/Toolasha/compare/v2.39.3...v2.39.4) (2026-05-07)

### Bug Fixes

- aggregate healingAmplify from buffs in combat sim ([7620a76](https://github.com/Celasha/Toolasha/commit/7620a764955bef03b1defc0305b200f7d74c870b))

## [2.39.3](https://github.com/Celasha/Toolasha/compare/v2.39.2...v2.39.3) (2026-05-06)

### Bug Fixes

- close net worth chart on click outside ([e90306b](https://github.com/Celasha/Toolasha/commit/e90306bd176035bf5b837098522be889712cf4e0))
- limit gear score setting scope to only hide score display ([63d8aaa](https://github.com/Celasha/Toolasha/commit/63d8aaaa66886899c51f9acce179ca9e72e27f12))
- resolve intermittent time-to-level tooltip not appearing ([86bdd20](https://github.com/Celasha/Toolasha/commit/86bdd204934efe459573c594249f987c31545c73))

## [2.39.2](https://github.com/Celasha/Toolasha/compare/v2.39.1...v2.39.2) (2026-05-06)

### Bug Fixes

- force full rebuild after drag-and-drop tile operations ([eb42a34](https://github.com/Celasha/Toolasha/commit/eb42a34a59aab942ed4a29d8340ec345f3c39877))
- limit pin-to-top positioning to item and collection tooltips only ([1df6dae](https://github.com/Celasha/Toolasha/commit/1df6dae167aed72b96aa65401318088fffe84922))
- prevent chest EV display from being blocked by disabled price setting ([690726b](https://github.com/Celasha/Toolasha/commit/690726b22a8b750ca5c917807c203a832f8cbb68))
- restore skill calculator on Shykai page via GM storage fallback ([4522ae6](https://github.com/Celasha/Toolasha/commit/4522ae60e9b0df754954901c27a7e6336199c362))
- show unclaimed enhanced items in Unorganized bucket ([d47a649](https://github.com/Celasha/Toolasha/commit/d47a649174f07fae6c61fbdc1528e6e82520d73e))

## [2.39.1](https://github.com/Celasha/Toolasha/compare/v2.39.0...v2.39.1) (2026-05-06)

### Bug Fixes

- resolve missing enhancement levels in loadout-based combat sim export ([fcb3c4e](https://github.com/Celasha/Toolasha/commit/fcb3c4ed9975bfab3d44a273508f435040dd9cee))

## [2.39.0](https://github.com/Celasha/Toolasha/compare/v2.38.5...v2.39.0) (2026-05-06)

### Features

- add drag and drop for custom inventory tab items ([3af3d37](https://github.com/Celasha/Toolasha/commit/3af3d37e673f872a283f9193f1899b091020d692))

### Bug Fixes

- ceil books needed calculation and guard null trigger dependencies ([3fec882](https://github.com/Celasha/Toolasha/commit/3fec882aaeb3b552cb7018729bf969f3ec019d89))
- correct custom tab tile claiming order for collapsed tabs ([1ea9817](https://github.com/Celasha/Toolasha/commit/1ea9817ec5d99a80797a163c389ac21c6a3f1707))
- decouple listing total price colors from shared color settings ([43e3c1c](https://github.com/Celasha/Toolasha/commit/43e3c1c85e1cb413113efb1608b0cd93d24615ff))
- display house rooms in combat sim Configure tab ([678d547](https://github.com/Celasha/Toolasha/commit/678d547ad859766029d2e4084844140b7cbf4af8))
- pin-top tooltip positioning at low browser zoom levels ([a1f22fe](https://github.com/Celasha/Toolasha/commit/a1f22fe2dab6c4d92782a0f510f77f718bd02e40))
- use live equipment Map to preserve enhancement levels in sim export ([12dd6f7](https://github.com/Celasha/Toolasha/commit/12dd6f7770af2deecf4d5cb2c6b5414693c29902))
- use stored duration when loading combat stats from previous session ([d93411f](https://github.com/Celasha/Toolasha/commit/d93411f43599242673b9e052fa6cca8f7ce1084a))

## [2.38.5](https://github.com/Celasha/Toolasha/compare/v2.38.4...v2.38.5) (2026-05-05)

### Bug Fixes

- guard null friendlies/enemies in combat trigger evaluation ([5743b64](https://github.com/Celasha/Toolasha/commit/5743b64cbfe1e84ce4366a7b0b8f657d42e405dc))

## [2.38.4](https://github.com/Celasha/Toolasha/compare/v2.38.3...v2.38.4) (2026-05-05)

### Bug Fixes

- add comprehensive debug logging to all zone spawn paths ([45dd705](https://github.com/Celasha/Toolasha/commit/45dd705be7607977800c8f8733c4ab098a02ad8e))

## [2.38.3](https://github.com/Celasha/Toolasha/compare/v2.38.2...v2.38.3) (2026-05-05)

### Bug Fixes

- add debug logging and defensive guard for dungeon wave spawn crash ([873449d](https://github.com/Celasha/Toolasha/commit/873449d6c356d5991c4f2a6b4bd2a6503ce9a837))

## [2.38.2](https://github.com/Celasha/Toolasha/compare/v2.38.1...v2.38.2) (2026-05-05)

### Bug Fixes

- guard against null fixedSpawnsMap entries in dungeon waves ([f8c8762](https://github.com/Celasha/Toolasha/commit/f8c8762634a802c738d5183c008b94c55407275b))

## [2.38.1](https://github.com/Celasha/Toolasha/compare/v2.38.0...v2.38.1) (2026-05-05)

### Bug Fixes

- handle unmatched dungeon wave ranges in spawn lookup ([594a483](https://github.com/Celasha/Toolasha/commit/594a483246b3a6d7463bd230d28c79e0b54e3194))
- reset to defaults now uses actual schema default values ([65cc577](https://github.com/Celasha/Toolasha/commit/65cc57751eae58750817ed4b1e2c5975b8fdd50f))

## [2.38.0](https://github.com/Celasha/Toolasha/compare/v2.37.0...v2.38.0) (2026-05-05)

### Features

- add avg completion time and totals to dungeon sim results ([68df358](https://github.com/Celasha/Toolasha/commit/68df358fe96c6a727c5ad7bccfed7f1ebbc2a0dd))

### Bug Fixes

- resolve dungeon sim crash on exact wave key boundary ([d99b792](https://github.com/Celasha/Toolasha/commit/d99b7927f4c47a3e5514483b527d0b98155b9343))

## [2.37.0](https://github.com/Celasha/Toolasha/compare/v2.36.1...v2.37.0) (2026-05-05)

### Features

- change "Buy intermediates" to only buy uncraftable raw materials ([36eea27](https://github.com/Celasha/Toolasha/commit/36eea27aa9e017e7d1b2899a922acc3f0079b357))

### Bug Fixes

- use combatAbilities with positional aura detection for sim export ([d576c25](https://github.com/Celasha/Toolasha/commit/d576c25c4cd99328224550c3ad11b08d19835076))

## [2.36.1](https://github.com/Celasha/Toolasha/compare/v2.36.0...v2.36.1) (2026-05-05)

### Miscellaneous Chores

- add debug logging for self ability import diagnosis ([ca6dc96](https://github.com/Celasha/Toolasha/commit/ca6dc96ec6d701e2689f0b5a0cec27e6e733f36d))

## [2.36.0](https://github.com/Celasha/Toolasha/compare/v2.35.0...v2.36.0) (2026-05-04)

### Features

- add configurable default hours settings for combat sim modes ([ec4fc4d](https://github.com/Celasha/Toolasha/commit/ec4fc4db596bd35bb2b9d327fcb1bf1a10e05cbf))

### Bug Fixes

- add Profit/day column, two-decimal Deaths/hr, and base-item click in inventory search ([6e77e66](https://github.com/Celasha/Toolasha/commit/6e77e664a6d4062b4698ebb2d6b94f83a5aa2433))
- use characterLoadoutMap for ability slot assignment in sim export ([fad3e8c](https://github.com/Celasha/Toolasha/commit/fad3e8c2c1aa3fb421d655733d92923eb7912be4))

## [2.35.0](https://github.com/Celasha/Toolasha/compare/v2.34.0...v2.35.0) (2026-05-03)

### Features

- add early exit and seek best source to all zones combat sim ([473299d](https://github.com/Celasha/Toolasha/commit/473299d61487317cba48f9d498a335842033c666))

### Bug Fixes

- restore GM storage for cross-domain Import from Toolasha on Shykai ([1f5f1ff](https://github.com/Celasha/Toolasha/commit/1f5f1ff57f6b782979c56c35c85a67498c3dcd9f))

## [2.34.0](https://github.com/Celasha/Toolasha/compare/v2.33.1...v2.34.0) (2026-05-03)

### Features

- add topmost-tab priority for custom inventory tabs ([b5f3b4c](https://github.com/Celasha/Toolasha/commit/b5f3b4cc33d75860bfad61b5635bbd8fdb3c73ba))

### Bug Fixes

- resolve history.some is not a function in combat sim comparison panel ([c41bec4](https://github.com/Celasha/Toolasha/commit/c41bec4e70fa778dc548ed87e61fc87cd1186626))

## [2.33.1](https://github.com/Celasha/Toolasha/compare/v2.33.0...v2.33.1) (2026-05-03)

### Bug Fixes

- catch async WS handler rejections and guard action_completed null characterItems ([e65a5fb](https://github.com/Celasha/Toolasha/commit/e65a5fb65076584ce178163a3a9c12e3a7bdb7a4))

## [2.33.0](https://github.com/Celasha/Toolasha/compare/v2.32.4...v2.33.0) (2026-05-03)

### Features

- fix custom tab tile-stealing and add "Add all levels" shortcut for equipment items ([95ea23c](https://github.com/Celasha/Toolasha/commit/95ea23c3cfb9a8ffdbe6b693d2eb82cd942463ce))
- fix preset consumable trigger calculation and add delete result buttons ([506dec4](https://github.com/Celasha/Toolasha/commit/506dec49c96adadc086e42122d0e6b2c6348998a))

### Bug Fixes

- force full layout rebuild when config item count changes to prevent tile cascading ([ec207fb](https://github.com/Celasha/Toolasha/commit/ec207fb4aaccffe42ccc2922d5bfe77dd6f7b92d))
- use equipment presence instead of missing maxEnhancementLevel field to detect expandable items ([741b3c1](https://github.com/Celasha/Toolasha/commit/741b3c1393d8152d96f664cd86b762100845fbe7))

## [2.32.4](https://github.com/Celasha/Toolasha/compare/v2.32.3...v2.32.4) (2026-05-03)

### Bug Fixes

- show all enhancement levels in custom tab item picker, mark owned with indicator ([eea2cce](https://github.com/Celasha/Toolasha/commit/eea2cced159a26e079da4fa04b03a31fdac4d340))
- write profile list to IndexedDB immediately on profile_shared ([3fbdb96](https://github.com/Celasha/Toolasha/commit/3fbdb962a9571d932facee6051195385eca44546))

## [2.32.3](https://github.com/Celasha/Toolasha/compare/v2.32.2...v2.32.3) (2026-05-03)

### Bug Fixes

- replace GM storage with IndexedDB for profile list and dataManager for character/battle data ([e92e0a9](https://github.com/Celasha/Toolasha/commit/e92e0a9e836b987adc2e25ec4732e22341332d71))

## [2.32.2](https://github.com/Celasha/Toolasha/compare/v2.32.1...v2.32.2) (2026-05-03)

### Bug Fixes

- fall back to characterLoadoutMap from init_character_data for Steam users ([c53c2b3](https://github.com/Celasha/Toolasha/commit/c53c2b3828db2100365f11c28b4dcd53de57d41d))

## [2.32.1](https://github.com/Celasha/Toolasha/compare/v2.32.0...v2.32.1) (2026-05-03)

### Miscellaneous Chores

- add diagnostic logging to loadout snapshot pipeline ([7078324](https://github.com/Celasha/Toolasha/commit/70783248d15e18b4caf6e2a3364d74583a8e9d18))

## [2.32.0](https://github.com/Celasha/Toolasha/compare/v2.31.2...v2.32.0) (2026-05-03)

### Features

- add all-zones combat simulation with player import and sortable results ([4e1df65](https://github.com/Celasha/Toolasha/commit/4e1df65d20c8af35da4695f1b11d5c28504a134c))

### Bug Fixes

- register loadouts_updated handler at module load time ([aad1dd1](https://github.com/Celasha/Toolasha/commit/aad1dd18bc97d4d82a71e62681f8d2c6f65e822f))

## [2.31.2](https://github.com/Celasha/Toolasha/compare/v2.31.1...v2.31.2) (2026-05-02)

### Bug Fixes

- guard GM storage calls for environments without GM APIs ([6a519df](https://github.com/Celasha/Toolasha/commit/6a519dfbaa046a2c9e6b0100846fcbf14c93f1d3))

## [2.31.1](https://github.com/Celasha/Toolasha/compare/v2.31.0...v2.31.1) (2026-05-02)

### Bug Fixes

- add "buy intermediates" toggle to crafting plan ([c60c216](https://github.com/Celasha/Toolasha/commit/c60c21688e9c7d3eada8941d1e85f70de2ce02fb))
- add catalytic tea and remove artisan tea from alchemy optimizer ([9f88c2e](https://github.com/Celasha/Toolasha/commit/9f88c2ec6b1e98b611739d1902d660ae0d36aa42))
- add IndexedDB auto-reconnection and storage diagnostics ([39d87e5](https://github.com/Celasha/Toolasha/commit/39d87e52b959332b964395f41272e524f48ba9e9))
- correct double /items/ prefix in milkyway market link URL ([7161bdb](https://github.com/Celasha/Toolasha/commit/7161bdb6a44d72df7d6f674c42388c08fb602218))
- split XP color into separate rate and hours-to-level settings ([ef80baa](https://github.com/Celasha/Toolasha/commit/ef80baa7992c22a07dfc24b76a03cd5ee2273682))

### Miscellaneous Chores

- deprecate Steam build and remove all Steam-specific code ([3a72bbe](https://github.com/Celasha/Toolasha/commit/3a72bbe574484891de7e7461f347f30e70a382fd))

## [2.31.0](https://github.com/Celasha/Toolasha/compare/v2.30.2...v2.31.0) (2026-05-01)

### Features

- add best crafting plan to action panels ([a2dec28](https://github.com/Celasha/Toolasha/commit/a2dec281900d7dde899404cb40b595294f6a28bd))
- add milkyway market link to marketplace order books ([e43abfa](https://github.com/Celasha/Toolasha/commit/e43abfa17c59299121af4b3761ce8d3b2271e644))
- add seals, achievement buffs, and back slot to milkonomy export ([68405c2](https://github.com/Celasha/Toolasha/commit/68405c2c92ba728cf27a2a8d31fe81f999c08135))

### Bug Fixes

- default all collection filters to checked for new users ([2a066ec](https://github.com/Celasha/Toolasha/commit/2a066ec3e0425f343828957c045f60f26e0a2b48))

## [2.30.2](https://github.com/Celasha/Toolasha/compare/v2.30.1...v2.30.2) (2026-05-01)

### Bug Fixes

- hook page MessageEvent prototype and remove instanceof guard ([e8490a5](https://github.com/Celasha/Toolasha/commit/e8490a5255735267ff9427e3af73c34ecc83296e))

## [2.30.1](https://github.com/Celasha/Toolasha/compare/v2.30.0...v2.30.1) (2026-05-01)

### Bug Fixes

- use correct setting key for inventory networth panel ([5fcbea0](https://github.com/Celasha/Toolasha/commit/5fcbea0663323380cd9247d51d9a52b6e1e81c11))

## [2.30.0](https://github.com/Celasha/Toolasha/compare/v2.29.0...v2.30.0) (2026-05-01)

### Features

- add alchemy best items ranking by profit and XP ([1250222](https://github.com/Celasha/Toolasha/commit/12502220111895c604f8c20d3a081941ba3d89eb))

## [2.29.0](https://github.com/Celasha/Toolasha/compare/v2.28.2...v2.29.0) (2026-05-01)

### Features

- add materials availability indicator on production task cards ([89b5a92](https://github.com/Celasha/Toolasha/commit/89b5a92b61465d2a2dacae345fb38b8f3ee20d47))

## [2.28.2](https://github.com/Celasha/Toolasha/compare/v2.28.1...v2.28.2) (2026-05-01)

### Bug Fixes

- use getSetting for sub-settings incorrectly using isFeatureEnabled ([0d455e9](https://github.com/Celasha/Toolasha/commit/0d455e9023f34412e952ad86a1485a41ea13079f))

## [2.28.1](https://github.com/Celasha/Toolasha/compare/v2.28.0...v2.28.1) (2026-05-01)

### Bug Fixes

- decouple tooltip pin-to-top from market prices setting ([97c59a8](https://github.com/Celasha/Toolasha/commit/97c59a80622ceafad06e0082f684df6a7c98568f))

## [2.28.0](https://github.com/Celasha/Toolasha/compare/v2.27.0...v2.28.0) (2026-04-30)

### Features

- add alchemy tea recommendation support ([1596c7d](https://github.com/Celasha/Toolasha/commit/1596c7db8903c4c481031ac3a91321c2611dcaf4))
- add timing display to queue hover tooltip ([7e57ba3](https://github.com/Celasha/Toolasha/commit/7e57ba3455c4fa1dab74d5dc3064261a2610b4d7))

### Bug Fixes

- collection badge setting not persisting after refresh ([d3c036d](https://github.com/Celasha/Toolasha/commit/d3c036da3b4f66051551d8fe493e6eb813d74a38))
- labyrinth best-level badge position shifting after edit/save ([ea80a49](https://github.com/Celasha/Toolasha/commit/ea80a4902416322d7803cf8dbcbe702c5cd0753c))
- preserve customCheck when converting features to registry format ([51cb2a4](https://github.com/Celasha/Toolasha/commit/51cb2a46ccc1219cb3c882e28c978998a2f87c5d))
- re-render trade history display when DOM element is removed ([3177897](https://github.com/Celasha/Toolasha/commit/3177897a73ca5100e9d96b57c09254ad28e2e34e))
- show trade history when order book has only one side ([c785da8](https://github.com/Celasha/Toolasha/commit/c785da8b45e20930f60aaccefe6f082db7bb5999))

### Miscellaneous Chores

- remove stale debug console.log statements ([cad180c](https://github.com/Celasha/Toolasha/commit/cad180ccad7705024d8b4c7674914b120d5d98c0))

## [2.27.0](https://github.com/Celasha/Toolasha/compare/v2.26.0...v2.27.0) (2026-04-30)

### Features

- add staleness indicator to collection skilling badges ([fabe9ab](https://github.com/Celasha/Toolasha/commit/fabe9abaebb867cbc0d222b9208aad49ac06bcd0))

### Bug Fixes

- count failed attempts in alchemy history trackers ([8b97a9b](https://github.com/Celasha/Toolasha/commit/8b97a9b73c1c9bf5d761c6f8e5b24f577247cf00))
- decouple level progress from profit detail toggle ([d877757](https://github.com/Celasha/Toolasha/commit/d8777574ceae58f89a3560eb0ba7548182c3d1d2))

### Miscellaneous Chores

- add diagnostic logging for alchemy coinify display ([2e5cee2](https://github.com/Celasha/Toolasha/commit/2e5cee267bbaf12a93ad0b85b42db9ae4eeadcb0))

## [2.26.0](https://github.com/Celasha/Toolasha/compare/v2.25.1...v2.26.0) (2026-04-29)

### Features

- add Sim Character button to profile page ([81dbbf2](https://github.com/Celasha/Toolasha/commit/81dbbf2e8b63df65b1201f61345b588c7634e5af))

### Bug Fixes

- anchor abilities panel to bottom of screen and make it draggable ([b4cd9d7](https://github.com/Celasha/Toolasha/commit/b4cd9d750929088c8150a59199632a2d6d4efe12))
- initialize task Go merge when profit calculator is disabled ([7e52bd0](https://github.com/Celasha/Toolasha/commit/7e52bd030c2dfa4445114e3825391a22a61c81e4))
- reload pinned actions using correct character ID after switch ([ae586c7](https://github.com/Celasha/Toolasha/commit/ae586c7f75a90d779cb97774ae29a643be0be02d))

## [2.25.1](https://github.com/Celasha/Toolasha/compare/v2.25.0...v2.25.1) (2026-04-29)

### Bug Fixes

- exclude Toolasha zone-index span from task description text in profit display ([1363340](https://github.com/Celasha/Toolasha/commit/13633401830ef36cca5f46a31a90f8057fa621ac))

## [2.25.0](https://github.com/Celasha/Toolasha/compare/v2.24.8...v2.25.0) (2026-04-29)

### Features

- add inline Auto/Manual mode toggle to enhancement calculator ([eed0222](https://github.com/Celasha/Toolasha/commit/eed0222bd41f4a8eba941eb0621f8363c61f5190))

### Bug Fixes

- strip zone suffix from monster name before lookup in combat task estimate ([6184df0](https://github.com/Celasha/Toolasha/commit/6184df0a14821bb780ce605f8122a76907c65dd4))

## [2.24.8](https://github.com/Celasha/Toolasha/compare/v2.24.7...v2.24.8) (2026-04-29)

### Miscellaneous Chores

- add diagnostic logging for task identification failures ([7abc65c](https://github.com/Celasha/Toolasha/commit/7abc65ccee73a740d597945f9ef3653f1a0ec078))

## [2.24.7](https://github.com/Celasha/Toolasha/compare/v2.24.6...v2.24.7) (2026-04-29)

### Bug Fixes

- use lazy runtime accessor for loadout-snapshot in task display ([da169b3](https://github.com/Celasha/Toolasha/commit/da169b3301a0e6b942f4023515e83a6d6a54c3c5))

## [2.24.6](https://github.com/Celasha/Toolasha/compare/v2.24.5...v2.24.6) (2026-04-29)

### Bug Fixes

- deduplicate loadout-snapshot instance across split bundles ([3c48a4f](https://github.com/Celasha/Toolasha/commit/3c48a4fef1843163d9bee57f1dcf86d51a44ea1a))

## [2.24.5](https://github.com/Celasha/Toolasha/compare/v2.24.4...v2.24.5) (2026-04-29)

### Bug Fixes

- load loadout snapshots after character ID is available ([1841289](https://github.com/Celasha/Toolasha/commit/1841289c5ed01a6d8d2f48728bab274d6c975d11))

## [2.24.4](https://github.com/Celasha/Toolasha/compare/v2.24.3...v2.24.4) (2026-04-29)

### Bug Fixes

- refresh task combat loadout dropdown when loadouts_updated fires ([966a4dc](https://github.com/Celasha/Toolasha/commit/966a4dc17ebdcbfd6417dae5267f4c479b72569c))

## [2.24.3](https://github.com/Celasha/Toolasha/compare/v2.24.2...v2.24.3) (2026-04-29)

### Bug Fixes

- await loadout snapshot initialization to prevent race condition ([4f515eb](https://github.com/Celasha/Toolasha/commit/4f515ebd8c48b5f2915ba9252afb9eb30b224b22))
- re-query input and action details at click time in quick input buttons ([4a23387](https://github.com/Celasha/Toolasha/commit/4a2338770b828c778a08ab794f09f351d9fb87b5))

## [2.24.2](https://github.com/Celasha/Toolasha/compare/v2.24.1...v2.24.2) (2026-04-29)

### Bug Fixes

- make action sort mode per-character instead of global ([5f1c9fd](https://github.com/Celasha/Toolasha/commit/5f1c9fd6cb90b149de9a5df61fb9bc998e821fe9))
- prevent empty alchemy history sessions from queue changes ([52a9fa5](https://github.com/Celasha/Toolasha/commit/52a9fa53c7d8567f8d9ff460516a5e1841b88649))
- prevent labyrinth best-level badge from breaking extension ([8ce4ee6](https://github.com/Celasha/Toolasha/commit/8ce4ee68dcc9cc2f94b675a736fdd0028d5ef9d3))
- target correct CSS class for labyrinth panel width override ([bfd5284](https://github.com/Celasha/Toolasha/commit/bfd5284b368795f2a70f7ff5ecdf10c20ff223a6))

## [2.24.1](https://github.com/Celasha/Toolasha/compare/v2.24.0...v2.24.1) (2026-04-28)

### Bug Fixes

- support live setting toggle for queue monitor ([08f13e6](https://github.com/Celasha/Toolasha/commit/08f13e65bf25d70ed9662e19e03bd24cc302f7de))

## [2.24.0](https://github.com/Celasha/Toolasha/compare/v2.23.0...v2.24.0) (2026-04-28)

### Features

- add combat task time and profit estimator ([cc425d2](https://github.com/Celasha/Toolasha/commit/cc425d2b1f26d289012c620d52ad37f9d640ddee))
- add cross-character queue monitor ([325eba4](https://github.com/Celasha/Toolasha/commit/325eba43544ad1a14b453c0b63b7520606480df5))
- add decompose session history tracking and viewer ([9e456d1](https://github.com/Celasha/Toolasha/commit/9e456d1d694f4d5620f5f1e9adb82c5791c102bb))
- add per-pane message filters to pop-out chat ([059d73d](https://github.com/Celasha/Toolasha/commit/059d73ddf61f4a28031cdae6d3f89c222a9c162c))

## [2.23.0](https://github.com/Celasha/Toolasha/compare/v2.22.2...v2.23.0) (2026-04-27)

### Features

- add All Off / Restore buttons to settings panel ([95291c5](https://github.com/Celasha/Toolasha/commit/95291c5c5184312427e07435c8b0b10ac88932ba))

### Bug Fixes

- correct actionPanel_showExpPerHour label and help text ([9a9f4ae](https://github.com/Celasha/Toolasha/commit/9a9f4aea46be579141554dfcd8e26e8c6b5fa3e9))

## [2.22.2](https://github.com/Celasha/Toolasha/compare/v2.22.1...v2.22.2) (2026-04-27)

### Bug Fixes

- restore querySelectorAll descent in DOMObserver.onClass for container nodes ([620caff](https://github.com/Celasha/Toolasha/commit/620caffa964e3a1f260075e75706465bc6fe6449))
- sort combat statistics drop list by total value descending ([49ea6f3](https://github.com/Celasha/Toolasha/commit/49ea6f3073a14f5a06dbf8a62153f351456c15a8))
- split action panel profit setting into tile and detail controls ([0eeee58](https://github.com/Celasha/Toolasha/commit/0eeee5801f3703c1450107e512e2c9be422420e3))
- use substring class selector for missing mats badge to survive game updates ([87e7691](https://github.com/Celasha/Toolasha/commit/87e7691d6ff6df3e24992b496d36897e03d8211e))
- use top bid (bids[0]) instead of lowest bid when reading order books ([4f5cac8](https://github.com/Celasha/Toolasha/commit/4f5cac89ea02adcf8d7da0e4652588e3210ac1db))

### Code Refactoring

- remove diagnostic logs from alchemy profit display ([ce314ea](https://github.com/Celasha/Toolasha/commit/ce314ea0399a4d1837562d2c2ad06dac70f02d81))

## [2.22.1](https://github.com/Celasha/Toolasha/compare/v2.22.0...v2.22.1) (2026-04-27)

### Bug Fixes

- remove redundant querySelectorAll descent in DOMObserver.onClass ([0203a8d](https://github.com/Celasha/Toolasha/commit/0203a8d2403b6b389bdeb9b3b21a6bb3af36c809))

### Code Refactoring

- exclude taskDamage from player damage roll in combat sim ([af25935](https://github.com/Celasha/Toolasha/commit/af259355e66de26e0c3dd9e9db9e0e01e221fe99))
- remove leftover debug logging from combat sim ([5d636c6](https://github.com/Celasha/Toolasha/commit/5d636c6ddfd1de2692afba138f241576dbf30d38))

## [2.22.0](https://github.com/Celasha/Toolasha/compare/v2.21.0...v2.22.0) (2026-04-26)

### Features

- add consumable editing and comparison table to combat sim ([0cdbe7c](https://github.com/Celasha/Toolasha/commit/0cdbe7c030e55266958aa8f52554728c038e2ab3))

### Bug Fixes

- use loose equality when resetting absent monster combat stats to zero ([7d61522](https://github.com/Celasha/Toolasha/commit/7d61522610983ef540f023a5b07613b05354bcd6))

## [2.21.0](https://github.com/Celasha/Toolasha/compare/v2.20.1...v2.21.0) (2026-04-25)

### Features

- add drag-and-drop tab reordering for character panel ([6367cbb](https://github.com/Celasha/Toolasha/commit/6367cbb11b72edafacda5972d43aed75ccfe5509))
- add setting to toggle protection items in enhancement material limit ([ebbe621](https://github.com/Celasha/Toolasha/commit/ebbe621307e902d09bbd69be364a6b76735797cc))
- add zone-level protection toggle to task reroll protection ([41921ff](https://github.com/Celasha/Toolasha/commit/41921ffc640db88e5df19cbf3dca2e31a71565de))

### Bug Fixes

- include gathering dropTable items in collection time-to-tier sort ([9077a6a](https://github.com/Celasha/Toolasha/commit/9077a6a53715c73cbf4b527b293a989199731164))

## [2.20.1](https://github.com/Celasha/Toolasha/compare/v2.20.0...v2.20.1) (2026-04-24)

### Bug Fixes

- add 3-second lockdown to task reroll protection ([2f78f28](https://github.com/Celasha/Toolasha/commit/2f78f289dd070841a792b5a4020b318ccf7dad33))

## [2.20.0](https://github.com/Celasha/Toolasha/compare/v2.19.2...v2.20.0) (2026-04-24)

### Features

- add task reroll protection with configurable protected zones ([f5cc111](https://github.com/Celasha/Toolasha/commit/f5cc111aa134ee32ec48cfe1e868e8e7ae1849fa))

### Bug Fixes

- correct combat sim trigger handling and null enemies crash ([ea01ff5](https://github.com/Celasha/Toolasha/commit/ea01ff593295b0a71ccacbc33b0de995fb8288dc))

## [2.19.2](https://github.com/Celasha/Toolasha/compare/v2.19.1...v2.19.2) (2026-04-23)

### Bug Fixes

- add dungeon key costs to combat sim profit calculations ([1aed228](https://github.com/Celasha/Toolasha/commit/1aed228d2f7d1b201893ea23c35d44493d333b1e))

## [2.19.1](https://github.com/Celasha/Toolasha/compare/v2.19.0...v2.19.1) (2026-04-23)

### Bug Fixes

- limit combat sim tier dropdown to T0-T5 for zones and T0-T2 for dungeons ([1a7af0f](https://github.com/Celasha/Toolasha/commit/1a7af0f6207333388b88edfee417fcb4c4ddb2e5))
- use dungeon completion rewards instead of monster drops for dungeon sims ([79affc5](https://github.com/Celasha/Toolasha/commit/79affc54f2d5b1c96454c1f7a1a7ba21bedcf47c))

## [2.19.0](https://github.com/Celasha/Toolasha/compare/v2.18.2...v2.19.0) (2026-04-23)

### Features

- add session history, loadout selection, and auto-labeled comparisons to combat sim ([7e427f3](https://github.com/Celasha/Toolasha/commit/7e427f3390a65877f9e0d6e92e843b9767c5bc02))
- add tooltip valuations for task tokens, labyrinth tokens, seals, and cowbells ([6c5b7c1](https://github.com/Celasha/Toolasha/commit/6c5b7c1661b0dd9fd7d990f752f9cfd33e5b67f9))

### Bug Fixes

- add deltas to per-day columns in combat sim results ([de7ad59](https://github.com/Celasha/Toolasha/commit/de7ad598b4160c6c1610cdf5b715cf1c63f4b969))
- clear stale action stats and battle counter on action switch ([2ee57cb](https://github.com/Celasha/Toolasha/commit/2ee57cb44d7b3d7140338425bf9b6d945da3686c))
- scope pinned actions storage per character ([7a90c65](https://github.com/Celasha/Toolasha/commit/7a90c658e16c8fbbea08a471a1efc083d28fd365))
- use highest bid for top order price in trade history display ([05fc3f6](https://github.com/Celasha/Toolasha/commit/05fc3f66241951afc358297a3d39eeab0a228d39))

## [2.18.2](https://github.com/Celasha/Toolasha/compare/v2.18.1...v2.18.2) (2026-04-22)

### Bug Fixes

- add quantity/day columns and fix overlapping text in combat sim ([935538d](https://github.com/Celasha/Toolasha/commit/935538d5384b4c9ed1195fe0f350182bee4ee53a))

## [2.18.1](https://github.com/Celasha/Toolasha/compare/v2.18.0...v2.18.1) (2026-04-22)

### Bug Fixes

- add per-day gold columns to combat sim results ([33aca03](https://github.com/Celasha/Toolasha/commit/33aca030d50296a8a2dc47fd7a189bb6b4059be6))

## [2.18.0](https://github.com/Celasha/Toolasha/compare/v2.17.2...v2.18.0) (2026-04-22)

### Features

- add loadout editor and comparison deltas to combat sim ([3236ff6](https://github.com/Celasha/Toolasha/commit/3236ff68a44ce5b7a83e4355a57d50b23b0aaf4d))

## [2.17.2](https://github.com/Celasha/Toolasha/compare/v2.17.1...v2.17.2) (2026-04-22)

### Bug Fixes

- show per-player data in combat sim results for party sims ([dc03026](https://github.com/Celasha/Toolasha/commit/dc03026f6cdd405c69d203e7f8db2634915ee2e6))

## [2.17.1](https://github.com/Celasha/Toolasha/compare/v2.17.0...v2.17.1) (2026-04-21)

### Bug Fixes

- show only self XP/hr in combat sim results ([43ce37a](https://github.com/Celasha/Toolasha/commit/43ce37a5fc6a7779a35f44010dee02179540c59b))

## [2.17.0](https://github.com/Celasha/Toolasha/compare/v2.16.0...v2.17.0) (2026-04-21)

### Features

- add in-game Combat Simulator ([84d9763](https://github.com/Celasha/Toolasha/commit/84d9763fe14dbcb8cf584ba4c91226220bb97825))

### Bug Fixes

- add missing daily profit rate to gathering tooltip ([9818e86](https://github.com/Celasha/Toolasha/commit/9818e860e3a770597ac9cae3287b779041258dba))

### Miscellaneous Chores

- bump Steam bundle size limit to 6MB for combat sim engine ([478414e](https://github.com/Celasha/Toolasha/commit/478414e8bc3639ea823b4f7ed76c634fff83bf11))

## [2.16.0](https://github.com/Celasha/Toolasha/compare/v2.15.0...v2.16.0) (2026-04-20)

### Features

- add Enhancement XPH Calculator ([22bf42e](https://github.com/Celasha/Toolasha/commit/22bf42e863fd66353c1249a1b0fd52dfa2f67b56))

### Bug Fixes

- raise dungeon tracker z-index to floating panel level when expanded ([b992489](https://github.com/Celasha/Toolasha/commit/b992489914ad7ced619dc01911302fd37687bbd1))
- use highest bid (last element) for top order price on buy listings ([9984e68](https://github.com/Celasha/Toolasha/commit/9984e6829b192d2b315227de80cce0e238d6abb7))

## [2.15.0](https://github.com/Celasha/Toolasha/compare/v2.14.0...v2.15.0) (2026-04-19)

### Features

- add budget calculator to production action panels ([9f22477](https://github.com/Celasha/Toolasha/commit/9f22477450ebdf00963becc2c3e191f47e75bde9))

## [2.14.0](https://github.com/Celasha/Toolasha/compare/v2.13.3...v2.14.0) (2026-04-19)

### Features

- add chat history extender to preserve evicted messages ([24a0a3b](https://github.com/Celasha/Toolasha/commit/24a0a3b86b0ab30ab8c31e814590a47559eab9ad))
- add customizable quick input presets for action panels ([7ed4ac1](https://github.com/Celasha/Toolasha/commit/7ed4ac1f198b2646a829e61a6e40992ada8f2a40))
- add option to hide Labyrinth ping badge in nav sidebar ([66c2ce7](https://github.com/Celasha/Toolasha/commit/66c2ce7257a827b6a49ea71f193defef5770db60))

### Bug Fixes

- preserve market listings expand state across net worth re-renders ([fd4b240](https://github.com/Celasha/Toolasha/commit/fd4b240b61d4c88a56f591b61fdebbdc8500a2d3))
- prevent negative count and focus input after View Action navigation ([1f2d448](https://github.com/Celasha/Toolasha/commit/1f2d448bc8e40e6e10da96d33d67e81485f4ba15))
- show limiting material icon in enhancing time display ([5851deb](https://github.com/Celasha/Toolasha/commit/5851deb9f829ee9294817622ac3bdfa8bd74d688))

## [2.13.3](https://github.com/Celasha/Toolasha/compare/v2.13.2...v2.13.3) (2026-04-18)

### Bug Fixes

- reconcile stale active listings against myMarketListings snapshots ([f4688b3](https://github.com/Celasha/Toolasha/commit/f4688b30d8ee37d4d567cd188d4f6c2c33393bf1))

## [2.13.2](https://github.com/Celasha/Toolasha/compare/v2.13.1...v2.13.2) (2026-04-18)

### Code Refactoring

- replace volatile target-based time with stable material time in enhancing display ([3165a39](https://github.com/Celasha/Toolasha/commit/3165a39429b981c772e742d0a26129f44e98deee))

## [2.13.1](https://github.com/Celasha/Toolasha/compare/v2.13.0...v2.13.1) (2026-04-18)

### Bug Fixes

- export correct ability levels and triggers for non-equipped loadout abilities ([60fafae](https://github.com/Celasha/Toolasha/commit/60fafae972c74a8baffcfa6c4de131aff1554c4c))
- guard against null characterItems in items_updated handler ([e6739c2](https://github.com/Celasha/Toolasha/commit/e6739c2eb5257513f3ba3addb10fde1a5d3086bf))
- lower dungeon tracker z-index below game countdown overlays ([12acb27](https://github.com/Celasha/Toolasha/commit/12acb27c2d0b6dfdbddec711abe2d48468ea660c))
- populate market listings breakdown in net worth calculator ([22e47fc](https://github.com/Celasha/Toolasha/commit/22e47fc2b5e4a84186f188e90ab8a9fc66f33243))
- use repeat count for enhancement missing mats when repeat is finite ([bb6a286](https://github.com/Celasha/Toolasha/commit/bb6a286e6c076883aa8bb9d3f5e972493b343033))

## [2.13.0](https://github.com/Celasha/Toolasha/compare/v2.12.1...v2.13.0) (2026-04-17)

### Features

- add material-based countdown timer for enhancement actions ([9c80cd7](https://github.com/Celasha/Toolasha/commit/9c80cd764e1028971dd6258a1566d18c65448b55))

### Bug Fixes

- detect marketplace navigation via CSS visibility instead of DOM mutations ([9b4f086](https://github.com/Celasha/Toolasha/commit/9b4f0863c7c3142637b0e19fa15089cd3b42a878))
- persist net worth chart range selection across sessions ([fe6b630](https://github.com/Celasha/Toolasha/commit/fe6b63081e3a09bf046ad4748ff9388000349c3d))

## [2.12.1](https://github.com/Celasha/Toolasha/compare/v2.12.0...v2.12.1) (2026-04-17)

### Bug Fixes

- add per-row delete button to market history ([a84dc6b](https://github.com/Celasha/Toolasha/commit/a84dc6bd4b6d35a1e5c42459855fa4483f39b71b))
- clear battle counter on combat exit and hide scroll sim for combat loadouts ([d8cd43a](https://github.com/Celasha/Toolasha/commit/d8cd43aa04c53322bbbbaac6cbfc42c255c231be))
- eliminate custom tab flicker when enhancing items ([482b9bc](https://github.com/Celasha/Toolasha/commit/482b9bc53847675674ea07f6d1d25e574ddbcc5d))
- resolve view action button failing for refined items ([4f8a972](https://github.com/Celasha/Toolasha/commit/4f8a972b9f6c6656e324803835e0e13ab0bbfe0f))

### Code Refactoring

- move combat sim loadout export from loadout page to score panel dropdown ([384741f](https://github.com/Celasha/Toolasha/commit/384741f6bbe5110eda7deba1a43a3cc4702f041a))

## [2.12.0](https://github.com/Celasha/Toolasha/compare/v2.11.0...v2.12.0) (2026-04-17)

### Features

- add battle/wave counter to combat action bar ([89471be](https://github.com/Celasha/Toolasha/commit/89471bef9395a5ace516b62edec3dad48fecc8b3))
- add per-loadout scroll simulation for profit/XP calculations ([49648bd](https://github.com/Celasha/Toolasha/commit/49648bd189eccf82b7105b4c913194fffb3381bd))

### Bug Fixes

- correct three row-matching bugs in My Listings price display ([aa7da12](https://github.com/Celasha/Toolasha/commit/aa7da1270c4d23a52ce811ced1da0a922b371b80))
- remove redundant quantity from coin line in net worth breakdown ([ea6d6c1](https://github.com/Celasha/Toolasha/commit/ea6d6c12f264ee24525f7330ea9a7821fd1d58e8))
- rename "Seal of" to "Scroll of" following game update ([ead6bf5](https://github.com/Celasha/Toolasha/commit/ead6bf5d92a7674a44b7a694d353f6836a5e8e53))
- update Milkonomy external link URL ([753658a](https://github.com/Celasha/Toolasha/commit/753658a7f642600d7bb0daf5cc0561092d768c1f))

## [2.11.0](https://github.com/Celasha/Toolasha/compare/v2.10.1...v2.11.0) (2026-04-16)

### Features

- add Claim Reward proxy button to task panel header ([0061b3e](https://github.com/Celasha/Toolasha/commit/0061b3ef59a22c30b3f30da86b9c1940ca03d2aa))
- generate Tib character sheet from a saved loadout snapshot ([b72d009](https://github.com/Celasha/Toolasha/commit/b72d0099d65632b20c147cd7935d4392be1e1f7b))

### Bug Fixes

- guard loadout enhancement overlays against mid-render and stale inventory ([ea1c9aa](https://github.com/Celasha/Toolasha/commit/ea1c9aaa83e24894371e03027d2fb37136649d89))
- populate XP/h columns on main player leaderboard ([0b2b684](https://github.com/Celasha/Toolasha/commit/0b2b6849d28665b2aca8bc7f6d09b0ac0c7bd360))
- show + prefix on net worth toggle from initial render ([0c18fe2](https://github.com/Celasha/Toolasha/commit/0c18fe2dfc73f8fc6cd37d6c14e25106161277db))
- show Coin as explicit line item in inventory breakdown ([d6b061f](https://github.com/Celasha/Toolasha/commit/d6b061fb8de1149005eedafb7cf33df8a7d31106))
- use direct index lookup for enhanced item order books in Top Order Price ([5d6ae04](https://github.com/Celasha/Toolasha/commit/5d6ae04b51f7bdf81af0c31de6d29bd3bc66e497))

## [2.10.1](https://github.com/Celasha/Toolasha/compare/v2.10.0...v2.10.1) (2026-04-15)

### Bug Fixes

- resolve exclusion chip names from game data instead of search list ([1e08a4b](https://github.com/Celasha/Toolasha/commit/1e08a4b9c97ed7f785c24086ce6817ed1880ed1e))

## [2.10.0](https://github.com/Celasha/Toolasha/compare/v2.9.2...v2.10.0) (2026-04-14)

### Features

- add Clear All button to exclusion popup and fix double-exclusion ([20ce818](https://github.com/Celasha/Toolasha/commit/20ce8182e18c725f8c04fd74210fcc050b4f3bb8))

### Bug Fixes

- exclude Coin from currency category grouping in net worth ([6ab4118](https://github.com/Celasha/Toolasha/commit/6ab41182bbac5c258e9c9ad4c0ce602f2c274b98))
- restore correct amounts for excluded items in exclusion popup ([84df111](https://github.com/Celasha/Toolasha/commit/84df111329513dae00d224ca995997710a6119e2))

### Styles

- center tab names and right-align count/value in custom tab headers ([7846de3](https://github.com/Celasha/Toolasha/commit/7846de3b05a39d3cfc12ab955a0f46bfa2f11392))

## [2.9.2](https://github.com/Celasha/Toolasha/compare/v2.9.1...v2.9.2) (2026-04-14)

### Bug Fixes

- add expandable detail view for multi-item exclusions ([65943bf](https://github.com/Celasha/Toolasha/commit/65943bfaa0034e9a5b1e3e141d0373179c71a7b8))

## [2.9.1](https://github.com/Celasha/Toolasha/compare/v2.9.0...v2.9.1) (2026-04-14)

### Bug Fixes

- eliminate blank padding on chart x-axis edges ([75d78d8](https://github.com/Celasha/Toolasha/commit/75d78d8df8efb67f34e8b051cbac44af6c15a09e))

### Performance Improvements

- avoid blocking on 3s debounced save in exclusion toggles ([9f1f957](https://github.com/Celasha/Toolasha/commit/9f1f9571b4332d8737f26ff28505730c76c2e78b))

## [2.9.0](https://github.com/Celasha/Toolasha/compare/v2.8.1...v2.9.0) (2026-04-14)

### Features

- add net worth exclusions and Non-Excluded history chart line ([90fe8d7](https://github.com/Celasha/Toolasha/commit/90fe8d73a64401c483e24f37d53d29346a99e9c9))

### Bug Fixes

- show wisdom tea on gold tab and gourmet tea on XP tab for cooking/brewing ([2a2f2bf](https://github.com/Celasha/Toolasha/commit/2a2f2bf80106b0b536d96491bf5ea2b654a5ff9f))

### Styles

- rename "Networth" to "Net Worth" in all user-facing text ([01d427e](https://github.com/Celasha/Toolasha/commit/01d427e18c6a6c27d17dac635f4d1acf4282dae6))

## [2.8.1](https://github.com/Celasha/Toolasha/compare/v2.8.0...v2.8.1) (2026-04-12)

### Bug Fixes

- make action panel display settings take effect without page reload ([c346437](https://github.com/Celasha/Toolasha/commit/c346437db308af221e4ec1115cec0e1c2f27b252))

## [2.8.0](https://github.com/Celasha/Toolasha/compare/v2.7.3...v2.8.0) (2026-04-12)

### Features

- add click-to-delete datapoints from networth history chart ([0dbaef6](https://github.com/Celasha/Toolasha/commit/0dbaef6fdb1fcde6269966a24a35bc25a1b4a198))
- add pin/ban tea constraints to tea recommendation popup ([8321ccf](https://github.com/Celasha/Toolasha/commit/8321ccfed5575ab5be2652f93bf7ef3a154a0685))

### Bug Fixes

- divide tooltip per-action profit by effective actions rate ([7b5f310](https://github.com/Celasha/Toolasha/commit/7b5f31070f956da0ccb2ea60e51fcb6ec516be1d))
- force full layout rebuild when inventory tile count changes ([ccaec79](https://github.com/Celasha/Toolasha/commit/ccaec79ff9b818b2b3bd6de45b05aacbeb58c91c))
- prevent duplicate action entries inflating queued material counts ([cfea250](https://github.com/Celasha/Toolasha/commit/cfea2504de2aae1577ffa4a4c4427bf7a43a4304))

## [2.7.3](https://github.com/Celasha/Toolasha/compare/v2.7.2...v2.7.3) (2026-04-12)

### Styles

- reduce inventory tab category header size for compactness ([4b61244](https://github.com/Celasha/Toolasha/commit/4b61244973f4be10e15386be3f3376553369d570))

## [2.7.2](https://github.com/Celasha/Toolasha/compare/v2.7.1...v2.7.2) (2026-04-12)

### Bug Fixes

- prevent duplicate reroll cost display for identical tasks ([07694ff](https://github.com/Celasha/Toolasha/commit/07694ffe5ba62b4ae74d26e06b2a80c87fdbc786))

## [2.7.1](https://github.com/Celasha/Toolasha/compare/v2.7.0...v2.7.1) (2026-04-11)

### Bug Fixes

- apply KMB formatting to Profit and Primary Outputs labels in action panel ([9e7a6e7](https://github.com/Celasha/Toolasha/commit/9e7a6e7758001a8442e8af43ec7c2a6fe53fedec))
- correct double-counted efficiency in production action totals ([0fc6738](https://github.com/Celasha/Toolasha/commit/0fc6738c2433b393f1e74ffb4a3d12d7727a8956))
- show average in parentheses alongside output range totals ([0d64bd2](https://github.com/Celasha/Toolasha/commit/0d64bd240142ff764a84f4d69126108b5d6a5e97))

### Performance Improvements

- debounce order books cache saves and evict stale entries on load ([d7fbecd](https://github.com/Celasha/Toolasha/commit/d7fbecd2210520a3ee2e06a135de675eacc05f42))

## [2.7.0](https://github.com/Celasha/Toolasha/compare/v2.6.2...v2.7.0) (2026-04-11)

### Features

- add custom price overrides for profit calculations ([93d7f77](https://github.com/Celasha/Toolasha/commit/93d7f775c3fa22cf12f066a4d886962a9f5ce7f3))
- use shop prices as cost floor for production material costs ([2cb98b0](https://github.com/Celasha/Toolasha/commit/2cb98b0795557bac8def675ecfa954f9441d099d))

### Code Refactoring

- unify price resolution and fix tooltip accuracy for refined items ([afb5510](https://github.com/Celasha/Toolasha/commit/afb55107e7a8e64a0f3276bf515cd9cccd22439a))

## [2.6.2](https://github.com/Celasha/Toolasha/compare/v2.6.1...v2.6.2) (2026-04-11)

### Bug Fixes

- handle ★ ↔ (R) refined item name resolution and skip profit for untradable items ([75f90d8](https://github.com/Celasha/Toolasha/commit/75f90d8835fae82d6ed8a8a4a8e330275abb8b92))

### Miscellaneous Chores

- remove diagnostic log from loadout snapshot rendering ([743d77d](https://github.com/Celasha/Toolasha/commit/743d77d93749aab37bf09cee1525d253dee8dac9))
- retrigger release-please ([fbe2842](https://github.com/Celasha/Toolasha/commit/fbe28424d91131197f80d056fe61180a5de52e6e))

## [2.6.1](https://github.com/Celasha/Toolasha/compare/v2.6.0...v2.6.1) (2026-04-11)

### Miscellaneous Chores

- format CHANGELOG.md after release-please update ([9d5ae7d](https://github.com/Celasha/Toolasha/commit/9d5ae7dce3a7ea091dc81b7b5cb17859bd61814c))

## [2.6.0](https://github.com/Celasha/Toolasha/compare/v2.5.1...v2.6.0) (2026-04-11)

### Features

- add "Filled or Active" status filter to market history ([48df8dc](https://github.com/Celasha/Toolasha/commit/48df8dcfb89b2ea8334f22aca70c489d50f0a7bc))
- show rolled-up value on collapsed custom inventory tab headers ([2ca8947](https://github.com/Celasha/Toolasha/commit/2ca8947f73e9e01dcab106e0f04ad641b6adea2c))

### Bug Fixes

- make custom tabs import apply layout immediately ([5e32ce2](https://github.com/Celasha/Toolasha/commit/5e32ce2012deb5ccd98874e3722bed40a36e8216))
- resolve loadout snapshots not showing in custom tab editor on production builds ([644043f](https://github.com/Celasha/Toolasha/commit/644043f8b6094574c4864dadceb3614a482cca08))
- show partially-filled cancelled orders as filled in market history ([d58697d](https://github.com/Celasha/Toolasha/commit/d58697dfef0397e0ccbd80f5e58023d01e97f6b9))

## [2.5.1](https://github.com/Celasha/Toolasha/compare/v2.5.0...v2.5.1) (2026-04-10)

### Bug Fixes

- allow time-till-level tooltip to work without XP/hr sidebar enabled ([368e2d0](https://github.com/Celasha/Toolasha/commit/368e2d044bb8acdf47baa156f14dcdb36121ad2e))
- disable collection filters and skilling badges when toggled off ([feb43ac](https://github.com/Celasha/Toolasha/commit/feb43acfa23398e09630a4311d9db8410c89273a))
- remove duplicate Iron Cow Mode checkbox from settings UI ([989ea99](https://github.com/Celasha/Toolasha/commit/989ea996cdb51fe184aa4e522e73e6355de835ce))
- restore task Go merge and queued indicator in Iron Cow mode ([cfb0959](https://github.com/Celasha/Toolasha/commit/cfb0959f9553fecf1dc1f6ca8ad3218f8405c003))

## [2.5.0](https://github.com/Celasha/Toolasha/compare/v2.4.0...v2.5.0) (2026-04-10)

### Features

- add line breaks and move-to-top to custom tab item editor ([9c6ce2c](https://github.com/Celasha/Toolasha/commit/9c6ce2ccdb5bd98c99861c65edf5fc7cc120ef0c))

## [2.4.0](https://github.com/Celasha/Toolasha/compare/v2.3.1...v2.4.0) (2026-04-10)

### Features

- pre-fill action count when navigating via "View Action" from missing materials ([ac40f58](https://github.com/Celasha/Toolasha/commit/ac40f58c14c0a136adbd8686925cef924e77d73a))
- show level gap and tooltip on Automations best-level badges ([140f827](https://github.com/Celasha/Toolasha/commit/140f82746bb4eb35891a4aa7a1b094f719cf6d61))

## [2.3.1](https://github.com/Celasha/Toolasha/compare/v2.3.0...v2.3.1) (2026-04-09)

### Code Refactoring

- move "add all items" toggle into tab editor ([4016d10](https://github.com/Celasha/Toolasha/commit/4016d104c1403d948ea076d275fbc00daf47bf65))

## [2.3.0](https://github.com/Celasha/Toolasha/compare/v2.2.2...v2.3.0) (2026-04-09)

### Features

- add configurable tile spacing setting for Toolasha tab ([eb39e5e](https://github.com/Celasha/Toolasha/commit/eb39e5e896b76ff5193f40a47b11da8203ddd900))

### Bug Fixes

- exclude collapsed-tab enhanced items from Unorganized bucket ([902ed44](https://github.com/Celasha/Toolasha/commit/902ed44fcd3a46f042c78d96ccc4f9f93e94539f))
- only show hidden-items warning when owned items are absent from DOM ([5e25f99](https://github.com/Celasha/Toolasha/commit/5e25f9960e2184e3f9281e5fac73ba065f7d6976))
- prevent concurrent layout calls and update layout on editor item changes ([1bacc33](https://github.com/Celasha/Toolasha/commit/1bacc33d98e358afb4da04675a20b6df741af50f))
- update Unorganized chevron immediately on toggle ([2845a25](https://github.com/Celasha/Toolasha/commit/2845a253994ec2f07c3c49da510d750e369238f7))

### Styles

- compact inventory panel header rows and unify button styles ([ca3e209](https://github.com/Celasha/Toolasha/commit/ca3e209b99bd0ada2187e655d3fa1bfdb43d66e9))

## [2.2.2](https://github.com/Celasha/Toolasha/compare/v2.2.1...v2.2.2) (2026-04-09)

### Bug Fixes

- remove ownership filter from item search; increase tab header color opacity ([8e64979](https://github.com/Celasha/Toolasha/commit/8e64979da78c566bfed11f546cbfb8b1bdaa337b))

## [2.2.1](https://github.com/Celasha/Toolasha/compare/v2.2.0...v2.2.1) (2026-04-09)

### Bug Fixes

- sort category items and category list by game sortIndex ([6057eff](https://github.com/Celasha/Toolasha/commit/6057effdf30efd65132e5bd2e6a3d833feacb087))

## [2.2.0](https://github.com/Celasha/Toolasha/compare/v2.1.0...v2.2.0) (2026-04-09)

### Features

- add "Add to Tab" button to item action menu ([53d8c27](https://github.com/Celasha/Toolasha/commit/53d8c279fb15f14f4c65172c2d59d15ab3f19f77))
- add "From Loadout" section in tab editor to bulk-add loadout items ([5061283](https://github.com/Celasha/Toolasha/commit/50612830d27250fd457665422faafe2a8a0e5b38))
- add color picker and hex input to custom tab color selector ([1b83c2c](https://github.com/Celasha/Toolasha/commit/1b83c2c52b6cd6e059248ab95f16c8a038e6b55c))
- add drag-and-drop item reordering in tab editor ([a9e5e60](https://github.com/Celasha/Toolasha/commit/a9e5e60fd699ca2539fae0071b1dd92b3482fbed))
- add export/import for custom inventory tab layouts ([8fcc6db](https://github.com/Celasha/Toolasha/commit/8fcc6db7b69c8eb93c4d33e6fa57f54581ef20c9))

### Bug Fixes

- pin tab editor footer buttons outside the scrollable modal body ([cfd2b7b](https://github.com/Celasha/Toolasha/commit/cfd2b7b31f2f5562cb4c929bd929d2b89ba76919))
- show summed badge value in custom tab section headers ([4bb15a2](https://github.com/Celasha/Toolasha/commit/4bb15a299dde6833765c95f488535f8b2f591b6d))
- show warning indicator when custom tab items are hidden by collapsed inventory category ([e6cc182](https://github.com/Celasha/Toolasha/commit/e6cc1829bdfd3afe9ed2a67e6544ce11657b6f05))
- sort Unorganized section by game sortIndex ([b3d97be](https://github.com/Celasha/Toolasha/commit/b3d97be8311366c4263fc468ef92670eae6af04b))
- support per-enhancement-level item assignment in custom tabs ([c1924b1](https://github.com/Celasha/Toolasha/commit/c1924b1cb65740421f24c16b3e123fda2c95c140))

### Code Refactoring

- move material tab click handler outside loop to fix no-loop-func lint warning ([cdb8fce](https://github.com/Celasha/Toolasha/commit/cdb8fcefd4fc81f58d55f6544d290451f1cd37b8))

### Styles

- fix Prettier formatting ([b56443b](https://github.com/Celasha/Toolasha/commit/b56443bcb43e073d2d95067322cacf1cb35d26e9))

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
