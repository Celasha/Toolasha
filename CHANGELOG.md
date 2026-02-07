# Changelog

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
