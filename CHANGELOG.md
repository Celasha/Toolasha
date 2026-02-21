# Changelog

## [1.5.1](https://github.com/Celasha/Toolasha/compare/v1.5.0...v1.5.1) (2026-02-21)

### Bug Fixes

- revert gathering stats to simpler rendering and exclude non-tradeable items from gold calc ([f16b319](https://github.com/Celasha/Toolasha/commit/f16b319c9bdb91a84b6ce65f25e32b099ee53231))

## [1.5.0](https://github.com/Celasha/Toolasha/compare/v1.4.3...v1.5.0) (2026-02-21)

### Features

- add auto-click "All" button feature for loot boxes ([bec9df9](https://github.com/Celasha/Toolasha/commit/bec9df9f69b012539bc470946a9be41c0a214007))

### Bug Fixes

- restore inventory badges when clicking items via shared tooltip observer ([55271d9](https://github.com/Celasha/Toolasha/commit/55271d9fd865c5d95756c4ea176abda21cd24a45))

## [1.4.3](https://github.com/Celasha/Toolasha/compare/v1.4.2...v1.4.3) (2026-02-21)

### Code Refactoring

- remove settings parent-child nesting system ([6445730](https://github.com/Celasha/Toolasha/commit/64457309a581631c00ba22b4f64e7f7ecb8c9791))

## [1.4.2](https://github.com/Celasha/Toolasha/compare/v1.4.1...v1.4.2) (2026-02-21)

### Code Refactoring

- consolidate item count parsing into shared utility ([e7d7f9c](https://github.com/Celasha/Toolasha/commit/e7d7f9c3f06ec1e55fdcb5f324a2330f5653cb15))

## [1.4.1](https://github.com/Celasha/Toolasha/compare/v1.4.0...v1.4.1) (2026-02-21)

### Bug Fixes

- handle international number formats in inventory badge count parsing ([13b03a4](https://github.com/Celasha/Toolasha/commit/13b03a4a76e75e2f8a82dc9115a4e48d1bb89db9))

## [1.4.0](https://github.com/Celasha/Toolasha/compare/v1.3.1...v1.4.0) (2026-02-21)

### Features

- add external profile support to Milkonomy export and update credits ([fdc2f79](https://github.com/Celasha/Toolasha/commit/fdc2f7903fc5f18391faf2ef6abd405129eab150))
- add Level Progress and Action Speed sections to alchemy with MooPass support ([b68b337](https://github.com/Celasha/Toolasha/commit/b68b33709959d0e2e9b75305da9edbcc90d7a217))
- add pricing mode display and fix efficiency decimal precision in action panels ([8464946](https://github.com/Celasha/Toolasha/commit/8464946fdd7df55c09f409b9e392b7b8ab11361a))

### Bug Fixes

- resolve tea optimizer category filtering and NaN display issues ([30fcb58](https://github.com/Celasha/Toolasha/commit/30fcb586c89a33cadff53b395a6c5524ba583b38))

### Performance Improvements

- convert features to event-driven updates and fix infinite loop ([94355e4](https://github.com/Celasha/Toolasha/commit/94355e48136411408d4ee7e4a570e8f46da3ad9a))

## [1.3.1](https://github.com/Celasha/Toolasha/compare/v1.3.0...v1.3.1) (2026-02-20)

### Bug Fixes

- remove userscript header from standalone library for GreasyFork compatibility ([164431c](https://github.com/Celasha/Toolasha/commit/164431cf68f554ee143d5ae05b5a08cd8061e48e))

## [1.3.0](https://github.com/Celasha/Toolasha/compare/v1.2.0...v1.3.0) (2026-02-20)

### Features

- add Socko's Combat Tracker to external links ([11531b4](https://github.com/Celasha/Toolasha/commit/11531b45da808b98317704eab40358463a151c75))

### Miscellaneous Chores

- commit standalone enhancement library for GreasyFork compatibility ([acc85a4](https://github.com/Celasha/Toolasha/commit/acc85a49d9af65aea80410f0a15be205c22e6ddc))

## [1.2.0](https://github.com/Celasha/Toolasha/compare/v1.1.1...v1.2.0) (2026-02-20)

### Features

- add standalone enhancement calculator library for external tools ([b7e9b49](https://github.com/Celasha/Toolasha/commit/b7e9b490b1b68fb717da2de6a9a67a6a82ba4c9f))

### Continuous Integration

- build standalone enhancement library in release workflow ([0b7b921](https://github.com/Celasha/Toolasha/commit/0b7b92195b53b0de561640632985afc8bcdbc92a))

## [1.1.1](https://github.com/Celasha/Toolasha/compare/v1.1.0...v1.1.1) (2026-02-20)

### Bug Fixes

- calculate correct time for Philosopher's Mirror enhancement strategy ([0c95e51](https://github.com/Celasha/Toolasha/commit/0c95e519f0f7ec9290786ecd427cdfa45bf5606a))
- correct mention badge positioning to match game UI ([acb6cd0](https://github.com/Celasha/Toolasha/commit/acb6cd05ea4bea683a0981771ff3067ba991fb2b))

### Performance Improvements

- replace 10ms polling with Promise for character switch cleanup ([0512733](https://github.com/Celasha/Toolasha/commit/0512733e4116e825543ba5961dfe4b2c5295302c))

## [1.1.0](https://github.com/Celasha/Toolasha/compare/v1.0.0...v1.1.0) (2026-02-19)

### Features

- add mention tracker for chat [@mentions](https://github.com/mentions) ([1805fc0](https://github.com/Celasha/Toolasha/commit/1805fc0c4bd87bf357b12e3c8bc20963fad9a6cb))
- show drink concentration impact in tea recommendations ([a5a2777](https://github.com/Celasha/Toolasha/commit/a5a27773ac3b3060b0e6919e01bc377745fde3af))

### Bug Fixes

- resolve settings reset on character switch ([71319e1](https://github.com/Celasha/Toolasha/commit/71319e1fc25ac2792d05a907f7128842002f7251))

### Performance Improvements

- remove DOM polling from listing age and dungeon tracker ([aa33e4e](https://github.com/Celasha/Toolasha/commit/aa33e4e59f3bad8203e166c28a0a7c2b6a8787c6))
- replace alchemy profit polling with event-driven updates ([31396c0](https://github.com/Celasha/Toolasha/commit/31396c0513b8e696f5ccda7fac1bd5dc42b1429b))
- replace enhancement UI polling with event-driven updates ([44c2e77](https://github.com/Celasha/Toolasha/commit/44c2e7742ae548a820700ac247047b311de508ad))

## [1.0.0](https://github.com/Celasha/Toolasha/compare/v0.39.1...v1.0.0) (2026-02-19)

### Features

- add tea recommendation optimizer for gathering and production skills ([c9fe4d9](https://github.com/Celasha/Toolasha/commit/c9fe4d98d78ade8e836d4376838868bf7c562a26))

### Bug Fixes

- prevent gathering stats overlay from overlapping action images ([a8ca719](https://github.com/Celasha/Toolasha/commit/a8ca7197c57378d69f84508f2d49fa7b803ca297))

## [0.39.1](https://github.com/Celasha/Toolasha/compare/v0.39.0...v0.39.1) (2026-02-17)

### Bug Fixes

- handle apostrophes in item dictionary View Action button ([99571f7](https://github.com/Celasha/Toolasha/commit/99571f7840901441519c2533e1fb9f2a5fcbc349))
- reset marketplace sort button state on tab change ([000d68e](https://github.com/Celasha/Toolasha/commit/000d68eb45f8e1e625fc754a60072868f2037aa7))

## [0.39.0](https://github.com/Celasha/Toolasha/compare/v0.38.2...v0.39.0) (2026-02-17)

### Features

- add marketplace sort by profitability ([fe4d790](https://github.com/Celasha/Toolasha/commit/fe4d790e13fdc1d371e94869c20fca0a9d60b61f))

### Bug Fixes

- improve marketplace sort reset and initial state ([a535bb9](https://github.com/Celasha/Toolasha/commit/a535bb954c4e62fd9c3874f656eaa7927927f38c))

## [0.38.2](https://github.com/Celasha/Toolasha/compare/v0.38.1...v0.38.2) (2026-02-17)

### Performance Improvements

- remove unnecessary delay in remaining XP initialization ([8179a8d](https://github.com/Celasha/Toolasha/commit/8179a8d471b61ab2d8877af755bb009f518b8f40))

## [0.38.1](https://github.com/Celasha/Toolasha/compare/v0.38.0...v0.38.1) (2026-02-16)

### Bug Fixes

- resolve enhancement tracker and networth calculation bugs ([ddbe16e](https://github.com/Celasha/Toolasha/commit/ddbe16eb419877fbd1b96d6c051d7eaa960fb6f7))

## [0.38.0](https://github.com/Celasha/Toolasha/compare/v0.37.1...v0.38.0) (2026-02-15)

### Features

- add ability book status to item tooltips ([ec22f37](https://github.com/Celasha/Toolasha/commit/ec22f37f3279675d71586a62afc9ec29e6737ef8))

### Bug Fixes

- correct trade history comparison logic for Orders mode ([68796f7](https://github.com/Celasha/Toolasha/commit/68796f7fb49ee1368939f50d2b819a471111eced))

### Performance Improvements

- add worker parallelization for networth and EV calculations ([7c540b6](https://github.com/Celasha/Toolasha/commit/7c540b6ad635dc1abac7b67d8ce0ff6bb38d13d8))

## [0.37.1](https://github.com/Celasha/Toolasha/compare/v0.37.0...v0.37.1) (2026-02-15)

### Performance Improvements

- add Web Workers for parallel enhancement calculations ([354ed52](https://github.com/Celasha/Toolasha/commit/354ed52ba9f203a6a16e4578e9eae4f0dd49ad56))

## [0.37.0](https://github.com/Celasha/Toolasha/compare/v0.36.0...v0.37.0) (2026-02-15)

### Features

- add action bar display modes with dropdown setting ([5bcae71](https://github.com/Celasha/Toolasha/commit/5bcae71352f3b27d72e46bdb59c7fbbd0c1e8b76))
- support multiple JSON formats for Edible market import ([020317e](https://github.com/Celasha/Toolasha/commit/020317e67c675daeb89634b8c76edb3d0b19262b))

## [0.36.0](https://github.com/Celasha/Toolasha/compare/v0.35.0...v0.36.0) (2026-02-14)

### Features

- add Coins/XP efficiency metric to action panels ([e83dde1](https://github.com/Celasha/Toolasha/commit/e83dde150570f4bf6f204030340fb6c346088c8c))
- add View Action button to Item Dictionary modal ([ca763e0](https://github.com/Celasha/Toolasha/commit/ca763e0a7a8417e840d116d23ad6199e0bf7ca5e))

## [0.35.0](https://github.com/Celasha/Toolasha/compare/v0.34.0...v0.35.0) (2026-02-14)

### Features

- add Alt+click item navigation to crafting/gathering pages ([1825eed](https://github.com/Celasha/Toolasha/commit/1825eed9002eef3073d4da0a58a8a2d39d9838c6))

### Bug Fixes

- resolve combat simulator skill calculator issues ([226ec15](https://github.com/Celasha/Toolasha/commit/226ec15a8e0bb5432fb28f1e46f5eab3691290db))

## [0.34.0](https://github.com/Celasha/Toolasha/compare/v0.33.1...v0.34.0) (2026-02-14)

### Features

- add skill progression calculator to combat simulator ([7e3650a](https://github.com/Celasha/Toolasha/commit/7e3650a1adb79761b6db55e69421878a369e0c61))

## [0.33.1](https://github.com/Celasha/Toolasha/compare/v0.33.0...v0.33.1) (2026-02-14)

### Bug Fixes

- reset consumable tracking when combat restarts ([f4768d8](https://github.com/Celasha/Toolasha/commit/f4768d8f4d6310d88891deadee22509f35f1f5c4))

## [0.33.0](https://github.com/Celasha/Toolasha/compare/v0.32.0...v0.33.0) (2026-02-14)

### Features

- add combat score to character sheet URL ([2524253](https://github.com/Celasha/Toolasha/commit/25242537aaaff264e4490e75dbca50fd608f4e53))

## [0.32.0](https://github.com/Celasha/Toolasha/compare/v0.31.0...v0.32.0) (2026-02-14)

### Features

- add task inventory highlighter and fix market tooltip ([e496b92](https://github.com/Celasha/Toolasha/commit/e496b9274a4afed1e1a9998690025861cabfbc6e))

### Documentation

- update performance.md with verification results and completed fixes ([c1602d1](https://github.com/Celasha/Toolasha/commit/c1602d10643fc756a003e5576ed011d08312885a))

### Miscellaneous Chores

- add docs/ to .gitignore to exclude documentation from repo ([f2403ba](https://github.com/Celasha/Toolasha/commit/f2403ba0e523169fb337df733a2f75f85720aa5a))

## [0.31.0](https://github.com/Celasha/Toolasha/compare/v0.30.1...v0.31.0) (2026-02-13)

### Features

- add chat commands (/item, /wiki, /market) ([0e265ee](https://github.com/Celasha/Toolasha/commit/0e265ee3becd69d5c6f20aa5390076bbf3148a60))
- add market queue length estimator with color customization ([49b4ec3](https://github.com/Celasha/Toolasha/commit/49b4ec3a4e0ab6cbcb2261e6aa889f9a3e027d93))
- add search filter for action panels ([6c5cd0d](https://github.com/Celasha/Toolasha/commit/6c5cd0ddab451b03370a7b9441171cd993a32ee3))

### Bug Fixes

- exempt coins from market tax in expected value calculations ([b623b04](https://github.com/Celasha/Toolasha/commit/b623b04d48a643643599ddd8492ec63c1e3df96f))

### Performance Improvements

- optimize market history viewer filtering for 1000+ listings ([c1ad708](https://github.com/Celasha/Toolasha/commit/c1ad708afe0b26b1a3f4438ab72eff10ba4343e9))

## [0.30.1](https://github.com/Celasha/Toolasha/compare/v0.30.0...v0.30.1) (2026-02-12)

### Bug Fixes

- add missing fields and consumables to Combat Sim Export ([be960e3](https://github.com/Celasha/Toolasha/commit/be960e3cca99945c0b29cd20150eb1024bdadef2))

## [0.30.0](https://github.com/Celasha/Toolasha/compare/v0.29.0...v0.30.0) (2026-02-12)

### Features

- implement MCS-style party member consumable tracking via snapshots ([5e81c35](https://github.com/Celasha/Toolasha/commit/5e81c350f6238af741dafc4548878e3e68969490))

## [0.29.0](https://github.com/Celasha/Toolasha/compare/v0.28.3...v0.29.0) (2026-02-12)

### Features

- add market listing status tracking and fix party consumable calculation ([d1e1831](https://github.com/Celasha/Toolasha/commit/d1e183121d3809c57102bb12e7be88ab35c747fb))

## [0.28.3](https://github.com/Celasha/Toolasha/compare/v0.28.2...v0.28.3) (2026-02-11)

### Bug Fixes

- parse JSON strings in getSettingValue for template settings ([970e8fb](https://github.com/Celasha/Toolasha/commit/970e8fbdbc1a6db12e0d5124f38ef043016dcdfc))
- resolve combat summary and market listing age issues ([3b1a007](https://github.com/Celasha/Toolasha/commit/3b1a007b3e5f281de05fd9ea37d13b1e8f6e73d8))

## [0.28.2](https://github.com/Celasha/Toolasha/compare/v0.28.1...v0.28.2) (2026-02-11)

### Bug Fixes

- add deduplication check for combat summary stats injection ([cac7739](https://github.com/Celasha/Toolasha/commit/cac77397bd96b9d1585fb1a4426f03d56420a9f1))

### Documentation

- clarify skillbook setting applies to item dictionary window ([452d9bb](https://github.com/Celasha/Toolasha/commit/452d9bbbae16f7dd656b244da6c76ca0b17cdf1c))

## [0.28.1](https://github.com/Celasha/Toolasha/compare/v0.28.0...v0.28.1) (2026-02-11)

### Bug Fixes

- align task time calculations ([0154ae2](https://github.com/Celasha/Toolasha/commit/0154ae2f1eb7b74579b6b13fe4466d20d3843b68))
- apply efficiency to task time ([8c3d7e1](https://github.com/Celasha/Toolasha/commit/8c3d7e1732e95d537391532a6450d6748e5628bf))

### Code Refactoring

- unify effective actions per hour ([4fdcd1f](https://github.com/Celasha/Toolasha/commit/4fdcd1fd517f25426442fa83a235e1f570b450a0))

## [0.28.0](https://github.com/Celasha/Toolasha/compare/v0.27.0...v0.28.0) (2026-02-11)

### Features

- make Market Listings expandable in networth display ([4cfdd83](https://github.com/Celasha/Toolasha/commit/4cfdd83ca0e63f8f41d62f8add4c49b00b435d34))

### Bug Fixes

- convert API timestamps to milliseconds and purge stale price patches ([e9c7984](https://github.com/Celasha/Toolasha/commit/e9c79845baddcc4993d4c136bbf389e439d82b6c))
- correct enhancement level detection in order book price patches ([d9e95db](https://github.com/Celasha/Toolasha/commit/d9e95db7af95398d32a5ab7604d437f2e88ba2cb))
- correct house inventory counting and add combat deaths/hour ([d63239e](https://github.com/Celasha/Toolasha/commit/d63239eb8b601c3c2241390e71d63b73ba99218e))
- respect combatStats setting to show/hide Statistics tab ([3f0671a](https://github.com/Celasha/Toolasha/commit/3f0671af927774d2417a96c2a197bef2d0871c2a))
- validate active listings when matching beyond top 20 in order book ([2db7155](https://github.com/Celasha/Toolasha/commit/2db715507853985289d9a651bd81d35c425b000a))

## [0.27.0](https://github.com/Celasha/Toolasha/compare/v0.26.3...v0.27.0) (2026-02-10)

### Features

- patch market API prices with fresh order book data ([b8ac1aa](https://github.com/Celasha/Toolasha/commit/b8ac1aa83306073256d7e83c3494e24f0f88cf82))

### Bug Fixes

- improve alchemy profit calculations with 5 bug fixes ([226b34c](https://github.com/Celasha/Toolasha/commit/226b34ce0ce679df300556c7a4c9cc08a53a9b9a))
- preserve array reference in marketplace tabs cleanup ([0a9e3f8](https://github.com/Celasha/Toolasha/commit/0a9e3f820d31906fbd285651fda3c81394091666))

### Miscellaneous Chores

- show all commit types in changelog and bump refactor/perf/build/revert as patch ([72e3c15](https://github.com/Celasha/Toolasha/commit/72e3c15a2ed4dfe36ae57ab9bd275aadc67aa364))
- show all commit types in changelog and bump refactor/perf/build/revert as patch ([3ff4d9a](https://github.com/Celasha/Toolasha/commit/3ff4d9af9a816b1809ee72ab1e39e47bc1b5b2ad))

## [0.26.3](https://github.com/Celasha/Toolasha/compare/v0.26.2...v0.26.3) (2026-02-10)

### Bug Fixes

- use order book cache for Top Order Price to match Top Order Age ([f3de521](https://github.com/Celasha/Toolasha/commit/f3de521dbc44d9b1d1b889ea658d158c7e248515))

## [0.26.2](https://github.com/Celasha/Toolasha/compare/v0.26.1...v0.26.2) (2026-02-10)

### Bug Fixes

- use GM_info for script manager detection to avoid Steam polyfill ([160ec7e](https://github.com/Celasha/Toolasha/commit/160ec7e71b03e04fccab0c7b45a8d1343087b07a))

## [0.26.1](https://github.com/Celasha/Toolasha/compare/v0.26.0...v0.26.1) (2026-02-10)

### Bug Fixes

- skip deduplication for battle_consumable_ability_updated events ([5a8fda5](https://github.com/Celasha/Toolasha/commit/5a8fda566ba89245acc28adbfb4f311f9d333daf))

## [0.26.0](https://github.com/Celasha/Toolasha/compare/v0.25.0...v0.26.0) (2026-02-10)

### Features

- add philo calculator and move market history to marketplace tab ([54fe928](https://github.com/Celasha/Toolasha/commit/54fe928d4f73f7a0867770495c478765830cdbfd))

### Bug Fixes

- remove debounce from combat score panel cleanup observer ([3f1028c](https://github.com/Celasha/Toolasha/commit/3f1028c680f0f968b7ef2ab7c8be3747678308fe))

## [0.25.0](https://github.com/Celasha/Toolasha/compare/v0.24.5...v0.25.0) (2026-02-09)

### Features

- add DD-MM date format, task token toggle, and ability books toggle ([c04a974](https://github.com/Celasha/Toolasha/commit/c04a974c355c339647fa97bcfeaeaa3edd57ac38))
- use KMB formatting for combat summary and enhancement tooltip numbers ([1df5f41](https://github.com/Celasha/Toolasha/commit/1df5f41d5556b354b07293b1c92675a410040335))

## [0.24.5](https://github.com/Celasha/Toolasha/compare/v0.24.4...v0.24.5) (2026-02-09)

### Bug Fixes

- correct alchemy profit calculation and display bugs ([12ff1a7](https://github.com/Celasha/Toolasha/commit/12ff1a731d753eb222b9670c9b8709650c1c116c))

## [0.24.4](https://github.com/Celasha/Toolasha/compare/v0.24.3...v0.24.4) (2026-02-09)

### Bug Fixes

- move View Card button into combat score panel template to prevent disappearing ([ddd8e47](https://github.com/Celasha/Toolasha/commit/ddd8e47328ecce522af49d097620e838f0c8a749))

## [0.24.3](https://github.com/Celasha/Toolasha/compare/v0.24.2...v0.24.3) (2026-02-09)

### Bug Fixes

- debounce profile panel cleanup observer to prevent premature removal ([0437dd8](https://github.com/Celasha/Toolasha/commit/0437dd8c1fb52fbf476d172e3234903fe666a502))

## [0.24.2](https://github.com/Celasha/Toolasha/compare/v0.24.1...v0.24.2) (2026-02-09)

### Bug Fixes

- correct alchemy profit calculations and add essence/rare drop revenue ([0aac51a](https://github.com/Celasha/Toolasha/commit/0aac51ae37f60359be6e5b2f9fce91df5dee8718))

## [0.24.1](https://github.com/Celasha/Toolasha/compare/v0.24.0...v0.24.1) (2026-02-09)

### Bug Fixes

- account for queued materials in Missing Materials feature ([3bbbde2](https://github.com/Celasha/Toolasha/commit/3bbbde217d460ebe0986d498246f5eec06f72927))

## [0.24.0](https://github.com/Celasha/Toolasha/compare/v0.23.0...v0.24.0) (2026-02-08)

### Features

- unify alchemy profit calculators for tooltip and action panel ([4592452](https://github.com/Celasha/Toolasha/commit/459245250f20fe1594497ce237ecfde3b4e8b9c8))

## [0.23.0](https://github.com/Celasha/Toolasha/compare/v0.22.3...v0.23.0) (2026-02-08)

### Features

- add auto-fill sell price strategy setting ([4e073f6](https://github.com/Celasha/Toolasha/commit/4e073f677a0e71ca07bc108850b920511cced719))

## [0.22.3](https://github.com/Celasha/Toolasha/compare/v0.22.2...v0.22.3) (2026-02-08)

### Bug Fixes

- use header text for sell order detection in auto-click max ([15b9110](https://github.com/Celasha/Toolasha/commit/15b911076b24e107161ea5037be64c070e210f47))
- use WebSocket data for trade history on equipment items ([ad9f54b](https://github.com/Celasha/Toolasha/commit/ad9f54b48dae0357769d5cdaa6f763a2438c9cd3))

## [0.22.2](https://github.com/Celasha/Toolasha/compare/v0.22.1...v0.22.2) (2026-02-08)

### Bug Fixes

- resolve trade history display overlap and color logic ([bf4f7c9](https://github.com/Celasha/Toolasha/commit/bf4f7c99baccfa6ed507bdba7112cde39123d968))

## [0.22.1](https://github.com/Celasha/Toolasha/compare/v0.22.0...v0.22.1) (2026-02-07)

### Bug Fixes

- improve task icon compatibility and sprite detection ([f915a2e](https://github.com/Celasha/Toolasha/commit/f915a2e5664b82b1e45e2ae52e0eed3e89a4edbb))
- improve task icon SVG compatibility for Chrome ([d68a452](https://github.com/Celasha/Toolasha/commit/d68a4522a0f492da974b0afae727efdbc56d8644))

## [0.22.0](https://github.com/Celasha/Toolasha/compare/v0.21.2...v0.22.0) (2026-02-07)

### Features

- add auto-click max for sell listings and remove Chinese localization ([1b1bcde](https://github.com/Celasha/Toolasha/commit/1b1bcdebd0fe1b89c02892cfdb0ad4af4ec8b44f))

## [0.21.2](https://github.com/Celasha/Toolasha/compare/v0.21.1...v0.21.2) (2026-02-07)

### Bug Fixes

- update release workflow for renamed Steam bundle filename ([f5eb7cf](https://github.com/Celasha/Toolasha/commit/f5eb7cffaf541367b51930d10d7c8f9b7d40222a))
- update release-please bootstrap-sha to v0.21.1 ([f6d3d47](https://github.com/Celasha/Toolasha/commit/f6d3d4797cce15a7c3dac0eb00478b1d1f66bb62))

## [0.21.1](https://github.com/Celasha/Toolasha/compare/v0.21.0...v0.21.1) (2026-02-07)

### Bug Fixes

- update CI workflow for renamed Steam bundle filename ([db2c1fa](https://github.com/Celasha/Toolasha/commit/db2c1fa0d25a604ac3f6427004626a1e2f163832))

## [0.21.0](https://github.com/Celasha/Toolasha/compare/v0.20.3...v0.21.0) (2026-02-07)

### Features

- add sprite fetching for Steam monster task icons ([a14f0a7](https://github.com/Celasha/Toolasha/commit/a14f0a740c14793c7a58b050c97093abaec90c31))

### Bug Fixes

- allow market order book updates to bypass deduplication ([72d016f](https://github.com/Celasha/Toolasha/commit/72d016f27056aa4fea09e22fd1c02528fe313fdd))

## [0.20.3](https://github.com/Celasha/Toolasha/compare/v0.20.2...v0.20.3) (2026-02-07)

### Bug Fixes

- navbar links and networth display on character switch ([754beb9](https://github.com/Celasha/Toolasha/commit/754beb9f303f88eb8bee1398570c4061bfb6bd3f))

## [0.20.2](https://github.com/Celasha/Toolasha/compare/v0.20.1...v0.20.2) (2026-02-07)

### Bug Fixes

- profile panels not showing on subsequent opens ([3d6a463](https://github.com/Celasha/Toolasha/commit/3d6a463caf1c625e5f1606e182f687048f8b6d04))
- update character sheet URL to GitLab ([1381ac7](https://github.com/Celasha/Toolasha/commit/1381ac7331dfd24d3e27a249acbe3649b62e2b89))
- view card button injected into wrong container ([954dbc1](https://github.com/Celasha/Toolasha/commit/954dbc1a0b9d4a91f532090d59f5a43e3d51f4de))

## [0.20.1](https://github.com/Celasha/Toolasha/compare/v0.20.0...v0.20.1) (2026-02-07)

### Bug Fixes

- handle multiple parentheses in combat action names ([4e6a5ec](https://github.com/Celasha/Toolasha/commit/4e6a5ec3e7f7ad6fb5247744462a8de776fe1851))
- resolve memory leaks and cache poisoning in tooltip handlers ([5c17439](https://github.com/Celasha/Toolasha/commit/5c1743946b833fdc708c74e7a860c78d5ea5b28f))

## [0.20.0](https://github.com/Celasha/Toolasha/compare/v0.19.0...v0.20.0) (2026-02-07)

### Features

- add dual score system for combat and skiller equipment ([a483578](https://github.com/Celasha/Toolasha/commit/a483578244e8dd362d4c0d09cdd854871fae706b))

### Bug Fixes

- exclude zero-value items from combat score equipment list ([e4cdc5e](https://github.com/Celasha/Toolasha/commit/e4cdc5e1c4df460edd589ff4717973406cd801d6))

## [0.19.0](https://github.com/Celasha/Toolasha/compare/v0.18.0...v0.19.0) (2026-02-07)

### Features

- add Steam build system and rename library files to .js ([846c1b8](https://github.com/Celasha/Toolasha/commit/846c1b882acbc69c9fcc84f7f93567ea1764de5e))

### Bug Fixes

- exclude filled sell listings from SO totals ([fc34844](https://github.com/Celasha/Toolasha/commit/fc34844a0ef37ccd4a6708717b797610704be004))
- exclude filled sell listings from SO totals ([069127f](https://github.com/Celasha/Toolasha/commit/069127fc447e2357ba8e5a66c50c773c7ec6c458))
- resolve CI failures and add Steam build to pipeline ([a20f688](https://github.com/Celasha/Toolasha/commit/a20f6889ee85eb89b5c7b08c3b27c758278efdbf))
- resolve CI failures and add Steam build to pipeline ([0eef87f](https://github.com/Celasha/Toolasha/commit/0eef87f1e0b6f2007d943c7ffc83b9d9afc10a35))
- resolve XP left display not updating in real-time ([ef6fa07](https://github.com/Celasha/Toolasha/commit/ef6fa07f8e47b645a425746c7ed00fc634433587))
- resolve XP left display not updating in real-time ([facfb74](https://github.com/Celasha/Toolasha/commit/facfb74343a850dc88b2142c317a15cb154ab59c))
- skip websocket dedup for action_completed and items_updated events ([ba7bc6e](https://github.com/Celasha/Toolasha/commit/ba7bc6e99fa6b1efd097d98aaf9de45e9f2d9506))
- skip websocket dedup for action_completed and items_updated events ([1007215](https://github.com/Celasha/Toolasha/commit/10072154b8402a5b7f0e3927e99d578bb80c8dda))

## [0.18.0](https://github.com/Celasha/Toolasha/compare/v0.17.6...v0.18.0) (2026-02-06)

### Features

- persist order book cache with color-coded staleness indicators ([6d21937](https://github.com/Celasha/Toolasha/commit/6d21937aba2ea9ee5c731e5680d10b852cc25c1b))

### Bug Fixes

- persist order book cache across page refreshes ([cde5fe8](https://github.com/Celasha/Toolasha/commit/cde5fe8354bc6b3d687a0582587ec810854b6ad8))
- prevent browser freeze during character switching ([751b923](https://github.com/Celasha/Toolasha/commit/751b923dcb0e829868f133b2b79a94bd2d656b74))
- prevent Statistics tab from appearing on Marketplace panel ([0bc78a6](https://github.com/Celasha/Toolasha/commit/0bc78a610c0cc94c9ad0d571f2a1e8d959fa56ee))
- resolve quest reroll and consumable tracking bugs ([b3bb137](https://github.com/Celasha/Toolasha/commit/b3bb1370da1bb69ecb83e1095ab8aad77f56a8bc))

### Performance Improvements

- replace polling loop with MutationObserver in listing price display ([2760075](https://github.com/Celasha/Toolasha/commit/2760075301705ee910de0ac6f459b867537cef74))

## [0.17.6](https://github.com/Celasha/Toolasha/compare/v0.17.5...v0.17.6) (2026-02-06)

### Bug Fixes

- filter out seed listings without itemHrid in market history viewer ([86bbffc](https://github.com/Celasha/Toolasha/commit/86bbffc9697c7bda74d9d650e63839018cf59b4b))

## [0.17.5](https://github.com/Celasha/Toolasha/compare/v0.17.4...v0.17.5) (2026-02-06)

### Bug Fixes

- use external sprite references in combat score abilities panel ([d99464b](https://github.com/Celasha/Toolasha/commit/d99464b3fa2b3bf721b4b54932f74a76fea036d0))
- use external sprite references in market history viewer ([e9a0f9b](https://github.com/Celasha/Toolasha/commit/e9a0f9bcc6361a79ee90df36bc00862f031f1609))

## [0.17.4](https://github.com/Celasha/Toolasha/compare/v0.17.3...v0.17.4) (2026-02-06)

### Bug Fixes

- resolve dungeon icon display and filter persistence issues ([d5c455d](https://github.com/Celasha/Toolasha/commit/d5c455d20c31f9971ee41487c5c44bcca2133387))
- resolve market history viewer button not appearing in settings ([04be752](https://github.com/Celasha/Toolasha/commit/04be752a6d3bfc4425d4e39c5dc1c2afce9706f5))

## [0.17.3](https://github.com/Celasha/Toolasha/compare/v0.17.2...v0.17.3) (2026-02-06)

### Bug Fixes

- use external sprite URLs for task icons and filters ([41255e9](https://github.com/Celasha/Toolasha/commit/41255e9682446a6d29c365812c9da95060d19f7a))

## [0.17.2](https://github.com/Celasha/Toolasha/compare/v0.17.1...v0.17.2) (2026-02-05)

### Bug Fixes

- prevent double-initialization on character switch and enhance statistics tab ([b516ce0](https://github.com/Celasha/Toolasha/commit/b516ce018adee3aa3fe3970e60aeac127cad5eeb))

## [0.17.1](https://github.com/Celasha/Toolasha/compare/v0.17.0...v0.17.1) (2026-02-05)

### Bug Fixes

- improve missing materials tabs cleanup detection ([6c30b58](https://github.com/Celasha/Toolasha/commit/6c30b5811573db61d7b0861c2d01b35d674cf9a1))
- improve missing materials tabs cleanup detection ([1c3c7f4](https://github.com/Celasha/Toolasha/commit/1c3c7f4f40e505e2aafbfc4245542a3b79b5f2ae))
- use dynamic SVG symbol cloning and extend timeout for Steam ([91c494a](https://github.com/Celasha/Toolasha/commit/91c494a088c5d7a270a1d672accc1b66f4948679))

## [0.17.0](https://github.com/Celasha/Toolasha/compare/v0.16.2...v0.17.0) (2026-02-05)

### Features

- add abilities & triggers display to profile panel ([0821759](https://github.com/Celasha/Toolasha/commit/0821759ad59eed2ee008283ad32825d3234d3f93))
- add disconnect-aware runtime behavior ([862eb59](https://github.com/Celasha/Toolasha/commit/862eb59e4c0f946134880d6c10a046ecb145d506))
- add disconnect-aware runtime behavior ([8d3b2a9](https://github.com/Celasha/Toolasha/commit/8d3b2a9665113149a900b35ea02b689d529d97cb))
- add trade history comparison mode and improve UI positioning ([4e5dbdf](https://github.com/Celasha/Toolasha/commit/4e5dbdfcad965c89d6cc4c2e2641acfa4b86cd8a))

### Bug Fixes

- re-process order book containers after WebSocket data arrives ([e24a7ee](https://github.com/Celasha/Toolasha/commit/e24a7eee9e44a63e26218926c22f004af3871abc))

## [0.16.2](https://github.com/Celasha/Toolasha/compare/v0.16.1...v0.16.2) (2026-02-04)

### Bug Fixes

- correct feature registry key for skillRemainingXP toggle ([d37ac56](https://github.com/Celasha/Toolasha/commit/d37ac56638da51d6b22938412f2ad1ff5999317f))
- correct feature registry key for skillRemainingXP toggle ([be09de0](https://github.com/Celasha/Toolasha/commit/be09de0cb8cc1a0412ac171b09203f882e737ffd))
- equipment order books now show age estimates using enhancement level key ([62aab0a](https://github.com/Celasha/Toolasha/commit/62aab0a1d9d0d3386ff14e0538559fa2b4336538))
- prevent duplicate timestamps for listings with same quantity ([6f948f6](https://github.com/Celasha/Toolasha/commit/6f948f629b58df21dcd6ed9ba25ff771973e7e94))
- remove old age column elements before adding new ones ([567a68a](https://github.com/Celasha/Toolasha/commit/567a68a14f6c0b44aedbd877bff58cbba0cbebf7))

## [0.16.1](https://github.com/Celasha/Toolasha/compare/v0.16.0...v0.16.1) (2026-02-04)

### Bug Fixes

- initialize market data for task profits ([204c83b](https://github.com/Celasha/Toolasha/commit/204c83be08bc948d36aaa774eeffd5bbc694137e))

## [0.16.0](https://github.com/Celasha/Toolasha/compare/v0.15.5...v0.16.0) (2026-02-04)

### Features

- add task auto-sort and fix listing age estimation ([abe7600](https://github.com/Celasha/Toolasha/commit/abe7600e7f287d99d7c3f9dec95ccf9c0f0ee70e))

### Bug Fixes

- use game data for alchemy essence drop rates ([0d1880f](https://github.com/Celasha/Toolasha/commit/0d1880fd1851120fbb483d4a8006f74642e8d82f))

## [0.15.5](https://github.com/Celasha/Toolasha/compare/v0.15.4...v0.15.5) (2026-02-04)

### Bug Fixes

- correct listing age extrapolation using boundary-offset approach ([3be64f3](https://github.com/Celasha/Toolasha/commit/3be64f3018e91bf1949e8d5eac2574ae60c3be7e))
- enhancement tracker now respects main enable setting ([c4df1ed](https://github.com/Celasha/Toolasha/commit/c4df1ed3bdca6142511c4cdab24d49f9adde3a8b))
- prevent duplicate tooltip processing causing lag/crashes ([4a28177](https://github.com/Celasha/Toolasha/commit/4a281777f11af22db873b4c5f98f4d6a79fcf747))

## [0.15.4](https://github.com/Celasha/Toolasha/compare/v0.15.3...v0.15.4) (2026-02-04)

### Bug Fixes

- move external dependencies to entrypoint header ([ad6ac53](https://github.com/Celasha/Toolasha/commit/ad6ac53800d7b8c9eb66945f85c62c70aa737f4b))

## [0.15.3](https://github.com/Celasha/Toolasha/compare/v0.15.2...v0.15.3) (2026-02-04)

### Bug Fixes

- sync library header versions in version sync script ([a1b71d4](https://github.com/Celasha/Toolasha/commit/a1b71d418e8284acffcd3dd5b3195986a0973223))
- sync library header versions in version sync script ([1718445](https://github.com/Celasha/Toolasha/commit/1718445a1bed396e3c10f47b364897231b5f944c))

## [0.15.2](https://github.com/Celasha/Toolasha/compare/v0.15.1...v0.15.2) (2026-02-04)

### Bug Fixes

- use jsdelivr for pinned library URLs ([9324a43](https://github.com/Celasha/Toolasha/commit/9324a4388be103adf6e9f907bad1c9fdb261c104))
- use jsdelivr for pinned library URLs ([86b6102](https://github.com/Celasha/Toolasha/commit/86b6102a4883b8c8b368887ded4fe136f3452d16))

## [0.15.1](https://github.com/Celasha/Toolasha/compare/v0.15.0...v0.15.1) (2026-02-04)

### Bug Fixes

- correct release pinning SHA ([e030008](https://github.com/Celasha/Toolasha/commit/e030008cc3c7f6b1f1568150512d2397c41aa596))
- set library pinning sha in release ([a4c9ee1](https://github.com/Celasha/Toolasha/commit/a4c9ee1aeb05005afbf0cf444052f30aa52738af))

## [0.15.0](https://github.com/Celasha/Toolasha/compare/v0.14.3...v0.15.0) (2026-02-04)

### Features

- implement library split for Greasyfork 2MB limit ([f17c33a](https://github.com/Celasha/Toolasha/commit/f17c33afc09b61bec94ff781a7f45e8eed54af9d))
- library split for Greasyfork 2MB limit compliance ([aff7156](https://github.com/Celasha/Toolasha/commit/aff7156895653ff66d7a08037de9015965d8e246))

### Bug Fixes

- dev bundle and market totals refresh ([9026ad2](https://github.com/Celasha/Toolasha/commit/9026ad21c50bfc188ff63c74b125d4fefb1631bf))
- restore action time display matching for item-named actions ([33a9654](https://github.com/Celasha/Toolasha/commit/33a9654a7fd60e9228a6fca61599b3c027af8b20))
- update market order totals display ([8dceb6e](https://github.com/Celasha/Toolasha/commit/8dceb6e9930f038efd046c3616ce94ddd6c820a6))

## [0.14.3](https://github.com/Celasha/Toolasha/compare/v0.14.2...v0.14.3) (2026-02-03)

### Performance Improvements

- reduce script size by removing debug logging and redundant comments ([382d014](https://github.com/Celasha/Toolasha/commit/382d01423f6522a52140d49a6ebd8661bc31e989))

## [0.14.2](https://github.com/Celasha/Toolasha/compare/v0.14.1...v0.14.2) (2026-02-03)

### Performance Improvements

- optimize event handling to reduce calculation frequency ([c9ae1ca](https://github.com/Celasha/Toolasha/commit/c9ae1cad07251a60c6770f279120fb0ef0dc4dcf))

## [0.14.1](https://github.com/Celasha/Toolasha/compare/v0.14.0...v0.14.1) (2026-02-03)

### Bug Fixes

- use getSettingValue for combat stats chat template ([909f132](https://github.com/Celasha/Toolasha/commit/909f132fd23c0f8bca85bb675183edb8aae520ca))

## [0.14.0](https://github.com/Celasha/Toolasha/compare/v0.13.0...v0.14.0) (2026-02-03)

### Features

- add Combat Statistics feature with real-time consumption tracking ([df2a870](https://github.com/Celasha/Toolasha/commit/df2a8705cd2c952ca9698841b6393052054bc619))
- improve combat stats tracking with event-based consumption and template editor ([2b46c6e](https://github.com/Celasha/Toolasha/commit/2b46c6e423482c67bdea2a1e5026a559599ee5d8))

### Bug Fixes

- handle abbreviated quantity matching in market listings ([80c4025](https://github.com/Celasha/Toolasha/commit/80c402565ca4d57434e1fbd4ef296031d865273b))

## [0.13.0](https://github.com/Celasha/Toolasha/compare/v0.12.2...v0.13.0) (2026-02-02)

### Features

- **action-time:** always include current action time in queue total ([d40a171](https://github.com/Celasha/Toolasha/commit/d40a171a042aed212c8b7cca0bfedf5b4026d6d8))

### Bug Fixes

- **market:** parse K/M suffixes in listing quantities ([eee35f3](https://github.com/Celasha/Toolasha/commit/eee35f3c2d47f180046854441a38a620beb47494))

## [0.12.2](https://github.com/Celasha/Toolasha/compare/v0.12.1...v0.12.2) (2026-02-02)

### Bug Fixes

- **market:** remove price decrement for sell orders ([1f49b03](https://github.com/Celasha/Toolasha/commit/1f49b0306358fed02cd504cbfb9d4215a684cc3c))

## [0.12.1](https://github.com/Celasha/Toolasha/compare/v0.12.0...v0.12.1) (2026-02-02)

### Bug Fixes

- **action-time:** prevent queue from matching currently running action ([4beedbe](https://github.com/Celasha/Toolasha/commit/4beedbe87f06880e13d0cb967fbf9fd8ce389b3e))
- **dungeon-tracker:** sync chat run numbers with UI, prevent duplicates ([db589e0](https://github.com/Celasha/Toolasha/commit/db589e01b6815a17f20b7db78e956b52a9d0d015))

## [0.12.0](https://github.com/Celasha/Toolasha/compare/v0.11.0...v0.12.0) (2026-02-02)

### Features

- **tasks:** rank task efficiency colors by relative profit ([df36ae9](https://github.com/Celasha/Toolasha/commit/df36ae9582f4f549b33065177c827a0ed1bb5abb))

### Bug Fixes

- **actions:** prevent queue matching against current action ([43f7d29](https://github.com/Celasha/Toolasha/commit/43f7d29be17b3d604f5afedd6b506de24be14f50))
- **formatters:** respect user locale in percentage formatting ([98c80f8](https://github.com/Celasha/Toolasha/commit/98c80f8b2bc40f2b598d16c61caf1b2fd9775764))

## [0.11.0](https://github.com/Celasha/Toolasha/compare/v0.10.0...v0.11.0) (2026-02-02)

### Features

- add task efficiency rating display and tests ([c1cf2d0](https://github.com/Celasha/Toolasha/commit/c1cf2d00011683f8bf141a92ac4a27fe597ea76c))

### Bug Fixes

- **actions:** fix action time estimates and queue duration (closes [#77](https://github.com/Celasha/Toolasha/issues/77)) ([07dd8d8](https://github.com/Celasha/Toolasha/commit/07dd8d8fae1da1d3703b34a7e2381c92e9de8efe))
- correct version sync regex for README footer ([24b98fc](https://github.com/Celasha/Toolasha/commit/24b98fcf2e970f18b272122a0dd0e74d98d5234d))
- **market:** use WebSocket for trade history, fix queue action matching ([31e5df6](https://github.com/Celasha/Toolasha/commit/31e5df634faa78e10f682fa099165b92235063d6))
- refresh market listings and link totals icon ([3c60136](https://github.com/Celasha/Toolasha/commit/3c60136086a74e9dde7ee9c2d35ed1aeed37b751))

## [0.10.0](https://github.com/Celasha/Toolasha/compare/v0.9.2...v0.10.0) (2026-02-01)

### Features

- add market history viewer with filtering and export capabilities ([1d2f391](https://github.com/Celasha/Toolasha/commit/1d2f3918b885dce782b2b80b6bbfc97c28eb36af))
- reduce market history table row height for better space efficiency ([4e0dd36](https://github.com/Celasha/Toolasha/commit/4e0dd3616443e4c71ac37c6ea3e5b8f41b185656))

### Bug Fixes

- correct alchemy essence drop rate display ([1d2f391](https://github.com/Celasha/Toolasha/commit/1d2f3918b885dce782b2b80b6bbfc97c28eb36af))
- resolve SVG memory leaks in market history filter system ([1d2f391](https://github.com/Celasha/Toolasha/commit/1d2f3918b885dce782b2b80b6bbfc97c28eb36af))

## [0.9.2](https://github.com/Celasha/Toolasha/compare/v0.9.1...v0.9.2) (2026-01-31)

### Bug Fixes

- add seconds to estimated listing age datetime format ([49b3947](https://github.com/Celasha/Toolasha/commit/49b3947962da1dcdcd838079ce9b111780d9d302))

## [0.9.1](https://github.com/Celasha/Toolasha/compare/v0.9.0...v0.9.1) (2026-01-31)

### Bug Fixes

- use KMB formatting for market order totals ([33d937a](https://github.com/Celasha/Toolasha/commit/33d937af1139b84f2621dd0a982b4f3d2be9b828))

## [0.9.0](https://github.com/Celasha/Toolasha/compare/v0.8.3...v0.9.0) (2026-01-31)

### Features

- add market order totals to header ([15bb121](https://github.com/Celasha/Toolasha/commit/15bb121f8526d6e221f7e12eafbffc31c2b095af))

## [0.8.3](https://github.com/Celasha/Toolasha/compare/v0.8.2...v0.8.3) (2026-01-31)

### Bug Fixes

- correct marketplace listing age ordering for same-price listings ([414aa6d](https://github.com/Celasha/Toolasha/commit/414aa6de721b778c7588639de15d4e49629bacc2))

## [0.8.2](https://github.com/Celasha/Toolasha/compare/v0.8.1...v0.8.2) (2026-01-31)

### Bug Fixes

- skip CI on unformatted release-please commits ([b457415](https://github.com/Celasha/Toolasha/commit/b457415de11c1fc7161de1ee937b5b86069dbc96))
- skip CI on unformatted release-please commits ([e628733](https://github.com/Celasha/Toolasha/commit/e628733435f5970c912d815eb9867ed53e145496))

## [0.8.1](https://github.com/Celasha/Toolasha/compare/v0.8.0...v0.8.1) (2026-01-31)

### Bug Fixes

- prevent CI from double-triggering on PRs ([518cce8](https://github.com/Celasha/Toolasha/commit/518cce86e7d4752527470b093a562650f970e58d))
- prevent CI from double-triggering on PRs ([f2c3719](https://github.com/Celasha/Toolasha/commit/f2c37196efa34d45f66336b9cac3e9aec9bf9d2b))

## [0.8.0](https://github.com/Celasha/Toolasha/compare/v0.7.0...v0.8.0) (2026-01-30)

### Features

- hide dungeon filter icons when setting disabled and highlight all best token values ([a26e640](https://github.com/Celasha/Toolasha/commit/a26e6404141b2ce73eee4f5cb9b5cf28aaffb7df))

## [0.7.0](https://github.com/Celasha/Toolasha/compare/v0.6.2...v0.7.0) (2026-01-30)

### Features

- add gold coin icon to networth header display ([aa6f36e](https://github.com/Celasha/Toolasha/commit/aa6f36ee595912889a491871c612c8492abe8df2))

## [0.6.2](https://github.com/Celasha/Toolasha/compare/toolasha-v0.6.1...toolasha-v0.6.2) (2026-01-30)

### Bug Fixes

- create corrrect commit messages ([f4431c2](https://github.com/Celasha/Toolasha/commit/f4431c2808b8d7227a34308b301d1a1d4762f169))
- fix ci and bump version ([0b1303d](https://github.com/Celasha/Toolasha/commit/0b1303dfabb9a478298e952d3e1df9b879d01538))
- fix ci and bump version ([8bf07dd](https://github.com/Celasha/Toolasha/commit/8bf07ddf77a7e65d55937af5520fd1089fcb2312))

## [0.6.1](https://github.com/Celasha/Toolasha/compare/toolasha-v0.6.0...toolasha-v0.6.1) (2026-01-30)

### Bug Fixes

- correctly identify quantity input for equipment items in missing materials auto-fill ([f321760](https://github.com/Celasha/Toolasha/commit/f321760ff5fc74383d02b5917d2d50c7d8ee8ba1))
- prettier complaining ([f5c1937](https://github.com/Celasha/Toolasha/commit/f5c193731388e4c3bf4097b31cb3b45b86eb4a92))
- prettier complaining ([7f03751](https://github.com/Celasha/Toolasha/commit/7f0375170495cbca2bef20e352686e9c8b9d274c))

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
