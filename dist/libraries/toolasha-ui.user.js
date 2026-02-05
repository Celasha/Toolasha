// ==UserScript==
// @name         Toolasha UI Library
// @namespace    http://tampermonkey.net/
// @version      0.17.0
// @description  UI library for Toolasha - UI enhancements, tasks, skills, and misc features
// @author       Celasha
// @license      CC-BY-NC-SA-4.0
// @run-at       document-start
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @match        https://shykai.github.io/MWICombatSimulatorTest/dist/*
// @grant        none
// ==/UserScript==

(function (config, dataManager, domObserver, formatters_js, timerRegistry_js, webSocketHook, marketAPI, tokenValuation_js, marketData_js, profitHelpers_js, equipmentParser_js, teaParser_js, bonusRevenueCalculator_js, profitConstants_js, efficiency_js, houseEfficiency_js, selectors_js, storage, domObserverHelpers_js, cleanupRegistry_js, settingsSchema_js, settingsStorage, enhancementCalculator_js) {
    'use strict';

    /**
     * Equipment Level Display
     * Shows item level in top right corner of equipment icons
     * Based on original MWI Tools implementation
     */


    /**
     * EquipmentLevelDisplay class adds level overlays to equipment icons
     */
    class EquipmentLevelDisplay {
        constructor() {
            this.unregisterHandler = null;
            this.isActive = false;
            this.processedDivs = new WeakSet(); // Track already-processed divs
            this.isInitialized = false;
        }

        /**
         * Setup setting change listener (always active, even when feature is disabled)
         */
        setupSettingListener() {
            // Listen for main toggle changes
            config.onSettingChange('itemIconLevel', (enabled) => {
                if (enabled) {
                    this.initialize();
                } else {
                    this.disable();
                }
            });

            // Listen for key info toggle
            config.onSettingChange('showsKeyInfoInIcon', () => {
                if (this.isInitialized) {
                    // Clear processed set and re-render
                    this.processedDivs = new WeakSet();
                    this.addItemLevels();
                }
            });

            config.onSettingChange('color_accent', () => {
                if (this.isInitialized) {
                    this.refresh();
                }
            });
        }

        /**
         * Initialize the equipment level display
         */
        initialize() {
            if (!config.getSetting('itemIconLevel')) {
                return;
            }

            if (this.isInitialized) {
                return;
            }

            // Register with centralized DOM observer with debouncing
            this.unregisterHandler = domObserver.register(
                'EquipmentLevelDisplay',
                () => {
                    this.addItemLevels();
                },
                { debounce: true, debounceDelay: 150 } // 150ms debounce to reduce update frequency
            );

            // Process any existing items on page
            this.addItemLevels();

            this.isActive = true;
            this.isInitialized = true;
        }

        /**
         * Clean up
         */
        cleanup() {
            if (this.unregisterHandler) {
                this.unregisterHandler();
                this.unregisterHandler = null;
            }
            this.isActive = false;
        }

        /**
         * Add item levels to all equipment icons
         * Matches original MWI Tools logic with dungeon key zone info
         */
        addItemLevels() {
            // Find all item icon divs (the clickable containers)
            const iconDivs = document.querySelectorAll(
                'div.Item_itemContainer__x7kH1 div.Item_item__2De2O.Item_clickable__3viV6'
            );

            for (const div of iconDivs) {
                if (this.processedDivs.has(div)) {
                    continue;
                }

                // Skip if already has a name element (tooltip is open)
                if (div.querySelector('div.Item_name__2C42x')) {
                    continue;
                }

                // Get the use element inside this div
                const useElement = div.querySelector('use');
                if (!useElement) {
                    continue;
                }

                const href = useElement.getAttribute('href');
                if (!href) {
                    continue;
                }

                // Extract item HRID (e.g., "#cheese_sword" -> "/items/cheese_sword")
                const hrefName = href.split('#')[1];
                const itemHrid = `/items/${hrefName}`;

                // Get item details
                const itemDetails = dataManager.getItemDetails(itemHrid);
                if (!itemDetails) {
                    continue;
                }

                // For equipment, show the level requirement (not itemLevel)
                // For ability books, show the ability level requirement
                // For dungeon entry keys, show zone index
                let displayText = null;

                if (itemDetails.equipmentDetail) {
                    // Equipment: Use levelRequirements from equipmentDetail
                    const levelReq = itemDetails.equipmentDetail.levelRequirements;
                    if (levelReq && levelReq.length > 0 && levelReq[0].level > 0) {
                        displayText = levelReq[0].level.toString();
                    }
                } else if (itemDetails.abilityBookDetail) {
                    // Ability book: Use level requirement from abilityBookDetail
                    const abilityLevelReq = itemDetails.abilityBookDetail.levelRequirements;
                    if (abilityLevelReq && abilityLevelReq.length > 0 && abilityLevelReq[0].level > 0) {
                        displayText = abilityLevelReq[0].level.toString();
                    }
                } else if (config.getSetting('showsKeyInfoInIcon') && this.isKeyOrFragment(itemHrid)) {
                    // Keys and fragments: Show zone/dungeon info
                    displayText = this.getKeyDisplayText(itemHrid);
                }

                // Add overlay if we have valid text to display
                if (displayText && !div.querySelector('div.script_itemLevel')) {
                    div.style.position = 'relative';

                    // Position: bottom left for all items (matches market value style)
                    const position = 'bottom: 2px; left: 2px; text-align: left;';

                    div.insertAdjacentHTML(
                        'beforeend',
                        `<div class="script_itemLevel" style="z-index: 1; position: absolute; ${position} color: ${config.SCRIPT_COLOR_MAIN}; text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 3px #000;">${displayText}</div>`
                    );
                    // Mark as processed
                    this.processedDivs.add(div);
                } else {
                    // No valid text or already has overlay, mark as processed
                    this.processedDivs.add(div);
                }
            }
        }

        /**
         * Check if item is a key or fragment
         * @param {string} itemHrid - Item HRID
         * @returns {boolean} True if item is a key or fragment
         */
        isKeyOrFragment(itemHrid) {
            return itemHrid.includes('_key') || itemHrid.includes('_fragment');
        }

        /**
         * Get display text for keys and fragments
         * Uses hardcoded mapping like MWI Tools
         * @param {string} itemHrid - Key/fragment HRID
         * @returns {string|null} Display text (e.g., "D1", "Z3", "3.4.5.6") or null
         */
        getKeyDisplayText(itemHrid) {
            const keyMap = new Map([
                // Key fragments (zones where they drop)
                ['/items/blue_key_fragment', 'Z3'],
                ['/items/green_key_fragment', 'Z4'],
                ['/items/purple_key_fragment', 'Z5'],
                ['/items/white_key_fragment', 'Z6'],
                ['/items/orange_key_fragment', 'Z7'],
                ['/items/brown_key_fragment', 'Z8'],
                ['/items/stone_key_fragment', 'Z9'],
                ['/items/dark_key_fragment', 'Z10'],
                ['/items/burning_key_fragment', 'Z11'],

                // Entry keys (dungeon identifiers)
                ['/items/chimerical_entry_key', 'D1'],
                ['/items/sinister_entry_key', 'D2'],
                ['/items/enchanted_entry_key', 'D3'],
                ['/items/pirate_entry_key', 'D4'],

                // Chest keys (zones where they drop)
                ['/items/chimerical_chest_key', '3.4.5.6'],
                ['/items/sinister_chest_key', '5.7.8.10'],
                ['/items/enchanted_chest_key', '7.8.9.11'],
                ['/items/pirate_chest_key', '6.9.10.11'],
            ]);

            return keyMap.get(itemHrid) || null;
        }

        /**
         * Refresh colors (called when settings change)
         */
        refresh() {
            // Update color for all level overlays
            const overlays = document.querySelectorAll('div.script_itemLevel');
            overlays.forEach((overlay) => {
                overlay.style.color = config.COLOR_ACCENT;
            });
        }

        /**
         * Disable the feature
         */
        disable() {
            if (this.unregisterHandler) {
                this.unregisterHandler();
                this.unregisterHandler = null;
            }

            // Remove all level overlays
            const overlays = document.querySelectorAll('div.script_itemLevel');
            for (const overlay of overlays) {
                overlay.remove();
            }

            // Clear processed tracking
            this.processedDivs = new WeakSet();

            this.isActive = false;
            this.isInitialized = false;
        }
    }

    const equipmentLevelDisplay = new EquipmentLevelDisplay();

    equipmentLevelDisplay.setupSettingListener();

    /**
     * Alchemy Item Dimming
     * Dims items in alchemy panel that require higher level than player has
     * Player must have Alchemy level >= itemLevel to perform alchemy actions
     */


    /**
     * AlchemyItemDimming class dims items based on level requirements
     */
    class AlchemyItemDimming {
        constructor() {
            this.unregisterObserver = null; // Unregister function from centralized observer
            this.isActive = false;
            this.processedDivs = new WeakSet(); // Track already-processed divs
            this.isInitialized = false;
        }

        /**
         * Initialize the alchemy item dimming
         */
        initialize() {
            // Guard FIRST (before feature check)
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('alchemyItemDimming')) {
                return;
            }

            this.isInitialized = true;

            // Register with centralized observer to watch for alchemy panel
            this.unregisterObserver = domObserver.onClass('AlchemyItemDimming', 'ItemSelector_menu__12sEM', () => {
                this.processAlchemyItems();
            });

            // Process any existing items on page
            this.processAlchemyItems();

            this.isActive = true;
        }

        /**
         * Process all items in the alchemy panel
         */
        processAlchemyItems() {
            // Check if alchemy panel is open
            const alchemyPanel = this.findAlchemyPanel();
            if (!alchemyPanel) {
                return;
            }

            // Get player's Alchemy level
            const skills = dataManager.getSkills();
            if (!skills) {
                return;
            }

            const alchemySkill = skills.find((s) => s.skillHrid === '/skills/alchemy');
            const playerAlchemyLevel = alchemySkill?.level || 1;

            // Find all item icon divs within the alchemy panel
            const iconDivs = alchemyPanel.querySelectorAll(
                'div.Item_itemContainer__x7kH1 div.Item_item__2De2O.Item_clickable__3viV6'
            );

            for (const div of iconDivs) {
                if (this.processedDivs.has(div)) {
                    continue;
                }

                // Get the use element inside this div
                const useElement = div.querySelector('use');
                if (!useElement) {
                    continue;
                }

                const href = useElement.getAttribute('href');
                if (!href) {
                    continue;
                }

                // Extract item HRID (e.g., "#cheese_sword" -> "/items/cheese_sword")
                const hrefName = href.split('#')[1];
                const itemHrid = `/items/${hrefName}`;

                // Get item details
                const itemDetails = dataManager.getItemDetails(itemHrid);
                if (!itemDetails) {
                    continue;
                }

                // Get item's alchemy level requirement
                const itemLevel = itemDetails.itemLevel || 0;

                // Apply dimming if player level is too low
                if (playerAlchemyLevel < itemLevel) {
                    div.style.opacity = '0.5';
                    div.style.pointerEvents = 'auto'; // Still clickable
                    div.classList.add('mwi-alchemy-dimmed');
                } else {
                    // Remove dimming if level is now sufficient (player leveled up)
                    div.style.opacity = '1';
                    div.classList.remove('mwi-alchemy-dimmed');
                }

                // Mark as processed
                this.processedDivs.add(div);
            }
        }

        /**
         * Find the alchemy panel in the DOM
         * @returns {Element|null} Alchemy panel element or null
         */
        findAlchemyPanel() {
            // The alchemy item selector is a MuiTooltip dropdown with ItemSelector_menu class
            // It appears when clicking in the "Alchemize Item" box
            const itemSelectorMenus = document.querySelectorAll('div.ItemSelector_menu__12sEM');

            // Check each menu to find the one with "Alchemize Item" label
            for (const menu of itemSelectorMenus) {
                // Look for the ItemSelector_label element in the document
                // (It's not a direct sibling, it's part of the button that opens this menu)
                const alchemyLabels = document.querySelectorAll('div.ItemSelector_label__22ds9');

                for (const label of alchemyLabels) {
                    if (label.textContent.trim() === 'Alchemize Item') {
                        // Found the alchemy label, this menu is likely the alchemy selector
                        return menu;
                    }
                }
            }

            return null;
        }

        /**
         * Disable the feature
         */
        disable() {
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }

            // Remove all dimming effects
            const dimmedItems = document.querySelectorAll('.mwi-alchemy-dimmed');
            for (const item of dimmedItems) {
                item.style.opacity = '1';
                item.classList.remove('mwi-alchemy-dimmed');
            }

            // Clear processed tracking
            this.processedDivs = new WeakSet();

            this.isActive = false;
            this.isInitialized = false;
        }
    }

    const alchemyItemDimming = new AlchemyItemDimming();

    /**
     * Skill Experience Percentage Display
     * Shows XP progress percentage in the left sidebar skill list
     */


    class SkillExperiencePercentage {
        constructor() {
            this.isActive = false;
            this.unregisterHandlers = [];
            this.processedBars = new Set();
            this.isInitialized = false;
            this.updateInterval = null;
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
        }

        /**
         * Setup setting change listener (always active, even when feature is disabled)
         */
        setupSettingListener() {
            // Listen for main toggle changes
            config.onSettingChange('skillExperiencePercentage', (enabled) => {
                if (enabled) {
                    this.initialize();
                } else {
                    this.disable();
                }
            });

            config.onSettingChange('color_accent', () => {
                if (this.isInitialized) {
                    this.refresh();
                }
            });
        }

        /**
         * Initialize the display system
         */
        initialize() {
            if (!config.isFeatureEnabled('skillExperiencePercentage')) {
                return;
            }

            if (this.isInitialized) {
                return;
            }

            this.isActive = true;
            this.registerObservers();

            // Initial update for existing skills
            this.updateAllSkills();

            // Update every 5 seconds to catch XP changes
            // Experience changes slowly enough that frequent polling is unnecessary
            this.updateInterval = setInterval(() => {
                this.updateAllSkills();
            }, 5000); // 5 seconds (reduced from 1 second for better performance)
            this.timerRegistry.registerInterval(this.updateInterval);

            this.isInitialized = true;
        }

        /**
         * Register DOM observers
         */
        registerObservers() {
            // Watch for progress bars appearing/changing
            const unregister = domObserver.onClass(
                'SkillExpPercentage',
                'NavigationBar_currentExperience',
                (progressBar) => {
                    this.updateSkillPercentage(progressBar);
                }
            );
            this.unregisterHandlers.push(unregister);
        }

        /**
         * Update all existing skills on page
         */
        updateAllSkills() {
            const progressBars = document.querySelectorAll('[class*="NavigationBar_currentExperience"]');
            progressBars.forEach((bar) => this.updateSkillPercentage(bar));
        }

        /**
         * Update a single skill's percentage display
         * @param {Element} progressBar - The progress bar element
         */
        updateSkillPercentage(progressBar) {
            // Get the skill container
            const skillContainer = progressBar.parentNode?.parentNode;
            if (!skillContainer) return;

            // Get the level display container (first child of skill container)
            const levelContainer = skillContainer.children[0];
            if (!levelContainer) return;

            // Find the NavigationBar_level span to set its width
            const levelSpan = skillContainer.querySelector('[class*="NavigationBar_level"]');
            if (levelSpan) {
                levelSpan.style.width = 'auto';
            }

            // Extract percentage from progress bar width
            const widthStyle = progressBar.style.width;
            if (!widthStyle) return;

            const percentage = parseFloat(widthStyle.replace('%', ''));
            if (isNaN(percentage)) return;

            // Format with 1 decimal place (convert from percentage to decimal first)
            const formattedPercentage = formatters_js.formatPercentage(percentage / 100, 1);

            // Check if we already have a percentage span
            let percentageSpan = levelContainer.querySelector('.mwi-exp-percentage');

            if (percentageSpan) {
                // Update existing span
                if (percentageSpan.textContent !== formattedPercentage) {
                    percentageSpan.textContent = formattedPercentage;
                }
            } else {
                // Create new span
                percentageSpan = document.createElement('span');
                percentageSpan.className = 'mwi-exp-percentage';
                percentageSpan.textContent = formattedPercentage;
                percentageSpan.style.fontSize = '0.875rem';
                percentageSpan.style.color = config.SCRIPT_COLOR_MAIN;

                // Insert percentage before children[1] (same as original)
                levelContainer.insertBefore(percentageSpan, levelContainer.children[1]);
            }
        }

        /**
         * Refresh colors (called when settings change)
         */
        refresh() {
            // Update all existing percentage spans with new color
            const percentageSpans = document.querySelectorAll('.mwi-exp-percentage');
            percentageSpans.forEach((span) => {
                span.style.color = config.COLOR_ACCENT;
            });
        }

        /**
         * Disable the feature
         */
        disable() {
            this.timerRegistry.clearAll();
            this.updateInterval = null;

            // Remove all percentage spans
            document.querySelectorAll('.mwi-exp-percentage').forEach((span) => span.remove());

            this.unregisterHandlers.forEach((unregister) => unregister());
            this.unregisterHandlers = [];

            this.processedBars.clear();
            this.isActive = false;
            this.isInitialized = false;
        }
    }

    const skillExperiencePercentage = new SkillExperiencePercentage();

    skillExperiencePercentage.setupSettingListener();

    /**
     * External Links
     * Adds links to external MWI tools in the left sidebar navigation
     */


    class ExternalLinks {
        constructor() {
            this.unregisterObserver = null;
            this.linksAdded = false;
            this.isInitialized = false;
        }

        /**
         * Initialize external links feature
         */
        initialize() {
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('ui_externalLinks')) {
                return;
            }

            this.isInitialized = true;
            this.setupObserver();
        }

        /**
         * Setup DOM observer to watch for navigation bar
         */
        setupObserver() {
            // Wait for the minor navigation links container
            this.unregisterObserver = domObserver.onClass(
                'ExternalLinks',
                'NavigationBar_minorNavigationLinks',
                (container) => {
                    if (!this.linksAdded) {
                        this.addLinks(container);
                        this.linksAdded = true;
                    }
                }
            );

            // Check for existing container immediately
            const existingContainer = document.querySelector('[class*="NavigationBar_minorNavigationLinks"]');
            if (existingContainer && !this.linksAdded) {
                this.addLinks(existingContainer);
                this.linksAdded = true;
            }
        }

        /**
         * Add external tool links to navigation bar
         * @param {HTMLElement} container - Navigation links container
         */
        addLinks(container) {
            const links = [
                {
                    label: 'Combat Sim',
                    url: 'https://shykai.github.io/MWICombatSimulatorTest/dist/',
                },
                {
                    label: 'Milkyway Market',
                    url: 'https://milkyway.market/',
                },
                {
                    label: 'Enhancelator',
                    url: 'https://doh-nuts.github.io/Enhancelator/',
                },
                {
                    label: 'Milkonomy',
                    url: 'https://milkonomy.pages.dev/#/dashboard',
                },
            ];

            // Add each link (in reverse order so they appear in correct order when prepended)
            for (let i = links.length - 1; i >= 0; i--) {
                const link = links[i];
                this.addLink(container, link.label, link.url);
            }
        }

        /**
         * Add a single external link to the navigation
         * @param {HTMLElement} container - Navigation links container
         * @param {string} label - Link label
         * @param {string} url - External URL
         */
        addLink(container, label, url) {
            const div = document.createElement('div');
            div.setAttribute('class', 'NavigationBar_minorNavigationLink__31K7Y');
            div.style.color = config.COLOR_ACCENT;
            div.style.cursor = 'pointer';
            div.textContent = label;

            div.addEventListener('click', () => {
                window.open(url, '_blank');
            });

            // Insert at the beginning (after Settings if it exists)
            container.insertAdjacentElement('afterbegin', div);
        }

        /**
         * Disable the external links feature
         */
        disable() {
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }

            // Remove added links
            const container = document.querySelector('[class*="NavigationBar_minorNavigationLinks"]');
            if (container) {
                container.querySelectorAll('[style*="cursor: pointer"]').forEach((link) => {
                    // Only remove links we added (check if they have our color)
                    if (link.style.color === config.COLOR_ACCENT) {
                        link.remove();
                    }
                });
            }

            this.linksAdded = false;
            this.isInitialized = false;
        }
    }

    const externalLinks = new ExternalLinks();

    /**
     * Expected Value Calculator Module
     * Calculates expected value for openable containers
     */


    /**
     * ExpectedValueCalculator class handles EV calculations for openable containers
     */
    class ExpectedValueCalculator {
        constructor() {
            // Constants
            this.MARKET_TAX = 0.02; // 2% marketplace tax
            this.CONVERGENCE_ITERATIONS = 4; // Nested container convergence

            // Cache for container EVs
            this.containerCache = new Map();

            // Special item HRIDs
            this.COIN_HRID = '/items/coin';
            this.COWBELL_HRID = '/items/cowbell';
            this.COWBELL_BAG_HRID = '/items/bag_of_10_cowbells';

            // Dungeon token HRIDs
            this.DUNGEON_TOKENS = [
                '/items/chimerical_token',
                '/items/sinister_token',
                '/items/enchanted_token',
                '/items/pirate_token',
            ];

            // Flag to track if initialized
            this.isInitialized = false;

            // Retry handler reference for cleanup
            this.retryHandler = null;
        }

        /**
         * Initialize the calculator
         * Pre-calculates all openable containers with nested convergence
         */
        async initialize() {
            if (!dataManager.getInitClientData()) {
                // Init data not yet available - set up retry on next character update
                if (!this.retryHandler) {
                    this.retryHandler = () => {
                        this.initialize(); // Retry initialization
                    };
                    dataManager.on('character_initialized', this.retryHandler);
                }
                return false;
            }

            // Data is available - remove retry handler if it exists
            if (this.retryHandler) {
                dataManager.off('character_initialized', this.retryHandler);
                this.retryHandler = null;
            }

            // Wait for market data to load
            if (!marketAPI.isLoaded()) {
                await marketAPI.fetch(true); // Force fresh fetch on init
            }

            // Calculate all containers with 4-iteration convergence for nesting
            this.calculateNestedContainers();

            this.isInitialized = true;

            // Notify listeners that calculator is ready
            dataManager.emit('expected_value_initialized', { timestamp: Date.now() });

            return true;
        }

        /**
         * Calculate all containers with nested convergence
         * Iterates 4 times to resolve nested container values
         */
        calculateNestedContainers() {
            const initData = dataManager.getInitClientData();
            if (!initData || !initData.openableLootDropMap) {
                return;
            }

            // Get all openable container HRIDs
            const containerHrids = Object.keys(initData.openableLootDropMap);

            // Iterate 4 times for convergence (handles nesting depth)
            for (let iteration = 0; iteration < this.CONVERGENCE_ITERATIONS; iteration++) {
                for (const containerHrid of containerHrids) {
                    // Calculate and cache EV for this container (pass cached initData)
                    const ev = this.calculateSingleContainer(containerHrid, initData);
                    if (ev !== null) {
                        this.containerCache.set(containerHrid, ev);
                    }
                }
            }
        }

        /**
         * Calculate expected value for a single container
         * @param {string} containerHrid - Container item HRID
         * @param {Object} initData - Cached game data (optional, will fetch if not provided)
         * @returns {number|null} Expected value or null if unavailable
         */
        calculateSingleContainer(containerHrid, initData = null) {
            // Use cached data if provided, otherwise fetch
            if (!initData) {
                initData = dataManager.getInitClientData();
            }
            if (!initData || !initData.openableLootDropMap) {
                return null;
            }

            // Get drop table for this container
            const dropTable = initData.openableLootDropMap[containerHrid];
            if (!dropTable || dropTable.length === 0) {
                return null;
            }

            let totalExpectedValue = 0;

            // Calculate expected value for each drop
            for (const drop of dropTable) {
                const itemHrid = drop.itemHrid;
                const dropRate = drop.dropRate || 0;
                const minCount = drop.minCount || 0;
                const maxCount = drop.maxCount || 0;

                // Skip invalid drops
                if (dropRate <= 0 || (minCount === 0 && maxCount === 0)) {
                    continue;
                }

                // Calculate average drop count
                const avgCount = (minCount + maxCount) / 2;

                // Get price for this drop
                const price = this.getDropPrice(itemHrid);

                if (price === null) {
                    continue; // Skip drops with missing data
                }

                // Check if item is tradeable (for tax calculation)
                const itemDetails = dataManager.getItemDetails(itemHrid);
                const canBeSold = itemDetails?.tradeable !== false;
                const dropValue = canBeSold
                    ? profitHelpers_js.calculatePriceAfterTax(avgCount * dropRate * price, this.MARKET_TAX)
                    : avgCount * dropRate * price;
                totalExpectedValue += dropValue;
            }

            return totalExpectedValue;
        }

        /**
         * Get price for a drop item
         * Handles special cases (Coin, Cowbell, Dungeon Tokens, nested containers)
         * @param {string} itemHrid - Item HRID
         * @returns {number|null} Price or null if unavailable
         */
        getDropPrice(itemHrid) {
            // Special case: Coin (face value = 1)
            if (itemHrid === this.COIN_HRID) {
                return 1;
            }

            // Special case: Cowbell (use bag price ÷ 10, with 18% tax)
            if (itemHrid === this.COWBELL_HRID) {
                // Get Cowbell Bag price using profit context (sell side - you're selling the bag)
                const bagValue = marketData_js.getItemPrice(this.COWBELL_BAG_HRID, { context: 'profit', side: 'sell' }) || 0;

                if (bagValue > 0) {
                    // Apply 18% market tax (Cowbell Bag only), then divide by 10
                    return profitHelpers_js.calculatePriceAfterTax(bagValue, 0.18) / 10;
                }
                return null; // No bag price available
            }

            // Special case: Dungeon Tokens (calculate value from shop items)
            if (this.DUNGEON_TOKENS.includes(itemHrid)) {
                return tokenValuation_js.calculateDungeonTokenValue(itemHrid, 'profitCalc_pricingMode', 'expectedValue_respectPricingMode');
            }

            // Check if this is a nested container (use cached EV)
            if (this.containerCache.has(itemHrid)) {
                return this.containerCache.get(itemHrid);
            }

            // Regular market item - get price based on pricing mode (sell side - you're selling drops)
            const dropPrice = marketData_js.getItemPrice(itemHrid, { enhancementLevel: 0, context: 'profit', side: 'sell' });
            return dropPrice > 0 ? dropPrice : null;
        }

        /**
         * Calculate expected value for an openable container
         * @param {string} itemHrid - Container item HRID
         * @returns {Object|null} EV data or null
         */
        calculateExpectedValue(itemHrid) {
            if (!this.isInitialized) {
                console.warn('[ExpectedValueCalculator] Not initialized');
                return null;
            }

            // Get item details
            const itemDetails = dataManager.getItemDetails(itemHrid);
            if (!itemDetails) {
                return null;
            }

            // Verify this is an openable container
            if (!itemDetails.isOpenable) {
                return null; // Not an openable container
            }

            // Get detailed drop breakdown (calculates with fresh market prices)
            const drops = this.getDropBreakdown(itemHrid);

            // Calculate total expected value from fresh drop data
            const expectedReturn = drops.reduce((sum, drop) => sum + drop.expectedValue, 0);

            return {
                itemName: itemDetails.name,
                itemHrid,
                expectedValue: expectedReturn,
                drops,
            };
        }

        /**
         * Get cached expected value for a container (for use by other modules)
         * @param {string} itemHrid - Container item HRID
         * @returns {number|null} Cached EV or null
         */
        getCachedValue(itemHrid) {
            return this.containerCache.get(itemHrid) || null;
        }

        /**
         * Get detailed drop breakdown for display
         * @param {string} containerHrid - Container HRID
         * @returns {Array} Array of drop objects
         */
        getDropBreakdown(containerHrid) {
            const initData = dataManager.getInitClientData();
            if (!initData || !initData.openableLootDropMap) {
                return [];
            }

            const dropTable = initData.openableLootDropMap[containerHrid];
            if (!dropTable) {
                return [];
            }

            const drops = [];

            for (const drop of dropTable) {
                const itemHrid = drop.itemHrid;
                const dropRate = drop.dropRate || 0;
                const minCount = drop.minCount || 0;
                const maxCount = drop.maxCount || 0;

                if (dropRate <= 0) {
                    continue;
                }

                // Get item details
                const itemDetails = dataManager.getItemDetails(itemHrid);
                if (!itemDetails) {
                    continue;
                }

                // Calculate average count
                const avgCount = (minCount + maxCount) / 2;

                // Get price
                const price = this.getDropPrice(itemHrid);

                // Calculate expected value for this drop
                const itemCanBeSold = itemDetails.tradeable !== false;
                const dropValue =
                    price !== null
                        ? itemCanBeSold
                            ? profitHelpers_js.calculatePriceAfterTax(avgCount * dropRate * price, this.MARKET_TAX)
                            : avgCount * dropRate * price
                        : 0;

                drops.push({
                    itemHrid,
                    itemName: itemDetails.name,
                    dropRate,
                    avgCount,
                    priceEach: price || 0,
                    expectedValue: dropValue,
                    hasPriceData: price !== null,
                });
            }

            // Sort by expected value (highest first)
            drops.sort((a, b) => b.expectedValue - a.expectedValue);

            return drops;
        }

        /**
         * Invalidate cache (call when market data refreshes)
         */
        invalidateCache() {
            this.containerCache.clear();
            this.isInitialized = false;

            // Re-initialize if data is available
            if (dataManager.getInitClientData() && marketAPI.isLoaded()) {
                this.initialize();
            }
        }

        /**
         * Cleanup calculator state and handlers
         */
        cleanup() {
            if (this.retryHandler) {
                dataManager.off('character_initialized', this.retryHandler);
                this.retryHandler = null;
            }

            this.containerCache.clear();
            this.isInitialized = false;
        }

        disable() {
            this.cleanup();
        }
    }

    const expectedValueCalculator = new ExpectedValueCalculator();

    /**
     * Gathering Profit Calculator
     *
     * Calculates comprehensive profit/hour for gathering actions (Foraging, Woodcutting, Milking) including:
     * - All drop table items at market prices
     * - Drink consumption costs
     * - Equipment speed bonuses
     * - Efficiency buffs (level, house, tea, equipment)
     * - Gourmet tea bonus items (production skills only)
     * - Market tax (2%)
     */


    /**
     * Cache for processing action conversions (inputItemHrid → conversion data)
     * Built once per game data load to avoid O(n) searches through action map
     */
    let processingConversionCache = null;

    /**
     * Build processing conversion cache from game data
     * @param {Object} gameData - Game data from dataManager
     * @returns {Map} Map of inputItemHrid → {actionHrid, outputItemHrid, conversionRatio}
     */
    function buildProcessingConversionCache(gameData) {
        const cache = new Map();
        const validProcessingTypes = [
            '/action_types/cheesesmithing', // Milk → Cheese conversions
            '/action_types/crafting', // Log → Lumber conversions
            '/action_types/tailoring', // Cotton/Flax/Bamboo/Cocoon/Radiant → Fabric conversions
        ];

        for (const [actionHrid, action] of Object.entries(gameData.actionDetailMap)) {
            if (!validProcessingTypes.includes(action.type)) {
                continue;
            }

            const inputItem = action.inputItems?.[0];
            const outputItem = action.outputItems?.[0];

            if (inputItem && outputItem) {
                cache.set(inputItem.itemHrid, {
                    actionHrid: actionHrid,
                    outputItemHrid: outputItem.itemHrid,
                    conversionRatio: inputItem.count,
                });
            }
        }

        return cache;
    }

    /**
     * Calculate comprehensive profit for a gathering action
     * @param {string} actionHrid - Action HRID (e.g., "/actions/foraging/asteroid_belt")
     * @returns {Object|null} Profit data or null if not applicable
     */
    async function calculateGatheringProfit(actionHrid) {
        const gameData = dataManager.getInitClientData();
        const actionDetail = gameData.actionDetailMap[actionHrid];

        if (!actionDetail) {
            return null;
        }

        // Only process gathering actions (Foraging, Woodcutting, Milking) with drop tables
        if (!profitConstants_js.GATHERING_TYPES.includes(actionDetail.type)) {
            return null;
        }

        if (!actionDetail.dropTable) {
            return null; // No drop table - nothing to calculate
        }

        // Build processing conversion cache once (lazy initialization)
        if (!processingConversionCache) {
            processingConversionCache = buildProcessingConversionCache(gameData);
        }

        const priceCache = new Map();
        const getCachedPrice = (itemHrid, options) => {
            const side = options?.side || '';
            const enhancementLevel = options?.enhancementLevel ?? '';
            const cacheKey = `${itemHrid}|${side}|${enhancementLevel}`;

            if (priceCache.has(cacheKey)) {
                return priceCache.get(cacheKey);
            }

            const price = marketData_js.getItemPrice(itemHrid, options);
            priceCache.set(cacheKey, price);
            return price;
        };

        // Note: Market API is pre-loaded by caller (max-produceable.js)
        // No need to check or fetch here

        // Get character data
        const equipment = dataManager.getEquipment();
        const skills = dataManager.getSkills();
        const houseRooms = Array.from(dataManager.getHouseRooms().values());

        // Calculate action time per action (with speed bonuses)
        const baseTimePerActionSec = actionDetail.baseTimeCost / 1000000000;
        const speedBonus = equipmentParser_js.parseEquipmentSpeedBonuses(equipment, actionDetail.type, gameData.itemDetailMap);
        // speedBonus is already a decimal (e.g., 0.15 for 15%), don't divide by 100
        const actualTimePerActionSec = baseTimePerActionSec / (1 + speedBonus);

        // Calculate actions per hour
        const actionsPerHour = profitHelpers_js.calculateActionsPerHour(actualTimePerActionSec);

        // Get character's actual equipped drink slots for this action type (from WebSocket data)
        const drinkSlots = dataManager.getActionDrinkSlots(actionDetail.type);

        // Get drink concentration from equipment
        const drinkConcentration = teaParser_js.getDrinkConcentration(equipment, gameData.itemDetailMap);

        // Parse tea buffs
        const teaEfficiency = teaParser_js.parseTeaEfficiency(actionDetail.type, drinkSlots, gameData.itemDetailMap, drinkConcentration);

        // Gourmet Tea only applies to production skills (Brewing, Cooking, Cheesesmithing, Crafting, Tailoring)
        // NOT gathering skills (Foraging, Woodcutting, Milking)
        const gourmetBonus = profitConstants_js.PRODUCTION_TYPES.includes(actionDetail.type)
            ? teaParser_js.parseGourmetBonus(drinkSlots, gameData.itemDetailMap, drinkConcentration)
            : 0;

        // Processing Tea: 15% base chance to convert raw → processed (Cotton → Cotton Fabric, etc.)
        // Only applies to gathering skills (Foraging, Woodcutting, Milking)
        const processingBonus = profitConstants_js.GATHERING_TYPES.includes(actionDetail.type)
            ? teaParser_js.parseProcessingBonus(drinkSlots, gameData.itemDetailMap, drinkConcentration)
            : 0;

        // Gathering Quantity: Increases item drop amounts (min/max)
        // Sources: Gathering Tea (15% base), Community Buff (20% base + 0.5%/level), Achievement Tiers
        // Only applies to gathering skills (Foraging, Woodcutting, Milking)
        let totalGathering = 0;
        let gatheringTea = 0;
        let communityGathering = 0;
        let achievementGathering = 0;
        if (profitConstants_js.GATHERING_TYPES.includes(actionDetail.type)) {
            // Parse Gathering Tea bonus
            gatheringTea = teaParser_js.parseGatheringBonus(drinkSlots, gameData.itemDetailMap, drinkConcentration);

            // Get Community Buff level for gathering quantity
            const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/gathering_quantity');
            communityGathering = communityBuffLevel ? 0.2 + (communityBuffLevel - 1) * 0.005 : 0;

            // Get Achievement buffs for this action type (Beginner tier: +2% Gathering Quantity)
            achievementGathering = dataManager.getAchievementBuffFlatBoost(actionDetail.type, '/buff_types/gathering');

            // Stack all bonuses additively
            totalGathering = gatheringTea + communityGathering + achievementGathering;
        }

        const teaCostData = profitHelpers_js.calculateTeaCostsPerHour({
            drinkSlots,
            drinkConcentration,
            itemDetailMap: gameData.itemDetailMap,
            getItemPrice: getCachedPrice,
        });
        const drinkCostPerHour = teaCostData.totalCostPerHour;
        const drinkCosts = teaCostData.costs.map((tea) => ({
            name: tea.itemName,
            priceEach: tea.pricePerDrink,
            drinksPerHour: tea.drinksPerHour,
            costPerHour: tea.totalCost,
            missingPrice: tea.missingPrice,
        }));

        // Calculate level efficiency bonus
        const requiredLevel = actionDetail.levelRequirement?.level || 1;
        const skillHrid = actionDetail.levelRequirement?.skillHrid;
        let currentLevel = requiredLevel;
        for (const skill of skills) {
            if (skill.skillHrid === skillHrid) {
                currentLevel = skill.level;
                break;
            }
        }

        // Calculate tea skill level bonus (e.g., +5 Foraging from Ultra Foraging Tea)
        const teaSkillLevelBonus = teaParser_js.parseTeaSkillLevelBonus(
            actionDetail.type,
            drinkSlots,
            gameData.itemDetailMap,
            drinkConcentration
        );

        // Calculate house efficiency bonus
        let houseEfficiency = 0;
        for (const room of houseRooms) {
            const roomDetail = gameData.houseRoomDetailMap?.[room.houseRoomHrid];
            if (roomDetail?.usableInActionTypeMap?.[actionDetail.type]) {
                houseEfficiency += (room.level || 0) * 1.5;
            }
        }

        // Calculate equipment efficiency bonus (uses equipment-parser utility)
        const equipmentEfficiency = equipmentParser_js.parseEquipmentEfficiencyBonuses(equipment, actionDetail.type, gameData.itemDetailMap);
        const achievementEfficiency =
            dataManager.getAchievementBuffFlatBoost(actionDetail.type, '/buff_types/efficiency') * 100;

        const efficiencyBreakdown = efficiency_js.calculateEfficiencyBreakdown({
            requiredLevel,
            skillLevel: currentLevel,
            teaSkillLevelBonus,
            houseEfficiency,
            teaEfficiency,
            equipmentEfficiency,
            achievementEfficiency,
        });
        const totalEfficiency = efficiencyBreakdown.totalEfficiency;
        const levelEfficiency = efficiencyBreakdown.levelEfficiency;

        // Calculate efficiency multiplier (matches production profit calculator pattern)
        // Efficiency "repeats the action" - we apply it to item outputs, not action rate
        const efficiencyMultiplier = efficiency_js.calculateEfficiencyMultiplier(totalEfficiency);

        // Calculate revenue from drop table
        // Processing happens PER ACTION (before efficiency multiplies the count)
        // So we calculate per-action outputs, then multiply by actionsPerHour and efficiency
        let baseRevenuePerHour = 0;
        let gourmetRevenueBonus = 0;
        let gourmetRevenueBonusPerAction = 0;
        let processingRevenueBonus = 0; // Track extra revenue from Processing Tea
        let processingRevenueBonusPerAction = 0; // Per-action processing revenue
        const processingConversions = []; // Track conversion details for display
        const baseOutputs = []; // Baseline outputs (before gourmet and processing)
        const gourmetBonuses = []; // Gourmet bonus outputs (display-only)
        const dropTable = actionDetail.dropTable;

        for (const drop of dropTable) {
            const rawPrice = getCachedPrice(drop.itemHrid, { context: 'profit', side: 'sell' });
            const rawPriceMissing = rawPrice === null;
            const resolvedRawPrice = rawPriceMissing ? 0 : rawPrice;
            // Apply gathering quantity bonus to drop amounts
            const baseAvgAmount = (drop.minCount + drop.maxCount) / 2;
            const avgAmountPerAction = baseAvgAmount * (1 + totalGathering);

            // Check if this item has a Processing Tea conversion (using cache for O(1) lookup)
            // Processing Tea only applies to: Milk→Cheese, Log→Lumber, Cotton/Flax/Bamboo/Cocoon/Radiant→Fabric
            const conversionData = processingConversionCache.get(drop.itemHrid);
            const processedItemHrid = conversionData?.outputItemHrid || null;
            conversionData?.actionHrid || null;

            // Per-action calculations (efficiency will be applied when converting to items per hour)
            let rawPerAction = 0;
            let processedPerAction = 0;

            const rawItemName = gameData.itemDetailMap[drop.itemHrid]?.name || 'Unknown';
            const baseItemsPerHour = actionsPerHour * drop.dropRate * avgAmountPerAction * efficiencyMultiplier;
            const baseItemsPerAction = drop.dropRate * avgAmountPerAction;
            const baseRevenuePerAction = baseItemsPerAction * resolvedRawPrice;
            const baseRevenueLine = baseItemsPerHour * resolvedRawPrice;
            baseRevenuePerHour += baseRevenueLine;
            baseOutputs.push({
                name: rawItemName,
                itemsPerHour: baseItemsPerHour,
                itemsPerAction: baseItemsPerAction,
                dropRate: drop.dropRate,
                priceEach: resolvedRawPrice,
                revenuePerHour: baseRevenueLine,
                revenuePerAction: baseRevenuePerAction,
                missingPrice: rawPriceMissing,
            });

            if (processedItemHrid && processingBonus > 0) {
                // Get conversion ratio from cache (e.g., 1 Milk → 1 Cheese)
                const conversionRatio = conversionData.conversionRatio;

                // Processing Tea check happens per action:
                // If procs (processingBonus% chance): Convert to processed + leftover
                const processedIfProcs = Math.floor(avgAmountPerAction / conversionRatio);
                const rawLeftoverIfProcs = avgAmountPerAction % conversionRatio;

                // If doesn't proc: All stays raw
                const rawIfNoProc = avgAmountPerAction;

                // Expected value per action
                processedPerAction = processingBonus * processedIfProcs;
                rawPerAction = processingBonus * rawLeftoverIfProcs + (1 - processingBonus) * rawIfNoProc;

                const processedPrice = getCachedPrice(processedItemHrid, { context: 'profit', side: 'sell' });
                const processedPriceMissing = processedPrice === null;
                const resolvedProcessedPrice = processedPriceMissing ? 0 : processedPrice;

                const processedItemsPerHour = actionsPerHour * drop.dropRate * processedPerAction * efficiencyMultiplier;
                const processedItemsPerAction = drop.dropRate * processedPerAction;

                // Track processing details
                const processedItemName = gameData.itemDetailMap[processedItemHrid]?.name || 'Unknown';

                // Value gain per conversion = cheese value - cost of milk used
                const costOfMilkUsed = conversionRatio * resolvedRawPrice;
                const valueGainPerConversion = resolvedProcessedPrice - costOfMilkUsed;
                const revenueFromConversion = processedItemsPerHour * valueGainPerConversion;
                const rawConsumedPerHour = processedItemsPerHour * conversionRatio;
                const rawConsumedPerAction = processedItemsPerAction * conversionRatio;

                processingRevenueBonus += revenueFromConversion;
                processingRevenueBonusPerAction += processedItemsPerAction * valueGainPerConversion;
                processingConversions.push({
                    rawItem: rawItemName,
                    processedItem: processedItemName,
                    valueGain: valueGainPerConversion,
                    conversionsPerHour: processedItemsPerHour,
                    conversionsPerAction: processedItemsPerAction,
                    rawConsumedPerHour,
                    rawConsumedPerAction,
                    rawPriceEach: resolvedRawPrice,
                    processedPriceEach: resolvedProcessedPrice,
                    revenuePerHour: revenueFromConversion,
                    revenuePerAction: processedItemsPerAction * valueGainPerConversion,
                    missingPrice: rawPriceMissing || processedPriceMissing,
                });
            } else {
                // No processing - simple calculation
                rawPerAction = avgAmountPerAction;
            }

            // Gourmet tea bonus (only for production skills, not gathering)
            if (gourmetBonus > 0) {
                const totalPerAction = rawPerAction + processedPerAction;
                const bonusPerAction = totalPerAction * (gourmetBonus / 100);
                const bonusItemsPerHour = actionsPerHour * drop.dropRate * bonusPerAction * efficiencyMultiplier;
                const bonusItemsPerAction = drop.dropRate * bonusPerAction;

                // Use weighted average price for gourmet bonus
                if (processedItemHrid && processingBonus > 0) {
                    const processedPrice = getCachedPrice(processedItemHrid, { context: 'profit', side: 'sell' });
                    const processedPriceMissing = processedPrice === null;
                    const resolvedProcessedPrice = processedPriceMissing ? 0 : processedPrice;
                    const weightedPrice =
                        (rawPerAction * resolvedRawPrice + processedPerAction * resolvedProcessedPrice) /
                        (rawPerAction + processedPerAction);
                    const bonusRevenue = bonusItemsPerHour * weightedPrice;
                    gourmetRevenueBonus += bonusRevenue;
                    gourmetRevenueBonusPerAction += bonusItemsPerAction * weightedPrice;
                    gourmetBonuses.push({
                        name: rawItemName,
                        itemsPerHour: bonusItemsPerHour,
                        itemsPerAction: bonusItemsPerAction,
                        dropRate: drop.dropRate,
                        priceEach: weightedPrice,
                        revenuePerHour: bonusRevenue,
                        revenuePerAction: bonusItemsPerAction * weightedPrice,
                        missingPrice: rawPriceMissing || processedPriceMissing,
                    });
                } else {
                    const bonusRevenue = bonusItemsPerHour * resolvedRawPrice;
                    gourmetRevenueBonus += bonusRevenue;
                    gourmetRevenueBonusPerAction += bonusItemsPerAction * resolvedRawPrice;
                    gourmetBonuses.push({
                        name: rawItemName,
                        itemsPerHour: bonusItemsPerHour,
                        itemsPerAction: bonusItemsPerAction,
                        dropRate: drop.dropRate,
                        priceEach: resolvedRawPrice,
                        revenuePerHour: bonusRevenue,
                        revenuePerAction: bonusItemsPerAction * resolvedRawPrice,
                        missingPrice: rawPriceMissing,
                    });
                }
            }
        }

        // Calculate bonus revenue from essence and rare find drops
        const bonusRevenue = bonusRevenueCalculator_js.calculateBonusRevenue(actionDetail, actionsPerHour, equipment, gameData.itemDetailMap);

        // Apply efficiency multiplier to bonus revenue (efficiency repeats the action, including bonus rolls)
        const efficiencyBoostedBonusRevenue = bonusRevenue.totalBonusRevenue * efficiencyMultiplier;

        const revenuePerHour =
            baseRevenuePerHour + gourmetRevenueBonus + processingRevenueBonus + efficiencyBoostedBonusRevenue;

        const hasMissingPrices =
            drinkCosts.some((drink) => drink.missingPrice) ||
            baseOutputs.some((output) => output.missingPrice) ||
            gourmetBonuses.some((output) => output.missingPrice) ||
            processingConversions.some((conversion) => conversion.missingPrice) ||
            (bonusRevenue?.hasMissingPrices ?? false);

        // Calculate market tax (2% of gross revenue)
        const marketTax = revenuePerHour * profitConstants_js.MARKET_TAX;

        // Calculate net profit (revenue - market tax - drink costs)
        const profitPerHour = revenuePerHour - marketTax - drinkCostPerHour;

        return {
            profitPerHour,
            profitPerAction: profitHelpers_js.calculateProfitPerAction(profitPerHour, actionsPerHour), // Profit per action
            profitPerDay: profitHelpers_js.calculateProfitPerDay(profitPerHour), // Profit per day
            revenuePerHour,
            drinkCostPerHour,
            drinkCosts, // Array of individual drink costs {name, priceEach, costPerHour}
            actionsPerHour, // Base actions per hour (without efficiency)
            baseOutputs, // Display-only base outputs {name, itemsPerHour, dropRate, priceEach, revenuePerHour}
            gourmetBonuses, // Display-only gourmet bonus outputs
            totalEfficiency, // Total efficiency percentage
            efficiencyMultiplier, // Efficiency as multiplier (1 + totalEfficiency / 100)
            speedBonus,
            bonusRevenue, // Essence and rare find details
            gourmetBonus, // Gourmet bonus percentage
            processingBonus, // Processing Tea chance (as decimal)
            processingRevenueBonus, // Extra revenue from Processing conversions
            processingConversions, // Array of conversion details {rawItem, processedItem, valueGain}
            processingRevenueBonusPerAction, // Processing bonus per action
            gourmetRevenueBonus, // Gourmet bonus revenue per hour
            gourmetRevenueBonusPerAction, // Gourmet bonus revenue per action
            gatheringQuantity: totalGathering, // Total gathering quantity bonus (as decimal) - renamed for display consistency
            hasMissingPrices,
            details: {
                levelEfficiency,
                houseEfficiency,
                teaEfficiency,
                equipmentEfficiency,
                achievementEfficiency,
                gourmetBonus,
                communityBuffQuantity: communityGathering, // Community Buff component (as decimal)
                gatheringTeaBonus: gatheringTea, // Gathering Tea component (as decimal)
                achievementGathering: achievementGathering, // Achievement Tier component (as decimal)
            },
        };
    }

    /**
     * Profit Calculator Module
     * Calculates production costs and profit for crafted items
     */


    /**
     * ProfitCalculator class handles profit calculations for production actions
     */
    class ProfitCalculator {
        constructor() {
            // Cached static game data (never changes during session)
            this._itemDetailMap = null;
            this._actionDetailMap = null;
            this._communityBuffMap = null;
        }

        /**
         * Get item detail map (lazy-loaded and cached)
         * @returns {Object} Item details map from init_client_data
         */
        getItemDetailMap() {
            if (!this._itemDetailMap) {
                const initData = dataManager.getInitClientData();
                this._itemDetailMap = initData?.itemDetailMap || {};
            }
            return this._itemDetailMap;
        }

        /**
         * Get action detail map (lazy-loaded and cached)
         * @returns {Object} Action details map from init_client_data
         */
        getActionDetailMap() {
            if (!this._actionDetailMap) {
                const initData = dataManager.getInitClientData();
                this._actionDetailMap = initData?.actionDetailMap || {};
            }
            return this._actionDetailMap;
        }

        /**
         * Get community buff map (lazy-loaded and cached)
         * @returns {Object} Community buff details map from init_client_data
         */
        getCommunityBuffMap() {
            if (!this._communityBuffMap) {
                const initData = dataManager.getInitClientData();
                this._communityBuffMap = initData?.communityBuffTypeDetailMap || {};
            }
            return this._communityBuffMap;
        }

        /**
         * Calculate profit for a crafted item
         * @param {string} itemHrid - Item HRID
         * @returns {Promise<Object|null>} Profit data or null if not craftable
         */
        async calculateProfit(itemHrid) {
            // Get item details
            const itemDetails = dataManager.getItemDetails(itemHrid);
            if (!itemDetails) {
                return null;
            }

            // Find the action that produces this item
            const action = this.findProductionAction(itemHrid);
            if (!action) {
                return null; // Not a craftable item
            }

            // Get character skills for efficiency calculations
            const skills = dataManager.getSkills();
            if (!skills) {
                return null;
            }

            const actionDetails = dataManager.getActionDetails(action.actionHrid);
            if (!actionDetails) {
                return null;
            }

            // Initialize price cache for this calculation
            const priceCache = new Map();
            const getCachedPrice = (itemHridParam, options) => {
                const side = options?.side || '';
                const enhancementLevelParam = options?.enhancementLevel ?? '';
                const cacheKey = `${itemHridParam}|${side}|${enhancementLevelParam}`;

                if (priceCache.has(cacheKey)) {
                    return priceCache.get(cacheKey);
                }

                const price = marketData_js.getItemPrice(itemHridParam, options);
                priceCache.set(cacheKey, price);
                return price;
            };

            // Calculate base action time
            // Game uses NANOSECONDS (1e9 = 1 second)
            const baseTime = actionDetails.baseTimeCost / 1e9; // Convert nanoseconds to seconds

            // Get character level for the action's skill
            const skillLevel = this.getSkillLevel(skills, actionDetails.type);

            // Get equipped items for efficiency bonus calculation
            const characterEquipment = dataManager.getEquipment();
            const itemDetailMap = this.getItemDetailMap();

            // Get Drink Concentration from equipment
            const drinkConcentration = teaParser_js.getDrinkConcentration(characterEquipment, itemDetailMap);

            // Get active drinks for this action type
            const activeDrinks = dataManager.getActionDrinkSlots(actionDetails.type);

            // Calculate Action Level bonus from teas (e.g., Artisan Tea: +5 Action Level)
            // This lowers the effective requirement, not increases skill level
            const actionLevelBonus = teaParser_js.parseActionLevelBonus(activeDrinks, itemDetailMap, drinkConcentration);

            // Calculate efficiency components
            // Action Level bonus increases the effective requirement
            const baseRequirement = actionDetails.levelRequirement?.level || 1;
            // Calculate tea skill level bonus (e.g., +8 Cheesesmithing from Ultra Cheesesmithing Tea)
            const teaSkillLevelBonus = teaParser_js.parseTeaSkillLevelBonus(
                actionDetails.type,
                activeDrinks,
                itemDetailMap,
                drinkConcentration
            );

            // Calculate artisan material cost reduction
            const artisanBonus = teaParser_js.parseArtisanBonus(activeDrinks, itemDetailMap, drinkConcentration);

            // Calculate gourmet bonus (Brewing/Cooking extra items)
            const gourmetBonus = teaParser_js.parseGourmetBonus(activeDrinks, itemDetailMap, drinkConcentration);

            // Calculate processing bonus (Milking/Foraging/Woodcutting conversions)
            const processingBonus = teaParser_js.parseProcessingBonus(activeDrinks, itemDetailMap, drinkConcentration);

            // Get community buff bonus (Production Efficiency)
            const communityBuffLevel = dataManager.getCommunityBuffLevel('/community_buff_types/production_efficiency');
            const communityEfficiency = this.calculateCommunityBuffBonus(communityBuffLevel, actionDetails.type);

            // Total efficiency bonus (all sources additive)
            const houseEfficiency = houseEfficiency_js.calculateHouseEfficiency(actionDetails.type);

            // Calculate equipment efficiency bonus
            const equipmentEfficiency = equipmentParser_js.parseEquipmentEfficiencyBonuses(
                characterEquipment,
                actionDetails.type,
                itemDetailMap
            );

            // Calculate tea efficiency bonus
            const teaEfficiency = teaParser_js.parseTeaEfficiency(actionDetails.type, activeDrinks, itemDetailMap, drinkConcentration);

            const achievementEfficiency =
                dataManager.getAchievementBuffFlatBoost(actionDetails.type, '/buff_types/efficiency') * 100;

            const efficiencyBreakdown = efficiency_js.calculateEfficiencyBreakdown({
                requiredLevel: baseRequirement,
                skillLevel,
                teaSkillLevelBonus,
                actionLevelBonus,
                houseEfficiency,
                equipmentEfficiency,
                teaEfficiency,
                communityEfficiency,
                achievementEfficiency,
            });

            const totalEfficiency = efficiencyBreakdown.totalEfficiency;
            const levelEfficiency = efficiencyBreakdown.levelEfficiency;
            const effectiveRequirement = efficiencyBreakdown.effectiveRequirement;

            // Calculate equipment speed bonus
            const equipmentSpeedBonus = equipmentParser_js.parseEquipmentSpeedBonuses(characterEquipment, actionDetails.type, itemDetailMap);

            // Calculate action time with ONLY speed bonuses
            // Efficiency does NOT reduce time - it gives bonus actions
            // Formula: baseTime / (1 + speedBonus)
            // Example: 60s / (1 + 0.15) = 52.17s
            const actionTime = baseTime / (1 + equipmentSpeedBonus);

            // Build time breakdown for display
            const timeBreakdown = this.calculateTimeBreakdown(baseTime, equipmentSpeedBonus);

            // Actions per hour (base rate without efficiency)
            const actionsPerHour = profitHelpers_js.calculateActionsPerHour(actionTime);

            // Get output amount (how many items per action)
            // Use 'count' field from action output
            const outputAmount = action.count || action.baseAmount || 1;

            // Calculate efficiency multiplier
            // Formula matches original MWI Tools: 1 + efficiency%
            // Example: 150% efficiency → 1 + 1.5 = 2.5x multiplier
            const efficiencyMultiplier = efficiency_js.calculateEfficiencyMultiplier(totalEfficiency);

            // Items produced per hour (with efficiency multiplier)
            const itemsPerHour = actionsPerHour * outputAmount * efficiencyMultiplier;

            // Extra items from Gourmet (Brewing/Cooking bonus)
            // Statistical average: itemsPerHour × gourmetChance
            const gourmetBonusItems = itemsPerHour * gourmetBonus;

            // Total items per hour (base + gourmet bonus)
            const totalItemsPerHour = itemsPerHour + gourmetBonusItems;

            // Calculate material costs (with artisan reduction if applicable)
            const materialCosts = this.calculateMaterialCosts(actionDetails, artisanBonus, getCachedPrice);

            // Total material cost per action
            const totalMaterialCost = materialCosts.reduce((sum, mat) => sum + mat.totalCost, 0);

            // Get market price for the item
            // Use fallback {ask: 0, bid: 0} if no market data exists (e.g., refined items)
            const itemPrice = marketAPI.getPrice(itemHrid, 0) || { ask: 0, bid: 0 };

            // Get output price based on pricing mode setting
            // Uses 'profit' context with 'sell' side to get correct sell price
            const rawOutputPrice = getCachedPrice(itemHrid, { context: 'profit', side: 'sell' });
            const outputPriceMissing = rawOutputPrice === null;
            const outputPrice = outputPriceMissing ? 0 : rawOutputPrice;

            // Apply market tax (2% tax on sales)
            const priceAfterTax = profitHelpers_js.calculatePriceAfterTax(outputPrice);

            // Cost per item (without efficiency scaling)
            const costPerItem = totalMaterialCost / outputAmount;

            // Material costs per hour (accounting for efficiency multiplier)
            // Efficiency repeats the action, consuming materials each time
            const materialCostPerHour = actionsPerHour * totalMaterialCost * efficiencyMultiplier;

            // Revenue per hour (gross, before tax)
            const revenuePerHour = itemsPerHour * outputPrice + gourmetBonusItems * outputPrice;

            // Calculate tea consumption costs (drinks consumed per hour)
            const teaCostData = profitHelpers_js.calculateTeaCostsPerHour({
                drinkSlots: activeDrinks,
                drinkConcentration,
                itemDetailMap,
                getItemPrice: getCachedPrice,
            });
            const teaCosts = teaCostData.costs;
            const totalTeaCostPerHour = teaCostData.totalCostPerHour;

            // Calculate bonus revenue from essence and rare find drops (before profit calculation)
            const bonusRevenue = bonusRevenueCalculator_js.calculateBonusRevenue(actionDetails, actionsPerHour, characterEquipment, itemDetailMap);

            const hasMissingPrices =
                outputPriceMissing ||
                materialCosts.some((material) => material.missingPrice) ||
                teaCostData.hasMissingPrices ||
                (bonusRevenue?.hasMissingPrices ?? false);

            // Apply efficiency multiplier to bonus revenue (efficiency repeats the action, including bonus rolls)
            const efficiencyBoostedBonusRevenue = (bonusRevenue?.totalBonusRevenue || 0) * efficiencyMultiplier;

            // Calculate market tax (2% of gross revenue including bonus revenue)
            const marketTax = (revenuePerHour + efficiencyBoostedBonusRevenue) * profitConstants_js.MARKET_TAX;

            // Total costs per hour (materials + teas + market tax)
            const totalCostPerHour = materialCostPerHour + totalTeaCostPerHour + marketTax;

            // Profit per hour (revenue + bonus revenue - total costs)
            const profitPerHour = revenuePerHour + efficiencyBoostedBonusRevenue - totalCostPerHour;

            // Profit per item (for display)
            const profitPerItem = profitPerHour / totalItemsPerHour;

            return {
                itemName: itemDetails.name,
                itemHrid,
                actionTime,
                actionsPerHour,
                itemsPerHour,
                totalItemsPerHour, // Items/hour including Gourmet bonus
                gourmetBonusItems, // Extra items from Gourmet
                outputAmount,
                materialCosts,
                totalMaterialCost,
                materialCostPerHour, // Material costs per hour (with efficiency)
                teaCosts, // Tea consumption costs breakdown
                totalTeaCostPerHour, // Total tea costs per hour
                costPerItem,
                itemPrice,
                outputPrice, // Output price before tax (bid or ask based on mode)
                outputPriceMissing,
                priceAfterTax, // Output price after 2% tax (bid or ask based on mode)
                revenuePerHour,
                profitPerItem,
                profitPerHour,
                profitPerAction: profitHelpers_js.calculateProfitPerAction(profitPerHour, actionsPerHour), // Profit per action
                profitPerDay: profitHelpers_js.calculateProfitPerDay(profitPerHour), // Profit per day
                bonusRevenue, // Bonus revenue from essences and rare finds
                hasMissingPrices,
                totalEfficiency, // Total efficiency percentage
                levelEfficiency, // Level advantage efficiency
                houseEfficiency, // House room efficiency
                equipmentEfficiency, // Equipment efficiency
                teaEfficiency, // Tea buff efficiency
                communityEfficiency, // Community buff efficiency
                achievementEfficiency, // Achievement buff efficiency
                actionLevelBonus, // Action Level bonus from teas (e.g., Artisan Tea)
                artisanBonus, // Artisan material cost reduction
                gourmetBonus, // Gourmet bonus item chance
                processingBonus, // Processing conversion chance
                drinkConcentration, // Drink Concentration stat
                efficiencyMultiplier,
                equipmentSpeedBonus,
                skillLevel,
                baseRequirement, // Base requirement level
                effectiveRequirement, // Requirement after Action Level bonus
                requiredLevel: effectiveRequirement, // For backwards compatibility
                timeBreakdown,
            };
        }

        /**
         * Find the action that produces a given item
         * @param {string} itemHrid - Item HRID
         * @returns {Object|null} Action output data or null
         */
        findProductionAction(itemHrid) {
            const actionDetailMap = this.getActionDetailMap();

            // Search through all actions for one that produces this item
            for (const [actionHrid, action] of Object.entries(actionDetailMap)) {
                if (action.outputItems) {
                    for (const output of action.outputItems) {
                        if (output.itemHrid === itemHrid) {
                            return {
                                actionHrid,
                                ...output,
                            };
                        }
                    }
                }
            }

            return null;
        }

        /**
         * Calculate material costs for an action
         * @param {Object} actionDetails - Action details from game data
         * @param {number} artisanBonus - Artisan material reduction (0 to 1, e.g., 0.112 for 11.2% reduction)
         * @param {Function} getCachedPrice - Price lookup function with caching
         * @returns {Array} Array of material cost objects
         */
        calculateMaterialCosts(actionDetails, artisanBonus = 0, getCachedPrice) {
            const costs = [];

            // Check for upgrade item (e.g., Crimson Bulwark → Rainbow Bulwark)
            if (actionDetails.upgradeItemHrid) {
                const itemDetails = dataManager.getItemDetails(actionDetails.upgradeItemHrid);

                if (itemDetails) {
                    // Get material price based on pricing mode (uses 'profit' context with 'buy' side)
                    const materialPrice = getCachedPrice(actionDetails.upgradeItemHrid, { context: 'profit', side: 'buy' });
                    const isPriceMissing = materialPrice === null;
                    const resolvedPrice = isPriceMissing ? 0 : materialPrice;

                    // Special case: Coins have no market price but have face value of 1
                    let finalPrice = resolvedPrice;
                    let isMissing = isPriceMissing;
                    if (actionDetails.upgradeItemHrid === '/items/coin' && finalPrice === 0) {
                        finalPrice = 1;
                        isMissing = false;
                    }

                    // Upgrade items are NOT affected by Artisan Tea (only regular inputItems are)
                    const reducedAmount = 1;

                    costs.push({
                        itemHrid: actionDetails.upgradeItemHrid,
                        itemName: itemDetails.name,
                        baseAmount: 1,
                        amount: reducedAmount,
                        askPrice: finalPrice,
                        totalCost: finalPrice * reducedAmount,
                        missingPrice: isMissing,
                    });
                }
            }

            // Process regular input items
            if (actionDetails.inputItems && actionDetails.inputItems.length > 0) {
                for (const input of actionDetails.inputItems) {
                    const itemDetails = dataManager.getItemDetails(input.itemHrid);

                    if (!itemDetails) {
                        continue;
                    }

                    // Use 'count' field (not 'amount')
                    const baseAmount = input.count || input.amount || 1;

                    // Apply artisan reduction
                    const reducedAmount = baseAmount * (1 - artisanBonus);

                    // Get material price based on pricing mode (uses 'profit' context with 'buy' side)
                    const materialPrice = getCachedPrice(input.itemHrid, { context: 'profit', side: 'buy' });
                    const isPriceMissing = materialPrice === null;
                    const resolvedPrice = isPriceMissing ? 0 : materialPrice;

                    // Special case: Coins have no market price but have face value of 1
                    let finalPrice = resolvedPrice;
                    let isMissing = isPriceMissing;
                    if (input.itemHrid === '/items/coin' && finalPrice === 0) {
                        finalPrice = 1; // 1 coin = 1 gold value
                        isMissing = false;
                    }

                    costs.push({
                        itemHrid: input.itemHrid,
                        itemName: itemDetails.name,
                        baseAmount: baseAmount,
                        amount: reducedAmount,
                        askPrice: finalPrice,
                        totalCost: finalPrice * reducedAmount,
                        missingPrice: isMissing,
                    });
                }
            }

            return costs;
        }

        /**
         * Get character skill level for a skill type
         * @param {Array} skills - Character skills array
         * @param {string} skillType - Skill type HRID (e.g., "/action_types/cheesesmithing")
         * @returns {number} Skill level
         */
        getSkillLevel(skills, skillType) {
            // Map action type to skill HRID
            // e.g., "/action_types/cheesesmithing" -> "/skills/cheesesmithing"
            const skillHrid = skillType.replace('/action_types/', '/skills/');

            const skill = skills.find((s) => s.skillHrid === skillHrid);
            return skill?.level || 1;
        }

        /**
         * Calculate efficiency bonus from multiple sources
         * @param {number} characterLevel - Character's skill level
         * @param {number} requiredLevel - Action's required level
         * @param {string} actionTypeHrid - Action type HRID for house room matching
         * @returns {number} Total efficiency bonus percentage
         */
        calculateEfficiencyBonus(characterLevel, requiredLevel, actionTypeHrid) {
            // Level efficiency: +1% per level above requirement
            const levelEfficiency = Math.max(0, characterLevel - requiredLevel);

            // House room efficiency: houseLevel × 1.5%
            const houseEfficiency = houseEfficiency_js.calculateHouseEfficiency(actionTypeHrid);

            // Total efficiency (sum of all sources)
            const totalEfficiency = levelEfficiency + houseEfficiency;

            return totalEfficiency;
        }

        /**
         * Calculate time breakdown showing how modifiers affect action time
         * @param {number} baseTime - Base action time in seconds
         * @param {number} equipmentSpeedBonus - Equipment speed bonus as decimal (e.g., 0.15 for 15%)
         * @returns {Object} Time breakdown with steps
         */
        calculateTimeBreakdown(baseTime, equipmentSpeedBonus) {
            const steps = [];

            // Equipment Speed step (if > 0)
            if (equipmentSpeedBonus > 0) {
                const finalTime = baseTime / (1 + equipmentSpeedBonus);
                const reduction = baseTime - finalTime;

                steps.push({
                    name: 'Equipment Speed',
                    bonus: equipmentSpeedBonus * 100, // convert to percentage
                    reduction: reduction, // seconds saved
                    timeAfter: finalTime, // final time
                });

                return {
                    baseTime: baseTime,
                    steps: steps,
                    finalTime: finalTime,
                    actionsPerHour: profitHelpers_js.calculateActionsPerHour(finalTime),
                };
            }

            // No modifiers - final time is base time
            return {
                baseTime: baseTime,
                steps: [],
                finalTime: baseTime,
                actionsPerHour: profitHelpers_js.calculateActionsPerHour(baseTime),
            };
        }

        /**
         * Calculate community buff bonus for production efficiency
         * @param {number} buffLevel - Community buff level (0-20)
         * @param {string} actionTypeHrid - Action type to check if buff applies
         * @returns {number} Efficiency bonus percentage
         */
        calculateCommunityBuffBonus(buffLevel, actionTypeHrid) {
            if (buffLevel === 0) {
                return 0;
            }

            // Check if buff applies to this action type
            const communityBuffMap = this.getCommunityBuffMap();
            const buffDef = communityBuffMap['/community_buff_types/production_efficiency'];

            if (!buffDef?.usableInActionTypeMap?.[actionTypeHrid]) {
                return 0; // Buff doesn't apply to this skill
            }

            // Formula: flatBoost + (level - 1) × flatBoostLevelBonus
            const baseBonus = buffDef.buff.flatBoost * 100; // 14%
            const levelBonus = (buffLevel - 1) * buffDef.buff.flatBoostLevelBonus * 100; // 0.3% per level

            return baseBonus + levelBonus;
        }
    }

    const profitCalculator = new ProfitCalculator();

    /**
     * Production Profit Calculator
     *
     * Calculates comprehensive profit/hour for production actions (Brewing, Cooking, Crafting, Tailoring, Cheesesmithing)
     * Reuses existing profit calculator from tooltip system.
     */


    /**
     * Action types for production skills (5 skills)
     */
    const PRODUCTION_TYPES = [
        '/action_types/brewing',
        '/action_types/cooking',
        '/action_types/cheesesmithing',
        '/action_types/crafting',
        '/action_types/tailoring',
    ];

    /**
     * Calculate comprehensive profit for a production action
     * @param {string} actionHrid - Action HRID (e.g., "/actions/brewing/efficiency_tea")
     * @returns {Object|null} Profit data or null if not applicable
     */
    async function calculateProductionProfit(actionHrid) {
        const gameData = dataManager.getInitClientData();
        const actionDetail = gameData.actionDetailMap[actionHrid];

        if (!actionDetail) {
            return null;
        }

        // Only process production actions with outputs
        if (!PRODUCTION_TYPES.includes(actionDetail.type)) {
            return null;
        }

        if (!actionDetail.outputItems || actionDetail.outputItems.length === 0) {
            return null; // No output - nothing to calculate
        }

        // Note: Market API is pre-loaded by caller (max-produceable.js)
        // No need to check or fetch here

        // Get output item HRID
        const outputItemHrid = actionDetail.outputItems[0].itemHrid;

        // Reuse existing profit calculator (does all the heavy lifting)
        const profitData = await profitCalculator.calculateProfit(outputItemHrid);

        if (!profitData) {
            return null;
        }

        return profitData;
    }

    /**
     * Task Profit Calculator
     * Calculates total profit for gathering and production tasks
     * Includes task rewards (coins, task tokens, Purple's Gift) + action profit
     */


    /**
     * Calculate Task Token value from Task Shop items
     * Uses same approach as Ranged Way Idle - find best Task Shop item
     * @returns {Object} Token value breakdown or error state
     */
    function calculateTaskTokenValue() {
        // Return error state if expected value calculator isn't ready
        if (!expectedValueCalculator.isInitialized) {
            return {
                tokenValue: null,
                giftPerTask: null,
                totalPerToken: null,
                error: 'Market data not loaded',
            };
        }

        const taskShopItems = [
            '/items/large_meteorite_cache',
            '/items/large_artisans_crate',
            '/items/large_treasure_chest',
        ];

        // Get expected value of each Task Shop item (all cost 30 tokens)
        const expectedValues = taskShopItems.map((itemHrid) => {
            const result = expectedValueCalculator.calculateExpectedValue(itemHrid);
            return result?.expectedValue || 0;
        });

        // Use best (highest value) item
        const bestValue = Math.max(...expectedValues);

        // Task Token value = best chest value / 30 (cost in tokens)
        const taskTokenValue = bestValue / 30;

        // Calculate Purple's Gift prorated value (divide by 50 tasks)
        const giftResult = expectedValueCalculator.calculateExpectedValue('/items/purples_gift');
        const giftValue = giftResult?.expectedValue || 0;
        const giftPerTask = giftValue / 50;

        return {
            tokenValue: taskTokenValue,
            giftPerTask: giftPerTask,
            totalPerToken: taskTokenValue + giftPerTask,
            error: null,
        };
    }

    /**
     * Calculate task reward value (coins + tokens + Purple's Gift)
     * @param {number} coinReward - Coin reward amount
     * @param {number} taskTokenReward - Task token reward amount
     * @returns {Object} Reward value breakdown
     */
    function calculateTaskRewardValue(coinReward, taskTokenReward) {
        const tokenData = calculateTaskTokenValue();

        // Handle error state (market data not loaded)
        if (tokenData.error) {
            return {
                coins: coinReward,
                taskTokens: 0,
                purpleGift: 0,
                total: coinReward,
                breakdown: {
                    tokenValue: 0,
                    tokensReceived: taskTokenReward,
                    giftPerTask: 0,
                },
                error: tokenData.error,
            };
        }

        const taskTokenValue = taskTokenReward * tokenData.tokenValue;
        const purpleGiftValue = taskTokenReward * tokenData.giftPerTask;

        return {
            coins: coinReward,
            taskTokens: taskTokenValue,
            purpleGift: purpleGiftValue,
            total: coinReward + taskTokenValue + purpleGiftValue,
            breakdown: {
                tokenValue: tokenData.tokenValue,
                tokensReceived: taskTokenReward,
                giftPerTask: tokenData.giftPerTask,
            },
            error: null,
        };
    }

    /**
     * Detect task type from description
     * @param {string} taskDescription - Task description text (e.g., "Cheesesmithing - Holy Cheese")
     * @returns {string} Task type: 'gathering', 'production', 'combat', or 'unknown'
     */
    function detectTaskType(taskDescription) {
        // Extract skill from "Skill - Action" format
        const skillMatch = taskDescription.match(/^([^-]+)\s*-/);
        if (!skillMatch) return 'unknown';

        const skill = skillMatch[1].trim().toLowerCase();

        // Gathering skills
        if (['foraging', 'woodcutting', 'milking'].includes(skill)) {
            return 'gathering';
        }

        // Production skills
        if (['cheesesmithing', 'brewing', 'cooking', 'crafting', 'tailoring'].includes(skill)) {
            return 'production';
        }

        // Combat
        if (skill === 'defeat') {
            return 'combat';
        }

        return 'unknown';
    }

    /**
     * Parse task description to extract action HRID
     * Format: "Skill - Action Name" (e.g., "Cheesesmithing - Holy Cheese", "Milking - Cow")
     * @param {string} taskDescription - Task description text
     * @param {string} taskType - Task type (gathering/production)
     * @param {number} quantity - Task quantity
     * @param {number} currentProgress - Current progress (actions completed)
     * @returns {Object|null} {actionHrid, quantity, currentProgress, description} or null if parsing fails
     */
    function parseTaskDescription(taskDescription, taskType, quantity, currentProgress) {
        const gameData = dataManager.getInitClientData();
        if (!gameData) {
            return null;
        }

        const actionDetailMap = gameData.actionDetailMap;
        if (!actionDetailMap) {
            return null;
        }

        // Extract action name from "Skill - Action" format
        const match = taskDescription.match(/^[^-]+\s*-\s*(.+)$/);
        if (!match) {
            return null;
        }

        const actionName = match[1].trim();

        // Find matching action HRID by searching for action name in action details
        for (const [actionHrid, actionDetail] of Object.entries(actionDetailMap)) {
            if (actionDetail.name && actionDetail.name.toLowerCase() === actionName.toLowerCase()) {
                return { actionHrid, quantity, currentProgress, description: taskDescription };
            }
        }

        return null;
    }

    /**
     * Calculate gathering task profit
     * @param {string} actionHrid - Action HRID
     * @param {number} quantity - Number of times to perform action
     * @returns {Promise<Object>} Profit breakdown
     */
    async function calculateGatheringTaskProfit(actionHrid, quantity) {
        let profitData;
        try {
            profitData = await calculateGatheringProfit(actionHrid);
        } catch {
            profitData = null;
        }

        if (!profitData) {
            return {
                totalValue: 0,
                breakdown: {
                    actionHrid,
                    quantity,
                    perAction: 0,
                },
            };
        }

        const hasMissingPrices = profitData.hasMissingPrices;

        const totals = profitHelpers_js.calculateGatheringActionTotalsFromBase({
            actionsCount: quantity,
            actionsPerHour: profitData.actionsPerHour,
            baseOutputs: profitData.baseOutputs,
            bonusDrops: profitData.bonusRevenue?.bonusDrops || [],
            processingRevenueBonusPerAction: profitData.processingRevenueBonusPerAction,
            gourmetRevenueBonusPerAction: profitData.gourmetRevenueBonusPerAction,
            drinkCostPerHour: profitData.drinkCostPerHour,
            efficiencyMultiplier: profitData.efficiencyMultiplier || 1,
        });

        return {
            totalValue: hasMissingPrices ? null : totals.totalProfit,
            hasMissingPrices,
            breakdown: {
                actionHrid,
                quantity,
                perAction: quantity > 0 ? totals.totalProfit / quantity : 0,
            },
            // Include detailed data for expandable display
            details: {
                profitPerHour: profitData.profitPerHour,
                actionsPerHour: profitData.actionsPerHour,
                baseOutputs: profitData.baseOutputs,
                gourmetBonuses: profitData.gourmetBonuses,
                bonusRevenue: profitData.bonusRevenue,
                processingConversions: profitData.processingConversions,
                processingRevenueBonusPerAction: profitData.processingRevenueBonusPerAction,
                processingBonus: profitData.processingBonus,
                gourmetRevenueBonusPerAction: profitData.gourmetRevenueBonusPerAction,
                gourmetBonus: profitData.gourmetBonus,
                efficiencyMultiplier: profitData.efficiencyMultiplier,
            },
        };
    }

    /**
     * Calculate production task profit
     * @param {string} actionHrid - Action HRID
     * @param {number} quantity - Number of times to perform action
     * @returns {Promise<Object>} Profit breakdown
     */
    async function calculateProductionTaskProfit(actionHrid, quantity) {
        let profitData;
        try {
            profitData = await calculateProductionProfit(actionHrid);
        } catch {
            profitData = null;
        }

        if (!profitData) {
            return {
                totalProfit: 0,
                breakdown: {
                    actionHrid,
                    quantity,
                    outputValue: 0,
                    materialCost: 0,
                    perAction: 0,
                },
            };
        }

        const hasMissingPrices = profitData.hasMissingPrices;

        const bonusDrops = profitData.bonusRevenue?.bonusDrops || [];
        const totals = profitHelpers_js.calculateProductionActionTotalsFromBase({
            actionsCount: quantity,
            actionsPerHour: profitData.actionsPerHour,
            outputAmount: profitData.outputAmount || 1,
            outputPrice: profitData.outputPrice,
            gourmetBonus: profitData.gourmetBonus || 0,
            bonusDrops,
            materialCosts: profitData.materialCosts,
            totalTeaCostPerHour: profitData.totalTeaCostPerHour,
            efficiencyMultiplier: profitData.efficiencyMultiplier || 1,
        });

        return {
            totalProfit: hasMissingPrices ? null : totals.totalProfit,
            hasMissingPrices,
            breakdown: {
                actionHrid,
                quantity,
                outputValue: totals.totalBaseRevenue + totals.totalGourmetRevenue,
                materialCost: totals.totalMaterialCost + totals.totalTeaCost,
                perAction: quantity > 0 ? totals.totalProfit / quantity : 0,
            },
            // Include detailed data for expandable display
            details: {
                profitPerHour: profitData.profitPerHour,
                materialCosts: profitData.materialCosts,
                teaCosts: profitData.teaCosts,
                outputAmount: profitData.outputAmount,
                itemName: profitData.itemName,
                itemHrid: profitData.itemHrid,
                gourmetBonus: profitData.gourmetBonus,
                priceEach: profitData.outputPrice,
                outputPriceMissing: profitData.outputPriceMissing,
                actionsPerHour: profitData.actionsPerHour,
                bonusRevenue: profitData.bonusRevenue, // Pass through bonus revenue data
            },
        };
    }

    /**
     * Calculate complete task profit
     * @param {Object} taskData - Task data {description, coinReward, taskTokenReward}
     * @returns {Promise<Object|null>} Complete profit breakdown or null for combat/unknown tasks
     */
    async function calculateTaskProfit(taskData) {
        const taskType = detectTaskType(taskData.description);

        // Skip combat tasks entirely
        if (taskType === 'combat') {
            return null;
        }

        // Parse task details
        const taskInfo = parseTaskDescription(taskData.description, taskType, taskData.quantity, taskData.currentProgress);
        if (!taskInfo) {
            // Return error state for UI to display "Unable to calculate"
            return {
                type: taskType,
                error: 'Unable to parse task description',
                totalProfit: 0,
            };
        }

        // Calculate task rewards
        const rewardValue = calculateTaskRewardValue(taskData.coinReward, taskData.taskTokenReward);

        // Calculate action profit based on task type
        let actionProfit = null;
        if (taskType === 'gathering') {
            actionProfit = await calculateGatheringTaskProfit(taskInfo.actionHrid, taskInfo.quantity);
        } else if (taskType === 'production') {
            actionProfit = await calculateProductionTaskProfit(taskInfo.actionHrid, taskInfo.quantity);
        }

        if (!actionProfit) {
            return {
                type: taskType,
                error: 'Unable to calculate action profit',
                totalProfit: 0,
            };
        }

        // Calculate total profit
        const actionValue = taskType === 'production' ? actionProfit.totalProfit : actionProfit.totalValue;
        const hasMissingPrices = actionProfit.hasMissingPrices;
        const totalProfit = hasMissingPrices ? null : rewardValue.total + actionValue;

        return {
            type: taskType,
            totalProfit,
            hasMissingPrices,
            rewards: rewardValue,
            action: actionProfit,
            taskInfo: taskInfo,
        };
    }

    /**
     * Task Profit Display
     * Shows profit calculation on task cards
     * Expandable breakdown on click
     */


    // Compiled regex pattern (created once, reused for performance)
    const REGEX_TASK_PROGRESS = /(\d+)\s*\/\s*(\d+)/;
    const RATING_MODE_TOKENS = 'tokens';
    const RATING_MODE_GOLD = 'gold';

    /**
     * Calculate task completion time in seconds based on task progress and action rates
     * @param {Object} profitData - Profit calculation result
     * @returns {number|null} Completion time in seconds or null if unavailable
     */
    function calculateTaskCompletionSeconds(profitData) {
        const actionsPerHour = profitData?.action?.details?.actionsPerHour;
        const totalQuantity = profitData?.taskInfo?.quantity;

        if (!actionsPerHour || !totalQuantity) {
            return null;
        }

        const currentProgress = profitData.taskInfo.currentProgress || 0;
        const remainingActions = Math.max(totalQuantity - currentProgress, 0);
        if (remainingActions <= 0) {
            return 0;
        }

        const efficiencyMultiplier = profitData.action.details.efficiencyMultiplier || 1;
        const baseActionsNeeded = efficiencyMultiplier > 0 ? remainingActions / efficiencyMultiplier : remainingActions;

        return profitHelpers_js.calculateSecondsForActions(baseActionsNeeded, actionsPerHour);
    }

    /**
     * Calculate task efficiency rating data
     * @param {Object} profitData - Profit calculation result
     * @param {string} ratingMode - Rating mode (tokens or gold)
     * @returns {Object|null} Rating data or null if unavailable
     */
    function calculateTaskEfficiencyRating(profitData, ratingMode) {
        const completionSeconds = calculateTaskCompletionSeconds(profitData);
        if (!completionSeconds || completionSeconds <= 0) {
            return null;
        }

        const hours = completionSeconds / 3600;

        if (ratingMode === RATING_MODE_GOLD) {
            if (profitData.rewards?.error || profitData.totalProfit === null || profitData.totalProfit === undefined) {
                return {
                    value: null,
                    unitLabel: 'gold/hr',
                    error: profitData.rewards?.error || 'Missing price data',
                };
            }

            return {
                value: profitData.totalProfit / hours,
                unitLabel: 'gold/hr',
                error: null,
            };
        }

        const tokensReceived = profitData.rewards?.breakdown?.tokensReceived ?? 0;
        return {
            value: tokensReceived / hours,
            unitLabel: 'tokens/hr',
            error: null,
        };
    }

    const HEX_COLOR_PATTERN = /^#?[0-9a-f]{6}$/i;

    /**
     * Convert a hex color to RGB
     * @param {string} hex - Hex color string
     * @returns {Object|null} RGB values or null when invalid
     */
    function parseHexColor(hex) {
        if (!hex || !HEX_COLOR_PATTERN.test(hex)) {
            return null;
        }

        const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
        return {
            r: Number.parseInt(normalized.slice(0, 2), 16),
            g: Number.parseInt(normalized.slice(2, 4), 16),
            b: Number.parseInt(normalized.slice(4, 6), 16),
        };
    }

    /**
     * Convert RGB values to a CSS color string
     * @param {Object} rgb - RGB values
     * @returns {string} CSS rgb color string
     */
    function formatRgbColor({ r, g, b }) {
        return `rgb(${r}, ${g}, ${b})`;
    }

    /**
     * Interpolate between two RGB colors
     * @param {Object} startColor - RGB start color
     * @param {Object} endColor - RGB end color
     * @param {number} ratio - Interpolation ratio
     * @returns {Object} RGB color
     */
    function interpolateRgbColor(startColor, endColor, ratio) {
        return {
            r: Math.round(startColor.r + (endColor.r - startColor.r) * ratio),
            g: Math.round(startColor.g + (endColor.g - startColor.g) * ratio),
            b: Math.round(startColor.b + (endColor.b - startColor.b) * ratio),
        };
    }

    /**
     * Convert a rating value into a relative gradient color
     * @param {number} value - Rating value
     * @param {number} minValue - Minimum rating value
     * @param {number} maxValue - Maximum rating value
     * @param {string} minColor - CSS color for lowest value
     * @param {string} maxColor - CSS color for highest value
     * @param {string} fallbackColor - Color to use when value is invalid
     * @returns {string} CSS color value
     */
    function getRelativeEfficiencyGradientColor(value, minValue, maxValue, minColor, maxColor, fallbackColor) {
        if (!Number.isFinite(value) || !Number.isFinite(minValue) || !Number.isFinite(maxValue) || maxValue <= minValue) {
            return fallbackColor;
        }

        const startColor = parseHexColor(minColor);
        const endColor = parseHexColor(maxColor);
        if (!startColor || !endColor) {
            return fallbackColor;
        }

        const normalized = (value - minValue) / (maxValue - minValue);
        const clamped = Math.min(Math.max(normalized, 0), 1);
        const blendedColor = interpolateRgbColor(startColor, endColor, clamped);
        return formatRgbColor(blendedColor);
    }

    /**
     * TaskProfitDisplay class manages task profit UI
     */
    class TaskProfitDisplay {
        constructor() {
            this.isActive = false;
            this.unregisterHandlers = []; // Store unregister functions
            this.retryHandler = null; // Retry handler reference for cleanup
            this.marketDataRetryHandler = null; // Market data retry handler
            this.pendingTaskNodes = new Set(); // Track task nodes waiting for data
            this.eventListeners = new WeakMap(); // Store listeners for cleanup
            this.isInitialized = false;
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
            this.marketDataInitPromise = null; // Guard against duplicate market data inits
        }

        /**
         * Setup settings listeners for feature toggle and color changes
         */
        setupSettingListener() {
            config.onSettingChange('taskProfitCalculator', (value) => {
                if (value) {
                    this.initialize();
                } else {
                    this.disable();
                }
            });

            config.onSettingChange('taskEfficiencyRating', () => {
                if (this.isInitialized) {
                    this.updateTaskProfits(true);
                }
            });

            config.onSettingChange('taskEfficiencyRatingMode', () => {
                if (this.isInitialized) {
                    this.updateTaskProfits(true);
                }
            });

            config.onSettingChange('taskEfficiencyGradient', () => {
                if (this.isInitialized) {
                    this.updateEfficiencyGradientColors();
                }
            });

            config.onSettingChange('color_accent', () => {
                if (this.isInitialized) {
                    this.refresh();
                }
            });
        }

        /**
         * Initialize task profit display
         */
        initialize() {
            // Guard FIRST (before feature check)
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('taskProfitCalculator')) {
                return;
            }

            // Set up retry handler for when game data loads
            if (!dataManager.getInitClientData()) {
                if (!this.retryHandler) {
                    this.retryHandler = () => {
                        // Retry all pending task nodes
                        this.retryPendingTasks();
                    };
                    dataManager.on('character_initialized', this.retryHandler);
                }
            }

            // Set up retry handler for when market data loads
            if (!this.marketDataRetryHandler) {
                this.marketDataRetryHandler = () => {
                    // Retry all pending task nodes when market data becomes available
                    this.retryPendingTasks();
                };
                dataManager.on('expected_value_initialized', this.marketDataRetryHandler);
            }

            // Register WebSocket listener for task updates
            this.registerWebSocketListeners();

            // Register DOM observers for task panel appearance
            this.registerDOMObservers();

            // Initial update
            this.updateTaskProfits();

            this.isActive = true;
            this.isInitialized = true;
        }

        /**
         * Register WebSocket message listeners
         */
        registerWebSocketListeners() {
            const questsHandler = (data) => {
                if (!data.endCharacterQuests) return;

                // Wait for game to update DOM before recalculating profits
                const updateTimeout = setTimeout(() => {
                    this.updateTaskProfits();
                }, 250);
                this.timerRegistry.registerTimeout(updateTimeout);
            };

            webSocketHook.on('quests_updated', questsHandler);

            this.unregisterHandlers.push(() => {
                webSocketHook.off('quests_updated', questsHandler);
            });
        }

        /**
         * Register DOM observers
         */
        registerDOMObservers() {
            // Watch for task list appearing
            const unregisterTaskList = domObserver.onClass('TaskProfitDisplay-TaskList', 'TasksPanel_taskList', () => {
                this.updateTaskProfits();
            });
            this.unregisterHandlers.push(unregisterTaskList);

            // Watch for individual tasks appearing
            const unregisterTask = domObserver.onClass('TaskProfitDisplay-Task', 'RandomTask_randomTask', () => {
                // Small delay to let task data settle
                const taskTimeout = setTimeout(() => this.updateTaskProfits(), 100);
                this.timerRegistry.registerTimeout(taskTimeout);
            });
            this.unregisterHandlers.push(unregisterTask);
        }

        /**
         * Update all task profit displays
         */
        updateTaskProfits(forceRefresh = false) {
            if (!config.getSetting('taskProfitCalculator')) {
                return;
            }

            const taskListNode = document.querySelector(selectors_js.GAME.TASK_LIST);
            if (!taskListNode) return;

            const taskNodes = taskListNode.querySelectorAll(selectors_js.GAME.TASK_INFO);
            for (const taskNode of taskNodes) {
                // Get current task description to detect changes
                const taskData = this.parseTaskData(taskNode);
                if (!taskData) continue;

                const currentTaskKey = `${taskData.description}|${taskData.quantity}`;

                // Check if already processed
                const existingProfit = taskNode.querySelector(selectors_js.TOOLASHA.TASK_PROFIT);
                if (existingProfit) {
                    // Check if task has changed (rerolled)
                    const savedTaskKey = existingProfit.dataset.taskKey;
                    if (!forceRefresh && savedTaskKey === currentTaskKey) {
                        continue; // Same task, skip
                    }

                    // Task changed - clean up event listeners before removing
                    const listeners = this.eventListeners.get(existingProfit);
                    if (listeners) {
                        listeners.forEach((listener, element) => {
                            element.removeEventListener('click', listener);
                        });
                        this.eventListeners.delete(existingProfit);
                    }

                    // Remove ALL old profit displays (visible + hidden markers)
                    taskNode.querySelectorAll(selectors_js.TOOLASHA.TASK_PROFIT).forEach((el) => el.remove());
                }

                this.addProfitToTask(taskNode);
            }
        }

        /**
         * Retry processing pending task nodes after data becomes available
         */
        retryPendingTasks() {
            if (!dataManager.getInitClientData()) {
                return; // Data still not ready
            }

            // Remove retry handler - we're ready now
            if (this.retryHandler) {
                dataManager.off('character_initialized', this.retryHandler);
                this.retryHandler = null;
            }

            // Process all pending tasks
            const pendingNodes = Array.from(this.pendingTaskNodes);
            this.pendingTaskNodes.clear();

            this.timerRegistry.clearAll();

            for (const taskNode of pendingNodes) {
                // Check if node still exists in DOM
                if (document.contains(taskNode)) {
                    this.addProfitToTask(taskNode);
                }
            }
        }

        /**
         * Ensure expected value calculator is initialized when task profits need market data
         * @returns {Promise<boolean>} True if initialization completed
         */
        async ensureMarketDataInitialized() {
            if (expectedValueCalculator.isInitialized) {
                return true;
            }

            if (!this.marketDataInitPromise) {
                this.marketDataInitPromise = (async () => {
                    try {
                        return await expectedValueCalculator.initialize();
                    } catch (error) {
                        console.error('[Task Profit Display] Market data initialization failed:', error);
                        return false;
                    } finally {
                        this.marketDataInitPromise = null;
                    }
                })();
            }

            return this.marketDataInitPromise;
        }

        /**
         * Add profit display to a task card
         * @param {Element} taskNode - Task card DOM element
         */
        async addProfitToTask(taskNode) {
            try {
                // Check if game data is ready
                if (!dataManager.getInitClientData()) {
                    // Game data not ready - add to pending queue
                    this.pendingTaskNodes.add(taskNode);
                    return;
                }

                // Double-check we haven't already processed this task
                // (check again in case another async call beat us to it)
                if (taskNode.querySelector(selectors_js.TOOLASHA.TASK_PROFIT)) {
                    return;
                }

                // Parse task data from DOM
                const taskData = this.parseTaskData(taskNode);
                if (!taskData) {
                    return;
                }

                if (!expectedValueCalculator.isInitialized) {
                    const initialized = await this.ensureMarketDataInitialized();
                    if (!initialized || !expectedValueCalculator.isInitialized) {
                        this.pendingTaskNodes.add(taskNode);
                        this.displayLoadingState(taskNode, taskData);
                        return;
                    }
                }

                // Calculate profit
                const profitData = await calculateTaskProfit(taskData);

                // Don't show anything for combat tasks, but mark them so we detect rerolls
                if (profitData === null) {
                    // Add hidden marker for combat tasks to enable reroll detection
                    const combatMarker = document.createElement('div');
                    combatMarker.className = 'mwi-task-profit';
                    combatMarker.style.display = 'none';
                    combatMarker.dataset.taskKey = `${taskData.description}|${taskData.quantity}`;

                    const actionNode = taskNode.querySelector(selectors_js.GAME.TASK_ACTION);
                    if (actionNode) {
                        actionNode.appendChild(combatMarker);
                    }
                    return;
                }

                // Handle market data not loaded - add to pending queue
                if (
                    profitData.error === 'Market data not loaded' ||
                    (profitData.rewards && profitData.rewards.error === 'Market data not loaded')
                ) {
                    // Add to pending queue
                    this.pendingTaskNodes.add(taskNode);

                    // Show loading state instead of error
                    this.displayLoadingState(taskNode, taskData);
                    return;
                }

                // Check one more time before adding (another async call might have added it)
                if (taskNode.querySelector(selectors_js.TOOLASHA.TASK_PROFIT)) {
                    return;
                }

                // Display profit
                this.displayTaskProfit(taskNode, profitData);
            } catch (error) {
                console.error('[Task Profit Display] Failed to calculate profit:', error);

                // Display error state in UI
                this.displayErrorState(taskNode, 'Unable to calculate profit');

                // Remove from pending queue if present
                this.pendingTaskNodes.delete(taskNode);
            }
        }

        /**
         * Parse task data from DOM
         * @param {Element} taskNode - Task card DOM element
         * @returns {Object|null} {description, coinReward, taskTokenReward, quantity}
         */
        parseTaskData(taskNode) {
            // Get task description
            const nameNode = taskNode.querySelector(selectors_js.GAME.TASK_NAME_DIV);
            if (!nameNode) return null;

            const description = nameNode.textContent.trim();

            // Get quantity from progress (plain div with text "Progress: 0 / 1562")
            // Find all divs in taskInfo and look for the one containing "Progress:"
            let quantity = 0;
            let currentProgress = 0;
            const taskInfoDivs = taskNode.querySelectorAll('div');
            for (const div of taskInfoDivs) {
                const text = div.textContent.trim();
                if (text.startsWith('Progress:')) {
                    const match = text.match(REGEX_TASK_PROGRESS);
                    if (match) {
                        currentProgress = parseInt(match[1]); // Current progress
                        quantity = parseInt(match[2]); // Total quantity
                    }
                    break;
                }
            }

            // Get rewards
            const rewardsNode = taskNode.querySelector(selectors_js.GAME.TASK_REWARDS);
            if (!rewardsNode) return null;

            let coinReward = 0;
            let taskTokenReward = 0;

            const itemContainers = rewardsNode.querySelectorAll(selectors_js.GAME.ITEM_CONTAINER);

            for (const container of itemContainers) {
                const useElement = container.querySelector('use');
                if (!useElement) continue;

                const href = useElement.href.baseVal;

                if (href.includes('coin')) {
                    const countNode = container.querySelector(selectors_js.GAME.ITEM_COUNT);
                    if (countNode) {
                        coinReward = this.parseItemCount(countNode.textContent);
                    }
                } else if (href.includes('task_token')) {
                    const countNode = container.querySelector(selectors_js.GAME.ITEM_COUNT);
                    if (countNode) {
                        taskTokenReward = this.parseItemCount(countNode.textContent);
                    }
                }
            }

            const taskData = {
                description,
                coinReward,
                taskTokenReward,
                quantity,
                currentProgress,
            };

            return taskData;
        }

        /**
         * Parse item count from text (handles K/M suffixes)
         * @param {string} text - Count text (e.g., "1.5K")
         * @returns {number} Parsed count
         */
        parseItemCount(text) {
            text = text.trim();

            if (text.includes('K')) {
                return parseFloat(text.replace('K', '')) * 1000;
            } else if (text.includes('M')) {
                return parseFloat(text.replace('M', '')) * 1000000;
            }

            return parseFloat(text) || 0;
        }

        /**
         * Display profit on task card
         * @param {Element} taskNode - Task card DOM element
         * @param {Object} profitData - Profit calculation result
         */
        displayTaskProfit(taskNode, profitData) {
            const actionNode = taskNode.querySelector(selectors_js.GAME.TASK_ACTION);
            if (!actionNode) return;

            // Create profit container
            const profitContainer = document.createElement('div');
            profitContainer.className = 'mwi-task-profit';
            profitContainer.style.cssText = `
            margin-top: 4px;
            font-size: 0.75rem;
        `;

            // Store task key for reroll detection
            if (profitData.taskInfo) {
                const taskKey = `${profitData.taskInfo.description}|${profitData.taskInfo.quantity}`;
                profitContainer.dataset.taskKey = taskKey;
            }

            // Check for error state
            if (profitData.error) {
                profitContainer.innerHTML = `
                <div style="color: ${config.SCRIPT_COLOR_ALERT};">
                    Unable to calculate profit
                </div>
            `;
                actionNode.appendChild(profitContainer);
                return;
            }

            // Calculate time estimate for task completion
            const completionSeconds = calculateTaskCompletionSeconds(profitData);
            const timeEstimate = completionSeconds !== null ? formatters_js.timeReadable(completionSeconds) : '???';

            // Create main profit display (Option B format: compact with time)
            const profitLine = document.createElement('div');
            profitLine.style.cssText = `
            color: ${config.COLOR_ACCENT};
            cursor: pointer;
            user-select: none;
        `;
            const totalProfitLabel = profitData.hasMissingPrices ? '-- ⚠' : formatters_js.numberFormatter(profitData.totalProfit);
            profitLine.innerHTML = `💰 ${totalProfitLabel} | <span style="display: inline-block; margin-right: 0.25em;">⏱</span> ${timeEstimate} ▸`;

            // Create breakdown section (hidden by default)
            const breakdownSection = document.createElement('div');
            breakdownSection.className = 'mwi-task-profit-breakdown';
            breakdownSection.style.cssText = `
            display: none;
            margin-top: 6px;
            padding: 8px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 4px;
            font-size: 0.7rem;
            color: #ddd;
        `;

            // Build breakdown HTML
            breakdownSection.innerHTML = this.buildBreakdownHTML(profitData);

            // Store listener references for cleanup
            const listeners = new Map();

            // Add click handlers for expandable sections
            breakdownSection.querySelectorAll('.mwi-expandable-header').forEach((header) => {
                const listener = (e) => {
                    e.stopPropagation();
                    const section = header.getAttribute('data-section');
                    const detailSection = breakdownSection.querySelector(
                        `.mwi-expandable-section[data-section="${section}"]`
                    );

                    if (detailSection) {
                        const isHidden = detailSection.style.display === 'none';
                        detailSection.style.display = isHidden ? 'block' : 'none';

                        // Update arrow
                        const currentText = header.textContent;
                        header.textContent = currentText.replace(isHidden ? '▸' : '▾', isHidden ? '▾' : '▸');
                    }
                };

                header.addEventListener('click', listener);
                listeners.set(header, listener);
            });

            // Toggle breakdown on click
            const profitLineListener = (e) => {
                e.stopPropagation();
                const isHidden = breakdownSection.style.display === 'none';
                breakdownSection.style.display = isHidden ? 'block' : 'none';
                const updatedProfitLabel = profitData.hasMissingPrices ? '-- ⚠' : formatters_js.numberFormatter(profitData.totalProfit);
                profitLine.innerHTML = `💰 ${updatedProfitLabel} | <span style="display: inline-block; margin-right: 0.25em;">⏱</span> ${timeEstimate} ${isHidden ? '▾' : '▸'}`;
            };

            profitLine.addEventListener('click', profitLineListener);
            listeners.set(profitLine, profitLineListener);

            // Store all listeners for cleanup
            this.eventListeners.set(profitContainer, listeners);

            profitContainer.appendChild(profitLine);

            profitContainer.appendChild(breakdownSection);

            if (config.getSetting('taskEfficiencyRating')) {
                const ratingMode = config.getSettingValue('taskEfficiencyRatingMode', RATING_MODE_TOKENS);
                const ratingData = calculateTaskEfficiencyRating(profitData, ratingMode);
                const ratingLine = document.createElement('div');
                ratingLine.className = 'mwi-task-profit-rating';
                ratingLine.style.cssText = 'margin-top: 2px; font-size: 0.7rem;';

                if (!ratingData || ratingData.value === null) {
                    const warningText = ratingData?.error ? ' ⚠' : '';
                    ratingLine.style.color = config.COLOR_WARNING;
                    ratingLine.textContent = `⚡ --${warningText} ${ratingData?.unitLabel || ''}`.trim();
                } else {
                    const ratingValue = formatters_js.numberFormatter(ratingData.value, 2);
                    ratingLine.dataset.ratingValue = `${ratingData.value}`;
                    ratingLine.dataset.ratingMode = ratingMode;
                    ratingLine.style.color = config.COLOR_ACCENT;
                    ratingLine.textContent = `⚡ ${ratingValue} ${ratingData.unitLabel}`;
                }

                profitContainer.appendChild(ratingLine);
            }
            actionNode.appendChild(profitContainer);

            this.updateEfficiencyGradientColors();
        }

        /**
         * Update efficiency rating colors based on relative performance
         */
        updateEfficiencyGradientColors() {
            const ratingMode = config.getSettingValue('taskEfficiencyRatingMode', RATING_MODE_TOKENS);
            const ratingLines = Array.from(document.querySelectorAll('.mwi-task-profit-rating')).filter((line) => {
                return line.dataset.ratingMode === ratingMode && line.dataset.ratingValue;
            });

            if (ratingLines.length === 0) {
                return;
            }

            const ratingValues = ratingLines
                .map((line) => Number.parseFloat(line.dataset.ratingValue))
                .filter((value) => Number.isFinite(value));

            if (ratingValues.length === 0) {
                return;
            }

            if (!config.getSetting('taskEfficiencyGradient')) {
                ratingLines.forEach((line) => {
                    line.style.color = config.COLOR_ACCENT;
                });
                return;
            }

            if (ratingValues.length === 1) {
                ratingLines.forEach((line) => {
                    line.style.color = config.COLOR_ACCENT;
                });
                return;
            }

            const sortedValues = [...ratingValues].sort((a, b) => a - b);
            const lastIndex = sortedValues.length - 1;
            const percentileLookup = new Map();
            const resolvedPercentile = (value) => {
                if (percentileLookup.has(value)) {
                    return percentileLookup.get(value);
                }

                const firstIndex = sortedValues.indexOf(value);
                const lastValueIndex = sortedValues.lastIndexOf(value);
                const averageRank = (firstIndex + lastValueIndex) / 2;
                const percentile = lastIndex > 0 ? averageRank / lastIndex : 1;
                percentileLookup.set(value, percentile);
                return percentile;
            };

            ratingLines.forEach((line) => {
                const value = Number.parseFloat(line.dataset.ratingValue);
                const percentile = resolvedPercentile(value);
                line.style.color = getRelativeEfficiencyGradientColor(
                    percentile,
                    0,
                    1,
                    config.COLOR_LOSS,
                    config.COLOR_ACCENT,
                    config.COLOR_ACCENT
                );
            });
        }

        /**
         * Build breakdown HTML
         * @param {Object} profitData - Profit calculation result
         * @returns {string} HTML string
         */
        buildBreakdownHTML(profitData) {
            const lines = [];
            const showTotals = !profitData.hasMissingPrices;
            const formatTotalValue = (value) => (showTotals ? formatters_js.numberFormatter(value) : '-- ⚠');
            const formatPerActionValue = (value) => (showTotals ? formatters_js.numberFormatter(value.toFixed(0)) : '-- ⚠');

            lines.push('<div style="font-weight: bold; margin-bottom: 4px;">Task Profit Breakdown</div>');
            lines.push('<div style="border-bottom: 1px solid #555; margin-bottom: 4px;"></div>');

            // Show warning if market data unavailable
            if (profitData.rewards.error) {
                lines.push(
                    `<div style="color: ${config.SCRIPT_COLOR_ALERT}; margin-bottom: 6px; font-style: italic;">⚠ ${profitData.rewards.error} - Token values unavailable</div>`
                );
            }

            // Task Rewards section
            lines.push('<div style="margin-bottom: 4px; color: #aaa;">Task Rewards:</div>');
            lines.push(`<div style="margin-left: 10px;">Coins: ${formatters_js.numberFormatter(profitData.rewards.coins)}</div>`);

            if (!profitData.rewards.error) {
                lines.push(
                    `<div style="margin-left: 10px;">Task Tokens: ${formatters_js.numberFormatter(profitData.rewards.taskTokens)}</div>`
                );
                lines.push(
                    `<div style="margin-left: 20px; font-size: 0.65rem; color: #888;">(${profitData.rewards.breakdown.tokensReceived} tokens @ ${formatters_js.numberFormatter(profitData.rewards.breakdown.tokenValue.toFixed(0))} each)</div>`
                );
                lines.push(
                    `<div style="margin-left: 10px;">Purple's Gift: ${formatters_js.numberFormatter(profitData.rewards.purpleGift)}</div>`
                );
                lines.push(
                    `<div style="margin-left: 20px; font-size: 0.65rem; color: #888;">(${formatters_js.numberFormatter(profitData.rewards.breakdown.giftPerTask.toFixed(0))} per task)</div>`
                );
            } else {
                lines.push(
                    `<div style="margin-left: 10px; color: #888; font-style: italic;">Task Tokens: Loading...</div>`
                );
                lines.push(
                    `<div style="margin-left: 10px; color: #888; font-style: italic;">Purple's Gift: Loading...</div>`
                );
            }
            // Action profit section
            lines.push('<div style="margin-top: 6px; margin-bottom: 4px; color: #aaa;">Action Profit:</div>');

            if (profitData.type === 'gathering') {
                // Gathering Value (expandable)
                lines.push(
                    `<div class="mwi-expandable-header" data-section="gathering" style="margin-left: 10px; cursor: pointer; user-select: none;">Gathering Value: ${formatTotalValue(profitData.action.totalValue)} ▸</div>`
                );
                lines.push(
                    `<div class="mwi-expandable-section" data-section="gathering" style="display: none; margin-left: 20px; font-size: 0.65rem; color: #888; margin-top: 2px;">`
                );

                if (profitData.action.details) {
                    const details = profitData.action.details;
                    const quantity = profitData.action.breakdown.quantity;
                    const actionsPerHour = details.actionsPerHour;

                    // Primary output (base + gourmet + processing)
                    if (details.baseOutputs && details.baseOutputs.length > 0) {
                        const baseRevenueTotal = details.baseOutputs.reduce((sum, output) => {
                            const revenuePerAction = output.revenuePerAction ?? output.revenuePerHour / actionsPerHour;
                            return sum + revenuePerAction * quantity;
                        }, 0);
                        const gourmetRevenueTotal = (details.gourmetRevenueBonusPerAction || 0) * quantity;
                        const processingRevenueTotal = (details.processingRevenueBonusPerAction || 0) * quantity;
                        const primaryOutputTotal = baseRevenueTotal + gourmetRevenueTotal + processingRevenueTotal;
                        lines.push(
                            `<div style="margin-top: 2px; color: #aaa;">Primary Outputs: ${formatTotalValue(Math.round(primaryOutputTotal))}</div>`
                        );
                        for (const output of details.baseOutputs) {
                            const itemsPerAction = output.itemsPerAction ?? output.itemsPerHour / actionsPerHour;
                            const revenuePerAction = output.revenuePerAction ?? output.revenuePerHour / actionsPerHour;
                            const itemsForTask = itemsPerAction * quantity;
                            const revenueForTask = revenuePerAction * quantity;
                            const dropRateText =
                                output.dropRate < 1.0 ? ` (${formatters_js.formatPercentage(output.dropRate, 1)} drop)` : '';
                            const missingPriceNote = output.missingPrice ? ' ⚠' : '';
                            lines.push(
                                `<div>• ${output.name} (Base): ${itemsForTask.toFixed(1)} items @ ${formatters_js.numberFormatter(Math.round(output.priceEach))}${missingPriceNote} = ${formatters_js.numberFormatter(Math.round(revenueForTask))}${dropRateText}</div>`
                            );
                        }
                    }

                    if (details.gourmetBonuses && details.gourmetBonuses.length > 0) {
                        for (const output of details.gourmetBonuses) {
                            const itemsPerAction = output.itemsPerAction ?? output.itemsPerHour / actionsPerHour;
                            const revenuePerAction = output.revenuePerAction ?? output.revenuePerHour / actionsPerHour;
                            const itemsForTask = itemsPerAction * quantity;
                            const revenueForTask = revenuePerAction * quantity;
                            const missingPriceNote = output.missingPrice ? ' ⚠' : '';
                            lines.push(
                                `<div>• ${output.name} (Gourmet ${formatters_js.formatPercentage(details.gourmetBonus || 0, 1)}): ${itemsForTask.toFixed(1)} items @ ${formatters_js.numberFormatter(Math.round(output.priceEach))}${missingPriceNote} = ${formatters_js.numberFormatter(Math.round(revenueForTask))}</div>`
                            );
                        }
                    }

                    if (details.processingConversions && details.processingConversions.length > 0) {
                        const processingBonusTotal = (details.processingRevenueBonusPerAction || 0) * quantity;
                        const processingLabel = `${processingBonusTotal >= 0 ? '+' : '-'}${formatters_js.numberFormatter(Math.abs(Math.round(processingBonusTotal)))}`;
                        lines.push(
                            `<div>• Processing (${formatters_js.formatPercentage(details.processingBonus || 0, 1)} proc): Net ${processingLabel}</div>`
                        );

                        for (const conversion of details.processingConversions) {
                            const conversionsPerAction =
                                conversion.conversionsPerAction ?? conversion.conversionsPerHour / actionsPerHour;
                            const rawConsumedPerAction =
                                conversion.rawConsumedPerAction ?? conversion.rawConsumedPerHour / actionsPerHour;
                            const totalConsumed = rawConsumedPerAction * quantity;
                            const totalProduced = conversionsPerAction * quantity;
                            const consumedRevenue = totalConsumed * conversion.rawPriceEach;
                            const producedRevenue = totalProduced * conversion.processedPriceEach;
                            const missingPriceNote = conversion.missingPrice ? ' ⚠' : '';
                            lines.push(
                                `<div style="margin-left: 10px;">• ${conversion.rawItem} consumed: -${totalConsumed.toFixed(1)} items @ ${formatters_js.numberFormatter(Math.round(conversion.rawPriceEach))}${missingPriceNote} = -${formatters_js.numberFormatter(Math.round(consumedRevenue))}</div>`
                            );
                            lines.push(
                                `<div style="margin-left: 10px;">• ${conversion.processedItem} produced: ${totalProduced.toFixed(1)} items @ ${formatters_js.numberFormatter(Math.round(conversion.processedPriceEach))}${missingPriceNote} = ${formatters_js.numberFormatter(Math.round(producedRevenue))}</div>`
                            );
                        }
                    }

                    // Bonus Revenue (essence and rare finds)
                    if (
                        details.bonusRevenue &&
                        details.bonusRevenue.bonusDrops &&
                        details.bonusRevenue.bonusDrops.length > 0
                    ) {
                        const bonusRevenue = details.bonusRevenue;
                        const essenceDrops = bonusRevenue.bonusDrops.filter((d) => d.type === 'essence');
                        const rareFindDrops = bonusRevenue.bonusDrops.filter((d) => d.type === 'rare_find');

                        if (essenceDrops.length > 0) {
                            const totalEssenceRevenue = essenceDrops.reduce(
                                (sum, drop) => sum + (drop.revenuePerAction || 0) * quantity,
                                0
                            );
                            lines.push(
                                `<div style="margin-top: 4px; color: #aaa;">Essence Drops: ${formatTotalValue(Math.round(totalEssenceRevenue))}</div>`
                            );
                            for (const drop of essenceDrops) {
                                const dropsForTask = (drop.dropsPerAction || 0) * quantity;
                                const revenueForTask = (drop.revenuePerAction || 0) * quantity;
                                const missingPriceNote = drop.missingPrice ? ' ⚠' : '';
                                lines.push(
                                    `<div>• ${drop.itemName}: ${dropsForTask.toFixed(2)} drops @ ${formatters_js.numberFormatter(Math.round(drop.priceEach))}${missingPriceNote} = ${formatters_js.numberFormatter(Math.round(revenueForTask))}</div>`
                                );
                            }
                        }

                        if (rareFindDrops.length > 0) {
                            const totalRareRevenue = rareFindDrops.reduce(
                                (sum, drop) => sum + (drop.revenuePerAction || 0) * quantity,
                                0
                            );
                            lines.push(
                                `<div style="margin-top: 4px; color: #aaa;">Rare Finds: ${formatTotalValue(Math.round(totalRareRevenue))}</div>`
                            );
                            for (const drop of rareFindDrops) {
                                const dropsForTask = (drop.dropsPerAction || 0) * quantity;
                                const revenueForTask = (drop.revenuePerAction || 0) * quantity;
                                const missingPriceNote = drop.missingPrice ? ' ⚠' : '';
                                lines.push(
                                    `<div>• ${drop.itemName}: ${dropsForTask.toFixed(2)} drops @ ${formatters_js.numberFormatter(Math.round(drop.priceEach))}${missingPriceNote} = ${formatters_js.numberFormatter(Math.round(revenueForTask))}</div>`
                                );
                            }
                        }
                    }
                }

                lines.push(`</div>`);
                lines.push(
                    `<div style="margin-left: 20px; font-size: 0.65rem; color: #888;">(${profitData.action.breakdown.quantity}× @ ${formatPerActionValue(profitData.action.breakdown.perAction)} each)</div>`
                );
            } else if (profitData.type === 'production') {
                const details = profitData.action.details;
                const bonusDrops = details?.bonusRevenue?.bonusDrops || [];
                const netProductionValue = profitData.action.totalProfit;

                // Net Production (expandable)
                lines.push(
                    `<div class="mwi-expandable-header" data-section="production" style="margin-left: 10px; cursor: pointer; user-select: none;">Net Production: ${formatTotalValue(netProductionValue)} ▸</div>`
                );
                lines.push(
                    `<div class="mwi-expandable-section" data-section="production" style="display: none; margin-left: 20px; font-size: 0.65rem; color: #888; margin-top: 2px;">`
                );

                if (details) {
                    const outputAmount = details.outputAmount || 1;
                    const totalItems = outputAmount * profitData.action.breakdown.quantity;
                    const outputPriceNote = details.outputPriceMissing ? ' ⚠' : '';
                    const baseRevenueTotal = totalItems * details.priceEach;
                    const gourmetRevenueTotal = details.gourmetBonus
                        ? outputAmount * details.gourmetBonus * profitData.action.breakdown.quantity * details.priceEach
                        : 0;
                    const primaryOutputTotal = baseRevenueTotal + gourmetRevenueTotal;

                    lines.push(
                        `<div style="margin-top: 2px; color: #aaa;">Primary Outputs: ${formatTotalValue(Math.round(primaryOutputTotal))}</div>`
                    );

                    lines.push(
                        `<div>• ${details.itemName} (Base): ${totalItems.toFixed(1)} items @ ${formatters_js.numberFormatter(details.priceEach)}${outputPriceNote} = ${formatters_js.numberFormatter(Math.round(totalItems * details.priceEach))}</div>`
                    );

                    if (details.gourmetBonus > 0) {
                        const bonusItems = outputAmount * details.gourmetBonus * profitData.action.breakdown.quantity;
                        lines.push(
                            `<div>• ${details.itemName} (Gourmet +${formatters_js.formatPercentage(details.gourmetBonus, 1)}): ${bonusItems.toFixed(1)} items @ ${formatters_js.numberFormatter(details.priceEach)}${outputPriceNote} = ${formatters_js.numberFormatter(Math.round(bonusItems * details.priceEach))}</div>`
                        );
                    }
                }

                if (bonusDrops.length > 0) {
                    const essenceDrops = bonusDrops.filter((d) => d.type === 'essence');
                    const rareFindDrops = bonusDrops.filter((d) => d.type === 'rare_find');

                    if (essenceDrops.length > 0) {
                        const totalEssenceRevenue = essenceDrops.reduce(
                            (sum, drop) => sum + (drop.revenuePerAction || 0) * profitData.action.breakdown.quantity,
                            0
                        );
                        lines.push(
                            `<div style="margin-top: 4px; color: #aaa;">Essence Drops: ${formatTotalValue(Math.round(totalEssenceRevenue))}</div>`
                        );
                        for (const drop of essenceDrops) {
                            const dropsForTask = (drop.dropsPerAction || 0) * profitData.action.breakdown.quantity;
                            const revenueForTask = (drop.revenuePerAction || 0) * profitData.action.breakdown.quantity;
                            const missingPriceNote = drop.missingPrice ? ' ⚠' : '';
                            lines.push(
                                `<div>• ${drop.itemName}: ${dropsForTask.toFixed(2)} drops @ ${formatters_js.numberFormatter(Math.round(drop.priceEach))}${missingPriceNote} = ${formatters_js.numberFormatter(Math.round(revenueForTask))}</div>`
                            );
                        }
                    }

                    if (rareFindDrops.length > 0) {
                        const totalRareRevenue = rareFindDrops.reduce(
                            (sum, drop) => sum + (drop.revenuePerAction || 0) * profitData.action.breakdown.quantity,
                            0
                        );
                        lines.push(
                            `<div style="margin-top: 4px; color: #aaa;">Rare Finds: ${formatTotalValue(Math.round(totalRareRevenue))}</div>`
                        );
                        for (const drop of rareFindDrops) {
                            const dropsForTask = (drop.dropsPerAction || 0) * profitData.action.breakdown.quantity;
                            const revenueForTask = (drop.revenuePerAction || 0) * profitData.action.breakdown.quantity;
                            const missingPriceNote = drop.missingPrice ? ' ⚠' : '';
                            lines.push(
                                `<div>• ${drop.itemName}: ${dropsForTask.toFixed(2)} drops @ ${formatters_js.numberFormatter(Math.round(drop.priceEach))}${missingPriceNote} = ${formatters_js.numberFormatter(Math.round(revenueForTask))}</div>`
                            );
                        }
                    }
                }

                if (details?.materialCosts) {
                    const actionsNeeded = profitData.action.breakdown.quantity;
                    const hoursNeeded = actionsNeeded / (details.actionsPerHour * (details.efficiencyMultiplier || 1));
                    lines.push(
                        `<div style="margin-top: 4px; color: #aaa;">Material Costs: ${formatTotalValue(profitData.action.breakdown.materialCost)}</div>`
                    );

                    for (const mat of details.materialCosts) {
                        const totalAmount = mat.amount * actionsNeeded;
                        const totalCost = mat.totalCost * actionsNeeded;
                        const missingPriceNote = mat.missingPrice ? ' ⚠' : '';
                        lines.push(
                            `<div>• ${mat.itemName}: ${totalAmount.toFixed(1)} @ ${formatters_js.numberFormatter(Math.round(mat.askPrice))}${missingPriceNote} = ${formatters_js.numberFormatter(Math.round(totalCost))}</div>`
                        );
                    }

                    if (details.teaCosts && details.teaCosts.length > 0) {
                        for (const tea of details.teaCosts) {
                            const drinksNeeded = tea.drinksPerHour * hoursNeeded;
                            const totalCost = tea.totalCost * hoursNeeded;
                            const missingPriceNote = tea.missingPrice ? ' ⚠' : '';
                            lines.push(
                                `<div>• ${tea.itemName}: ${drinksNeeded.toFixed(1)} drinks @ ${formatters_js.numberFormatter(Math.round(tea.pricePerDrink))}${missingPriceNote} = ${formatters_js.numberFormatter(Math.round(totalCost))}</div>`
                            );
                        }
                    }
                }

                lines.push(`</div>`);

                // Net Production now shown in header
                lines.push(
                    `<div style="margin-left: 20px; font-size: 0.65rem; color: #888;">(${profitData.action.breakdown.quantity}× @ ${formatPerActionValue(profitData.action.breakdown.perAction)} each)</div>`
                );
            }

            // Total
            lines.push('<div style="border-top: 1px solid #555; margin-top: 6px; padding-top: 4px;"></div>');
            lines.push(
                `<div style="font-weight: bold; color: ${config.COLOR_ACCENT};">Total Profit: ${formatTotalValue(profitData.totalProfit)}</div>`
            );

            return lines.join('');
        }

        /**
         * Display error state when profit calculation fails
         * @param {Element} taskNode - Task card DOM element
         * @param {string} message - Error message to display
         */
        displayErrorState(taskNode, message) {
            const actionNode = taskNode.querySelector(selectors_js.GAME.TASK_ACTION);
            if (!actionNode) return;

            // Create error container
            const errorContainer = document.createElement('div');
            errorContainer.className = 'mwi-task-profit mwi-task-profit-error';
            errorContainer.style.cssText = `
            margin-top: 4px;
            font-size: 0.75rem;
            color: ${config.SCRIPT_COLOR_ALERT};
            font-style: italic;
        `;
            errorContainer.textContent = `⚠ ${message}`;

            actionNode.appendChild(errorContainer);
        }

        /**
         * Display loading state while waiting for market data
         * @param {Element} taskNode - Task card DOM element
         * @param {Object} taskData - Task data for reroll detection
         */
        displayLoadingState(taskNode, taskData) {
            const actionNode = taskNode.querySelector(selectors_js.GAME.TASK_ACTION);
            if (!actionNode) return;

            // Create loading container
            const loadingContainer = document.createElement('div');
            loadingContainer.className = 'mwi-task-profit mwi-task-profit-loading';
            loadingContainer.style.cssText = `
            margin-top: 4px;
            font-size: 0.75rem;
            color: #888;
            font-style: italic;
        `;
            loadingContainer.textContent = '⏳ Loading market data...';

            // Store task key for reroll detection
            const taskKey = `${taskData.description}|${taskData.quantity}`;
            loadingContainer.dataset.taskKey = taskKey;

            actionNode.appendChild(loadingContainer);
        }

        /**
         * Refresh colors on existing task profit displays
         */
        refresh() {
            // Update all profit line colors
            const profitLines = document.querySelectorAll('.mwi-task-profit > div:first-child');
            profitLines.forEach((line) => {
                line.style.color = config.COLOR_ACCENT;
            });

            // Update all total profit colors in breakdowns
            const totalProfits = document.querySelectorAll('.mwi-task-profit-breakdown > div:last-child');
            totalProfits.forEach((total) => {
                total.style.color = config.COLOR_ACCENT;
            });
        }

        /**
         * Disable the feature
         */
        disable() {
            this.unregisterHandlers.forEach((unregister) => unregister());
            this.unregisterHandlers = [];

            if (this.retryHandler) {
                dataManager.off('character_initialized', this.retryHandler);
                this.retryHandler = null;
            }

            if (this.marketDataRetryHandler) {
                dataManager.off('expected_value_initialized', this.marketDataRetryHandler);
                this.marketDataRetryHandler = null;
            }

            // Clear pending tasks
            this.pendingTaskNodes.clear();

            // Clean up event listeners before removing profit displays
            document.querySelectorAll(selectors_js.TOOLASHA.TASK_PROFIT).forEach((el) => {
                const listeners = this.eventListeners.get(el);
                if (listeners) {
                    listeners.forEach((listener, element) => {
                        element.removeEventListener('click', listener);
                    });
                    this.eventListeners.delete(el);
                }
                el.remove();
            });

            this.isActive = false;
            this.isInitialized = false;
        }
    }

    const taskProfitDisplay = new TaskProfitDisplay();
    taskProfitDisplay.setupSettingListener();

    /**
     * Task Reroll Cost Tracker
     * Tracks and displays reroll costs for tasks using WebSocket messages
     */


    class TaskRerollTracker {
        constructor() {
            this.taskRerollData = new Map(); // key: taskId, value: { coinRerollCount, cowbellRerollCount }
            this.unregisterHandlers = [];
            this.isInitialized = false;
            this.storeName = 'rerollSpending';
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
        }

        /**
         * Initialize the tracker
         */
        async initialize() {
            if (this.isInitialized) return;

            // Load saved data from IndexedDB
            await this.loadFromStorage();

            // Register WebSocket listener
            this.registerWebSocketListeners();

            // Register DOM observer for display updates
            this.registerDOMObservers();

            this.isInitialized = true;
        }

        /**
         * Load task reroll data from IndexedDB
         */
        async loadFromStorage() {
            try {
                const savedData = await storage.getJSON('taskRerollData', this.storeName, {});

                // Convert saved object back to Map
                for (const [taskId, data] of Object.entries(savedData)) {
                    this.taskRerollData.set(parseInt(taskId), data);
                }
            } catch (error) {
                console.error('[Task Reroll Tracker] Failed to load from storage:', error);
            }
        }

        /**
         * Save task reroll data to IndexedDB
         */
        async saveToStorage() {
            try {
                // Convert Map to plain object for storage
                const dataToSave = {};
                for (const [taskId, data] of this.taskRerollData.entries()) {
                    dataToSave[taskId] = data;
                }

                await storage.setJSON('taskRerollData', dataToSave, this.storeName, true);
            } catch (error) {
                console.error('[Task Reroll Tracker] Failed to save to storage:', error);
            }
        }

        /**
         * Clean up observers and handlers
         */
        cleanup() {
            this.unregisterHandlers.forEach((unregister) => unregister());
            this.unregisterHandlers = [];
            this.timerRegistry.clearAll();
            this.isInitialized = false;
        }

        disable() {
            this.cleanup();
        }

        /**
         * Clean up old task data that's no longer active
         * Keeps only tasks that are currently in characterQuests
         */
        cleanupOldTasks() {
            if (!dataManager.characterData || !dataManager.characterData.characterQuests) {
                return;
            }

            const activeTaskIds = new Set(dataManager.characterData.characterQuests.map((quest) => quest.id));

            let hasChanges = false;

            // Remove tasks that are no longer active
            for (const taskId of this.taskRerollData.keys()) {
                if (!activeTaskIds.has(taskId)) {
                    this.taskRerollData.delete(taskId);
                    hasChanges = true;
                }
            }

            if (hasChanges) {
                this.saveToStorage();
            }
        }

        /**
         * Register WebSocket message listeners
         */
        registerWebSocketListeners() {
            const questsHandler = (data) => {
                if (!data.endCharacterQuests) {
                    return;
                }

                let hasChanges = false;

                // Update our task reroll data from server data
                for (const quest of data.endCharacterQuests) {
                    const existingData = this.taskRerollData.get(quest.id);
                    const newCoinCount = quest.coinRerollCount || 0;
                    const newCowbellCount = quest.cowbellRerollCount || 0;

                    // Only update if counts increased or task is new
                    if (
                        !existingData ||
                        newCoinCount > existingData.coinRerollCount ||
                        newCowbellCount > existingData.cowbellRerollCount
                    ) {
                        this.taskRerollData.set(quest.id, {
                            coinRerollCount: Math.max(existingData?.coinRerollCount || 0, newCoinCount),
                            cowbellRerollCount: Math.max(existingData?.cowbellRerollCount || 0, newCowbellCount),
                            monsterHrid: quest.monsterHrid || '',
                            actionHrid: quest.actionHrid || '',
                            goalCount: quest.goalCount || 0,
                        });
                        hasChanges = true;
                    }
                }

                // Save to storage if data changed
                if (hasChanges) {
                    this.saveToStorage();
                }

                // Clean up old tasks periodically (every 10th update)
                if (Math.random() < 0.1) {
                    this.cleanupOldTasks();
                }

                // Wait for game to update DOM before updating displays
                const updateTimeout = setTimeout(() => {
                    this.updateAllTaskDisplays();
                }, 250);
                this.timerRegistry.registerTimeout(updateTimeout);
            };

            webSocketHook.on('quests_updated', questsHandler);

            this.unregisterHandlers.push(() => {
                webSocketHook.off('quests_updated', questsHandler);
            });

            // Load existing quest data from DataManager (which receives init_character_data early)
            const initHandler = (data) => {
                if (!data.characterQuests) {
                    return;
                }

                let hasChanges = false;

                // Load all quest data into the map
                for (const quest of data.characterQuests) {
                    const existingData = this.taskRerollData.get(quest.id);
                    const newCoinCount = quest.coinRerollCount || 0;
                    const newCowbellCount = quest.cowbellRerollCount || 0;

                    // Only update if counts increased or task is new
                    if (
                        !existingData ||
                        newCoinCount > existingData.coinRerollCount ||
                        newCowbellCount > existingData.cowbellRerollCount
                    ) {
                        this.taskRerollData.set(quest.id, {
                            coinRerollCount: Math.max(existingData?.coinRerollCount || 0, newCoinCount),
                            cowbellRerollCount: Math.max(existingData?.cowbellRerollCount || 0, newCowbellCount),
                            monsterHrid: quest.monsterHrid || '',
                            actionHrid: quest.actionHrid || '',
                            goalCount: quest.goalCount || 0,
                        });
                        hasChanges = true;
                    }
                }

                // Save to storage if data changed
                if (hasChanges) {
                    this.saveToStorage();
                }

                // Clean up old tasks after loading character data
                this.cleanupOldTasks();

                // Wait for DOM to be ready before updating displays
                const initTimeout = setTimeout(() => {
                    this.updateAllTaskDisplays();
                }, 500);
                this.timerRegistry.registerTimeout(initTimeout);
            };

            dataManager.on('character_initialized', initHandler);

            // Check if character data already loaded (in case we missed the event)
            if (dataManager.characterData && dataManager.characterData.characterQuests) {
                initHandler(dataManager.characterData);
            }

            this.unregisterHandlers.push(() => {
                dataManager.off('character_initialized', initHandler);
            });
        }

        /**
         * Register DOM observers for display updates
         */
        registerDOMObservers() {
            // Watch for task list appearing
            const unregisterTaskList = domObserver.onClass('TaskRerollTracker-TaskList', 'TasksPanel_taskList', () => {
                this.updateAllTaskDisplays();
            });
            this.unregisterHandlers.push(unregisterTaskList);

            // Watch for individual tasks appearing
            const unregisterTask = domObserver.onClass('TaskRerollTracker-Task', 'RandomTask_randomTask', () => {
                // Small delay to let task data settle
                const taskTimeout = setTimeout(() => this.updateAllTaskDisplays(), 100);
                this.timerRegistry.registerTimeout(taskTimeout);
            });
            this.unregisterHandlers.push(unregisterTask);
        }

        /**
         * Calculate cumulative gold spent from coin reroll count
         * Formula: 10K, 20K, 40K, 80K, 160K, 320K (doubles, caps at 320K)
         * @param {number} rerollCount - Number of gold rerolls
         * @returns {number} Total gold spent
         */
        calculateGoldSpent(rerollCount) {
            if (rerollCount === 0) return 0;

            let total = 0;
            let cost = 10000; // Start at 10K

            for (let i = 0; i < rerollCount; i++) {
                total += cost;
                // Double the cost, but cap at 320K
                cost = Math.min(cost * 2, 320000);
            }

            return total;
        }

        /**
         * Calculate cumulative cowbells spent from cowbell reroll count
         * Formula: 1, 2, 4, 8, 16, 32 (doubles, caps at 32)
         * @param {number} rerollCount - Number of cowbell rerolls
         * @returns {number} Total cowbells spent
         */
        calculateCowbellSpent(rerollCount) {
            if (rerollCount === 0) return 0;

            let total = 0;
            let cost = 1; // Start at 1

            for (let i = 0; i < rerollCount; i++) {
                total += cost;
                // Double the cost, but cap at 32
                cost = Math.min(cost * 2, 32);
            }

            return total;
        }

        /**
         * Get task ID from DOM element by matching task description
         * @param {Element} taskElement - Task DOM element
         * @returns {number|null} Task ID or null if not found
         */
        getTaskIdFromElement(taskElement) {
            // Get task description and goal count from DOM
            const nameEl = taskElement.querySelector(selectors_js.GAME.TASK_NAME);
            const description = nameEl ? nameEl.textContent.trim() : '';

            if (!description) {
                return null;
            }

            // Get quantity from progress text
            const progressDivs = taskElement.querySelectorAll('div');
            let goalCount = 0;
            for (const div of progressDivs) {
                const text = div.textContent.trim();
                if (text.startsWith('Progress:')) {
                    const match = text.match(/Progress:\s*\d+\s*\/\s*(\d+)/);
                    if (match) {
                        goalCount = parseInt(match[1]);
                        break;
                    }
                }
            }

            // Match against stored task data
            for (const [taskId, taskData] of this.taskRerollData.entries()) {
                // Check if goal count matches
                if (taskData.goalCount !== goalCount) continue;

                // Extract monster/action name from description
                // Description format: "Kill X" or "Do action X times"
                const descLower = description.toLowerCase();

                // For monster tasks, check monsterHrid
                if (taskData.monsterHrid) {
                    const monsterName = taskData.monsterHrid.replace('/monsters/', '').replace(/_/g, ' ');
                    if (descLower.includes(monsterName.toLowerCase())) {
                        return taskId;
                    }
                }

                // For action tasks, check actionHrid
                if (taskData.actionHrid) {
                    const actionParts = taskData.actionHrid.split('/');
                    const actionName = actionParts[actionParts.length - 1].replace(/_/g, ' ');
                    if (descLower.includes(actionName.toLowerCase())) {
                        return taskId;
                    }
                }
            }

            return null;
        }

        /**
         * Update display for a specific task
         * @param {Element} taskElement - Task DOM element
         */
        updateTaskDisplay(taskElement) {
            const taskId = this.getTaskIdFromElement(taskElement);
            if (!taskId) {
                // Remove display if task not found in our data
                const existingDisplay = taskElement.querySelector('.mwi-reroll-cost-display');
                if (existingDisplay) {
                    existingDisplay.remove();
                }
                return;
            }

            const taskData = this.taskRerollData.get(taskId);
            if (!taskData) {
                return;
            }

            // Calculate totals
            const goldSpent = this.calculateGoldSpent(taskData.coinRerollCount);
            const cowbellSpent = this.calculateCowbellSpent(taskData.cowbellRerollCount);

            // Find or create display element
            let displayElement = taskElement.querySelector(selectors_js.TOOLASHA.REROLL_COST_DISPLAY);

            if (!displayElement) {
                displayElement = document.createElement('div');
                displayElement.className = 'mwi-reroll-cost-display';
                displayElement.style.cssText = `
                color: ${config.SCRIPT_COLOR_SECONDARY};
                font-size: 0.75rem;
                margin-top: 4px;
                padding: 2px 4px;
                border-radius: 3px;
                background: rgba(0, 0, 0, 0.3);
            `;

                // Insert at top of task card
                const taskContent = taskElement.querySelector(selectors_js.GAME.TASK_CONTENT);
                if (taskContent) {
                    taskContent.insertBefore(displayElement, taskContent.firstChild);
                } else {
                    taskElement.insertBefore(displayElement, taskElement.firstChild);
                }
            }

            // Format display text
            const parts = [];
            if (cowbellSpent > 0) {
                parts.push(`${cowbellSpent}🔔`);
            }
            if (goldSpent > 0) {
                parts.push(`${formatters_js.numberFormatter(goldSpent)}💰`);
            }

            if (parts.length > 0) {
                displayElement.textContent = `Reroll spent: ${parts.join(' + ')}`;
                displayElement.style.display = 'block';
            } else {
                displayElement.style.display = 'none';
            }
        }

        /**
         * Update all task displays
         */
        updateAllTaskDisplays() {
            const taskList = document.querySelector(selectors_js.GAME.TASK_LIST);
            if (!taskList) {
                return;
            }

            const allTasks = taskList.querySelectorAll(selectors_js.GAME.TASK_CARD);
            allTasks.forEach((task) => {
                this.updateTaskDisplay(task);
            });
        }
    }

    const taskRerollTracker = new TaskRerollTracker();

    /**
     * Task Icon Filters
     *
     * Adds clickable filter icons to the task panel header for controlling
     * which task icons are displayed. Based on MWI Task Manager implementation.
     *
     * Features:
     * - Battle icon toggle (shows/hides all combat task icons)
     * - Individual dungeon toggles (4 dungeons)
     * - Visual state indication (opacity 1.0 = active, 0.3 = inactive)
     * - Task count badges on each icon
     * - Persistent filter state across sessions
     * - Event-driven updates when filters change
     */


    const STORAGE_KEYS = {
        migration: 'taskIconsFiltersMigratedV1',
        battle: 'taskIconsFilterBattle',
        dungeonPrefix: 'taskIconsFilterDungeon:',
    };

    class TaskIconFilters {
        constructor() {
            this.filterIcons = new Map(); // Map of filter ID -> DOM element
            this.currentCounts = new Map(); // Map of filter ID -> task count
            this.taskListObserver = null;
            this.filterBar = null; // Reference to filter bar DOM element
            this.settingChangeHandler = null; // Handler for setting changes
            this.stateLoadPromise = null;
            this.isStateLoaded = false;
            this.state = {
                battle: true,
                dungeons: {},
            };

            // Dungeon configuration matching game data
            this.dungeonConfig = {
                '/actions/combat/chimerical_den': {
                    id: 'chimerical_den',
                    name: 'Chimerical Den',
                    spriteId: 'chimerical_den',
                },
                '/actions/combat/sinister_circus': {
                    id: 'sinister_circus',
                    name: 'Sinister Circus',
                    spriteId: 'sinister_circus',
                },
                '/actions/combat/enchanted_fortress': {
                    id: 'enchanted_fortress',
                    name: 'Enchanted Fortress',
                    spriteId: 'enchanted_fortress',
                },
                '/actions/combat/pirate_cove': {
                    id: 'pirate_cove',
                    name: 'Pirate Cove',
                    spriteId: 'pirate_cove',
                },
            };
        }

        /**
         * Initialize the task icon filters feature
         */
        initialize() {
            // Note: Filter bar is added by task-sorter.js when task panel appears

            this.loadState();

            // Listen for taskIconsDungeons setting changes
            this.settingChangeHandler = (enabled) => {
                if (this.filterBar) {
                    this.filterBar.style.display = enabled ? 'flex' : 'none';
                }
            };
            config.onSettingChange('taskIconsDungeons', this.settingChangeHandler);
        }

        async loadState() {
            if (this.stateLoadPromise) {
                return this.stateLoadPromise;
            }

            this.stateLoadPromise = this.loadStateInternal();
            return this.stateLoadPromise;
        }

        async loadStateInternal() {
            try {
                const migrated = await storage.get(STORAGE_KEYS.migration, 'settings', false);

                if (migrated) {
                    await this.loadStateFromStorage();
                } else {
                    this.loadStateFromLocalStorage();
                    const migrated = await this.persistStateToStorage();
                    if (migrated) {
                        await storage.set(STORAGE_KEYS.migration, true, 'settings', true);
                        this.clearLocalStorageState();
                    }
                }
            } catch (error) {
                console.error('[TaskIconFilters] Failed to load filter state:', error);
            } finally {
                this.isStateLoaded = true;
                this.updateAllIconStates();
                this.dispatchFilterChange('init');
            }
        }

        loadStateFromLocalStorage() {
            const storedBattle = localStorage.getItem('mwi-taskIconsFilterBattle');
            this.state.battle = storedBattle === null || storedBattle === 'true';

            Object.values(this.dungeonConfig).forEach((dungeon) => {
                const stored = localStorage.getItem(`mwi-taskIconsFilter-${dungeon.id}`);
                this.state.dungeons[dungeon.id] = stored === 'true';
            });
        }

        async loadStateFromStorage() {
            const storedBattle = await storage.get(STORAGE_KEYS.battle, 'settings', true);
            this.state.battle = storedBattle === true;

            const dungeonEntries = Object.values(this.dungeonConfig).map(async (dungeon) => {
                const key = `${STORAGE_KEYS.dungeonPrefix}${dungeon.id}`;
                const enabled = await storage.get(key, 'settings', false);
                return { id: dungeon.id, enabled: enabled === true };
            });

            const results = await Promise.all(dungeonEntries);
            results.forEach(({ id, enabled }) => {
                this.state.dungeons[id] = enabled;
            });
        }

        async persistStateToStorage() {
            const battleSaved = await storage.set(STORAGE_KEYS.battle, this.state.battle, 'settings', true);

            const dungeonWrites = Object.values(this.dungeonConfig).map((dungeon) => {
                const key = `${STORAGE_KEYS.dungeonPrefix}${dungeon.id}`;
                return storage.set(key, this.state.dungeons[dungeon.id] === true, 'settings', true);
            });

            const dungeonResults = await Promise.all(dungeonWrites);
            return battleSaved && dungeonResults.every(Boolean);
        }

        clearLocalStorageState() {
            localStorage.removeItem('mwi-taskIconsFilterBattle');
            Object.values(this.dungeonConfig).forEach((dungeon) => {
                localStorage.removeItem(`mwi-taskIconsFilter-${dungeon.id}`);
            });
        }

        /**
         * Cleanup when feature is disabled
         */
        cleanup() {
            // Remove setting change listener
            if (this.settingChangeHandler) {
                config.offSettingChange('taskIconsDungeons', this.settingChangeHandler);
                this.settingChangeHandler = null;
            }

            // Disconnect task list observer
            if (this.taskListObserver) {
                this.taskListObserver();
                this.taskListObserver = null;
            }

            // Remove filter bar from DOM
            if (this.filterBar) {
                this.filterBar.remove();
                this.filterBar = null;
            }

            // Clear maps
            this.filterIcons.clear();
            this.currentCounts.clear();
        }

        /**
         * Add filter icon bar to task panel header
         * Called by task-sorter.js when task panel appears
         * @param {HTMLElement} headerElement - Task panel header element
         */
        addFilterBar(headerElement) {
            // Check if we already added filters to this header
            if (headerElement.querySelector('[data-mwi-task-filters]')) {
                return;
            }

            // Find the task panel container to observe task list
            // DOM structure: Grandparent > TaskBoardInfo (parent) > TaskSlotCount (header)
            //                Grandparent > TaskList (sibling to TaskBoardInfo)
            // So we need to go up two levels to find the common container
            const panel = headerElement.parentElement?.parentElement;
            if (!panel) {
                console.warn('[TaskIconFilters] Could not find task panel grandparent');
                return;
            }

            // Create container for filter icons
            this.filterBar = document.createElement('div');
            this.filterBar.setAttribute('data-mwi-task-filters', 'true');
            this.filterBar.style.gap = '8px';
            this.filterBar.style.alignItems = 'center';
            this.filterBar.style.marginLeft = '8px';

            // Check if taskIconsDungeons setting is enabled
            const isEnabled = config.isFeatureEnabled('taskIconsDungeons');
            this.filterBar.style.display = isEnabled ? 'flex' : 'none';

            // Create battle icon
            const battleIcon = this.createFilterIcon(
                'battle',
                'Battle',
                '/static/media/misc_sprite.426c5d78.svg#combat',
                () => this.getBattleFilterEnabled()
            );
            this.filterBar.appendChild(battleIcon);
            this.filterIcons.set('battle', battleIcon);

            // Create dungeon icons
            Object.entries(this.dungeonConfig).forEach(([hrid, dungeon]) => {
                const dungeonIcon = this.createFilterIcon(
                    dungeon.id,
                    dungeon.name,
                    `/static/media/actions_sprite.e6388cbc.svg#${dungeon.spriteId}`,
                    () => this.getDungeonFilterEnabled(hrid)
                );
                this.filterBar.appendChild(dungeonIcon);
                this.filterIcons.set(dungeon.id, dungeonIcon);
            });

            // Insert filter bar after the task sort button (if it exists)
            const sortButton = headerElement.querySelector('[data-mwi-task-sort]');
            if (sortButton) {
                sortButton.parentNode.insertBefore(this.filterBar, sortButton.nextSibling);
            } else {
                headerElement.appendChild(this.filterBar);
            }

            // Initial count update
            this.updateCounts(panel);

            // Start observing task list for count updates
            this.observeTaskList(panel);
        }

        /**
         * Create a clickable filter icon with count badge
         * @param {string} id - Unique identifier for this filter
         * @param {string} title - Tooltip text
         * @param {string} spriteHref - SVG sprite reference
         * @param {Function} getEnabled - Function to check if filter is enabled
         * @returns {HTMLElement} Filter icon container
         */
        createFilterIcon(id, title, spriteHref, getEnabled) {
            const container = document.createElement('div');
            container.setAttribute('data-filter-id', id);
            container.style.position = 'relative';
            container.style.cursor = 'pointer';
            container.style.userSelect = 'none';
            container.title = title;

            // Create SVG icon
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '24');
            svg.setAttribute('height', '24');
            svg.setAttribute('viewBox', '0 0 1024 1024');
            svg.style.display = 'block';
            svg.style.transition = 'opacity 0.2s';

            const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
            use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', spriteHref);
            svg.appendChild(use);
            container.appendChild(svg);

            // Create count badge
            const countBadge = document.createElement('span');
            countBadge.setAttribute('data-count-badge', 'true');
            countBadge.style.position = 'absolute';
            countBadge.style.top = '-4px';
            countBadge.style.right = '-8px';
            countBadge.style.fontSize = '11px';
            countBadge.style.fontWeight = 'bold';
            countBadge.style.color = '#fff';
            countBadge.style.textShadow = '0 0 2px #000, 0 0 2px #000';
            countBadge.style.pointerEvents = 'none';
            countBadge.style.transition = 'opacity 0.2s';
            countBadge.textContent = '*0';
            container.appendChild(countBadge);

            // Click handler
            container.addEventListener('click', () => {
                this.handleFilterClick(id);
            });

            // Set initial state
            this.updateIconState(container, getEnabled());

            return container;
        }

        /**
         * Handle filter icon click
         * @param {string} filterId - ID of the filter that was clicked
         */
        handleFilterClick(filterId) {
            if (filterId === 'battle') {
                // Toggle battle filter
                const currentState = this.getBattleFilterEnabled();
                this.state.battle = !currentState;
                storage.set(STORAGE_KEYS.battle, this.state.battle, 'settings');
            } else {
                // Toggle dungeon filter
                const dungeonHrid = Object.keys(this.dungeonConfig).find(
                    (hrid) => this.dungeonConfig[hrid].id === filterId
                );
                if (dungeonHrid) {
                    const currentState = this.getDungeonFilterEnabled(dungeonHrid);
                    this.state.dungeons[filterId] = !currentState;
                    const key = `${STORAGE_KEYS.dungeonPrefix}${filterId}`;
                    storage.set(key, this.state.dungeons[filterId], 'settings');
                }
            }

            // Update all icon states
            this.updateAllIconStates();

            // Dispatch custom event to notify other components
            this.dispatchFilterChange(filterId);
        }

        dispatchFilterChange(filterId) {
            document.dispatchEvent(
                new CustomEvent('mwi-task-icon-filter-changed', {
                    detail: {
                        filterId,
                        battleEnabled: this.getBattleFilterEnabled(),
                    },
                })
            );
        }

        /**
         * Update visual state of a filter icon
         * @param {HTMLElement} container - Filter icon container
         * @param {boolean} enabled - Whether filter is enabled
         */
        updateIconState(container, enabled) {
            const svg = container.querySelector('svg');
            const countBadge = container.querySelector('[data-count-badge]');

            if (enabled) {
                svg.style.opacity = '1.0';
                countBadge.style.display = 'inline';
            } else {
                svg.style.opacity = '0.3';
                countBadge.style.display = 'none';
            }
        }

        /**
         * Update all icon states based on current config
         */
        updateAllIconStates() {
            // Update battle icon
            const battleIcon = this.filterIcons.get('battle');
            if (battleIcon) {
                this.updateIconState(battleIcon, this.getBattleFilterEnabled());
            }

            // Update dungeon icons
            Object.entries(this.dungeonConfig).forEach(([hrid, dungeon]) => {
                const dungeonIcon = this.filterIcons.get(dungeon.id);
                if (dungeonIcon) {
                    this.updateIconState(dungeonIcon, this.getDungeonFilterEnabled(hrid));
                }
            });
        }

        /**
         * Update task counts on all filter icons
         * @param {HTMLElement} panel - Task panel container
         */
        updateCounts(panel) {
            // Find all task items in the panel
            const taskItems = panel.querySelectorAll(selectors_js.GAME.TASK_CARD);

            // Count tasks for each filter
            const counts = {
                battle: 0,
                chimerical_den: 0,
                sinister_circus: 0,
                enchanted_fortress: 0,
                pirate_cove: 0,
            };

            taskItems.forEach((taskItem) => {
                // Check if this is a combat task
                const isCombatTask = this.isTaskCombat(taskItem);

                if (isCombatTask) {
                    counts.battle++;

                    // Check which dungeon this task is for
                    const dungeonType = this.getTaskDungeonType(taskItem);
                    if (dungeonType && counts.hasOwnProperty(dungeonType)) {
                        counts[dungeonType]++;
                    }
                }
            });

            // Update count badges
            this.filterIcons.forEach((icon, filterId) => {
                const count = counts[filterId] || 0;
                const countBadge = icon.querySelector('[data-count-badge]');
                if (countBadge) {
                    countBadge.textContent = `*${count}`;
                }
                this.currentCounts.set(filterId, count);
            });
        }

        /**
         * Check if a task item is a combat task
         * @param {HTMLElement} taskItem - Task item element
         * @returns {boolean} True if this is a combat task
         */
        isTaskCombat(taskItem) {
            // Check for monster icon class added by task-icons.js to all combat tasks
            const monsterIcon = taskItem.querySelector('.mwi-task-icon-monster');
            return monsterIcon !== null;
        }

        /**
         * Get the dungeon type for a combat task
         * @param {HTMLElement} taskItem - Task item element
         * @returns {string|null} Dungeon ID or null if not a dungeon task
         */
        getTaskDungeonType(taskItem) {
            // Look for dungeon badge icons (using class, not ID)
            const badges = taskItem.querySelectorAll('.mwi-task-icon-dungeon svg use');

            if (!badges || badges.length === 0) {
                return null;
            }

            // Check each badge to identify the dungeon
            for (const badge of badges) {
                const href = badge.getAttribute('href') || badge.getAttributeNS('http://www.w3.org/1999/xlink', 'href');

                if (!href) continue;

                // Match href to dungeon config
                for (const [_hrid, dungeon] of Object.entries(this.dungeonConfig)) {
                    if (href.includes(dungeon.spriteId)) {
                        return dungeon.id;
                    }
                }
            }

            return null;
        }

        /**
         * Set up observer to watch for task list changes
         * @param {HTMLElement} panel - Task panel container
         */
        observeTaskList(panel) {
            // Find the task list container
            const taskList = panel.querySelector(selectors_js.GAME.TASK_LIST);
            if (!taskList) {
                console.warn('[TaskIconFilters] Could not find task list');
                return;
            }

            // Disconnect existing observer if any
            if (this.taskListObserver) {
                this.taskListObserver();
            }

            // Create new observer
            this.taskListObserver = domObserverHelpers_js.createMutationWatcher(
                taskList,
                () => {
                    this.updateCounts(panel);
                },
                {
                    childList: true,
                    subtree: true,
                }
            );
        }

        /**
         * Check if battle filter is enabled
         * @returns {boolean} True if battle icons should be shown
         */
        getBattleFilterEnabled() {
            return this.state.battle !== false;
        }

        /**
         * Check if a specific dungeon filter is enabled
         * @param {string} dungeonHrid - Dungeon action HRID
         * @returns {boolean} True if this dungeon's badges should be shown
         */
        getDungeonFilterEnabled(dungeonHrid) {
            const dungeon = this.dungeonConfig[dungeonHrid];
            if (!dungeon) return false;

            return this.state.dungeons[dungeon.id] === true;
        }

        /**
         * Check if a specific dungeon badge should be shown
         * @param {string} dungeonHrid - Dungeon action HRID
         * @returns {boolean} True if badge should be shown
         */
        shouldShowDungeonBadge(dungeonHrid) {
            // Must have both battle toggle enabled AND specific dungeon toggle enabled
            return this.getBattleFilterEnabled() && this.getDungeonFilterEnabled(dungeonHrid);
        }
    }

    // Export singleton instance
    const taskIconFilters = new TaskIconFilters();

    /**
     * Task Icons
     * Adds visual icon overlays to task cards
     */


    class TaskIcons {
        constructor() {
            this.initialized = false;
            this.observers = [];
            this.characterSwitchingHandler = null;

            // SVG sprite paths (from game assets)
            this.SPRITES = {
                ITEMS: '/static/media/items_sprite.328d6606.svg',
                ACTIONS: '/static/media/actions_sprite.e6388cbc.svg',
                MONSTERS: '/static/media/combat_monsters_sprite.75d964d1.svg',
            };

            // Cache for parsed game data
            this.itemsByHrid = null;
            this.actionsByHrid = null;
            this.monstersByHrid = null;
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
        }

        /**
         * Initialize the task icons feature
         */
        initialize() {
            if (this.initialized) return;

            // Load game data from DataManager
            this.loadGameData();

            // Watch for task cards being added/updated
            this.watchTaskCards();

            this.characterSwitchingHandler = () => {
                this.cleanup();
            };

            dataManager.on('character_switching', this.characterSwitchingHandler);

            // Listen for filter changes to refresh icons
            this.filterChangeHandler = () => {
                this.refreshAllIcons();
            };
            document.addEventListener('mwi-task-icon-filter-changed', this.filterChangeHandler);

            this.initialized = true;
        }

        /**
         * Load game data from DataManager
         */
        loadGameData() {
            const gameData = dataManager.getInitClientData();
            if (!gameData) {
                return;
            }

            // Build lookup maps for quick access
            this.itemsByHrid = new Map();
            this.actionsByHrid = new Map();
            this.monstersByHrid = new Map();
            this.locationsByHrid = new Map();

            // Index items
            if (gameData.itemDetailMap) {
                Object.entries(gameData.itemDetailMap).forEach(([hrid, item]) => {
                    this.itemsByHrid.set(hrid, item);
                });
            }

            // Index actions
            if (gameData.actionDetailMap) {
                Object.entries(gameData.actionDetailMap).forEach(([hrid, action]) => {
                    this.actionsByHrid.set(hrid, action);
                });
            }

            // Index monsters
            if (gameData.combatMonsterDetailMap) {
                Object.entries(gameData.combatMonsterDetailMap).forEach(([hrid, monster]) => {
                    this.monstersByHrid.set(hrid, monster);
                });
            }
        }

        /**
         * Watch for task cards in the DOM
         */
        watchTaskCards() {
            // Process existing task cards
            this.processAllTaskCards();

            // Watch for task list appearing
            const unregisterTaskList = domObserver.onClass('TaskIcons-TaskList', 'TasksPanel_taskList', () => {
                this.processAllTaskCards();
            });
            this.observers.push(unregisterTaskList);

            // Watch for individual task cards appearing
            const unregisterTask = domObserver.onClass('TaskIcons-Task', 'RandomTask_randomTask', () => {
                this.processAllTaskCards();
            });
            this.observers.push(unregisterTask);

            // Watch for task rerolls via WebSocket
            const questsHandler = (data) => {
                if (!data.endCharacterQuests) {
                    return;
                }

                // Wait for game to update DOM before updating icons
                const iconsTimeout = setTimeout(() => {
                    this.clearAllProcessedMarkers();
                    this.processAllTaskCards();
                }, 250);
                this.timerRegistry.registerTimeout(iconsTimeout);
            };

            webSocketHook.on('quests_updated', questsHandler);

            this.observers.push(() => {
                webSocketHook.off('quests_updated', questsHandler);
            });
        }

        /**
         * Process all task cards in the DOM
         */
        processAllTaskCards() {
            const taskList = document.querySelector(selectors_js.GAME.TASK_LIST);
            if (!taskList) {
                return;
            }

            // Ensure game data is loaded
            if (!this.itemsByHrid || this.itemsByHrid.size === 0) {
                this.loadGameData();
                if (!this.itemsByHrid || this.itemsByHrid.size === 0) {
                    return;
                }
            }

            const taskCards = taskList.querySelectorAll(selectors_js.GAME.TASK_CARD);

            taskCards.forEach((card) => {
                // Get current task name
                const nameElement = card.querySelector(selectors_js.GAME.TASK_NAME);
                if (!nameElement) return;

                const taskName = nameElement.textContent.trim();

                // Check if this card already has icons for this exact task
                const processedTaskName = card.getAttribute('data-mwi-task-processed');

                // Only process if:
                // 1. Card has never been processed, OR
                // 2. Task name has changed (task was rerolled)
                if (processedTaskName !== taskName) {
                    // Remove old icons (if any)
                    this.removeIcons(card);

                    // Add new icons
                    this.addIconsToTaskCard(card);

                    // Mark card as processed with current task name
                    card.setAttribute('data-mwi-task-processed', taskName);
                }
            });
        }

        /**
         * Clear all processed markers to force icon refresh
         */
        clearAllProcessedMarkers() {
            const taskList = document.querySelector(selectors_js.GAME.TASK_LIST);
            if (!taskList) {
                return;
            }

            const taskCards = taskList.querySelectorAll(selectors_js.GAME.TASK_CARD);
            taskCards.forEach((card) => {
                card.removeAttribute('data-mwi-task-processed');
            });
        }

        /**
         * Refresh all icons (called when filters change)
         */
        refreshAllIcons() {
            this.clearAllProcessedMarkers();
            this.processAllTaskCards();
        }

        /**
         * Add icon overlays to a task card
         */
        addIconsToTaskCard(taskCard) {
            // Parse task description to get task type and name
            const taskInfo = this.parseTaskCard(taskCard);
            if (!taskInfo) {
                return;
            }

            // Add appropriate icons based on task type
            if (taskInfo.isCombatTask) {
                this.addMonsterIcon(taskCard, taskInfo);
            } else {
                this.addActionIcon(taskCard, taskInfo);
            }
        }

        /**
         * Parse task card to extract task information
         */
        parseTaskCard(taskCard) {
            const nameElement = taskCard.querySelector(selectors_js.GAME.TASK_NAME);
            if (!nameElement) {
                return null;
            }

            const fullText = nameElement.textContent.trim();

            // Format is "SkillType - TaskName" or "Defeat - MonsterName"
            const match = fullText.match(/^(.+?)\s*-\s*(.+)$/);
            if (!match) {
                return null;
            }

            const [, skillType, taskName] = match;

            const taskInfo = {
                skillType: skillType.trim(),
                taskName: taskName.trim(),
                fullText,
                isCombatTask: skillType.trim() === 'Defeat',
            };

            return taskInfo;
        }

        /**
         * Find action HRID by display name
         */
        findActionHrid(actionName) {
            // Search through actions to find matching name
            for (const [hrid, action] of this.actionsByHrid) {
                if (action.name === actionName) {
                    return hrid;
                }
            }
            return null;
        }

        /**
         * Find monster HRID by display name
         */
        findMonsterHrid(monsterName) {
            // Strip zone tier suffix (e.g., "Grizzly BearZ8" → "Grizzly Bear")
            // Format is: MonsterNameZ# where # is the zone index
            const cleanName = monsterName.replace(/Z\d+$/, '').trim();

            // Search through monsters to find matching name
            for (const [hrid, monster] of this.monstersByHrid) {
                if (monster.name === cleanName) {
                    return hrid;
                }
            }
            return null;
        }

        /**
         * Add action icon to task card
         */
        addActionIcon(taskCard, taskInfo) {
            const actionHrid = this.findActionHrid(taskInfo.taskName);
            if (!actionHrid) {
                return;
            }

            const action = this.actionsByHrid.get(actionHrid);
            if (!action) {
                return;
            }

            // Determine sprite and icon name
            let spritePath, iconName;

            // Check if action produces a specific item (use item sprite)
            if (action.outputItems && action.outputItems.length > 0) {
                const outputItem = action.outputItems[0];
                const itemHrid = outputItem.itemHrid || outputItem.hrid;
                const item = this.itemsByHrid.get(itemHrid);
                if (item) {
                    spritePath = this.SPRITES.ITEMS;
                    iconName = itemHrid.split('/').pop();
                }
            }

            // If still no icon, try to find corresponding item for gathering actions
            if (!iconName) {
                // Convert action HRID to item HRID (e.g., /actions/foraging/cow → /items/cow)
                const actionName = actionHrid.split('/').pop();
                const potentialItemHrid = `/items/${actionName}`;
                const potentialItem = this.itemsByHrid.get(potentialItemHrid);

                if (potentialItem) {
                    spritePath = this.SPRITES.ITEMS;
                    iconName = actionName;
                } else {
                    // Fall back to action sprite
                    spritePath = this.SPRITES.ACTIONS;
                    iconName = actionName;
                }
            }

            this.addIconOverlay(taskCard, spritePath, iconName, 'action');
        }

        /**
         * Add monster icon to task card
         */
        addMonsterIcon(taskCard, taskInfo) {
            const monsterHrid = this.findMonsterHrid(taskInfo.taskName);
            if (!monsterHrid) {
                return;
            }

            // Count dungeons if dungeon icons are enabled
            let dungeonCount = 0;
            if (config.isFeatureEnabled('taskIconsDungeons')) {
                dungeonCount = this.countDungeonsForMonster(monsterHrid);
            }

            // Calculate icon width based on total count (1 monster + N dungeons)
            const totalIcons = 1 + dungeonCount;
            let iconWidth;
            if (totalIcons <= 2) {
                iconWidth = 30;
            } else if (totalIcons <= 4) {
                iconWidth = 25;
            } else {
                iconWidth = 20;
            }

            // Position monster on the right (ends at 100%)
            const monsterPosition = 100 - iconWidth;
            const iconName = monsterHrid.split('/').pop();
            this.addIconOverlay(
                taskCard,
                this.SPRITES.MONSTERS,
                iconName,
                'monster',
                `${monsterPosition}%`,
                `${iconWidth}%`
            );

            // Add dungeon icons if enabled
            if (config.isFeatureEnabled('taskIconsDungeons') && dungeonCount > 0) {
                this.addDungeonIcons(taskCard, monsterHrid, iconWidth);
            }
        }

        /**
         * Count how many dungeons a monster appears in
         */
        countDungeonsForMonster(monsterHrid) {
            let count = 0;

            for (const [_actionHrid, action] of this.actionsByHrid) {
                if (!action.combatZoneInfo?.isDungeon) continue;

                const dungeonInfo = action.combatZoneInfo.dungeonInfo;
                if (!dungeonInfo) continue;

                let monsterFound = false;

                // Check random spawns
                if (dungeonInfo.randomSpawnInfoMap) {
                    for (const waveSpawns of Object.values(dungeonInfo.randomSpawnInfoMap)) {
                        if (waveSpawns.spawns) {
                            for (const spawn of waveSpawns.spawns) {
                                if (spawn.combatMonsterHrid === monsterHrid) {
                                    monsterFound = true;
                                    break;
                                }
                            }
                        }
                        if (monsterFound) break;
                    }
                }

                // Check fixed spawns
                if (!monsterFound && dungeonInfo.fixedSpawnsMap) {
                    for (const waveSpawns of Object.values(dungeonInfo.fixedSpawnsMap)) {
                        for (const spawn of waveSpawns) {
                            if (spawn.combatMonsterHrid === monsterHrid) {
                                monsterFound = true;
                                break;
                            }
                        }
                        if (monsterFound) break;
                    }
                }

                if (monsterFound) {
                    count++;
                }
            }

            return count;
        }

        /**
         * Add dungeon icons for a monster
         * @param {HTMLElement} taskCard - Task card element
         * @param {string} monsterHrid - Monster HRID
         * @param {number} iconWidth - Width percentage for each icon
         */
        addDungeonIcons(taskCard, monsterHrid, iconWidth) {
            const monster = this.monstersByHrid.get(monsterHrid);
            if (!monster) return;

            // Find which dungeons this monster appears in
            const dungeonHrids = [];

            for (const [actionHrid, action] of this.actionsByHrid) {
                // Skip non-dungeon actions
                if (!action.combatZoneInfo?.isDungeon) continue;

                const dungeonInfo = action.combatZoneInfo.dungeonInfo;
                if (!dungeonInfo) continue;

                let monsterFound = false;

                // Check random spawns (regular waves)
                if (dungeonInfo.randomSpawnInfoMap) {
                    for (const waveSpawns of Object.values(dungeonInfo.randomSpawnInfoMap)) {
                        if (waveSpawns.spawns) {
                            for (const spawn of waveSpawns.spawns) {
                                if (spawn.combatMonsterHrid === monsterHrid) {
                                    monsterFound = true;
                                    break;
                                }
                            }
                        }
                        if (monsterFound) break;
                    }
                }

                // Check fixed spawns (boss waves)
                if (!monsterFound && dungeonInfo.fixedSpawnsMap) {
                    for (const waveSpawns of Object.values(dungeonInfo.fixedSpawnsMap)) {
                        for (const spawn of waveSpawns) {
                            if (spawn.combatMonsterHrid === monsterHrid) {
                                monsterFound = true;
                                break;
                            }
                        }
                        if (monsterFound) break;
                    }
                }

                if (monsterFound) {
                    dungeonHrids.push(actionHrid);
                }
            }

            // Position dungeons right-to-left, starting from left of monster
            const monsterPosition = 100 - iconWidth;
            let position = monsterPosition - iconWidth; // Start one icon to the left of monster

            dungeonHrids.forEach((dungeonHrid) => {
                // Check if this dungeon should be shown based on filter settings
                if (!taskIconFilters.shouldShowDungeonBadge(dungeonHrid)) {
                    return; // Skip this dungeon
                }

                const iconName = dungeonHrid.split('/').pop();
                this.addIconOverlay(taskCard, this.SPRITES.ACTIONS, iconName, 'dungeon', `${position}%`, `${iconWidth}%`);
                position -= iconWidth; // Move left for next dungeon
            });
        }

        /**
         * Add icon overlay to task card
         * @param {HTMLElement} taskCard - Task card element
         * @param {string} spritePath - Path to sprite SVG
         * @param {string} iconName - Icon name in sprite
         * @param {string} type - Icon type (action/monster/dungeon)
         * @param {string} leftPosition - Left position percentage
         * @param {string} widthPercent - Width percentage (default: '30%')
         */
        addIconOverlay(taskCard, spritePath, iconName, type, leftPosition = '50%', widthPercent = '30%') {
            // Create container for icon
            const iconDiv = document.createElement('div');
            iconDiv.className = `mwi-task-icon mwi-task-icon-${type}`;
            iconDiv.style.position = 'absolute';
            iconDiv.style.left = leftPosition;
            iconDiv.style.width = widthPercent;
            iconDiv.style.height = '100%';
            iconDiv.style.opacity = '0.3';
            iconDiv.style.pointerEvents = 'none';
            iconDiv.style.zIndex = '0';

            // Create SVG element
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');

            // Create use element to reference sprite
            const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
            const spriteRef = `${spritePath}#${iconName}`;
            use.setAttribute('href', spriteRef);
            svg.appendChild(use);

            iconDiv.appendChild(svg);

            // Ensure task card is positioned relatively
            taskCard.style.position = 'relative';

            // Insert icon before content (so it appears in background)
            const taskContent = taskCard.querySelector(selectors_js.GAME.TASK_CONTENT);
            if (taskContent) {
                taskContent.style.zIndex = '1';
                taskContent.style.position = 'relative';
            }

            taskCard.appendChild(iconDiv);
        }

        /**
         * Remove icons from task card
         */
        removeIcons(taskCard) {
            const existingIcons = taskCard.querySelectorAll('.mwi-task-icon');
            existingIcons.forEach((icon) => icon.remove());
        }

        /**
         * Cleanup
         */
        cleanup() {
            this.observers.forEach((unregister) => unregister());
            this.observers = [];

            // Remove all icons and data attributes
            document.querySelectorAll('.mwi-task-icon').forEach((icon) => icon.remove());
            document.querySelectorAll('[data-mwi-task-processed]').forEach((card) => {
                card.removeAttribute('data-mwi-task-processed');
            });

            // Clear caches
            this.itemsByHrid = null;
            this.actionsByHrid = null;
            this.monstersByHrid = null;

            this.timerRegistry.clearAll();

            this.initialized = false;
        }

        /**
         * Disable and cleanup (called by feature registry during character switch)
         */
        disable() {
            if (this.characterSwitchingHandler) {
                dataManager.off('character_switching', this.characterSwitchingHandler);
                this.characterSwitchingHandler = null;
            }

            if (this.filterChangeHandler) {
                document.removeEventListener('mwi-task-icon-filter-changed', this.filterChangeHandler);
                this.filterChangeHandler = null;
            }

            // Run cleanup
            this.cleanup();
        }
    }

    const taskIcons = new TaskIcons();

    /**
     * Task Sorter
     * Sorts tasks in the task board by skill type
     */


    class TaskSorter {
        constructor() {
            this.initialized = false;
            this.sortButton = null;
            this.unregisterObserver = null;
            this.timerRegistry = timerRegistry_js.createTimerRegistry();

            // Task type ordering (combat tasks go to bottom)
            this.TASK_ORDER = {
                Milking: 1,
                Foraging: 2,
                Woodcutting: 3,
                Cheesesmithing: 4,
                Crafting: 5,
                Tailoring: 6,
                Cooking: 7,
                Brewing: 8,
                Alchemy: 9,
                Enhancing: 10,
                Defeat: 99, // Combat tasks at bottom
            };
        }

        /**
         * Initialize the task sorter
         */
        initialize() {
            if (this.initialized) return;

            // Use DOM observer to watch for task panel appearing
            this.watchTaskPanel();

            this.initialized = true;
        }

        /**
         * Watch for task panel to appear
         */
        watchTaskPanel() {
            // Register observer for task panel header (watch for the class name, not the selector)
            this.unregisterObserver = domObserver.onClass(
                'TaskSorter',
                'TasksPanel_taskSlotCount', // Just the class name, not [class*="..."]
                (headerElement) => {
                    this.addSortButton(headerElement);
                }
            );
        }

        /**
         * Add sort button to task panel header
         */
        addSortButton(headerElement) {
            // Check if button already exists
            if (this.sortButton && document.contains(this.sortButton)) {
                return;
            }

            // Create sort button
            this.sortButton = document.createElement('button');
            this.sortButton.className = 'Button_button__1Fe9z Button_small__3fqC7';
            this.sortButton.textContent = 'Sort Tasks';
            this.sortButton.style.marginLeft = '8px';
            this.sortButton.setAttribute('data-mwi-task-sort', 'true');
            this.sortButton.addEventListener('click', () => this.sortTasks());

            headerElement.appendChild(this.sortButton);

            // Add task icon filters if enabled
            if (config.isFeatureEnabled('taskIcons')) {
                taskIconFilters.addFilterBar(headerElement);
            }

            // Auto-sort if setting is enabled
            if (config.getSetting('taskSorter_autoSort')) {
                // Delay slightly to ensure all task cards are rendered
                const autoSortTimeout = setTimeout(() => {
                    this.sortTasks();
                }, 100);
                this.timerRegistry.registerTimeout(autoSortTimeout);
            }
        }

        /**
         * Parse task card to extract skill type and task name
         */
        parseTaskCard(taskCard) {
            const nameElement = taskCard.querySelector('[class*="RandomTask_name"]');
            if (!nameElement) return null;

            const fullText = nameElement.textContent.trim();

            // Format is "SkillType - TaskName"
            const match = fullText.match(/^(.+?)\s*-\s*(.+)$/);
            if (!match) return null;

            const [, skillType, taskName] = match;

            return {
                skillType: skillType.trim(),
                taskName: taskName.trim(),
                fullText,
            };
        }

        /**
         * Check if task is completed (has Claim Reward button)
         */
        isTaskCompleted(taskCard) {
            const claimButton = taskCard.querySelector('button.Button_button__1Fe9z.Button_buy__3s24l');
            return claimButton && claimButton.textContent.includes('Claim Reward');
        }

        /**
         * Get sort order for a task
         */
        getTaskOrder(taskCard) {
            const parsed = this.parseTaskCard(taskCard);
            if (!parsed) {
                return { skillOrder: 999, taskName: '', isCombat: false, monsterSortIndex: 999, isCompleted: false };
            }

            const skillOrder = this.TASK_ORDER[parsed.skillType] || 999;
            const isCombat = parsed.skillType === 'Defeat';
            const isCompleted = this.isTaskCompleted(taskCard);

            // For combat tasks, get monster sort index from game data
            let monsterSortIndex = 999;
            if (isCombat) {
                // Extract monster name from task name (e.g., "Granite GolemZ9" -> "Granite Golem")
                const monsterName = this.extractMonsterName(parsed.taskName);
                if (monsterName) {
                    const monsterHrid = dataManager.getMonsterHridFromName(monsterName);
                    if (monsterHrid) {
                        monsterSortIndex = dataManager.getMonsterSortIndex(monsterHrid);
                    }
                }
            }

            return {
                skillOrder,
                taskName: parsed.taskName,
                skillType: parsed.skillType,
                isCombat,
                monsterSortIndex,
                isCompleted,
            };
        }

        /**
         * Extract monster name from combat task name
         * @param {string} taskName - Task name (e.g., "Granite Golem Z9")
         * @returns {string|null} Monster name or null if not found
         */
        extractMonsterName(taskName) {
            // Combat task format from parseTaskCard: "[Monster Name]Z[number]" (may or may not have space)
            // Strip the zone suffix "Z\d+" from the end
            const match = taskName.match(/^(.+?)\s*Z\d+$/);
            if (match) {
                return match[1].trim();
            }

            // Fallback: return as-is if no zone suffix found
            return taskName.trim();
        }

        /**
         * Compare two task cards for sorting
         */
        compareTaskCards(cardA, cardB) {
            const orderA = this.getTaskOrder(cardA);
            const orderB = this.getTaskOrder(cardB);

            // First: Sort by completion status (incomplete tasks first, completed tasks last)
            if (orderA.isCompleted !== orderB.isCompleted) {
                return orderA.isCompleted ? 1 : -1;
            }

            // Second: Sort by skill type (combat vs non-combat)
            if (orderA.skillOrder !== orderB.skillOrder) {
                return orderA.skillOrder - orderB.skillOrder;
            }

            // Third: Within combat tasks, sort by zone progression (sortIndex)
            if (orderA.isCombat && orderB.isCombat) {
                if (orderA.monsterSortIndex !== orderB.monsterSortIndex) {
                    return orderA.monsterSortIndex - orderB.monsterSortIndex;
                }
            }

            // Fourth: Within same skill type (or same zone for combat), sort alphabetically by task name
            return orderA.taskName.localeCompare(orderB.taskName);
        }

        /**
         * Sort all tasks in the task board
         */
        sortTasks() {
            const taskList = document.querySelector(selectors_js.GAME.TASK_LIST);
            if (!taskList) {
                return;
            }

            // Get all task cards
            const taskCards = Array.from(taskList.querySelectorAll(selectors_js.GAME.TASK_CARD));
            if (taskCards.length === 0) {
                return;
            }

            // Sort the cards
            taskCards.sort((a, b) => this.compareTaskCards(a, b));

            // Re-append in sorted order
            taskCards.forEach((card) => taskList.appendChild(card));

            // After sorting, React may re-render task cards and remove our icons
            // Clear the processed markers and force icon re-processing
            if (config.isFeatureEnabled('taskIcons')) {
                // Use taskIcons module's method to clear markers
                taskIcons.clearAllProcessedMarkers();

                // Trigger icon re-processing
                // Use setTimeout to ensure React has finished any re-rendering
                const iconTimeout = setTimeout(() => {
                    taskIcons.processAllTaskCards();
                }, 100);
                this.timerRegistry.registerTimeout(iconTimeout);
            }
        }

        /**
         * Cleanup
         */
        cleanup() {
            if (this.unregisterObserver) {
                this.unregisterObserver();
                this.unregisterObserver = null;
            }

            if (this.sortButton && document.contains(this.sortButton)) {
                this.sortButton.remove();
            }
            this.sortButton = null;
            this.timerRegistry.clearAll();
            this.initialized = false;
        }

        disable() {
            this.cleanup();
        }
    }

    const taskSorter = new TaskSorter();

    /**
     * Remaining XP Display
     * Shows remaining XP to next level on skill bars in the left navigation panel
     */


    class RemainingXP {
        constructor() {
            this.initialized = false;
            this.updateInterval = null;
            this.unregisterObservers = [];
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
        }

        /**
         * Initialize the remaining XP display
         */
        initialize() {
            if (this.initialized) return;

            // Watch for skill buttons appearing
            this.watchSkillButtons();

            // Update every second (like MWIT-E does)
            this.updateInterval = setInterval(() => {
                this.updateAllSkillBars();
            }, 1000);
            this.timerRegistry.registerInterval(this.updateInterval);

            this.initialized = true;
        }

        /**
         * Watch for skill buttons in the navigation panel and other skill displays
         */
        watchSkillButtons() {
            // Watch for left navigation bar skills (non-combat skills)
            const unregisterNav = domObserver.onClass('RemainingXP-NavSkillBar', 'NavigationBar_currentExperience', () => {
                this.updateAllSkillBars();
            });
            this.unregisterObservers.push(unregisterNav);

            // Wait for character data to be loaded before first update
            const initHandler = () => {
                // Initial update once character data is ready
                const initialUpdateTimeout = setTimeout(() => {
                    this.updateAllSkillBars();
                }, 500);
                this.timerRegistry.registerTimeout(initialUpdateTimeout);
            };

            dataManager.on('character_initialized', initHandler);

            // Check if character data already loaded (in case we missed the event)
            if (dataManager.characterData) {
                initHandler();
            }

            this.unregisterObservers.push(() => {
                dataManager.off('character_initialized', initHandler);
            });
        }

        /**
         * Update all skill bars with remaining XP
         */
        updateAllSkillBars() {
            // Remove any existing XP displays
            document.querySelectorAll('.mwi-remaining-xp').forEach((el) => el.remove());

            // Find all skill progress bars (broader selector to catch combat skills too)
            // Use attribute selector to match any class containing "currentExperience"
            const progressBars = document.querySelectorAll('[class*="currentExperience"]');

            progressBars.forEach((progressBar) => {
                this.addRemainingXP(progressBar);
            });
        }

        /**
         * Add remaining XP display to a skill bar
         * @param {HTMLElement} progressBar - The progress bar element
         */
        addRemainingXP(progressBar) {
            try {
                // Try to find skill name - handle both navigation bar and combat skill displays
                let skillName = null;

                // Check if we're in a sub-skills container (combat skills)
                const subSkillsContainer = progressBar.closest('[class*="NavigationBar_subSkills"]');

                if (subSkillsContainer) {
                    // We're in combat sub-skills - look for label in immediate parent structure
                    // The label should be in a sibling or nearby element, not in the parent navigationLink
                    const navContainer = progressBar.closest('[class*="NavigationBar_nav"]');
                    if (navContainer) {
                        const skillNameElement = navContainer.querySelector('[class*="NavigationBar_label"]');
                        if (skillNameElement) {
                            skillName = skillNameElement.textContent.trim();
                        }
                    }
                } else {
                    // Regular skill (not a sub-skill) - use standard navigation link approach
                    const navLink = progressBar.closest('[class*="NavigationBar_navigationLink"]');
                    if (navLink) {
                        const skillNameElement = navLink.querySelector('[class*="NavigationBar_label"]');
                        if (skillNameElement) {
                            skillName = skillNameElement.textContent.trim();
                        }
                    }
                }

                if (!skillName) return;

                // Calculate remaining XP for this skill
                const remainingXP = this.calculateRemainingXP(skillName);
                if (remainingXP === null) return;

                // Find the progress bar container (parent of the progress bar)
                const progressContainer = progressBar.parentNode;
                if (!progressContainer) return;

                // Check if we already added XP display here (prevent duplicates)
                if (progressContainer.querySelector('.mwi-remaining-xp')) return;

                // Create the remaining XP display
                const xpDisplay = document.createElement('span');
                xpDisplay.className = 'mwi-remaining-xp';
                xpDisplay.textContent = `${formatters_js.numberFormatter(remainingXP)} XP left`;

                // Build style with optional text shadow
                const useBlackBorder = config.getSetting('skillRemainingXP_blackBorder', true);
                const textShadow = useBlackBorder
                    ? 'text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 3px #000;'
                    : '';

                xpDisplay.style.cssText = `
                font-size: 11px;
                color: ${config.COLOR_REMAINING_XP};
                display: block;
                margin-top: -8px;
                text-align: center;
                width: 100%;
                font-weight: 600;
                pointer-events: none;
                ${textShadow}
            `;

                // Insert after the progress bar
                progressContainer.insertBefore(xpDisplay, progressBar.nextSibling);
            } catch {
                // Silent fail - don't spam console with errors
            }
        }

        /**
         * Calculate remaining XP to next level for a skill
         * @param {string} skillName - The skill name (e.g., "Milking", "Combat")
         * @returns {number|null} Remaining XP or null if unavailable
         */
        calculateRemainingXP(skillName) {
            // Convert skill name to HRID
            const skillHrid = `/skills/${skillName.toLowerCase()}`;

            // Get character skills data
            const characterData = dataManager.characterData;
            if (!characterData || !characterData.characterSkills) {
                return null;
            }

            // Find the skill
            const skill = characterData.characterSkills.find((s) => s.skillHrid === skillHrid);
            if (!skill) {
                return null;
            }

            // Get level experience table
            const gameData = dataManager.getInitClientData();
            if (!gameData || !gameData.levelExperienceTable) return null;

            const currentExp = skill.experience;
            const currentLevel = skill.level;
            const nextLevel = currentLevel + 1;

            // Get XP required for next level
            const expForNextLevel = gameData.levelExperienceTable[nextLevel];
            if (expForNextLevel === undefined) return null; // Max level

            // Calculate remaining XP
            const remainingXP = expForNextLevel - currentExp;

            return Math.max(0, Math.ceil(remainingXP));
        }

        /**
         * Disable the remaining XP display
         */
        disable() {
            if (this.updateInterval) {
                this.updateInterval = null;
            }

            this.timerRegistry.clearAll();

            // Unregister observers
            this.unregisterObservers.forEach((unregister) => unregister());
            this.unregisterObservers = [];

            // Remove all XP displays
            document.querySelectorAll('.mwi-remaining-xp').forEach((el) => el.remove());

            this.initialized = false;
        }
    }

    const remainingXP = new RemainingXP();

    /**
     * House Upgrade Cost Calculator
     * Calculates material and coin costs for house room upgrades
     */


    class HouseCostCalculator {
        constructor() {
            this.isInitialized = false;
        }

        /**
         * Initialize the calculator
         */
        async initialize() {
            if (this.isInitialized) return;

            // Ensure market data is loaded (check in-memory first to avoid storage reads)
            if (!marketAPI.isLoaded()) {
                await marketAPI.fetch();
            }

            this.isInitialized = true;
        }

        /**
         * Get current level of a house room
         * @param {string} houseRoomHrid - House room HRID (e.g., "/house_rooms/brewery")
         * @returns {number} Current level (0-8)
         */
        getCurrentRoomLevel(houseRoomHrid) {
            return dataManager.getHouseRoomLevel(houseRoomHrid);
        }

        /**
         * Calculate cost for a single level upgrade
         * @param {string} houseRoomHrid - House room HRID
         * @param {number} targetLevel - Target level (1-8)
         * @returns {Promise<Object>} Cost breakdown
         */
        async calculateLevelCost(houseRoomHrid, targetLevel) {
            const initData = dataManager.getInitClientData();
            if (!initData || !initData.houseRoomDetailMap) {
                throw new Error('Game data not loaded');
            }

            const roomData = initData.houseRoomDetailMap[houseRoomHrid];
            if (!roomData) {
                throw new Error(`House room not found: ${houseRoomHrid}`);
            }

            const upgradeCosts = roomData.upgradeCostsMap[targetLevel];
            if (!upgradeCosts) {
                throw new Error(`No upgrade costs for level ${targetLevel}`);
            }

            // Calculate costs
            let totalCoins = 0;
            const materials = [];

            for (const item of upgradeCosts) {
                if (item.itemHrid === '/items/coin') {
                    totalCoins = item.count;
                } else {
                    const marketPrice = await this.getItemMarketPrice(item.itemHrid);
                    materials.push({
                        itemHrid: item.itemHrid,
                        count: item.count,
                        marketPrice: marketPrice,
                        totalValue: marketPrice * item.count,
                    });
                }
            }

            const totalMaterialValue = materials.reduce((sum, m) => sum + m.totalValue, 0);

            return {
                level: targetLevel,
                coins: totalCoins,
                materials: materials,
                totalValue: totalCoins + totalMaterialValue,
            };
        }

        /**
         * Calculate cumulative cost from current level to target level
         * @param {string} houseRoomHrid - House room HRID
         * @param {number} currentLevel - Current level
         * @param {number} targetLevel - Target level (currentLevel+1 to 8)
         * @returns {Promise<Object>} Aggregated costs
         */
        async calculateCumulativeCost(houseRoomHrid, currentLevel, targetLevel) {
            if (targetLevel <= currentLevel) {
                throw new Error('Target level must be greater than current level');
            }

            if (targetLevel > 8) {
                throw new Error('Maximum house level is 8');
            }

            let totalCoins = 0;
            const materialMap = new Map(); // itemHrid -> {itemHrid, count, marketPrice, totalValue}

            // Aggregate costs across all levels
            for (let level = currentLevel + 1; level <= targetLevel; level++) {
                const levelCost = await this.calculateLevelCost(houseRoomHrid, level);

                totalCoins += levelCost.coins;

                // Aggregate materials
                for (const material of levelCost.materials) {
                    if (materialMap.has(material.itemHrid)) {
                        const existing = materialMap.get(material.itemHrid);
                        existing.count += material.count;
                        existing.totalValue += material.totalValue;
                    } else {
                        materialMap.set(material.itemHrid, { ...material });
                    }
                }
            }

            const materials = Array.from(materialMap.values());
            const totalMaterialValue = materials.reduce((sum, m) => sum + m.totalValue, 0);

            return {
                fromLevel: currentLevel,
                toLevel: targetLevel,
                coins: totalCoins,
                materials: materials,
                totalValue: totalCoins + totalMaterialValue,
            };
        }

        /**
         * Get market price for an item (uses 'ask' price for buying materials)
         * @param {string} itemHrid - Item HRID
         * @returns {Promise<number>} Market price
         */
        async getItemMarketPrice(itemHrid) {
            // Use 'ask' mode since house upgrades involve buying materials
            const price = marketData_js.getItemPrice(itemHrid, { mode: 'ask' });

            if (price === null || price === 0) {
                // Fallback to vendor price from game data
                const initData = dataManager.getInitClientData();
                const itemData = initData?.itemDetailMap?.[itemHrid];
                return itemData?.sellPrice || 0;
            }

            return price;
        }

        /**
         * Get player's inventory count for an item
         * @param {string} itemHrid - Item HRID
         * @returns {number} Item count in inventory
         */
        getInventoryCount(itemHrid) {
            const inventory = dataManager.getInventory();
            if (!inventory) return 0;

            const item = inventory.find((i) => i.itemHrid === itemHrid);
            return item ? item.count : 0;
        }

        /**
         * Get item name from game data
         * @param {string} itemHrid - Item HRID
         * @returns {string} Item name
         */
        getItemName(itemHrid) {
            if (itemHrid === '/items/coin') {
                return 'Gold';
            }

            const initData = dataManager.getInitClientData();
            const itemData = initData?.itemDetailMap?.[itemHrid];
            return itemData?.name || 'Unknown Item';
        }

        /**
         * Get house room name from game data
         * @param {string} houseRoomHrid - House room HRID
         * @returns {string} Room name
         */
        getRoomName(houseRoomHrid) {
            const initData = dataManager.getInitClientData();
            const roomData = initData?.houseRoomDetailMap?.[houseRoomHrid];
            return roomData?.name || 'Unknown Room';
        }
    }

    const houseCostCalculator = new HouseCostCalculator();

    /**
     * House Upgrade Cost Display
     * UI rendering for house upgrade costs
     */


    class HouseCostDisplay {
        constructor() {
            this.isActive = false;
            this.currentModalContent = null; // Track current modal to detect room switches
            this.isInitialized = false;
            this.currentMaterialsTabs = []; // Track marketplace tabs
            this.cleanupObserver = null; // Marketplace cleanup observer
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
        }

        /**
         * Setup settings listeners for feature toggle and color changes
         */
        setupSettingListener() {
            config.onSettingChange('houseUpgradeCosts', (value) => {
                if (value) {
                    this.initialize();
                } else {
                    this.disable();
                }
            });

            config.onSettingChange('color_accent', () => {
                if (this.isInitialized) {
                    this.refresh();
                }
            });
        }

        /**
         * Initialize the display system
         */
        initialize() {
            if (!config.getSetting('houseUpgradeCosts')) {
                return;
            }

            this.isActive = true;
            this.isInitialized = true;
        }

        /**
         * Augment native costs section with market pricing
         * @param {Element} costsSection - The native HousePanel_costs element
         * @param {string} houseRoomHrid - House room HRID
         * @param {Element} modalContent - The modal content element
         */
        async addCostColumn(costsSection, houseRoomHrid, modalContent) {
            // Remove any existing augmentation first
            this.removeExistingColumn(modalContent);

            const currentLevel = houseCostCalculator.getCurrentRoomLevel(houseRoomHrid);

            // Don't show if already max level
            if (currentLevel >= 8) {
                return;
            }

            try {
                // Add "Cumulative to Level" section
                await this.addCompactToLevel(costsSection, houseRoomHrid, currentLevel);

                // Mark this modal as processed
                this.currentModalContent = modalContent;
            } catch {
                // Silently fail - augmentation is optional
            }
        }

        /**
         * Remove existing augmentations
         * @param {Element} modalContent - The modal content element
         */
        removeExistingColumn(modalContent) {
            // Remove all MWI-added elements
            modalContent
                .querySelectorAll('.mwi-house-pricing, .mwi-house-pricing-empty, .mwi-house-total, .mwi-house-to-level')
                .forEach((el) => el.remove());

            // Restore original grid columns
            const itemRequirementsGrid = modalContent.querySelector('[class*="HousePanel_itemRequirements"]');
            if (itemRequirementsGrid) {
                itemRequirementsGrid.style.gridTemplateColumns = '';
            }
        }

        /**
         * Augment native cost items with market pricing
         * @param {Element} costsSection - Native costs section
         * @param {Object} costData - Cost data from calculator
         */
        async augmentNativeCosts(costsSection, costData) {
            // Find the item requirements grid container
            const itemRequirementsGrid = costsSection.querySelector('[class*="HousePanel_itemRequirements"]');
            if (!itemRequirementsGrid) {
                return;
            }

            // Modify the grid to accept 4 columns instead of 3
            // Native grid is: icon | inventory count | input count
            // We want: icon | inventory count | input count | pricing
            const currentGridStyle = window.getComputedStyle(itemRequirementsGrid).gridTemplateColumns;

            // Add a 4th column for pricing (auto width)
            itemRequirementsGrid.style.gridTemplateColumns = currentGridStyle + ' auto';

            // Find all item containers (these have the icons)
            const itemContainers = itemRequirementsGrid.querySelectorAll('[class*="Item_itemContainer"]');
            if (itemContainers.length === 0) {
                return;
            }

            for (const itemContainer of itemContainers) {
                // Game uses SVG sprites, not img tags
                const svg = itemContainer.querySelector('svg');
                if (!svg) continue;

                // Extract item name from href (e.g., #lumber -> lumber)
                const useElement = svg.querySelector('use');
                const hrefValue = useElement?.getAttribute('href') || '';
                const itemName = hrefValue.split('#')[1];
                if (!itemName) continue;

                // Convert to item HRID
                const itemHrid = `/items/${itemName}`;

                // Find matching material in costData
                let materialData;
                if (itemHrid === '/items/coin') {
                    materialData = {
                        itemHrid: '/items/coin',
                        count: costData.coins,
                        marketPrice: 1,
                        totalValue: costData.coins,
                    };
                } else {
                    materialData = costData.materials.find((m) => m.itemHrid === itemHrid);
                }

                if (!materialData) continue;

                // Skip coins (no pricing needed)
                if (materialData.itemHrid === '/items/coin') {
                    // Add empty cell to maintain grid structure
                    this.addEmptyCell(itemRequirementsGrid, itemContainer);
                    continue;
                }

                // Add pricing as a new grid cell to the right
                this.addPricingCell(itemRequirementsGrid, itemContainer, materialData);
            }
        }

        /**
         * Add empty cell for coins to maintain grid structure
         * @param {Element} grid - The requirements grid
         * @param {Element} itemContainer - The item icon container (badge)
         */
        addEmptyCell(grid, itemContainer) {
            const emptyCell = document.createElement('span');
            emptyCell.className = 'mwi-house-pricing-empty HousePanel_itemRequirementCell__3hSBN';

            // Insert immediately after the item badge
            itemContainer.after(emptyCell);
        }

        /**
         * Add pricing as a new grid cell to the right of the item
         * @param {Element} grid - The requirements grid
         * @param {Element} itemContainer - The item icon container (badge)
         * @param {Object} materialData - Material data with pricing
         */
        addPricingCell(grid, itemContainer, materialData) {
            // Check if already augmented
            const nextSibling = itemContainer.nextElementSibling;
            if (nextSibling?.classList.contains('mwi-house-pricing')) {
                return;
            }

            const inventoryCount = houseCostCalculator.getInventoryCount(materialData.itemHrid);
            const hasEnough = inventoryCount >= materialData.count;
            const amountNeeded = Math.max(0, materialData.count - inventoryCount);

            // Create pricing cell
            const pricingCell = document.createElement('span');
            pricingCell.className = 'mwi-house-pricing HousePanel_itemRequirementCell__3hSBN';
            pricingCell.style.cssText = `
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 8px;
            font-size: 0.75rem;
            color: ${config.COLOR_ACCENT};
            padding-left: 8px;
            white-space: nowrap;
        `;

            pricingCell.innerHTML = `
            <span style="color: ${config.SCRIPT_COLOR_SECONDARY};">@ ${formatters_js.coinFormatter(materialData.marketPrice)}</span>
            <span style="color: ${config.COLOR_ACCENT}; font-weight: bold;">= ${formatters_js.coinFormatter(materialData.totalValue)}</span>
            <span style="color: ${hasEnough ? '#4ade80' : '#f87171'}; margin-left: auto; text-align: right;">${formatters_js.coinFormatter(amountNeeded)}</span>
        `;

            // Insert immediately after the item badge
            itemContainer.after(pricingCell);
        }

        /**
         * Add total cost below native costs section
         * @param {Element} costsSection - Native costs section
         * @param {Object} costData - Cost data
         */
        addTotalCost(costsSection, costData) {
            const totalDiv = document.createElement('div');
            totalDiv.className = 'mwi-house-total';
            totalDiv.style.cssText = `
            margin-top: 12px;
            padding-top: 12px;
            border-top: 2px solid ${config.COLOR_ACCENT};
            font-weight: bold;
            font-size: 1rem;
            color: ${config.COLOR_ACCENT};
            text-align: center;
        `;
            totalDiv.textContent = `Total Market Value: ${formatters_js.coinFormatter(costData.totalValue)}`;
            costsSection.appendChild(totalDiv);
        }

        /**
         * Add compact "To Level" section
         * @param {Element} costsSection - Native costs section
         * @param {string} houseRoomHrid - House room HRID
         * @param {number} currentLevel - Current level
         */
        async addCompactToLevel(costsSection, houseRoomHrid, currentLevel) {
            const section = document.createElement('div');
            section.className = 'mwi-house-to-level';
            section.style.cssText = `
            margin-top: 8px;
            padding: 8px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 8px;
            border: 1px solid ${config.SCRIPT_COLOR_SECONDARY};
        `;

            // Compact header with inline dropdown
            const headerRow = document.createElement('div');
            headerRow.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            margin-bottom: 8px;
        `;

            const label = document.createElement('span');
            label.style.cssText = `
            color: ${config.COLOR_ACCENT};
            font-weight: bold;
            font-size: 0.875rem;
        `;
            label.textContent = 'Cumulative to Level:';

            const dropdown = document.createElement('select');
            dropdown.style.cssText = `
            padding: 4px 8px;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid ${config.SCRIPT_COLOR_SECONDARY};
            color: ${config.SCRIPT_COLOR_MAIN};
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.875rem;
        `;

            // Add options
            for (let level = currentLevel + 1; level <= 8; level++) {
                const option = document.createElement('option');
                option.value = level;
                option.textContent = level;
                dropdown.appendChild(option);
            }

            // Default to next level (currentLevel + 1)
            const defaultLevel = currentLevel + 1;
            dropdown.value = defaultLevel;

            headerRow.appendChild(label);
            headerRow.appendChild(dropdown);
            section.appendChild(headerRow);

            // Cost display container
            const costContainer = document.createElement('div');
            costContainer.className = 'mwi-cumulative-cost-container';
            costContainer.style.cssText = `
            font-size: 0.875rem;
            margin-top: 8px;
            text-align: left;
        `;
            section.appendChild(costContainer);

            // Initial render
            await this.updateCompactCumulativeDisplay(costContainer, houseRoomHrid, currentLevel, parseInt(dropdown.value));

            // Update on change
            dropdown.addEventListener('change', async () => {
                await this.updateCompactCumulativeDisplay(
                    costContainer,
                    houseRoomHrid,
                    currentLevel,
                    parseInt(dropdown.value)
                );
            });

            costsSection.parentElement.appendChild(section);
        }

        /**
         * Update compact cumulative display
         * @param {Element} container - Container element
         * @param {string} houseRoomHrid - House room HRID
         * @param {number} currentLevel - Current level
         * @param {number} targetLevel - Target level
         */
        async updateCompactCumulativeDisplay(container, houseRoomHrid, currentLevel, targetLevel) {
            container.innerHTML = '';

            const costData = await houseCostCalculator.calculateCumulativeCost(houseRoomHrid, currentLevel, targetLevel);

            // Materials list as vertical stack of single-line rows
            const materialsList = document.createElement('div');
            materialsList.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 8px;
        `;

            // Coins first
            if (costData.coins > 0) {
                this.appendMaterialRow(materialsList, {
                    itemHrid: '/items/coin',
                    count: costData.coins,
                    totalValue: costData.coins,
                });
            }

            // Materials
            for (const material of costData.materials) {
                this.appendMaterialRow(materialsList, material);
            }

            container.appendChild(materialsList);

            // Total
            const totalDiv = document.createElement('div');
            totalDiv.style.cssText = `
            margin-top: 12px;
            padding-top: 12px;
            border-top: 2px solid ${config.COLOR_ACCENT};
            font-weight: bold;
            font-size: 1rem;
            color: ${config.COLOR_ACCENT};
            text-align: center;
        `;
            totalDiv.textContent = `Total Market Value: ${formatters_js.coinFormatter(costData.totalValue)}`;
            container.appendChild(totalDiv);

            // Add Missing Mats Marketplace button if any materials are missing
            const missingMaterials = this.getMissingMaterials(costData);
            if (missingMaterials.length > 0) {
                const button = this.createMissingMaterialsButton(missingMaterials);
                container.appendChild(button);
            }
        }

        /**
         * Append material row as single-line compact format
         * @param {Element} container - The container element
         * @param {Object} material - Material data
         */
        appendMaterialRow(container, material) {
            const itemName = houseCostCalculator.getItemName(material.itemHrid);
            const inventoryCount = houseCostCalculator.getInventoryCount(material.itemHrid);
            const hasEnough = inventoryCount >= material.count;
            const amountNeeded = Math.max(0, material.count - inventoryCount);
            const isCoin = material.itemHrid === '/items/coin';

            const row = document.createElement('div');
            row.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.875rem;
            line-height: 1.4;
        `;

            // [inv / req] - left side
            const inventorySpan = document.createElement('span');
            inventorySpan.style.cssText = `
            color: ${hasEnough ? 'white' : '#f87171'};
            min-width: 120px;
            text-align: right;
        `;
            inventorySpan.textContent = `${formatters_js.coinFormatter(inventoryCount)} / ${formatters_js.coinFormatter(material.count)}`;
            row.appendChild(inventorySpan);

            // [Badge] Material Name
            const nameSpan = document.createElement('span');
            nameSpan.style.cssText = `
            color: white;
            min-width: 140px;
        `;
            nameSpan.textContent = itemName;
            row.appendChild(nameSpan);

            // @ price = total (skip for coins)
            if (!isCoin) {
                const pricingSpan = document.createElement('span');
                pricingSpan.style.cssText = `
                color: ${config.COLOR_ACCENT};
                min-width: 180px;
            `;
                pricingSpan.textContent = `@ ${formatters_js.coinFormatter(material.marketPrice)} = ${formatters_js.coinFormatter(material.totalValue)}`;
                row.appendChild(pricingSpan);
            } else {
                // Empty spacer for coins
                const spacer = document.createElement('span');
                spacer.style.minWidth = '180px';
                row.appendChild(spacer);
            }

            // Missing: X - right side
            const missingSpan = document.createElement('span');
            missingSpan.style.cssText = `
            color: ${hasEnough ? '#4ade80' : '#f87171'};
            margin-left: auto;
            text-align: right;
        `;
            missingSpan.textContent = `Missing: ${formatters_js.coinFormatter(amountNeeded)}`;
            row.appendChild(missingSpan);

            container.appendChild(row);
        }

        /**
         * Get missing materials from cost data
         * @param {Object} costData - Cost data from calculator
         * @returns {Array} Array of missing materials in marketplace format
         */
        getMissingMaterials(costData) {
            const gameData = dataManager.getInitClientData();
            const inventory = dataManager.getInventory();
            const missing = [];

            // Process all materials (skip coins)
            for (const material of costData.materials) {
                const inventoryItem = inventory.find((i) => i.itemHrid === material.itemHrid);
                const have = inventoryItem?.count || 0;
                const missingAmount = Math.max(0, material.count - have);

                // Only include if missing > 0
                if (missingAmount > 0) {
                    const itemDetails = gameData.itemDetailMap[material.itemHrid];
                    if (itemDetails) {
                        missing.push({
                            itemHrid: material.itemHrid,
                            itemName: itemDetails.name,
                            missing: missingAmount,
                            isTradeable: itemDetails.isTradable === true,
                        });
                    }
                }
            }

            return missing;
        }

        /**
         * Create missing materials marketplace button
         * @param {Array} missingMaterials - Array of missing material objects
         * @returns {HTMLElement} Button element
         */
        createMissingMaterialsButton(missingMaterials) {
            const button = document.createElement('button');
            button.style.cssText = `
            width: 100%;
            padding: 10px 16px;
            margin-top: 12px;
            background: linear-gradient(180deg, rgba(91, 141, 239, 0.2) 0%, rgba(91, 141, 239, 0.1) 100%);
            color: #ffffff;
            border: 1px solid rgba(91, 141, 239, 0.4);
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
            transition: all 0.2s ease;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        `;
            button.textContent = 'Missing Mats Marketplace';

            // Hover effects
            button.addEventListener('mouseenter', () => {
                button.style.background =
                    'linear-gradient(180deg, rgba(91, 141, 239, 0.35) 0%, rgba(91, 141, 239, 0.25) 100%)';
                button.style.borderColor = 'rgba(91, 141, 239, 0.6)';
                button.style.boxShadow = '0 3px 6px rgba(0, 0, 0, 0.3)';
            });

            button.addEventListener('mouseleave', () => {
                button.style.background =
                    'linear-gradient(180deg, rgba(91, 141, 239, 0.2) 0%, rgba(91, 141, 239, 0.1) 100%)';
                button.style.borderColor = 'rgba(91, 141, 239, 0.4)';
                button.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
            });

            // Click handler
            button.addEventListener('click', async () => {
                await this.handleMissingMaterialsClick(missingMaterials);
            });

            return button;
        }

        /**
         * Handle missing materials button click
         * @param {Array} missingMaterials - Array of missing material objects
         */
        async handleMissingMaterialsClick(missingMaterials) {
            // Navigate to marketplace
            const success = await this.navigateToMarketplace();
            if (!success) {
                console.error('[HouseCostDisplay] Failed to navigate to marketplace');
                return;
            }

            // Wait for marketplace to settle
            await new Promise((resolve) => {
                const delayTimeout = setTimeout(resolve, 200);
                this.timerRegistry.registerTimeout(delayTimeout);
            });

            // Create custom tabs
            this.createMissingMaterialTabs(missingMaterials);

            // Setup cleanup observer if not already setup
            if (!this.cleanupObserver) {
                this.setupMarketplaceCleanupObserver();
            }
        }

        /**
         * Get game object via React fiber
         * @returns {Object|null} Game component instance
         */
        getGameObject() {
            const gamePageEl = document.querySelector('[class^="GamePage"]');
            if (!gamePageEl) return null;

            const fiberKey = Object.keys(gamePageEl).find((k) => k.startsWith('__reactFiber$'));
            if (!fiberKey) return null;

            return gamePageEl[fiberKey]?.return?.stateNode;
        }

        /**
         * Navigate to marketplace for a specific item
         * @param {string} itemHrid - Item HRID
         * @param {number} enhancementLevel - Enhancement level
         */
        goToMarketplace(itemHrid, enhancementLevel = 0) {
            const game = this.getGameObject();
            if (game?.handleGoToMarketplace) {
                game.handleGoToMarketplace(itemHrid, enhancementLevel);
            }
        }

        /**
         * Navigate to marketplace by clicking navbar
         * @returns {Promise<boolean>} True if successful
         */
        async navigateToMarketplace() {
            // Find marketplace navbar button
            const navButtons = document.querySelectorAll('.NavigationBar_nav__3uuUl');
            const marketplaceButton = Array.from(navButtons).find((nav) => {
                const svg = nav.querySelector('svg[aria-label="navigationBar.marketplace"]');
                return svg !== null;
            });

            if (!marketplaceButton) {
                console.error('[HouseCostDisplay] Marketplace navbar button not found');
                return false;
            }

            // Click button
            marketplaceButton.click();

            // Wait for marketplace to appear
            return await this.waitForMarketplace();
        }

        /**
         * Wait for marketplace panel to appear
         * @returns {Promise<boolean>} True if marketplace appeared
         */
        async waitForMarketplace() {
            const maxAttempts = 50;
            const delayMs = 100;

            for (let i = 0; i < maxAttempts; i++) {
                const tabsContainer = document.querySelector('.MuiTabs-flexContainer[role="tablist"]');
                if (tabsContainer) {
                    const hasMarketListings = Array.from(tabsContainer.children).some((btn) =>
                        btn.textContent.includes('Market Listings')
                    );
                    if (hasMarketListings) {
                        return true;
                    }
                }

                await new Promise((resolve) => {
                    const delayTimeout = setTimeout(resolve, delayMs);
                    this.timerRegistry.registerTimeout(delayTimeout);
                });
            }

            console.error('[HouseCostDisplay] Marketplace did not open within timeout');
            return false;
        }

        /**
         * Create custom tabs for missing materials
         * @param {Array} missingMaterials - Array of missing material objects
         */
        createMissingMaterialTabs(missingMaterials) {
            const tabsContainer = document.querySelector('.MuiTabs-flexContainer[role="tablist"]');
            if (!tabsContainer) {
                console.error('[HouseCostDisplay] Tabs container not found');
                return;
            }

            // Remove existing custom tabs
            this.removeMissingMaterialTabs();

            // Get reference tab
            const referenceTab = Array.from(tabsContainer.children).find((btn) => btn.textContent.includes('My Listings'));
            if (!referenceTab) {
                console.error('[HouseCostDisplay] Reference tab not found');
                return;
            }

            // Enable flex wrapping
            tabsContainer.style.flexWrap = 'wrap';

            // Create tab for each missing material
            this.currentMaterialsTabs = [];
            for (const material of missingMaterials) {
                const tab = this.createCustomTab(material, referenceTab);
                tabsContainer.appendChild(tab);
                this.currentMaterialsTabs.push(tab);
            }
        }

        /**
         * Create custom tab for a material
         * @param {Object} material - Material object
         * @param {HTMLElement} referenceTab - Reference tab to clone
         * @returns {HTMLElement} Custom tab element
         */
        createCustomTab(material, referenceTab) {
            const tab = referenceTab.cloneNode(true);

            // Mark as custom tab
            tab.setAttribute('data-mwi-custom-tab', 'true');
            tab.setAttribute('data-item-hrid', material.itemHrid);

            // Color coding
            const statusColor = material.isTradeable ? '#ef4444' : '#888888';
            const statusText = material.isTradeable ? `Missing: ${formatters_js.formatWithSeparator(material.missing)}` : 'Not Tradeable';

            // Update badge
            const badgeSpan = tab.querySelector('.TabsComponent_badge__1Du26');
            if (badgeSpan) {
                const titleCaseName = material.itemName
                    .split(' ')
                    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                    .join(' ');

                badgeSpan.innerHTML = `
                <div style="text-align: center;">
                    <div>${titleCaseName}</div>
                    <div style="font-size: 0.75em; color: ${statusColor};">
                        ${statusText}
                    </div>
                </div>
            `;
            }

            // Gray out if not tradeable
            if (!material.isTradeable) {
                tab.style.opacity = '0.5';
                tab.style.cursor = 'not-allowed';
            }

            // Remove selected state
            tab.classList.remove('Mui-selected');
            tab.setAttribute('aria-selected', 'false');
            tab.setAttribute('tabindex', '-1');

            // Click handler
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (!material.isTradeable) {
                    return;
                }

                this.goToMarketplace(material.itemHrid, 0);
            });

            return tab;
        }

        /**
         * Remove all missing material tabs
         */
        removeMissingMaterialTabs() {
            const customTabs = document.querySelectorAll('[data-mwi-custom-tab="true"]');
            customTabs.forEach((tab) => tab.remove());
            this.currentMaterialsTabs = [];
        }

        /**
         * Setup marketplace cleanup observer
         */
        setupMarketplaceCleanupObserver() {
            if (!document.body) {
                return;
            }

            this.cleanupObserver = domObserverHelpers_js.createMutationWatcher(
                document.body,
                (mutations) => {
                    for (const mutation of mutations) {
                        for (const removedNode of mutation.removedNodes) {
                            if (removedNode.nodeType === Node.ELEMENT_NODE) {
                                const hadTabsContainer = removedNode.querySelector(
                                    '.MuiTabs-flexContainer[role="tablist"]'
                                );
                                if (hadTabsContainer) {
                                    this.removeMissingMaterialTabs();
                                    console.log('[HouseCostDisplay] Marketplace closed, cleaned up tabs');
                                }
                            }
                        }
                    }
                },
                {
                    childList: true,
                    subtree: true,
                }
            );
        }

        /**
         * Refresh colors on existing displays
         */
        refresh() {
            // Update pricing cell colors
            document.querySelectorAll('.mwi-house-pricing').forEach((cell) => {
                cell.style.color = config.COLOR_ACCENT;
                const boldSpan = cell.querySelector('span[style*="font-weight: bold"]');
                if (boldSpan) {
                    boldSpan.style.color = config.COLOR_ACCENT;
                }
            });

            // Update total cost colors
            document.querySelectorAll('.mwi-house-total').forEach((total) => {
                total.style.borderTopColor = config.COLOR_ACCENT;
                total.style.color = config.COLOR_ACCENT;
            });

            // Update "To Level" label colors
            document.querySelectorAll('.mwi-house-to-level span[style*="font-weight: bold"]').forEach((label) => {
                label.style.color = config.COLOR_ACCENT;
            });

            // Update cumulative total colors
            document.querySelectorAll('.mwi-cumulative-cost-container span[style*="font-weight: bold"]').forEach((span) => {
                span.style.color = config.COLOR_ACCENT;
            });
        }

        /**
         * Disable the feature
         */
        disable() {
            // Remove all MWI-added elements
            document
                .querySelectorAll('.mwi-house-pricing, .mwi-house-pricing-empty, .mwi-house-total, .mwi-house-to-level')
                .forEach((el) => el.remove());

            // Restore all grid columns
            document.querySelectorAll('[class*="HousePanel_itemRequirements"]').forEach((grid) => {
                grid.style.gridTemplateColumns = '';
            });

            // Clean up marketplace tabs and observer
            this.removeMissingMaterialTabs();
            if (this.cleanupObserver) {
                this.cleanupObserver();
                this.cleanupObserver = null;
            }

            this.timerRegistry.clearAll();

            this.currentModalContent = null;
            this.isActive = false;
            this.isInitialized = false;
        }
    }

    const houseCostDisplay = new HouseCostDisplay();
    houseCostDisplay.setupSettingListener();

    /**
     * House Panel Observer
     * Detects house upgrade modal and injects cost displays
     */


    class HousePanelObserver {
        constructor() {
            this.isActive = false;
            this.cleanupRegistry = cleanupRegistry_js.createCleanupRegistry();
            this.processedCards = new WeakSet();
        }

        /**
         * Initialize the observer
         */
        async initialize() {
            if (this.isActive) return;

            // Initialize calculator
            await houseCostCalculator.initialize();

            // Initialize display
            houseCostDisplay.initialize();

            // Register modal observer
            this.registerObservers();

            this.isActive = true;
        }

        /**
         * Register DOM observers
         */
        registerObservers() {
            // Watch for house modal appearing
            const unregisterModal = domObserver.onClass(
                'HousePanelObserver-Modal',
                'HousePanel_modalContent',
                (modalContent) => {
                    this.handleHouseModal(modalContent);
                }
            );
            this.cleanupRegistry.registerCleanup(unregisterModal);
        }

        /**
         * Handle house modal appearing
         * @param {Element} modalContent - The house panel modal content element
         */
        async handleHouseModal(modalContent) {
            // Wait a moment for content to fully load
            await new Promise((resolve) => {
                const loadTimeout = setTimeout(resolve, 100);
                this.cleanupRegistry.registerTimeout(loadTimeout);
            });

            // Modal shows one room at a time, not a grid
            // Process the currently displayed room
            await this.processModalContent(modalContent);

            // Set up observer for room switching
            this.observeModalChanges(modalContent);
        }

        /**
         * Process the modal content (single room display)
         * @param {Element} modalContent - The house panel modal content
         */
        async processModalContent(modalContent) {
            // Identify which room is currently displayed
            const houseRoomHrid = this.identifyRoomFromModal(modalContent);

            if (!houseRoomHrid) {
                return;
            }

            // Find the costs section to add our column
            const costsSection = modalContent.querySelector('[class*="HousePanel_costs"]');

            if (!costsSection) {
                return;
            }

            // Add our cost display as a column
            await houseCostDisplay.addCostColumn(costsSection, houseRoomHrid, modalContent);
        }

        /**
         * Identify house room HRID from modal header
         * @param {Element} modalContent - The modal content element
         * @returns {string|null} House room HRID
         */
        identifyRoomFromModal(modalContent) {
            const initData = dataManager.getInitClientData();
            if (!initData || !initData.houseRoomDetailMap) {
                return null;
            }

            // Get room name from header
            const header = modalContent.querySelector('[class*="HousePanel_header"]');
            if (!header) {
                return null;
            }

            const roomName = header.textContent.trim();

            // Match against room names in game data
            for (const [hrid, roomData] of Object.entries(initData.houseRoomDetailMap)) {
                if (roomData.name === roomName) {
                    return hrid;
                }
            }

            return null;
        }

        /**
         * Observe modal for room switching
         * @param {Element} modalContent - The house panel modal content
         */
        observeModalChanges(modalContent) {
            const observer = domObserverHelpers_js.createMutationWatcher(
                modalContent,
                (mutations) => {
                    // Check if header changed (indicates room switch)
                    for (const mutation of mutations) {
                        if (mutation.type === 'childList' || mutation.type === 'characterData') {
                            const header = modalContent.querySelector('[class*="HousePanel_header"]');
                            if (header && mutation.target.contains(header)) {
                                // Room switched, reprocess
                                this.processModalContent(modalContent);
                                break;
                            }
                        }
                    }
                },
                {
                    childList: true,
                    subtree: true,
                    characterData: true,
                }
            );
            this.cleanupRegistry.registerCleanup(observer);
        }

        /**
         * Disable the observer
         */
        disable() {
            this.cleanup();
        }

        /**
         * Clean up observers
         */
        cleanup() {
            this.cleanupRegistry.cleanupAll();
            this.cleanupRegistry = cleanupRegistry_js.createCleanupRegistry();
            this.processedCards = new WeakSet();
            this.isActive = false;
        }
    }

    const housePanelObserver = new HousePanelObserver();

    var settingsCSS = "/* Toolasha Settings UI Styles\n * Modern, compact design\n */\n\n/* CSS Variables */\n:root {\n    --toolasha-accent: #5b8def;\n    --toolasha-accent-hover: #7aa3f3;\n    --toolasha-accent-dim: rgba(91, 141, 239, 0.15);\n    --toolasha-secondary: #8A2BE2;\n    --toolasha-text: rgba(255, 255, 255, 0.9);\n    --toolasha-text-dim: rgba(255, 255, 255, 0.5);\n    --toolasha-bg: rgba(20, 25, 35, 0.6);\n    --toolasha-border: rgba(91, 141, 239, 0.2);\n    --toolasha-toggle-off: rgba(100, 100, 120, 0.4);\n    --toolasha-toggle-on: var(--toolasha-accent);\n}\n\n/* Settings Card Container */\n.toolasha-settings-card {\n    display: flex;\n    flex-direction: column;\n    padding: 12px 16px;\n    font-size: 12px;\n    line-height: 1.3;\n    color: var(--toolasha-text);\n    position: relative;\n    overflow-y: auto;\n    gap: 6px;\n    max-height: calc(100vh - 250px);\n}\n\n/* Top gradient line */\n.toolasha-settings-card::before {\n    display: none;\n}\n\n/* Scrollbar styling */\n.toolasha-settings-card::-webkit-scrollbar {\n    width: 6px;\n}\n\n.toolasha-settings-card::-webkit-scrollbar-track {\n    background: transparent;\n}\n\n.toolasha-settings-card::-webkit-scrollbar-thumb {\n    background: var(--toolasha-accent);\n    border-radius: 3px;\n    opacity: 0.5;\n}\n\n.toolasha-settings-card::-webkit-scrollbar-thumb:hover {\n    opacity: 1;\n}\n\n/* Collapsible Settings Groups */\n.toolasha-settings-group {\n    margin-bottom: 8px;\n}\n\n.toolasha-settings-group-header {\n    cursor: pointer;\n    user-select: none;\n    margin: 10px 0 4px 0;\n    color: var(--toolasha-accent);\n    font-weight: 600;\n    font-size: 13px;\n    display: flex;\n    align-items: center;\n    gap: 6px;\n    border-bottom: 1px solid var(--toolasha-border);\n    padding-bottom: 3px;\n    text-transform: uppercase;\n    letter-spacing: 0.5px;\n    transition: color 0.2s ease;\n}\n\n.toolasha-settings-group-header:hover {\n    color: var(--toolasha-accent-hover);\n}\n\n.toolasha-settings-group-header .collapse-icon {\n    font-size: 10px;\n    transition: transform 0.2s ease;\n}\n\n.toolasha-settings-group.collapsed .collapse-icon {\n    transform: rotate(-90deg);\n}\n\n.toolasha-settings-group-content {\n    max-height: 5000px;\n    overflow: hidden;\n    transition: max-height 0.3s ease-out;\n}\n\n.toolasha-settings-group.collapsed .toolasha-settings-group-content {\n    max-height: 0;\n}\n\n/* Section Headers */\n.toolasha-settings-card h3 {\n    margin: 10px 0 4px 0;\n    color: var(--toolasha-accent);\n    font-weight: 600;\n    font-size: 13px;\n    display: flex;\n    align-items: center;\n    gap: 6px;\n    border-bottom: 1px solid var(--toolasha-border);\n    padding-bottom: 3px;\n    text-transform: uppercase;\n    letter-spacing: 0.5px;\n}\n\n.toolasha-settings-card h3:first-child {\n    margin-top: 0;\n}\n\n.toolasha-settings-card h3 .icon {\n    font-size: 14px;\n}\n\n/* Individual Setting Row */\n.toolasha-setting {\n    display: flex;\n    align-items: center;\n    justify-content: space-between;\n    gap: 10px;\n    margin: 0;\n    padding: 6px 8px;\n    background: var(--toolasha-bg);\n    border: 1px solid var(--toolasha-border);\n    border-radius: 4px;\n    min-height: unset;\n    transition: all 0.2s ease;\n}\n\n.toolasha-setting:hover {\n    background: rgba(30, 35, 45, 0.7);\n    border-color: var(--toolasha-accent);\n}\n\n.toolasha-setting.disabled {\n    opacity: 0.3;\n    pointer-events: none;\n}\n\n.toolasha-setting.not-implemented .toolasha-setting-label {\n    color: #ff6b6b;\n}\n\n.toolasha-setting.not-implemented .toolasha-setting-help {\n    color: rgba(255, 107, 107, 0.7);\n}\n\n.toolasha-setting-label {\n    text-align: left;\n    flex: 1;\n    margin-right: 10px;\n    line-height: 1.3;\n    font-size: 12px;\n}\n\n.toolasha-setting-help {\n    display: block;\n    font-size: 10px;\n    color: var(--toolasha-text-dim);\n    margin-top: 2px;\n    font-style: italic;\n}\n\n.toolasha-setting-input {\n    flex-shrink: 0;\n}\n\n/* Modern Toggle Switch */\n.toolasha-switch {\n    position: relative;\n    width: 38px;\n    height: 20px;\n    flex-shrink: 0;\n    display: inline-block;\n}\n\n.toolasha-switch input {\n    opacity: 0;\n    width: 0;\n    height: 0;\n    position: absolute;\n}\n\n.toolasha-slider {\n    position: absolute;\n    top: 0;\n    left: 0;\n    right: 0;\n    bottom: 0;\n    background: var(--toolasha-toggle-off);\n    border-radius: 20px;\n    cursor: pointer;\n    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);\n    border: 2px solid transparent;\n}\n\n.toolasha-slider:before {\n    content: \"\";\n    position: absolute;\n    height: 12px;\n    width: 12px;\n    left: 2px;\n    bottom: 2px;\n    background: white;\n    border-radius: 50%;\n    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);\n    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);\n}\n\n.toolasha-switch input:checked + .toolasha-slider {\n    background: var(--toolasha-toggle-on);\n    border-color: var(--toolasha-accent-hover);\n    box-shadow: 0 0 6px var(--toolasha-accent-dim);\n}\n\n.toolasha-switch input:checked + .toolasha-slider:before {\n    transform: translateX(18px);\n}\n\n.toolasha-switch:hover .toolasha-slider {\n    border-color: var(--toolasha-accent);\n}\n\n/* Text Input */\n.toolasha-text-input {\n    padding: 5px 8px;\n    border: 1px solid var(--toolasha-border);\n    border-radius: 3px;\n    background: rgba(0, 0, 0, 0.3);\n    color: var(--toolasha-text);\n    min-width: 100px;\n    font-size: 12px;\n    transition: all 0.2s ease;\n}\n\n.toolasha-text-input:focus {\n    outline: none;\n    border-color: var(--toolasha-accent);\n    box-shadow: 0 0 0 2px var(--toolasha-accent-dim);\n}\n\n/* Number Input */\n.toolasha-number-input {\n    padding: 5px 8px;\n    border: 1px solid var(--toolasha-border);\n    border-radius: 3px;\n    background: rgba(0, 0, 0, 0.3);\n    color: var(--toolasha-text);\n    min-width: 80px;\n    font-size: 12px;\n    transition: all 0.2s ease;\n}\n\n.toolasha-number-input:focus {\n    outline: none;\n    border-color: var(--toolasha-accent);\n    box-shadow: 0 0 0 2px var(--toolasha-accent-dim);\n}\n\n/* Select Dropdown */\n.toolasha-select-input {\n    padding: 5px 8px;\n    border: 1px solid var(--toolasha-border);\n    border-radius: 3px;\n    background: rgba(0, 0, 0, 0.3);\n    color: var(--toolasha-accent);\n    font-weight: 600;\n    min-width: 150px;\n    cursor: pointer;\n    font-size: 12px;\n    -webkit-appearance: none;\n    -moz-appearance: none;\n    appearance: none;\n    background-image: url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M5%207l5%205%205-5z%22%20fill%3D%22%235b8def%22%2F%3E%3C%2Fsvg%3E');\n    background-repeat: no-repeat;\n    background-position: right 6px center;\n    background-size: 14px;\n    padding-right: 28px;\n    transition: all 0.2s ease;\n}\n\n.toolasha-select-input:focus {\n    outline: none;\n    border-color: var(--toolasha-accent);\n    box-shadow: 0 0 0 2px var(--toolasha-accent-dim);\n}\n\n.toolasha-select-input option {\n    background: #1a1a2e;\n    color: var(--toolasha-text);\n    padding: 8px;\n}\n\n/* Utility Buttons Container */\n.toolasha-utility-buttons {\n    display: flex;\n    gap: 8px;\n    margin-top: 12px;\n    padding-top: 10px;\n    border-top: 1px solid var(--toolasha-border);\n    flex-wrap: wrap;\n}\n\n.toolasha-utility-button {\n    background: linear-gradient(135deg, var(--toolasha-secondary), #6A1B9A);\n    border: 1px solid rgba(138, 43, 226, 0.4);\n    color: #ffffff;\n    padding: 6px 12px;\n    border-radius: 4px;\n    font-size: 11px;\n    font-weight: 600;\n    cursor: pointer;\n    transition: all 0.2s ease;\n    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);\n}\n\n.toolasha-utility-button:hover {\n    background: linear-gradient(135deg, #9A4BCF, var(--toolasha-secondary));\n    box-shadow: 0 0 10px rgba(138, 43, 226, 0.3);\n    transform: translateY(-1px);\n}\n\n.toolasha-utility-button:active {\n    transform: translateY(0);\n}\n\n/* Sync button - special styling for prominence */\n.toolasha-sync-button {\n    background: linear-gradient(135deg, #047857, #059669) !important;\n    border: 1px solid rgba(4, 120, 87, 0.4) !important;\n    flex: 1 1 auto; /* Allow it to grow and take more space */\n    min-width: 200px; /* Ensure it's wide enough for the text */\n}\n\n.toolasha-sync-button:hover {\n    background: linear-gradient(135deg, #059669, #10b981) !important;\n    box-shadow: 0 0 10px rgba(16, 185, 129, 0.3) !important;\n}\n\n/* Refresh Notice */\n.toolasha-refresh-notice {\n    background: rgba(255, 152, 0, 0.1);\n    border: 1px solid rgba(255, 152, 0, 0.3);\n    border-radius: 4px;\n    padding: 8px 12px;\n    margin-top: 10px;\n    color: #ffa726;\n    font-size: 11px;\n    display: flex;\n    align-items: center;\n    gap: 8px;\n}\n\n.toolasha-refresh-notice::before {\n    content: \"⚠️\";\n    font-size: 14px;\n}\n\n/* Dependency Indicator */\n.toolasha-setting.has-dependency::before {\n    content: \"↳\";\n    position: absolute;\n    left: -4px;\n    color: var(--toolasha-accent);\n    font-size: 14px;\n    opacity: 0.5;\n}\n\n.toolasha-setting.has-dependency {\n    margin-left: 16px;\n    position: relative;\n}\n\n/* Nested setting collapse icons */\n.setting-collapse-icon {\n    flex-shrink: 0;\n    color: var(--toolasha-accent);\n    opacity: 0.7;\n}\n\n.toolasha-setting.dependents-collapsed .setting-collapse-icon {\n    opacity: 1;\n}\n\n.toolasha-setting-label-container:hover .setting-collapse-icon {\n    opacity: 1;\n}\n\n/* Tab Panel Override (for game's settings panel) */\n.TabPanel_tabPanel__tXMJF#toolasha-settings {\n    display: block !important;\n}\n\n.TabPanel_tabPanel__tXMJF#toolasha-settings.TabPanel_hidden__26UM3 {\n    display: none !important;\n}\n";

    /**
     * Settings UI Module
     * Injects Toolasha settings tab into the game's settings panel
     * Based on MWITools Extended approach
     */


    class SettingsUI {
        constructor() {
            this.config = config;
            this.settingsPanel = null;
            this.settingsObserver = null;
            this.settingsObserverCleanup = null;
            this.currentSettings = {};
            this.isInjecting = false; // Guard against concurrent injection
            this.characterSwitchHandler = null; // Store listener reference to prevent duplicates
            this.settingsPanelCallbacks = []; // Callbacks to run when settings panel appears
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
        }

        /**
         * Initialize the settings UI
         */
        async initialize() {
            // Inject CSS styles (check if already injected)
            if (!document.getElementById('toolasha-settings-styles')) {
                this.injectStyles();
            }

            // Load current settings
            this.currentSettings = await settingsStorage.loadSettings();

            // Set up handler for character switching (ONLY if not already registered)
            if (!this.characterSwitchHandler) {
                this.characterSwitchHandler = () => {
                    this.handleCharacterSwitch();
                };
                dataManager.on('character_initialized', this.characterSwitchHandler);
            }

            // Wait for game's settings panel to load
            this.observeSettingsPanel();
        }

        /**
         * Register a callback to be called when settings panel appears
         * @param {Function} callback - Function to call when settings panel is detected
         */
        onSettingsPanelAppear(callback) {
            if (typeof callback === 'function') {
                this.settingsPanelCallbacks.push(callback);
            }
        }

        /**
         * Handle character switch
         * Clean up old observers and re-initialize for new character's settings panel
         */
        handleCharacterSwitch() {
            // Clean up old DOM references and observers (but keep listener registered)
            this.cleanupDOM();

            // Wait for settings panel to stabilize before re-observing
            const reobserveTimeout = setTimeout(() => {
                this.observeSettingsPanel();
            }, 500);
            this.timerRegistry.registerTimeout(reobserveTimeout);
        }

        /**
         * Cleanup DOM elements and observers only (internal cleanup during character switch)
         */
        cleanupDOM() {
            this.timerRegistry.clearAll();

            // Stop observer
            if (this.settingsObserver) {
                this.settingsObserver.disconnect();
                this.settingsObserver = null;
            }

            if (this.settingsObserverCleanup) {
                this.settingsObserverCleanup();
                this.settingsObserverCleanup = null;
            }

            // Remove settings tab
            const tab = document.querySelector('#toolasha-settings-tab');
            if (tab) {
                tab.remove();
            }

            // Remove settings panel
            const panel = document.querySelector('#toolasha-settings');
            if (panel) {
                panel.remove();
            }

            // Clear state
            this.settingsPanel = null;
            this.currentSettings = {};
            this.isInjecting = false;

            // Clear config cache
            this.config.clearSettingsCache();
        }

        /**
         * Inject CSS styles into page
         */
        injectStyles() {
            const styleEl = document.createElement('style');
            styleEl.id = 'toolasha-settings-styles';
            styleEl.textContent = settingsCSS;
            document.head.appendChild(styleEl);
        }

        /**
         * Observe for game's settings panel
         * Uses MutationObserver to detect when settings panel appears
         */
        observeSettingsPanel() {
            // Wait for DOM to be ready before observing
            const startObserver = () => {
                if (!document.body) {
                    const observerDelay = setTimeout(startObserver, 10);
                    this.timerRegistry.registerTimeout(observerDelay);
                    return;
                }

                const onMutation = (_mutations) => {
                    // Look for the settings tabs container
                    const tabsContainer = document.querySelector('div[class*="SettingsPanel_tabsComponentContainer"]');

                    if (tabsContainer) {
                        // Check if our tab already exists before injecting
                        if (!tabsContainer.querySelector('#toolasha-settings-tab')) {
                            this.injectSettingsTab();
                        }

                        // Call registered callbacks for other features
                        this.settingsPanelCallbacks.forEach((callback) => {
                            try {
                                callback();
                            } catch (error) {
                                console.error('[Toolasha Settings] Callback error:', error);
                            }
                        });

                        // Keep observer running - panel might be removed/re-added if user navigates away and back
                    }
                };

                // Observe the main game panel for changes
                const gamePanel = document.querySelector('div[class*="GamePage_gamePanel"]');
                if (gamePanel) {
                    this.settingsObserverCleanup = domObserverHelpers_js.createMutationWatcher(gamePanel, onMutation, {
                        childList: true,
                        subtree: true,
                    });
                } else {
                    // Fallback: observe entire body if game panel not found (Firefox timing issue)
                    console.warn('[Toolasha Settings] Could not find game panel, observing body instead');
                    this.settingsObserverCleanup = domObserverHelpers_js.createMutationWatcher(document.body, onMutation, {
                        childList: true,
                        subtree: true,
                    });
                }

                // Store observer reference (for compatibility with existing cleanup path)
                this.settingsObserver = null;

                // Also check immediately in case settings is already open
                const existingTabsContainer = document.querySelector('div[class*="SettingsPanel_tabsComponentContainer"]');
                if (existingTabsContainer && !existingTabsContainer.querySelector('#toolasha-settings-tab')) {
                    this.injectSettingsTab();

                    // Call registered callbacks for other features
                    this.settingsPanelCallbacks.forEach((callback) => {
                        try {
                            callback();
                        } catch (error) {
                            console.error('[Toolasha Settings] Callback error:', error);
                        }
                    });
                }
            };

            startObserver();
        }

        /**
         * Inject Toolasha settings tab into game's settings panel
         */
        async injectSettingsTab() {
            // Guard against concurrent injection
            if (this.isInjecting) {
                return;
            }
            this.isInjecting = true;

            try {
                // Find tabs container (MWIt-E approach)
                const tabsComponentContainer = document.querySelector('div[class*="SettingsPanel_tabsComponentContainer"]');

                if (!tabsComponentContainer) {
                    console.warn('[Toolasha Settings] Could not find tabsComponentContainer');
                    return;
                }

                // Find the MUI tabs flexContainer
                const tabsContainer = tabsComponentContainer.querySelector('[class*="MuiTabs-flexContainer"]');
                const tabPanelsContainer = tabsComponentContainer.querySelector(
                    '[class*="TabsComponent_tabPanelsContainer"]'
                );

                if (!tabsContainer || !tabPanelsContainer) {
                    console.warn('[Toolasha Settings] Could not find tabs or panels container');
                    return;
                }

                // Check if already injected
                if (tabsContainer.querySelector('#toolasha-settings-tab')) {
                    return;
                }

                // Reload current settings from storage to ensure latest values
                this.currentSettings = await settingsStorage.loadSettings();

                // Get existing tabs for reference
                const existingTabs = Array.from(tabsContainer.querySelectorAll('button[role="tab"]'));

                // Create new tab button
                const tabButton = this.createTabButton();

                // Create tab panel
                const tabPanel = this.createTabPanel();

                // Setup tab switching
                this.setupTabSwitching(tabButton, tabPanel, existingTabs, tabPanelsContainer);

                // Append to DOM
                tabsContainer.appendChild(tabButton);
                tabPanelsContainer.appendChild(tabPanel);

                // Store reference
                this.settingsPanel = tabPanel;
            } catch (error) {
                console.error('[Toolasha Settings] Error during tab injection:', error);
            } finally {
                // Always reset the guard flag
                this.isInjecting = false;
            }
        }

        /**
         * Create tab button
         * @returns {HTMLElement} Tab button element
         */
        createTabButton() {
            const button = document.createElement('button');
            button.id = 'toolasha-settings-tab';
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-selected', 'false');
            button.setAttribute('tabindex', '-1');
            button.className = 'MuiButtonBase-root MuiTab-root MuiTab-textColorPrimary';
            button.style.minWidth = '90px';

            const span = document.createElement('span');
            span.className = 'MuiTab-wrapper';
            span.textContent = 'Toolasha';

            button.appendChild(span);

            return button;
        }

        /**
         * Create tab panel with all settings
         * @returns {HTMLElement} Tab panel element
         */
        createTabPanel() {
            const panel = document.createElement('div');
            panel.id = 'toolasha-settings';
            panel.className = 'TabPanel_tabPanel__tXMJF TabPanel_hidden__26UM3';
            panel.setAttribute('role', 'tabpanel');
            panel.style.display = 'none';

            // Create settings card
            const card = document.createElement('div');
            card.className = 'toolasha-settings-card';
            card.id = 'toolasha-settings-content';

            // Add search box at the top
            this.addSearchBox(card);

            // Generate settings from config
            this.generateSettings(card);

            // Add utility buttons
            this.addUtilityButtons(card);

            // Add refresh notice
            this.addRefreshNotice(card);

            panel.appendChild(card);

            // Add change listener
            card.addEventListener('change', (e) => this.handleSettingChange(e));

            // Add click listener for template edit buttons
            card.addEventListener('click', (e) => {
                if (e.target.classList.contains('toolasha-template-edit-btn')) {
                    const settingId = e.target.dataset.settingId;
                    this.openTemplateEditor(settingId);
                }
            });

            return panel;
        }

        /**
         * Generate all settings UI from config
         * @param {HTMLElement} container - Container element
         */
        generateSettings(container) {
            for (const [groupKey, group] of Object.entries(settingsSchema_js.settingsGroups)) {
                // Create collapsible group container
                const groupContainer = document.createElement('div');
                groupContainer.className = 'toolasha-settings-group';
                groupContainer.dataset.group = groupKey;

                // Add section header with collapse toggle
                const header = document.createElement('h3');
                header.className = 'toolasha-settings-group-header';
                header.innerHTML = `
                <span class="collapse-icon">▼</span>
                <span class="icon">${group.icon}</span>
                ${group.title}
            `;
                // Bind toggleGroup method to this instance
                header.addEventListener('click', this.toggleGroup.bind(this, groupContainer));

                // Create content container for this group
                const content = document.createElement('div');
                content.className = 'toolasha-settings-group-content';

                // Add settings in this group
                for (const [settingId, settingDef] of Object.entries(group.settings)) {
                    const settingEl = this.createSettingElement(settingId, settingDef);
                    content.appendChild(settingEl);
                }

                groupContainer.appendChild(header);
                groupContainer.appendChild(content);
                container.appendChild(groupContainer);
            }

            // After all settings are created, set up collapse functionality for parent settings
            this.setupParentCollapseIcons(container);

            // Restore collapse states from IndexedDB storage
            this.restoreCollapseStates(container);
        }

        /**
         * Setup collapse icons for parent settings (settings that have dependents)
         * @param {HTMLElement} container - Settings container
         */
        setupParentCollapseIcons(container) {
            const allSettings = container.querySelectorAll('.toolasha-setting');

            allSettings.forEach((setting) => {
                const settingId = setting.dataset.settingId;

                // Find all dependents of this setting
                const dependents = Array.from(allSettings).filter(
                    (s) => s.dataset.dependencies && s.dataset.dependencies.split(',').includes(settingId)
                );

                if (dependents.length > 0) {
                    // This setting has dependents - show collapse icon
                    const collapseIcon = setting.querySelector('.setting-collapse-icon');
                    if (collapseIcon) {
                        collapseIcon.style.display = 'inline-block';

                        // Add click handler to toggle dependents - bind to preserve this context
                        const labelContainer = setting.querySelector('.toolasha-setting-label-container');
                        labelContainer.style.cursor = 'pointer';
                        labelContainer.addEventListener('click', (e) => {
                            // Don't toggle if clicking the input itself
                            if (e.target.closest('.toolasha-setting-input')) return;

                            this.toggleDependents(setting, dependents);
                        });
                    }
                }
            });
        }

        /**
         * Toggle group collapse/expand
         * @param {HTMLElement} groupContainer - Group container element
         */
        toggleGroup(groupContainer) {
            groupContainer.classList.toggle('collapsed');

            // Save collapse state to IndexedDB storage
            const groupKey = groupContainer.dataset.group;
            const isCollapsed = groupContainer.classList.contains('collapsed');
            this.saveCollapseState('group', groupKey, isCollapsed);
        }

        /**
         * Toggle dependent settings visibility
         * @param {HTMLElement} parentSetting - Parent setting element
         * @param {HTMLElement[]} dependents - Array of dependent setting elements
         */
        toggleDependents(parentSetting, dependents) {
            const collapseIcon = parentSetting.querySelector('.setting-collapse-icon');
            const isCollapsed = parentSetting.classList.contains('dependents-collapsed');

            if (isCollapsed) {
                // Expand
                parentSetting.classList.remove('dependents-collapsed');
                collapseIcon.style.transform = 'rotate(0deg)';
                dependents.forEach((dep) => (dep.style.display = 'flex'));
            } else {
                // Collapse
                parentSetting.classList.add('dependents-collapsed');
                collapseIcon.style.transform = 'rotate(-90deg)';
                dependents.forEach((dep) => (dep.style.display = 'none'));
            }

            // Save collapse state to IndexedDB storage
            const settingId = parentSetting.dataset.settingId;
            const newState = !isCollapsed; // Inverted because we just toggled
            this.saveCollapseState('setting', settingId, newState);
        }

        /**
         * Save collapse state to IndexedDB
         * @param {string} type - 'group' or 'setting'
         * @param {string} key - Group key or setting ID
         * @param {boolean} isCollapsed - Whether collapsed
         */
        async saveCollapseState(type, key, isCollapsed) {
            try {
                const states = await storage.getJSON('collapse-states', 'settings', {});

                if (!states[type]) {
                    states[type] = {};
                }
                states[type][key] = isCollapsed;

                await storage.setJSON('collapse-states', states, 'settings');
            } catch (e) {
                console.warn('[Toolasha Settings] Failed to save collapse states:', e);
            }
        }

        /**
         * Load collapse state from IndexedDB
         * @param {string} type - 'group' or 'setting'
         * @param {string} key - Group key or setting ID
         * @returns {Promise<boolean|null>} Collapse state or null if not found
         */
        async loadCollapseState(type, key) {
            try {
                const states = await storage.getJSON('collapse-states', 'settings', {});
                return states[type]?.[key] ?? null;
            } catch (e) {
                console.warn('[Toolasha Settings] Failed to load collapse states:', e);
                return null;
            }
        }

        /**
         * Restore collapse states from IndexedDB
         * @param {HTMLElement} container - Settings container
         */
        async restoreCollapseStates(container) {
            try {
                // Restore group collapse states
                const groups = container.querySelectorAll('.toolasha-settings-group');
                for (const group of groups) {
                    const groupKey = group.dataset.group;
                    const isCollapsed = await this.loadCollapseState('group', groupKey);
                    if (isCollapsed === true) {
                        group.classList.add('collapsed');
                    }
                }

                // Restore setting collapse states
                const settings = container.querySelectorAll('.toolasha-setting');
                for (const setting of settings) {
                    const settingId = setting.dataset.settingId;
                    const isCollapsed = await this.loadCollapseState('setting', settingId);

                    if (isCollapsed === true) {
                        setting.classList.add('dependents-collapsed');

                        // Update collapse icon rotation
                        const collapseIcon = setting.querySelector('.setting-collapse-icon');
                        if (collapseIcon) {
                            collapseIcon.style.transform = 'rotate(-90deg)';
                        }

                        // Hide dependents
                        const allSettings = container.querySelectorAll('.toolasha-setting');
                        const dependents = Array.from(allSettings).filter(
                            (s) => s.dataset.dependencies && s.dataset.dependencies.split(',').includes(settingId)
                        );
                        dependents.forEach((dep) => (dep.style.display = 'none'));
                    }
                }
            } catch (e) {
                console.warn('[Toolasha Settings] Failed to restore collapse states:', e);
            }
        }

        /**
         * Create a single setting UI element
         * @param {string} settingId - Setting ID
         * @param {Object} settingDef - Setting definition
         * @returns {HTMLElement} Setting element
         */
        createSettingElement(settingId, settingDef) {
            const div = document.createElement('div');
            div.className = 'toolasha-setting';
            div.dataset.settingId = settingId;
            div.dataset.type = settingDef.type || 'checkbox';

            // Add dependency class and store dependency info
            if (settingDef.dependencies) {
                div.classList.add('has-dependency');

                // Handle both array format (legacy, AND logic) and object format (supports OR logic)
                if (Array.isArray(settingDef.dependencies)) {
                    // Legacy format: ['dep1', 'dep2'] means AND logic
                    div.dataset.dependencies = settingDef.dependencies.join(',');
                    div.dataset.dependencyMode = 'all'; // AND logic
                } else if (typeof settingDef.dependencies === 'object') {
                    // New format: {mode: 'any', settings: ['dep1', 'dep2']}
                    div.dataset.dependencies = settingDef.dependencies.settings.join(',');
                    div.dataset.dependencyMode = settingDef.dependencies.mode || 'all'; // 'any' = OR, 'all' = AND
                }
            }

            // Add not-implemented class for red text
            if (settingDef.notImplemented) {
                div.classList.add('not-implemented');
            }

            // Create label container (clickable for collapse if has dependents)
            const labelContainer = document.createElement('div');
            labelContainer.className = 'toolasha-setting-label-container';
            labelContainer.style.display = 'flex';
            labelContainer.style.alignItems = 'center';
            labelContainer.style.flex = '1';
            labelContainer.style.gap = '6px';

            // Add collapse icon if this setting has dependents (will be populated by checkDependents)
            const collapseIcon = document.createElement('span');
            collapseIcon.className = 'setting-collapse-icon';
            collapseIcon.textContent = '▼';
            collapseIcon.style.display = 'none'; // Hidden by default, shown if dependents exist
            collapseIcon.style.cursor = 'pointer';
            collapseIcon.style.fontSize = '10px';
            collapseIcon.style.transition = 'transform 0.2s ease';

            // Create label
            const label = document.createElement('span');
            label.className = 'toolasha-setting-label';
            label.textContent = settingDef.label;

            // Add help text if present
            if (settingDef.help) {
                const help = document.createElement('span');
                help.className = 'toolasha-setting-help';
                help.textContent = settingDef.help;
                label.appendChild(help);
            }

            labelContainer.appendChild(collapseIcon);
            labelContainer.appendChild(label);

            // Create input
            const inputHTML = this.generateSettingInput(settingId, settingDef);
            const inputContainer = document.createElement('div');
            inputContainer.className = 'toolasha-setting-input';
            inputContainer.innerHTML = inputHTML;

            div.appendChild(labelContainer);
            div.appendChild(inputContainer);

            return div;
        }

        /**
         * Generate input HTML for a setting
         * @param {string} settingId - Setting ID
         * @param {Object} settingDef - Setting definition
         * @returns {string} Input HTML
         */
        generateSettingInput(settingId, settingDef) {
            const currentSetting = this.currentSettings[settingId];
            const type = settingDef.type || 'checkbox';

            switch (type) {
                case 'checkbox': {
                    const checked = currentSetting?.isTrue ?? settingDef.default ?? false;
                    return `
                    <label class="toolasha-switch">
                        <input type="checkbox" id="${settingId}" ${checked ? 'checked' : ''}>
                        <span class="toolasha-slider"></span>
                    </label>
                `;
                }

                case 'text': {
                    const value = currentSetting?.value ?? settingDef.default ?? '';
                    return `
                    <input type="text"
                        id="${settingId}"
                        class="toolasha-text-input"
                        value="${value}"
                        placeholder="${settingDef.placeholder || ''}">
                `;
                }

                case 'template': {
                    const value = currentSetting?.value ?? settingDef.default ?? [];
                    // Store as JSON string
                    const jsonValue = JSON.stringify(value);
                    const escapedValue = jsonValue.replace(/"/g, '&quot;');

                    return `
                    <input type="hidden"
                        id="${settingId}"
                        value="${escapedValue}">
                    <button type="button"
                        class="toolasha-template-edit-btn"
                        data-setting-id="${settingId}"
                        style="
                            background: #4a7c59;
                            border: 1px solid #5a8c69;
                            border-radius: 4px;
                            padding: 6px 12px;
                            color: #e0e0e0;
                            cursor: pointer;
                            font-size: 13px;
                            white-space: nowrap;
                            transition: all 0.2s;
                        ">
                        Edit Template
                    </button>
                `;
                }

                case 'number': {
                    const value = currentSetting?.value ?? settingDef.default ?? 0;
                    return `
                    <input type="number"
                        id="${settingId}"
                        class="toolasha-number-input"
                        value="${value}"
                        min="${settingDef.min ?? ''}"
                        max="${settingDef.max ?? ''}"
                        step="${settingDef.step ?? '1'}">
                `;
                }

                case 'select': {
                    const value = currentSetting?.value ?? settingDef.default ?? '';
                    const options = settingDef.options || [];
                    const optionsHTML = options
                        .map((option) => {
                            const optValue = typeof option === 'object' ? option.value : option;
                            const optLabel = typeof option === 'object' ? option.label : option;
                            const selected = optValue === value ? 'selected' : '';
                            return `<option value="${optValue}" ${selected}>${optLabel}</option>`;
                        })
                        .join('');

                    return `
                    <select id="${settingId}" class="toolasha-select-input">
                        ${optionsHTML}
                    </select>
                `;
                }

                case 'color': {
                    const value = currentSetting?.value ?? settingDef.value ?? settingDef.default ?? '#000000';
                    return `
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <input type="color"
                            id="${settingId}"
                            class="toolasha-color-input"
                            value="${value}">
                        <input type="text"
                            id="${settingId}_text"
                            class="toolasha-color-text-input"
                            value="${value}"
                            style="width: 80px; padding: 4px; background: #2a2a2a; color: white; border: 1px solid #555; border-radius: 3px;"
                            readonly>
                    </div>
                `;
                }

                case 'slider': {
                    const value = currentSetting?.value ?? settingDef.default ?? 0;
                    return `
                    <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
                        <input type="range"
                            id="${settingId}"
                            class="toolasha-slider-input"
                            value="${value}"
                            min="${settingDef.min ?? 0}"
                            max="${settingDef.max ?? 1}"
                            step="${settingDef.step ?? 0.01}"
                            style="flex: 1;">
                        <span id="${settingId}_value" class="toolasha-slider-value" style="min-width: 50px; color: #aaa; font-size: 0.9em;">${value}</span>
                    </div>
                `;
                }

                default:
                    return `<span style="color: red;">Unknown type: ${type}</span>`;
            }
        }

        /**
         * Add search box to filter settings
         * @param {HTMLElement} container - Container element
         */
        addSearchBox(container) {
            const searchContainer = document.createElement('div');
            searchContainer.className = 'toolasha-search-container';
            searchContainer.style.cssText = `
            margin-bottom: 20px;
            display: flex;
            gap: 8px;
            align-items: center;
        `;

            // Search input
            const searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.className = 'toolasha-search-input';
            searchInput.placeholder = 'Search settings...';
            searchInput.style.cssText = `
            flex: 1;
            padding: 8px 12px;
            background: #2a2a2a;
            color: white;
            border: 1px solid #555;
            border-radius: 4px;
            font-size: 14px;
        `;

            // Clear button
            const clearButton = document.createElement('button');
            clearButton.textContent = 'Clear';
            clearButton.className = 'toolasha-search-clear';
            clearButton.style.cssText = `
            padding: 8px 16px;
            background: #444;
            color: white;
            border: 1px solid #555;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        `;
            clearButton.style.display = 'none'; // Hidden by default

            // Filter function
            const filterSettings = (query) => {
                const lowerQuery = query.toLowerCase().trim();

                // If query is empty, show everything
                if (!lowerQuery) {
                    // Show all settings
                    document.querySelectorAll('.toolasha-setting').forEach((setting) => {
                        setting.style.display = 'flex';
                    });
                    // Show all groups
                    document.querySelectorAll('.toolasha-settings-group').forEach((group) => {
                        group.style.display = 'block';
                    });
                    clearButton.style.display = 'none';
                    return;
                }

                clearButton.style.display = 'block';

                // Filter settings
                document.querySelectorAll('.toolasha-settings-group').forEach((group) => {
                    let visibleCount = 0;

                    group.querySelectorAll('.toolasha-setting').forEach((setting) => {
                        const label = setting.querySelector('.toolasha-setting-label')?.textContent || '';
                        const help = setting.querySelector('.toolasha-setting-help')?.textContent || '';
                        const searchText = (label + ' ' + help).toLowerCase();

                        if (searchText.includes(lowerQuery)) {
                            setting.style.display = 'flex';
                            visibleCount++;
                        } else {
                            setting.style.display = 'none';
                        }
                    });

                    // Hide group if no visible settings
                    if (visibleCount === 0) {
                        group.style.display = 'none';
                    } else {
                        group.style.display = 'block';
                    }
                });
            };

            // Input event listener
            searchInput.addEventListener('input', (e) => {
                filterSettings(e.target.value);
            });

            // Clear button event listener
            clearButton.addEventListener('click', () => {
                searchInput.value = '';
                filterSettings('');
                searchInput.focus();
            });

            searchContainer.appendChild(searchInput);
            searchContainer.appendChild(clearButton);
            container.appendChild(searchContainer);
        }

        /**
         * Add utility buttons (Reset, Export, Import, Fetch Prices)
         * @param {HTMLElement} container - Container element
         */
        addUtilityButtons(container) {
            const buttonsDiv = document.createElement('div');
            buttonsDiv.className = 'toolasha-utility-buttons';

            // Sync button (at top - most important)
            const syncBtn = document.createElement('button');
            syncBtn.textContent = 'Copy Settings to All Characters';
            syncBtn.className = 'toolasha-utility-button toolasha-sync-button';
            syncBtn.addEventListener('click', () => this.handleSync());

            // Fetch Latest Prices button
            const fetchPricesBtn = document.createElement('button');
            fetchPricesBtn.textContent = '🔄 Fetch Latest Prices';
            fetchPricesBtn.className = 'toolasha-utility-button toolasha-fetch-prices-button';
            fetchPricesBtn.addEventListener('click', () => this.handleFetchPrices(fetchPricesBtn));

            // Reset button
            const resetBtn = document.createElement('button');
            resetBtn.textContent = 'Reset to Defaults';
            resetBtn.className = 'toolasha-utility-button';
            resetBtn.addEventListener('click', () => this.handleReset());

            // Export button
            const exportBtn = document.createElement('button');
            exportBtn.textContent = 'Export Settings';
            exportBtn.className = 'toolasha-utility-button';
            exportBtn.addEventListener('click', () => this.handleExport());

            // Import button
            const importBtn = document.createElement('button');
            importBtn.textContent = 'Import Settings';
            importBtn.className = 'toolasha-utility-button';
            importBtn.addEventListener('click', () => this.handleImport());

            buttonsDiv.appendChild(syncBtn);
            buttonsDiv.appendChild(fetchPricesBtn);
            buttonsDiv.appendChild(resetBtn);
            buttonsDiv.appendChild(exportBtn);
            buttonsDiv.appendChild(importBtn);

            container.appendChild(buttonsDiv);
        }

        /**
         * Add refresh notice
         * @param {HTMLElement} container - Container element
         */
        addRefreshNotice(container) {
            const notice = document.createElement('div');
            notice.className = 'toolasha-refresh-notice';
            notice.textContent = 'Some settings require a page refresh to take effect';
            container.appendChild(notice);
        }

        /**
         * Setup tab switching functionality
         * @param {HTMLElement} tabButton - Toolasha tab button
         * @param {HTMLElement} tabPanel - Toolasha tab panel
         * @param {HTMLElement[]} existingTabs - Existing tab buttons
         * @param {HTMLElement} tabPanelsContainer - Tab panels container
         */
        setupTabSwitching(tabButton, tabPanel, existingTabs, tabPanelsContainer) {
            const switchToTab = (targetButton, targetPanel) => {
                // Hide all panels
                const allPanels = tabPanelsContainer.querySelectorAll('[class*="TabPanel_tabPanel"]');
                allPanels.forEach((panel) => {
                    panel.style.display = 'none';
                    panel.classList.add('TabPanel_hidden__26UM3');
                });

                // Deactivate all buttons
                const allButtons = document.querySelectorAll('button[role="tab"]');
                allButtons.forEach((btn) => {
                    btn.setAttribute('aria-selected', 'false');
                    btn.setAttribute('tabindex', '-1');
                    btn.classList.remove('Mui-selected');
                });

                // Activate target
                targetButton.setAttribute('aria-selected', 'true');
                targetButton.setAttribute('tabindex', '0');
                targetButton.classList.add('Mui-selected');
                targetPanel.style.display = 'block';
                targetPanel.classList.remove('TabPanel_hidden__26UM3');

                // Update title
                const titleEl = document.querySelector('[class*="SettingsPanel_title"]');
                if (titleEl) {
                    if (targetButton.id === 'toolasha-settings-tab') {
                        titleEl.textContent = '⚙️ Toolasha Settings (refresh to apply)';
                    } else {
                        titleEl.textContent = 'Settings';
                    }
                }
            };

            // Click handler for Toolasha tab
            tabButton.addEventListener('click', () => {
                switchToTab(tabButton, tabPanel);
            });

            // Click handlers for existing tabs
            existingTabs.forEach((existingTab, index) => {
                existingTab.addEventListener('click', () => {
                    const correspondingPanel = tabPanelsContainer.children[index];
                    if (correspondingPanel) {
                        switchToTab(existingTab, correspondingPanel);
                    }
                });
            });
        }

        /**
         * Handle setting change
         * @param {Event} event - Change event
         */
        async handleSettingChange(event) {
            const input = event.target;
            if (!input.id) return;

            const settingId = input.id;
            const type = input.closest('.toolasha-setting')?.dataset.type || 'checkbox';

            let value;

            // Get value based on type
            if (type === 'checkbox') {
                value = input.checked;
            } else if (type === 'number' || type === 'slider') {
                value = parseFloat(input.value) || 0;
                // Update the slider value display if it's a slider
                if (type === 'slider') {
                    const valueDisplay = document.getElementById(`${settingId}_value`);
                    if (valueDisplay) {
                        valueDisplay.textContent = value;
                    }
                }
            } else if (type === 'color') {
                value = input.value;
                // Update the text display
                const textInput = document.getElementById(`${settingId}_text`);
                if (textInput) {
                    textInput.value = value;
                }
            } else {
                value = input.value;
            }

            // Save to storage
            await settingsStorage.setSetting(settingId, value);

            // Update local cache immediately
            if (!this.currentSettings[settingId]) {
                this.currentSettings[settingId] = {};
            }
            if (type === 'checkbox') {
                this.currentSettings[settingId].isTrue = value;
            } else {
                this.currentSettings[settingId].value = value;
            }

            // Update config module (for backward compatibility)
            if (type === 'checkbox') {
                this.config.setSetting(settingId, value);
            } else {
                this.config.setSettingValue(settingId, value);
            }

            // Apply color settings immediately if this is a color setting
            if (type === 'color') {
                this.config.applyColorSettings();
            }

            // Update dependencies
            this.updateDependencies();
        }

        /**
         * Update dependency states (enable/disable dependent settings)
         */
        updateDependencies() {
            const settings = document.querySelectorAll('.toolasha-setting[data-dependencies]');

            settings.forEach((settingEl) => {
                const dependencies = settingEl.dataset.dependencies.split(',');
                const mode = settingEl.dataset.dependencyMode || 'all'; // 'all' = AND, 'any' = OR
                let enabled = false;

                if (mode === 'any') {
                    // OR logic: at least one dependency must be met
                    for (const depId of dependencies) {
                        const depInput = document.getElementById(depId);
                        if (depInput && depInput.type === 'checkbox' && depInput.checked) {
                            enabled = true;
                            break; // Found at least one enabled, that's enough
                        }
                    }
                } else {
                    // AND logic (default): all dependencies must be met
                    enabled = true; // Assume enabled, then check all
                    for (const depId of dependencies) {
                        const depInput = document.getElementById(depId);
                        if (depInput && depInput.type === 'checkbox' && !depInput.checked) {
                            enabled = false;
                            break; // Found one disabled, no need to check rest
                        }
                    }
                }

                // Enable or disable
                if (enabled) {
                    settingEl.classList.remove('disabled');
                } else {
                    settingEl.classList.add('disabled');
                }
            });
        }

        /**
         * Handle sync settings to all characters
         */
        async handleSync() {
            // Get character count to show in confirmation
            const characterCount = await this.config.getKnownCharacterCount();

            // If only 1 character (current), no need to sync
            if (characterCount <= 1) {
                alert('You only have one character. Settings are already saved for this character.');
                return;
            }

            // Confirm action
            const otherCharacters = characterCount - 1;
            const message = `This will copy your current settings to ${otherCharacters} other character${otherCharacters > 1 ? 's' : ''}. Their existing settings will be overwritten.\n\nContinue?`;

            if (!confirm(message)) {
                return;
            }

            // Perform sync
            const result = await this.config.syncSettingsToAllCharacters();

            // Show result
            if (result.success) {
                alert(`Settings successfully copied to ${result.count} character${result.count > 1 ? 's' : ''}!`);
            } else {
                alert(`Failed to sync settings: ${result.error || 'Unknown error'}`);
            }
        }

        /**
         * Handle fetch latest prices
         * @param {HTMLElement} button - Button element for state updates
         */
        async handleFetchPrices(button) {
            // Disable button and show loading state
            const originalText = button.textContent;
            button.disabled = true;
            button.textContent = '⏳ Fetching...';

            try {
                // Clear cache and fetch fresh data
                const result = await marketAPI.clearCacheAndRefetch();

                if (result) {
                    // Success - clear listing price display cache to force re-render
                    document.querySelectorAll('.mwi-listing-prices-set').forEach((table) => {
                        table.classList.remove('mwi-listing-prices-set');
                    });

                    // Show success state
                    button.textContent = '✅ Updated!';
                    button.style.backgroundColor = '#00ff00';
                    button.style.color = '#000';

                    // Reset button after 2 seconds
                    const resetSuccessTimeout = setTimeout(() => {
                        button.textContent = originalText;
                        button.style.backgroundColor = '';
                        button.style.color = '';
                        button.disabled = false;
                    }, 2000);
                    this.timerRegistry.registerTimeout(resetSuccessTimeout);
                } else {
                    // Failed - show error state
                    button.textContent = '❌ Failed';
                    button.style.backgroundColor = '#ff0000';

                    // Reset button after 3 seconds
                    const resetFailureTimeout = setTimeout(() => {
                        button.textContent = originalText;
                        button.style.backgroundColor = '';
                        button.disabled = false;
                    }, 3000);
                    this.timerRegistry.registerTimeout(resetFailureTimeout);
                }
            } catch (error) {
                console.error('[SettingsUI] Fetch prices failed:', error);

                // Show error state
                button.textContent = '❌ Error';
                button.style.backgroundColor = '#ff0000';

                // Reset button after 3 seconds
                const resetErrorTimeout = setTimeout(() => {
                    button.textContent = originalText;
                    button.style.backgroundColor = '';
                    button.disabled = false;
                }, 3000);
                this.timerRegistry.registerTimeout(resetErrorTimeout);
            }
        }

        /**
         * Handle reset to defaults
         */
        async handleReset() {
            if (!confirm('Reset all settings to defaults? This cannot be undone.')) {
                return;
            }

            await settingsStorage.resetToDefaults();
            await this.config.resetToDefaults();

            alert('Settings reset to defaults. Please refresh the page.');
            window.location.reload();
        }

        /**
         * Handle export settings
         */
        async handleExport() {
            const json = await settingsStorage.exportSettings();

            // Create download
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `toolasha-settings-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        }

        /**
         * Handle import settings
         */
        async handleImport() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';

            input.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                try {
                    const text = await file.text();
                    const success = await settingsStorage.importSettings(text);

                    if (success) {
                        alert('Settings imported successfully. Please refresh the page.');
                        window.location.reload();
                    } else {
                        alert('Failed to import settings. Please check the file format.');
                    }
                } catch (error) {
                    console.error('[Toolasha Settings] Import error:', error);
                    alert('Failed to import settings.');
                }
            });

            input.click();
        }

        /**
         * Open template editor modal
         * @param {string} settingId - Setting ID
         */
        openTemplateEditor(settingId) {
            const setting = this.findSettingDef(settingId);
            if (!setting || !setting.templateVariables) {
                return;
            }

            const input = document.getElementById(settingId);
            let currentValue = setting.default;

            // Try to parse stored value
            if (input && input.value) {
                try {
                    const parsed = JSON.parse(input.value);
                    if (Array.isArray(parsed)) {
                        currentValue = parsed;
                    }
                } catch (e) {
                    console.error('[Settings] Failed to parse template value:', e);
                }
            }

            // Ensure currentValue is an array
            if (!Array.isArray(currentValue)) {
                currentValue = setting.default || [];
            }

            // Deep clone to avoid mutating original
            const templateItems = JSON.parse(JSON.stringify(currentValue));

            // Create overlay
            const overlay = document.createElement('div');
            overlay.className = 'toolasha-template-editor-overlay';
            overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            z-index: 100000;
            display: flex;
            align-items: center;
            justify-content: center;
        `;

            // Create modal
            const modal = document.createElement('div');
            modal.className = 'toolasha-template-editor-modal';
            modal.style.cssText = `
            background: #1a1a1a;
            border: 2px solid #3a3a3a;
            border-radius: 8px;
            padding: 20px;
            max-width: 700px;
            width: 90%;
            max-height: 90%;
            overflow-y: auto;
            color: #e0e0e0;
        `;

            // Header
            const header = document.createElement('div');
            header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            border-bottom: 2px solid #3a3a3a;
            padding-bottom: 10px;
        `;
            header.innerHTML = `
            <h3 style="margin: 0; color: #e0e0e0;">Edit Template</h3>
            <button class="toolasha-template-close-btn" style="
                background: none;
                border: none;
                color: #e0e0e0;
                font-size: 32px;
                cursor: pointer;
                padding: 0;
                line-height: 1;
            ">×</button>
        `;

            // Template list section
            const listSection = document.createElement('div');
            listSection.style.cssText = 'margin-bottom: 20px;';
            listSection.innerHTML =
                '<h4 style="margin: 0 0 10px 0; color: #e0e0e0;">Template Items (drag to reorder):</h4>';

            const listContainer = document.createElement('div');
            listContainer.className = 'toolasha-template-list';
            listContainer.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #4a4a4a;
            border-radius: 4px;
            padding: 10px;
            min-height: 200px;
            max-height: 300px;
            overflow-y: auto;
        `;

            const renderList = () => {
                listContainer.innerHTML = '';
                templateItems.forEach((item, index) => {
                    const itemEl = this.createTemplateListItem(item, index, templateItems, renderList);
                    listContainer.appendChild(itemEl);
                });
            };

            renderList();
            listSection.appendChild(listContainer);

            // Available variables section
            const variablesSection = document.createElement('div');
            variablesSection.style.cssText = 'margin-bottom: 20px;';
            variablesSection.innerHTML = '<h4 style="margin: 0 0 10px 0; color: #e0e0e0;">Add Variable:</h4>';

            const variablesContainer = document.createElement('div');
            variablesContainer.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        `;

            for (const variable of setting.templateVariables) {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.textContent = '+  ' + variable.label;
                chip.title = variable.description;
                chip.style.cssText = `
                background: #2a2a2a;
                border: 1px solid #4a4a4a;
                border-radius: 4px;
                padding: 6px 12px;
                color: #e0e0e0;
                cursor: pointer;
                font-size: 13px;
                transition: all 0.2s;
            `;
                chip.onmouseover = () => {
                    chip.style.background = '#3a3a3a';
                    chip.style.borderColor = '#5a5a5a';
                };
                chip.onmouseout = () => {
                    chip.style.background = '#2a2a2a';
                    chip.style.borderColor = '#4a4a4a';
                };
                chip.onclick = () => {
                    templateItems.push({
                        type: 'variable',
                        key: variable.key,
                        label: variable.label,
                    });
                    renderList();
                };
                variablesContainer.appendChild(chip);
            }

            // Add text button
            const addTextBtn = document.createElement('button');
            addTextBtn.type = 'button';
            addTextBtn.textContent = '+ Add Text';
            addTextBtn.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #4a4a4a;
            border-radius: 4px;
            padding: 6px 12px;
            color: #e0e0e0;
            cursor: pointer;
            font-size: 13px;
            transition: all 0.2s;
        `;
            addTextBtn.onmouseover = () => {
                addTextBtn.style.background = '#3a3a3a';
                addTextBtn.style.borderColor = '#5a5a5a';
            };
            addTextBtn.onmouseout = () => {
                addTextBtn.style.background = '#2a2a2a';
                addTextBtn.style.borderColor = '#4a4a4a';
            };
            addTextBtn.onclick = () => {
                const text = prompt('Enter text:');
                if (text !== null && text !== '') {
                    templateItems.push({
                        type: 'text',
                        value: text,
                    });
                    renderList();
                }
            };

            variablesContainer.appendChild(addTextBtn);
            variablesSection.appendChild(variablesContainer);

            // Buttons
            const buttonsSection = document.createElement('div');
            buttonsSection.style.cssText = `
            display: flex;
            gap: 10px;
            justify-content: space-between;
            margin-top: 20px;
        `;

            // Restore to Default button (left side)
            const restoreBtn = document.createElement('button');
            restoreBtn.type = 'button';
            restoreBtn.textContent = 'Restore to Default';
            restoreBtn.style.cssText = `
            background: #6b5b3a;
            border: 1px solid #8b7b5a;
            border-radius: 4px;
            padding: 8px 16px;
            color: #e0e0e0;
            cursor: pointer;
            font-size: 14px;
        `;
            restoreBtn.onclick = () => {
                if (confirm('Reset template to default? This will discard your current template.')) {
                    // Reset to default
                    templateItems.length = 0;
                    const defaultTemplate = setting.default || [];
                    templateItems.push(...JSON.parse(JSON.stringify(defaultTemplate)));
                    renderList();
                }
            };

            // Right side buttons container
            const rightButtons = document.createElement('div');
            rightButtons.style.cssText = 'display: flex; gap: 10px;';

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #4a4a4a;
            border-radius: 4px;
            padding: 8px 16px;
            color: #e0e0e0;
            cursor: pointer;
            font-size: 14px;
        `;
            cancelBtn.onclick = () => overlay.remove();

            const saveBtn = document.createElement('button');
            saveBtn.type = 'button';
            saveBtn.textContent = 'Save';
            saveBtn.style.cssText = `
            background: #4a7c59;
            border: 1px solid #5a8c69;
            border-radius: 4px;
            padding: 8px 16px;
            color: #e0e0e0;
            cursor: pointer;
            font-size: 14px;
        `;
            saveBtn.onclick = () => {
                const input = document.getElementById(settingId);
                if (input) {
                    input.value = JSON.stringify(templateItems);
                    // Trigger change event
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
                overlay.remove();
            };

            rightButtons.appendChild(cancelBtn);
            rightButtons.appendChild(saveBtn);

            buttonsSection.appendChild(restoreBtn);
            buttonsSection.appendChild(rightButtons);

            // Assemble modal
            modal.appendChild(header);
            modal.appendChild(listSection);
            modal.appendChild(variablesSection);
            modal.appendChild(buttonsSection);
            overlay.appendChild(modal);

            // Close button handler
            header.querySelector('.toolasha-template-close-btn').onclick = () => overlay.remove();

            // Close on overlay click
            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                }
            };

            // Add to page
            document.body.appendChild(overlay);
        }

        /**
         * Create a draggable template list item
         * @param {Object} item - Template item
         * @param {number} index - Item index
         * @param {Array} items - All items
         * @param {Function} renderList - Callback to re-render list
         * @returns {HTMLElement} List item element
         */
        createTemplateListItem(item, index, items, renderList) {
            const itemEl = document.createElement('div');
            itemEl.draggable = true;
            itemEl.dataset.index = index;
            itemEl.style.cssText = `
            background: #1a1a1a;
            border: 1px solid #4a4a4a;
            border-radius: 4px;
            padding: 8px;
            margin-bottom: 6px;
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: move;
            transition: all 0.2s;
        `;

            // Drag handle
            const dragHandle = document.createElement('span');
            dragHandle.textContent = '⋮⋮';
            dragHandle.style.cssText = `
            color: #666;
            font-size: 16px;
            cursor: move;
        `;

            // Content
            const content = document.createElement('div');
            content.style.cssText = 'flex: 1; color: #e0e0e0; font-size: 13px;';

            if (item.type === 'variable') {
                content.innerHTML = `<strong style="color: #4a9eff;">${item.label}</strong> <span style="color: #666; font-family: monospace;">${item.key}</span>`;
            } else {
                // Editable text
                const textInput = document.createElement('input');
                textInput.type = 'text';
                textInput.value = item.value;
                textInput.style.cssText = `
                background: #2a2a2a;
                border: 1px solid #4a4a4a;
                border-radius: 3px;
                padding: 4px 8px;
                color: #e0e0e0;
                font-size: 13px;
                width: 100%;
            `;
                textInput.onchange = () => {
                    items[index].value = textInput.value;
                };
                content.appendChild(textInput);
            }

            // Delete button
            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.textContent = '×';
            deleteBtn.title = 'Remove';
            deleteBtn.style.cssText = `
            background: #8b0000;
            border: 1px solid #a00000;
            border-radius: 3px;
            color: #e0e0e0;
            cursor: pointer;
            font-size: 18px;
            line-height: 1;
            padding: 4px 8px;
            transition: all 0.2s;
        `;
            deleteBtn.onmouseover = () => {
                deleteBtn.style.background = '#a00000';
            };
            deleteBtn.onmouseout = () => {
                deleteBtn.style.background = '#8b0000';
            };
            deleteBtn.onclick = () => {
                items.splice(index, 1);
                renderList();
            };

            // Drag events
            itemEl.ondragstart = (e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', index);
                itemEl.style.opacity = '0.5';
            };

            itemEl.ondragend = () => {
                itemEl.style.opacity = '1';
            };

            itemEl.ondragover = (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                itemEl.style.borderColor = '#4a9eff';
            };

            itemEl.ondragleave = () => {
                itemEl.style.borderColor = '#4a4a4a';
            };

            itemEl.ondrop = (e) => {
                e.preventDefault();
                itemEl.style.borderColor = '#4a4a4a';

                const dragIndex = parseInt(e.dataTransfer.getData('text/plain'));
                const dropIndex = index;

                if (dragIndex !== dropIndex) {
                    // Remove from old position
                    const [movedItem] = items.splice(dragIndex, 1);
                    // Insert at new position
                    items.splice(dropIndex, 0, movedItem);
                    renderList();
                }
            };

            itemEl.appendChild(dragHandle);
            itemEl.appendChild(content);
            itemEl.appendChild(deleteBtn);

            return itemEl;
        }

        /**
         * Find setting definition by ID
         * @param {string} settingId - Setting ID
         * @returns {Object|null} Setting definition
         */
        findSettingDef(settingId) {
            for (const group of Object.values(settingsSchema_js.settingsGroups)) {
                if (group.settings[settingId]) {
                    return group.settings[settingId];
                }
            }
            return null;
        }

        /**
         * Cleanup for full shutdown (not character switching)
         * Unregisters event listeners and removes all DOM elements
         */
        cleanup() {
            // Clean up DOM elements first
            this.cleanupDOM();

            if (this.characterSwitchHandler) {
                dataManager.off('character_initialized', this.characterSwitchHandler);
                this.characterSwitchHandler = null;
            }

            this.timerRegistry.clearAll();
        }
    }

    const settingsUI = new SettingsUI();

    /**
     * Transmute Rates Module
     * Shows transmutation success rate percentages in Item Dictionary modal
     */


    /**
     * TransmuteRates class manages success rate display in Item Dictionary
     */
    class TransmuteRates {
        constructor() {
            this.unregisterHandlers = [];
            this.isInitialized = false;
            this.injectTimeout = null;
            this.nameToHridCache = new Map();
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
        }

        /**
         * Setup setting change listener
         */
        setupSettingListener() {
            config.onSettingChange('itemDictionary_transmuteRates', (enabled) => {
                if (enabled) {
                    this.initialize();
                } else {
                    this.disable();
                }
            });

            // Listen for base rate inclusion toggle
            config.onSettingChange('itemDictionary_transmuteIncludeBaseRate', () => {
                if (this.isInitialized) {
                    this.refreshRates();
                }
            });

            config.onSettingChange('color_transmute', () => {
                if (this.isInitialized) {
                    this.refreshRates();
                }
            });
        }

        /**
         * Initialize transmute rates feature
         */
        initialize() {
            if (config.getSetting('itemDictionary_transmuteRates') !== true) {
                return;
            }

            if (this.isInitialized) {
                return;
            }

            this.isInitialized = true;

            // Watch for individual source items being added to the dictionary
            const unregister = domObserver.onClass('TransmuteRates', 'ItemDictionary_item', (elem) => {
                // When a new source item appears, find the parent section and inject rates
                const section = elem.closest('[class*="ItemDictionary_transmutedFrom"]');

                if (section) {
                    // Debounce to avoid injecting multiple times as items are added
                    clearTimeout(this.injectTimeout);
                    this.injectTimeout = setTimeout(() => {
                        this.injectRates(section);
                    }, 50);
                    this.timerRegistry.registerTimeout(this.injectTimeout);
                }
            });
            this.unregisterHandlers.push(unregister);

            // Check if dictionary is already open
            const existingSection = document.querySelector('[class*="ItemDictionary_transmutedFrom"]');
            if (existingSection) {
                this.injectRates(existingSection);
            }
        }

        /**
         * Inject transmutation success rates into the dictionary
         * @param {HTMLElement} transmutedFromSection - The "Transmuted From" section
         */
        injectRates(transmutedFromSection) {
            // Get current item name from modal title
            const titleElem = document.querySelector('[class*="ItemDictionary_title"]');
            if (!titleElem) {
                return;
            }

            const currentItemName = titleElem.textContent.trim();
            const gameData = dataManager.getInitClientData();
            if (!gameData) {
                return;
            }

            // Build name->HRID cache once for O(1) lookups
            if (this.nameToHridCache.size === 0) {
                for (const [hrid, item] of Object.entries(gameData.itemDetailMap)) {
                    this.nameToHridCache.set(item.name, hrid);
                }
            }

            // Find current item HRID by name (O(1) lookup)
            const currentItemHrid = this.nameToHridCache.get(currentItemName);

            if (!currentItemHrid) {
                return;
            }

            // Find all source items in "Transmuted From" list
            const sourceItems = transmutedFromSection.querySelectorAll('[class*="ItemDictionary_item"]');

            for (const sourceItemElem of sourceItems) {
                // Remove any existing rate first (in case React re-rendered this item)
                const existingRate = sourceItemElem.querySelector('.mwi-transmute-rate');
                if (existingRate) {
                    existingRate.remove();
                }

                // Get source item name
                const nameElem = sourceItemElem.querySelector('[class*="Item_name"]');
                if (!nameElem) {
                    continue;
                }

                const sourceItemName = nameElem.textContent.trim();

                // Find source item HRID by name (O(1) lookup)
                const sourceItemHrid = this.nameToHridCache.get(sourceItemName);

                if (!sourceItemHrid) {
                    continue;
                }

                // Get source item's alchemy details
                const sourceItem = gameData.itemDetailMap[sourceItemHrid];
                if (!sourceItem.alchemyDetail || !sourceItem.alchemyDetail.transmuteDropTable) {
                    continue;
                }

                const transmuteSuccessRate = sourceItem.alchemyDetail.transmuteSuccessRate;

                // Find current item in source's drop table
                const dropEntry = sourceItem.alchemyDetail.transmuteDropTable.find(
                    (entry) => entry.itemHrid === currentItemHrid
                );

                if (!dropEntry) {
                    continue;
                }

                // Calculate effective rate based on setting
                const includeBaseRate = config.getSetting('itemDictionary_transmuteIncludeBaseRate') !== false;
                const effectiveRate = includeBaseRate
                    ? transmuteSuccessRate * dropEntry.dropRate // Total probability
                    : dropEntry.dropRate; // Conditional probability
                const percentageText = `${(effectiveRate * 100).toFixed((effectiveRate * 100) % 1 === 0 ? 1 : 2)}%`;

                // Create rate element
                const rateElem = document.createElement('span');
                rateElem.className = 'mwi-transmute-rate';
                rateElem.textContent = ` ~${percentageText}`;
                rateElem.style.cssText = `
                position: absolute;
                right: 0;
                top: 50%;
                transform: translateY(-50%);
                color: ${config.COLOR_TRANSMUTE};
                font-size: 0.9em;
                pointer-events: none;
            `;

                // Make parent container position: relative so absolute positioning works
                sourceItemElem.style.position = 'relative';

                // Insert as sibling after item box (outside React's control)
                sourceItemElem.appendChild(rateElem);
            }
        }

        /**
         * Refresh all displayed rates (e.g., after color change)
         */
        refreshRates() {
            // Remove all existing rate displays
            document.querySelectorAll('.mwi-transmute-rate').forEach((elem) => elem.remove());

            // Re-inject if section is visible
            const existingSection = document.querySelector('[class*="ItemDictionary_transmutedFrom"]');
            if (existingSection) {
                this.injectRates(existingSection);
            }
        }

        /**
         * Disable the feature and clean up
         */
        disable() {
            // Clear any pending injection timeouts
            clearTimeout(this.injectTimeout);
            this.timerRegistry.clearAll();

            this.unregisterHandlers.forEach((unregister) => unregister());
            this.unregisterHandlers = [];

            // Remove all injected rate displays
            document.querySelectorAll('.mwi-transmute-rate').forEach((elem) => elem.remove());

            // Clear cache
            this.nameToHridCache.clear();

            this.isInitialized = false;
        }
    }

    const transmuteRates = new TransmuteRates();

    // Setup setting listener (always active, even when feature is disabled)
    transmuteRates.setupSettingListener();

    /**
     * Enhancement Session Data Structure
     * Represents a single enhancement tracking session for one item
     */

    /**
     * Session states
     */
    const SessionState = {
        TRACKING: 'tracking', // Currently tracking enhancements
        COMPLETED: 'completed'};

    /**
     * Create a new enhancement session
     * @param {string} itemHrid - Item HRID being enhanced
     * @param {string} itemName - Display name of item
     * @param {number} startLevel - Starting enhancement level
     * @param {number} targetLevel - Target enhancement level (1-20)
     * @param {number} protectFrom - Level to start using protection items (0 = never)
     * @returns {Object} New session object
     */
    function createSession(itemHrid, itemName, startLevel, targetLevel, protectFrom = 0) {
        const now = Date.now();

        return {
            // Session metadata
            id: `session_${now}`,
            state: SessionState.TRACKING,
            itemHrid,
            itemName,
            startLevel,
            targetLevel,
            currentLevel: startLevel,
            protectFrom,

            // Timestamps
            startTime: now,
            lastUpdateTime: now,
            endTime: null,

            // Last attempt tracking (for detecting success/failure)
            lastAttempt: {
                attemptNumber: 0,
                level: startLevel,
                timestamp: now,
            },

            // Attempt tracking (per level)
            // Format: { 1: { success: 5, fail: 3, successRate: 0.625 }, ... }
            attemptsPerLevel: {},

            // Cost tracking
            materialCosts: {}, // Format: { itemHrid: { count: 10, totalCost: 50000 } }
            coinCost: 0,
            coinCount: 0, // Track number of times coins were spent
            protectionCost: 0,
            protectionCount: 0,
            protectionItemHrid: null, // Track which protection item is being used
            totalCost: 0,

            // Statistics
            totalAttempts: 0,
            totalSuccesses: 0,
            totalFailures: 0,
            totalXP: 0, // Total XP gained from enhancements
            longestSuccessStreak: 0,
            longestFailureStreak: 0,
            currentStreak: { type: null, count: 0 }, // 'success' or 'fail'

            // Milestones reached
            milestonesReached: [], // [5, 10, 15, 20]

            // Enhancement predictions (optional - calculated at session start)
            predictions: null, // { expectedAttempts, expectedProtections, ... }
        };
    }

    /**
     * Initialize attempts tracking for a level
     * @param {Object} session - Session object
     * @param {number} level - Enhancement level
     */
    function initializeLevelTracking(session, level) {
        if (!session.attemptsPerLevel[level]) {
            session.attemptsPerLevel[level] = {
                success: 0,
                fail: 0,
                successRate: 0,
            };
        }
    }

    /**
     * Update success rate for a level
     * @param {Object} session - Session object
     * @param {number} level - Enhancement level
     */
    function updateSuccessRate(session, level) {
        const levelData = session.attemptsPerLevel[level];
        if (!levelData) return;

        const total = levelData.success + levelData.fail;
        levelData.successRate = total > 0 ? levelData.success / total : 0;
    }

    /**
     * Record a successful enhancement attempt
     * @param {Object} session - Session object
     * @param {number} previousLevel - Level before enhancement (level that succeeded)
     * @param {number} newLevel - New level after success
     */
    function recordSuccess(session, previousLevel, newLevel) {
        // Initialize tracking if needed for the level that succeeded
        initializeLevelTracking(session, previousLevel);

        // Record success at the level we enhanced FROM
        session.attemptsPerLevel[previousLevel].success++;
        session.totalAttempts++;
        session.totalSuccesses++;

        // Update success rate for this level
        updateSuccessRate(session, previousLevel);

        // Update current level
        session.currentLevel = newLevel;

        // Update streaks
        if (session.currentStreak.type === 'success') {
            session.currentStreak.count++;
        } else {
            session.currentStreak = { type: 'success', count: 1 };
        }

        if (session.currentStreak.count > session.longestSuccessStreak) {
            session.longestSuccessStreak = session.currentStreak.count;
        }

        // Check for milestones
        if ([5, 10, 15, 20].includes(newLevel) && !session.milestonesReached.includes(newLevel)) {
            session.milestonesReached.push(newLevel);
        }

        // Update timestamp
        session.lastUpdateTime = Date.now();

        // Check if target reached
        if (newLevel >= session.targetLevel) {
            session.state = SessionState.COMPLETED;
            session.endTime = Date.now();
        }
    }

    /**
     * Record a failed enhancement attempt
     * @param {Object} session - Session object
     * @param {number} previousLevel - Level that failed (level we tried to enhance from)
     */
    function recordFailure(session, previousLevel) {
        // Initialize tracking if needed for the level that failed
        initializeLevelTracking(session, previousLevel);

        // Record failure at the level we enhanced FROM
        session.attemptsPerLevel[previousLevel].fail++;
        session.totalAttempts++;
        session.totalFailures++;

        // Update success rate for this level
        updateSuccessRate(session, previousLevel);

        // Update streaks
        if (session.currentStreak.type === 'fail') {
            session.currentStreak.count++;
        } else {
            session.currentStreak = { type: 'fail', count: 1 };
        }

        if (session.currentStreak.count > session.longestFailureStreak) {
            session.longestFailureStreak = session.currentStreak.count;
        }

        // Update timestamp
        session.lastUpdateTime = Date.now();
    }

    /**
     * Add material cost to session
     * @param {Object} session - Session object
     * @param {string} itemHrid - Material item HRID
     * @param {number} count - Quantity used
     * @param {number} unitCost - Cost per item (from market)
     */
    function addMaterialCost(session, itemHrid, count, unitCost) {
        if (!session.materialCosts[itemHrid]) {
            session.materialCosts[itemHrid] = {
                count: 0,
                totalCost: 0,
            };
        }

        session.materialCosts[itemHrid].count += count;
        session.materialCosts[itemHrid].totalCost += count * unitCost;

        // Update total cost
        recalculateTotalCost(session);
    }

    /**
     * Add coin cost to session
     * @param {Object} session - Session object
     * @param {number} amount - Coin amount spent
     */
    function addCoinCost(session, amount) {
        session.coinCost += amount;
        session.coinCount += 1;
        recalculateTotalCost(session);
    }

    /**
     * Add protection item cost to session
     * @param {Object} session - Session object
     * @param {string} protectionItemHrid - Protection item HRID
     * @param {number} cost - Protection item cost
     */
    function addProtectionCost(session, protectionItemHrid, cost) {
        session.protectionCost += cost;
        session.protectionCount += 1;

        // Store the protection item HRID if not already set
        if (!session.protectionItemHrid) {
            session.protectionItemHrid = protectionItemHrid;
        }

        recalculateTotalCost(session);
    }

    /**
     * Recalculate total cost from all sources
     * @param {Object} session - Session object
     */
    function recalculateTotalCost(session) {
        const materialTotal = Object.values(session.materialCosts).reduce((sum, m) => sum + m.totalCost, 0);

        session.totalCost = materialTotal + session.coinCost + session.protectionCost;
    }

    /**
     * Get session duration in seconds
     * @param {Object} session - Session object
     * @returns {number} Duration in seconds
     */
    function getSessionDuration(session) {
        const endTime = session.endTime || Date.now();
        return Math.floor((endTime - session.startTime) / 1000);
    }

    /**
     * Finalize session (mark as completed)
     * @param {Object} session - Session object
     */
    function finalizeSession(session) {
        session.state = SessionState.COMPLETED;
        session.endTime = Date.now();
    }

    /**
     * Check if session matches given item and level criteria (for resume logic)
     * @param {Object} session - Session object
     * @param {string} itemHrid - Item HRID
     * @param {number} currentLevel - Current enhancement level
     * @param {number} targetLevel - Target level
     * @param {number} protectFrom - Protection level
     * @returns {boolean} True if session matches
     */
    function sessionMatches(session, itemHrid, currentLevel, targetLevel, protectFrom = 0) {
        // Must be same item
        if (session.itemHrid !== itemHrid) return false;

        // Can only resume tracking sessions (not completed/archived)
        if (session.state !== SessionState.TRACKING) return false;

        // Must match protection settings exactly (Ultimate Tracker requirement)
        if (session.protectFrom !== protectFrom) return false;

        // Must match target level exactly (Ultimate Tracker requirement)
        if (session.targetLevel !== targetLevel) return false;

        // Must match current level (with small tolerance for out-of-order events)
        const levelDiff = Math.abs(session.currentLevel - currentLevel);
        if (levelDiff <= 1) {
            return true;
        }

        return false;
    }

    /**
     * Check if a completed session can be extended
     * @param {Object} session - Session object
     * @param {string} itemHrid - Item HRID
     * @param {number} currentLevel - Current enhancement level
     * @returns {boolean} True if session can be extended
     */
    function canExtendSession(session, itemHrid, currentLevel) {
        // Must be same item
        if (session.itemHrid !== itemHrid) return false;

        // Must be completed
        if (session.state !== SessionState.COMPLETED) return false;

        // Current level should match where session ended (or close)
        const levelDiff = Math.abs(session.currentLevel - currentLevel);
        if (levelDiff <= 1) {
            return true;
        }

        return false;
    }

    /**
     * Extend a completed session to a new target level
     * @param {Object} session - Session object
     * @param {number} newTargetLevel - New target level
     */
    function extendSession(session, newTargetLevel) {
        session.state = SessionState.TRACKING;
        session.targetLevel = newTargetLevel;
        session.endTime = null;
        session.lastUpdateTime = Date.now();
    }

    /**
     * Validate session data integrity
     * @param {Object} session - Session object
     * @returns {boolean} True if valid
     */
    function validateSession(session) {
        if (!session || typeof session !== 'object') return false;

        // Required fields
        if (!session.id || !session.itemHrid || !session.itemName) return false;
        if (typeof session.startLevel !== 'number' || typeof session.targetLevel !== 'number') return false;
        if (typeof session.currentLevel !== 'number') return false;

        // Validate level ranges
        if (session.startLevel < 0 || session.startLevel > 20) return false;
        if (session.targetLevel < 1 || session.targetLevel > 20) return false;
        if (session.currentLevel < 0 || session.currentLevel > 20) return false;

        // Validate costs are non-negative
        if (session.totalCost < 0 || session.coinCost < 0 || session.protectionCost < 0) return false;

        return true;
    }

    /**
     * Enhancement Tracker Storage
     * Handles persistence of enhancement sessions using IndexedDB
     */


    const STORAGE_KEY = 'enhancementTracker_sessions';
    const CURRENT_SESSION_KEY = 'enhancementTracker_currentSession';
    const STORAGE_STORE = 'settings'; // Use existing 'settings' store

    /**
     * Save all sessions to storage
     * @param {Object} sessions - Sessions object (keyed by session ID)
     * @returns {Promise<void>}
     */
    async function saveSessions(sessions) {
        try {
            await storage.setJSON(STORAGE_KEY, sessions, STORAGE_STORE, true); // immediate=true for rapid updates
        } catch (error) {
            throw error;
        }
    }

    /**
     * Load all sessions from storage
     * @returns {Promise<Object>} Sessions object (keyed by session ID)
     */
    async function loadSessions() {
        try {
            const sessions = await storage.getJSON(STORAGE_KEY, STORAGE_STORE, {});
            return sessions;
        } catch {
            return {};
        }
    }

    /**
     * Save current session ID
     * @param {string|null} sessionId - Current session ID (null if no active session)
     * @returns {Promise<void>}
     */
    async function saveCurrentSessionId(sessionId) {
        try {
            await storage.set(CURRENT_SESSION_KEY, sessionId, STORAGE_STORE, true); // immediate=true for rapid updates
        } catch {
            // Silent failure
        }
    }

    /**
     * Load current session ID
     * @returns {Promise<string|null>} Current session ID or null
     */
    async function loadCurrentSessionId() {
        try {
            return await storage.get(CURRENT_SESSION_KEY, STORAGE_STORE, null);
        } catch {
            return null;
        }
    }

    /**
     * Enhancement XP Calculations
     * Based on Ultimate Enhancement Tracker formulas
     */


    /**
     * Get base item level from item HRID
     * @param {string} itemHrid - Item HRID
     * @returns {number} Base item level
     */
    function getBaseItemLevel(itemHrid) {
        try {
            const gameData = dataManager.getInitClientData();
            const itemData = gameData?.itemDetailMap?.[itemHrid];

            // First try direct level field (works for consumables, resources, etc.)
            if (itemData?.level) {
                return itemData.level;
            }

            // For equipment, check levelRequirements array
            if (itemData?.equipmentDetail?.levelRequirements?.length > 0) {
                // Return the level from the first requirement (highest requirement)
                return itemData.equipmentDetail.levelRequirements[0].level;
            }

            return 0;
        } catch {
            return 0;
        }
    }

    /**
     * Get wisdom buff percentage from all sources
     * Reads from dataManager.characterData (NOT localStorage)
     * @returns {number} Wisdom buff as decimal (e.g., 0.20 for 20%)
     */
    function getWisdomBuff() {
        try {
            // Use dataManager for character data (NOT localStorage)
            const charData = dataManager.characterData;
            if (!charData) return 0;

            let totalFlatBoost = 0;

            // 1. Community Buffs
            const communityEnhancingBuffs = charData.communityActionTypeBuffsMap?.['/action_types/enhancing'];
            if (Array.isArray(communityEnhancingBuffs)) {
                communityEnhancingBuffs.forEach((buff) => {
                    if (buff.typeHrid === '/buff_types/wisdom') {
                        totalFlatBoost += buff.flatBoost || 0;
                    }
                });
            }

            // 2. Equipment Buffs
            const equipmentEnhancingBuffs = charData.equipmentActionTypeBuffsMap?.['/action_types/enhancing'];
            if (Array.isArray(equipmentEnhancingBuffs)) {
                equipmentEnhancingBuffs.forEach((buff) => {
                    if (buff.typeHrid === '/buff_types/wisdom') {
                        totalFlatBoost += buff.flatBoost || 0;
                    }
                });
            }

            // 3. House Buffs
            const houseEnhancingBuffs = charData.houseActionTypeBuffsMap?.['/action_types/enhancing'];
            if (Array.isArray(houseEnhancingBuffs)) {
                houseEnhancingBuffs.forEach((buff) => {
                    if (buff.typeHrid === '/buff_types/wisdom') {
                        totalFlatBoost += buff.flatBoost || 0;
                    }
                });
            }

            // 4. Consumable Buffs (from wisdom tea, etc.)
            const consumableEnhancingBuffs = charData.consumableActionTypeBuffsMap?.['/action_types/enhancing'];
            if (Array.isArray(consumableEnhancingBuffs)) {
                consumableEnhancingBuffs.forEach((buff) => {
                    if (buff.typeHrid === '/buff_types/wisdom') {
                        totalFlatBoost += buff.flatBoost || 0;
                    }
                });
            }

            // 5. Achievement Buffs
            totalFlatBoost += dataManager.getAchievementBuffFlatBoost('/action_types/enhancing', '/buff_types/wisdom');

            // Return as decimal (flatBoost is already in decimal form, e.g., 0.2 for 20%)
            return totalFlatBoost;
        } catch {
            return 0;
        }
    }

    /**
     * Calculate XP gained from successful enhancement
     * Formula: 1.4 × (1 + wisdom) × enhancementMultiplier × (10 + baseItemLevel)
     * @param {number} previousLevel - Enhancement level before success
     * @param {string} itemHrid - Item HRID
     * @returns {number} XP gained
     */
    function calculateSuccessXP(previousLevel, itemHrid) {
        const baseLevel = getBaseItemLevel(itemHrid);
        const wisdomBuff = getWisdomBuff();

        // Special handling for enhancement level 0 (base items)
        const enhancementMultiplier =
            previousLevel === 0
                ? 1.0 // Base value for unenhanced items
                : previousLevel + 1; // Normal progression

        return Math.floor(1.4 * (1 + wisdomBuff) * enhancementMultiplier * (10 + baseLevel));
    }

    /**
     * Calculate XP gained from failed enhancement
     * Formula: 10% of success XP
     * @param {number} previousLevel - Enhancement level that failed
     * @param {string} itemHrid - Item HRID
     * @returns {number} XP gained
     */
    function calculateFailureXP(previousLevel, itemHrid) {
        return Math.floor(calculateSuccessXP(previousLevel, itemHrid) * 0.1);
    }

    /**
     * Calculate adjusted attempt number from session data
     * This makes tracking resume-proof (doesn't rely on WebSocket currentCount)
     * @param {Object} session - Session object
     * @returns {number} Next attempt number
     */
    function calculateAdjustedAttemptCount(session) {
        let successCount = 0;
        let failCount = 0;

        // Sum all successes and failures across all levels
        for (const level in session.attemptsPerLevel) {
            const levelData = session.attemptsPerLevel[level];
            successCount += levelData.success || 0;
            failCount += levelData.fail || 0;
        }

        // For the first attempt, return 1
        if (successCount === 0 && failCount === 0) {
            return 1;
        }

        // Return total + 1 for the next attempt
        return successCount + failCount + 1;
    }

    /**
     * Calculate enhancement predictions using character stats
     * @param {string} itemHrid - Item HRID being enhanced
     * @param {number} startLevel - Starting enhancement level
     * @param {number} targetLevel - Target enhancement level
     * @param {number} protectFrom - Level to start using protection
     * @returns {Object|null} Prediction data or null if cannot calculate
     */
    function calculateEnhancementPredictions(itemHrid, startLevel, targetLevel, protectFrom) {
        try {
            // Use dataManager for character data (NOT localStorage)
            const charData = dataManager.characterData;
            const gameData = dataManager.getInitClientData();

            if (!charData || !gameData) {
                return null;
            }

            // Get item level
            const itemData = gameData.itemDetailMap?.[itemHrid];
            if (!itemData) {
                return null;
            }
            const itemLevel = itemData.level || 0;

            // Get enhancing skill level
            const enhancingLevel = charData.characterSkills?.['/skills/enhancing']?.level || 1;

            // Get house level (Observatory)
            const houseRooms = charData.characterHouseRoomMap;
            let houseLevel = 0;
            if (houseRooms) {
                for (const roomHrid in houseRooms) {
                    const room = houseRooms[roomHrid];
                    if (room.houseRoomHrid === '/house_rooms/observatory') {
                        houseLevel = room.level || 0;
                        break;
                    }
                }
            }

            // Get equipment buffs for enhancing
            let toolBonus = 0;
            let speedBonus = 0;
            const equipmentBuffs = charData.equipmentActionTypeBuffsMap?.['/action_types/enhancing'];
            if (Array.isArray(equipmentBuffs)) {
                equipmentBuffs.forEach((buff) => {
                    if (buff.typeHrid === '/buff_types/enhancing_success') {
                        toolBonus += (buff.flatBoost || 0) * 100; // Convert to percentage
                    }
                    if (buff.typeHrid === '/buff_types/enhancing_speed') {
                        speedBonus += (buff.flatBoost || 0) * 100; // Convert to percentage
                    }
                });
            }

            // Add house buffs
            const houseBuffs = charData.houseActionTypeBuffsMap?.['/action_types/enhancing'];
            if (Array.isArray(houseBuffs)) {
                houseBuffs.forEach((buff) => {
                    if (buff.typeHrid === '/buff_types/enhancing_success') {
                        toolBonus += (buff.flatBoost || 0) * 100;
                    }
                    if (buff.typeHrid === '/buff_types/enhancing_speed') {
                        speedBonus += (buff.flatBoost || 0) * 100;
                    }
                });
            }

            // Add achievement buffs
            toolBonus +=
                dataManager.getAchievementBuffFlatBoost('/action_types/enhancing', '/buff_types/enhancing_success') * 100;

            // Check for blessed tea
            let hasBlessed = false;
            let guzzlingBonus = 1.0;
            const enhancingTeas = charData.actionTypeDrinkSlotsMap?.['/action_types/enhancing'] || [];
            const activeTeas = enhancingTeas.filter((tea) => tea?.isActive);

            activeTeas.forEach((tea) => {
                if (tea.itemHrid === '/items/blessed_tea') {
                    hasBlessed = true;
                }
            });

            // Get guzzling pouch bonus (drink concentration)
            const consumableBuffs = charData.consumableActionTypeBuffsMap?.['/action_types/enhancing'];
            if (Array.isArray(consumableBuffs)) {
                consumableBuffs.forEach((buff) => {
                    if (buff.typeHrid === '/buff_types/drink_concentration') {
                        guzzlingBonus = 1.0 + (buff.flatBoost || 0);
                    }
                });
            }

            // Calculate predictions
            const result = enhancementCalculator_js.calculateEnhancement({
                enhancingLevel,
                houseLevel,
                toolBonus,
                speedBonus,
                itemLevel,
                targetLevel,
                protectFrom,
                blessedTea: hasBlessed,
                guzzlingBonus,
            });

            if (!result) {
                return null;
            }

            return {
                expectedAttempts: Math.round(result.attemptsRounded),
                expectedProtections: Math.round(result.protectionCount),
                expectedTime: result.totalTime,
                successMultiplier: result.successMultiplier,
            };
        } catch {
            return null;
        }
    }

    /**
     * Enhancement Tracker
     * Main tracker class for monitoring enhancement attempts, costs, and statistics
     */


    /**
     * EnhancementTracker class manages enhancement tracking sessions
     */
    class EnhancementTracker {
        constructor() {
            this.sessions = {}; // All sessions (keyed by session ID)
            this.currentSessionId = null; // Currently active session ID
            this.isInitialized = false;
        }

        /**
         * Initialize enhancement tracker
         * @returns {Promise<void>}
         */
        async initialize() {
            if (this.isInitialized) {
                return;
            }

            if (!config.getSetting('enhancementTracker')) {
                return;
            }

            try {
                // Load sessions from storage
                this.sessions = await loadSessions();
                this.currentSessionId = await loadCurrentSessionId();

                // Validate current session still exists
                if (this.currentSessionId && !this.sessions[this.currentSessionId]) {
                    this.currentSessionId = null;
                    await saveCurrentSessionId(null);
                }

                // Validate all loaded sessions
                for (const [sessionId, session] of Object.entries(this.sessions)) {
                    if (!validateSession(session)) {
                        delete this.sessions[sessionId];
                    }
                }

                this.isInitialized = true;
            } catch {
                // Silent failure
            }
        }

        /**
         * Start a new enhancement session
         * @param {string} itemHrid - Item HRID being enhanced
         * @param {number} startLevel - Starting enhancement level
         * @param {number} targetLevel - Target enhancement level
         * @param {number} protectFrom - Level to start using protection (0 = never)
         * @returns {Promise<string>} New session ID
         */
        async startSession(itemHrid, startLevel, targetLevel, protectFrom = 0) {
            const gameData = dataManager.getInitClientData();
            if (!gameData) {
                throw new Error('Game data not available');
            }

            // Get item name
            const itemDetails = gameData.itemDetailMap[itemHrid];
            if (!itemDetails) {
                throw new Error(`Item not found: ${itemHrid}`);
            }

            const itemName = itemDetails.name;

            // Create new session
            const session = createSession(itemHrid, itemName, startLevel, targetLevel, protectFrom);

            // Calculate predictions
            const predictions = calculateEnhancementPredictions(itemHrid, startLevel, targetLevel, protectFrom);
            session.predictions = predictions;

            // Store session
            this.sessions[session.id] = session;
            this.currentSessionId = session.id;

            // Save to storage
            await saveSessions(this.sessions);
            await saveCurrentSessionId(session.id);

            return session.id;
        }

        /**
         * Find a matching previous session that can be resumed
         * @param {string} itemHrid - Item HRID
         * @param {number} currentLevel - Current enhancement level
         * @param {number} targetLevel - Target level
         * @param {number} protectFrom - Protection level
         * @returns {string|null} Session ID if found, null otherwise
         */
        findMatchingSession(itemHrid, currentLevel, targetLevel, protectFrom = 0) {
            for (const [sessionId, session] of Object.entries(this.sessions)) {
                if (sessionMatches(session, itemHrid, currentLevel, targetLevel, protectFrom)) {
                    return sessionId;
                }
            }

            return null;
        }

        /**
         * Resume an existing session
         * @param {string} sessionId - Session ID to resume
         * @returns {Promise<boolean>} True if resumed successfully
         */
        async resumeSession(sessionId) {
            if (!this.sessions[sessionId]) {
                return false;
            }

            const session = this.sessions[sessionId];

            // Can only resume tracking sessions
            if (session.state !== SessionState.TRACKING) {
                return false;
            }

            this.currentSessionId = sessionId;
            await saveCurrentSessionId(sessionId);

            return true;
        }

        /**
         * Find a completed session that can be extended
         * @param {string} itemHrid - Item HRID
         * @param {number} currentLevel - Current enhancement level
         * @returns {string|null} Session ID if found, null otherwise
         */
        findExtendableSession(itemHrid, currentLevel) {
            for (const [sessionId, session] of Object.entries(this.sessions)) {
                if (canExtendSession(session, itemHrid, currentLevel)) {
                    return sessionId;
                }
            }

            return null;
        }

        /**
         * Extend a completed session to a new target level
         * @param {string} sessionId - Session ID to extend
         * @param {number} newTargetLevel - New target level
         * @returns {Promise<boolean>} True if extended successfully
         */
        async extendSessionTarget(sessionId, newTargetLevel) {
            if (!this.sessions[sessionId]) {
                return false;
            }

            const session = this.sessions[sessionId];

            // Can only extend completed sessions
            if (session.state !== SessionState.COMPLETED) {
                return false;
            }

            extendSession(session, newTargetLevel);
            this.currentSessionId = sessionId;

            await saveSessions(this.sessions);
            await saveCurrentSessionId(sessionId);

            return true;
        }

        /**
         * Get current active session
         * @returns {Object|null} Current session or null
         */
        getCurrentSession() {
            if (!this.currentSessionId) return null;
            return this.sessions[this.currentSessionId] || null;
        }

        /**
         * Finalize current session (mark as completed)
         * @returns {Promise<void>}
         */
        async finalizeCurrentSession() {
            const session = this.getCurrentSession();
            if (!session) {
                return;
            }

            finalizeSession(session);
            await saveSessions(this.sessions);

            // Clear current session
            this.currentSessionId = null;
            await saveCurrentSessionId(null);
        }

        /**
         * Record a successful enhancement attempt
         * @param {number} previousLevel - Level before success
         * @param {number} newLevel - New level after success
         * @returns {Promise<void>}
         */
        async recordSuccess(previousLevel, newLevel) {
            const session = this.getCurrentSession();
            if (!session) {
                return;
            }

            recordSuccess(session, previousLevel, newLevel);
            await saveSessions(this.sessions);

            // Check if target reached
            if (session.state === SessionState.COMPLETED) {
                this.currentSessionId = null;
                await saveCurrentSessionId(null);
            }
        }

        /**
         * Record a failed enhancement attempt
         * @param {number} previousLevel - Level that failed
         * @returns {Promise<void>}
         */
        async recordFailure(previousLevel) {
            const session = this.getCurrentSession();
            if (!session) {
                return;
            }

            recordFailure(session, previousLevel);
            await saveSessions(this.sessions);
        }

        /**
         * Track material costs for current session
         * @param {string} itemHrid - Material item HRID
         * @param {number} count - Quantity used
         * @returns {Promise<void>}
         */
        async trackMaterialCost(itemHrid, count) {
            const session = this.getCurrentSession();
            if (!session) return;

            // Get market price
            const priceData = marketAPI.getPrice(itemHrid, 0);
            const unitCost = priceData ? priceData.ask || priceData.bid || 0 : 0;

            addMaterialCost(session, itemHrid, count, unitCost);
            await saveSessions(this.sessions);
        }

        /**
         * Track coin cost for current session
         * @param {number} amount - Coin amount spent
         * @returns {Promise<void>}
         */
        async trackCoinCost(amount) {
            const session = this.getCurrentSession();
            if (!session) return;

            addCoinCost(session, amount);
            await saveSessions(this.sessions);
        }

        /**
         * Track protection item cost for current session
         * @param {string} protectionItemHrid - Protection item HRID
         * @param {number} cost - Protection item cost
         * @returns {Promise<void>}
         */
        async trackProtectionCost(protectionItemHrid, cost) {
            const session = this.getCurrentSession();
            if (!session) return;

            addProtectionCost(session, protectionItemHrid, cost);
            await saveSessions(this.sessions);
        }

        /**
         * Get all sessions
         * @returns {Object} All sessions
         */
        getAllSessions() {
            return this.sessions;
        }

        /**
         * Get session by ID
         * @param {string} sessionId - Session ID
         * @returns {Object|null} Session or null
         */
        getSession(sessionId) {
            return this.sessions[sessionId] || null;
        }

        /**
         * Save sessions to storage (can be called directly)
         * @returns {Promise<void>}
         */
        async saveSessions() {
            await saveSessions(this.sessions);
        }

        /**
         * Disable and cleanup
         */
        disable() {
            this.isInitialized = false;
        }
    }

    const enhancementTracker = new EnhancementTracker();

    /**
     * Enhancement Tracker Floating UI
     * Displays enhancement session statistics in a draggable panel
     * Based on Ultimate Enhancement Tracker v3.7.9
     */


    // UI Style Constants (matching Ultimate Enhancement Tracker)
    const STYLE = {
        colors: {
            primary: '#00ffe7',
            border: 'rgba(0, 255, 234, 0.4)',
            textPrimary: '#e0f7ff',
            textSecondary: '#9b9bff',
            accent: '#ff00d4',
            danger: '#ff0055',
            success: '#00ff99',
            headerBg: 'rgba(15, 5, 35, 0.7)',
            gold: '#FFD700',
        },
        borderRadius: {
            medium: '8px'},
        transitions: {
            fast: 'all 0.15s ease'},
    };

    // Table styling
    const compactTableStyle = `
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    margin: 0;
`;

    const compactHeaderStyle = `
    padding: 4px 6px;
    background: ${STYLE.colors.headerBg};
    border: 1px solid ${STYLE.colors.border};
    color: ${STYLE.colors.textPrimary};
    font-weight: bold;
    text-align: center;
`;

    const compactCellStyle = `
    padding: 3px 6px;
    border: 1px solid rgba(0, 255, 234, 0.2);
    color: ${STYLE.colors.textPrimary};
`;

    /**
     * Enhancement UI Manager
     */
    class EnhancementUI {
        constructor() {
            this.floatingUI = null;
            this.currentViewingIndex = 0; // Index in sessions array
            this.updateDebounce = null;
            this.isDragging = false;
            this.unregisterScreenObserver = null;
            this.pollInterval = null;
            this.isOnEnhancingScreen = false;
            this.isCollapsed = false; // Track collapsed state
            this.updateInterval = null;
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
            this.dragHandle = null;
            this.dragMouseDownHandler = null;
            this.dragMoveHandler = null;
            this.dragUpHandler = null;
        }

        /**
         * Initialize the UI
         */
        initialize() {
            this.createFloatingUI();
            this.updateUI();

            // Set up screen observer for visibility control
            this.setupScreenObserver();

            // Update UI every second during active sessions
            this.updateInterval = setInterval(() => {
                const session = this.getCurrentSession();
                if (session && session.state === SessionState.TRACKING) {
                    this.updateUI();
                }
            }, 1000);
            this.timerRegistry.registerInterval(this.updateInterval);
        }

        /**
         * Set up screen observer to detect Enhancing screen using centralized observer
         */
        setupScreenObserver() {
            // Check if main feature is enabled
            const trackerEnabled = config.getSetting('enhancementTracker');

            if (!trackerEnabled) {
                // Main feature disabled, hide tracker
                this.hide();
            } else {
                // Check if setting is enabled (default to false if undefined)
                const showOnlyOnEnhancingScreen = config.getSetting('enhancementTracker_showOnlyOnEnhancingScreen');

                if (showOnlyOnEnhancingScreen !== true) {
                    // Setting is disabled or undefined, always show tracker
                    this.isOnEnhancingScreen = true;
                    this.show();
                } else {
                    // Setting enabled, check current screen
                    this.checkEnhancingScreen();
                    this.updateVisibility();
                }
            }

            // Register with centralized DOM observer for enhancing panel detection
            // Note: Enhancing screen uses EnhancingPanel_enhancingPanel, not SkillActionDetail_enhancingComponent
            this.unregisterScreenObserver = domObserver.onClass(
                'EnhancementUI-ScreenDetection',
                'EnhancingPanel_enhancingPanel',
                (_node) => {
                    this.checkEnhancingScreen();
                },
                { debounce: false }
            );

            // Poll for both setting changes and panel removal
            this.pollInterval = setInterval(() => {
                const trackerEnabled = config.getSetting('enhancementTracker');
                const currentSetting = config.getSetting('enhancementTracker_showOnlyOnEnhancingScreen');

                // If main tracker is disabled, always hide
                if (!trackerEnabled) {
                    if (this.floatingUI && this.floatingUI.style.display !== 'none') {
                        this.hide();
                    }
                    return;
                }

                if (currentSetting !== true) {
                    // Setting disabled - always show
                    if (!this.isOnEnhancingScreen) {
                        this.isOnEnhancingScreen = true;
                        this.updateVisibility();
                    }
                } else {
                    // Setting enabled - check if panel exists
                    const panel = document.querySelector('[class*="EnhancingPanel_enhancingPanel"]');
                    const shouldBeOnScreen = !!panel;

                    if (this.isOnEnhancingScreen !== shouldBeOnScreen) {
                        this.isOnEnhancingScreen = shouldBeOnScreen;
                        this.updateVisibility();
                    }
                }
            }, 500);
            this.timerRegistry.registerInterval(this.pollInterval);
        }

        /**
         * Check if currently on Enhancing screen
         */
        checkEnhancingScreen() {
            const enhancingPanel = document.querySelector('[class*="EnhancingPanel_enhancingPanel"]');
            const wasOnEnhancingScreen = this.isOnEnhancingScreen;
            this.isOnEnhancingScreen = !!enhancingPanel;

            if (wasOnEnhancingScreen !== this.isOnEnhancingScreen) {
                this.updateVisibility();
            }
        }

        /**
         * Update visibility based on screen state and settings
         */
        updateVisibility() {
            const trackerEnabled = config.getSetting('enhancementTracker');
            const showOnlyOnEnhancingScreen = config.getSetting('enhancementTracker_showOnlyOnEnhancingScreen');

            // If main tracker is disabled, always hide
            if (!trackerEnabled) {
                this.hide();
            } else if (showOnlyOnEnhancingScreen !== true) {
                this.show();
            } else if (this.isOnEnhancingScreen) {
                this.show();
            } else {
                this.hide();
            }
        }

        /**
         * Get currently viewed session
         */
        getCurrentSession() {
            const sessions = Object.values(enhancementTracker.getAllSessions());
            if (sessions.length === 0) return null;

            // Ensure index is valid
            if (this.currentViewingIndex >= sessions.length) {
                this.currentViewingIndex = sessions.length - 1;
            }
            if (this.currentViewingIndex < 0) {
                this.currentViewingIndex = 0;
            }

            return sessions[this.currentViewingIndex];
        }

        /**
         * Switch viewing to a specific session by ID
         * @param {string} sessionId - Session ID to view
         */
        switchToSession(sessionId) {
            const sessions = Object.values(enhancementTracker.getAllSessions());
            const index = sessions.findIndex((session) => session.id === sessionId);

            if (index !== -1) {
                this.currentViewingIndex = index;
            }
        }

        /**
         * Create the floating UI panel
         */
        createFloatingUI() {
            if (this.floatingUI && document.body.contains(this.floatingUI)) {
                return this.floatingUI;
            }

            // Main container
            this.floatingUI = document.createElement('div');
            this.floatingUI.id = 'enhancementFloatingUI';
            Object.assign(this.floatingUI.style, {
                position: 'fixed',
                top: '50px',
                right: '50px',
                zIndex: '9998',
                fontSize: '14px',
                padding: '0',
                borderRadius: STYLE.borderRadius.medium,
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
                overflow: 'hidden',
                width: '350px',
                minHeight: 'auto',
                background: 'rgba(25, 0, 35, 0.92)',
                backdropFilter: 'blur(12px)',
                border: `1px solid ${STYLE.colors.primary}`,
                color: STYLE.colors.textPrimary,
                display: 'flex',
                flexDirection: 'column',
                transition: 'width 0.2s ease',
            });

            // Create header
            const header = this.createHeader();
            this.floatingUI.appendChild(header);

            // Create content area
            const content = document.createElement('div');
            content.id = 'enhancementPanelContent';
            content.style.padding = '15px';
            content.style.flexGrow = '1';
            content.style.overflow = 'auto';
            content.style.transition = 'max-height 0.2s ease, opacity 0.2s ease';
            content.style.maxHeight = '600px';
            content.style.opacity = '1';
            this.floatingUI.appendChild(content);

            // Make draggable
            this.makeDraggable(header);

            // Add to page
            document.body.appendChild(this.floatingUI);

            return this.floatingUI;
        }

        /**
         * Create header with title and navigation
         */
        createHeader() {
            const header = document.createElement('div');
            header.id = 'enhancementPanelHeader';
            Object.assign(header.style, {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'move',
                padding: '10px 15px',
                background: STYLE.colors.headerBg,
                borderBottom: `1px solid ${STYLE.colors.border}`,
                userSelect: 'none',
                flexShrink: '0',
            });

            // Title with session counter
            const titleContainer = document.createElement('div');
            titleContainer.style.display = 'flex';
            titleContainer.style.alignItems = 'center';
            titleContainer.style.gap = '10px';

            const title = document.createElement('span');
            title.textContent = 'Enhancement Tracker';
            title.style.fontWeight = 'bold';

            const sessionCounter = document.createElement('span');
            sessionCounter.id = 'enhancementSessionCounter';
            sessionCounter.style.fontSize = '12px';
            sessionCounter.style.opacity = '0.7';
            sessionCounter.style.marginLeft = '5px';

            titleContainer.appendChild(title);
            titleContainer.appendChild(sessionCounter);

            // Navigation container
            const navContainer = document.createElement('div');
            Object.assign(navContainer.style, {
                display: 'flex',
                gap: '5px',
                alignItems: 'center',
                marginLeft: 'auto',
            });

            // Previous session button
            const prevButton = this.createNavButton('◀', () => this.navigateSession(-1));

            // Next session button
            const nextButton = this.createNavButton('▶', () => this.navigateSession(1));

            // Collapse button
            const collapseButton = this.createCollapseButton();

            // Clear sessions button
            const clearButton = this.createClearButton();

            navContainer.appendChild(prevButton);
            navContainer.appendChild(nextButton);
            navContainer.appendChild(collapseButton);
            navContainer.appendChild(clearButton);

            header.appendChild(titleContainer);
            header.appendChild(navContainer);

            return header;
        }

        /**
         * Create navigation button
         */
        createNavButton(text, onClick) {
            const button = document.createElement('button');
            button.textContent = text;
            Object.assign(button.style, {
                background: 'none',
                border: 'none',
                color: STYLE.colors.textPrimary,
                cursor: 'pointer',
                fontSize: '14px',
                padding: '2px 8px',
                borderRadius: '3px',
                transition: STYLE.transitions.fast,
            });

            button.addEventListener('mouseover', () => {
                button.style.color = STYLE.colors.accent;
                button.style.background = 'rgba(255, 0, 212, 0.1)';
            });
            button.addEventListener('mouseout', () => {
                button.style.color = STYLE.colors.textPrimary;
                button.style.background = 'none';
            });
            button.addEventListener('click', onClick);

            return button;
        }

        /**
         * Create clear sessions button
         */
        createClearButton() {
            const button = document.createElement('button');
            button.innerHTML = '🗑️';
            button.title = 'Clear all sessions';
            Object.assign(button.style, {
                background: 'none',
                border: 'none',
                color: STYLE.colors.textPrimary,
                cursor: 'pointer',
                fontSize: '14px',
                padding: '2px 8px',
                borderRadius: '3px',
                transition: STYLE.transitions.fast,
                marginLeft: '5px',
            });

            button.addEventListener('mouseover', () => {
                button.style.color = STYLE.colors.danger;
                button.style.background = 'rgba(255, 0, 0, 0.1)';
            });
            button.addEventListener('mouseout', () => {
                button.style.color = STYLE.colors.textPrimary;
                button.style.background = 'none';
            });
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm('Clear all enhancement sessions?')) {
                    this.clearAllSessions();
                }
            });

            return button;
        }

        /**
         * Create collapse button
         */
        createCollapseButton() {
            const button = document.createElement('button');
            button.id = 'enhancementCollapseButton';
            button.innerHTML = '▼';
            button.title = 'Collapse panel';
            Object.assign(button.style, {
                background: 'none',
                border: 'none',
                color: STYLE.colors.textPrimary,
                cursor: 'pointer',
                fontSize: '14px',
                padding: '2px 8px',
                borderRadius: '3px',
                transition: STYLE.transitions.fast,
            });

            button.addEventListener('mouseover', () => {
                button.style.color = STYLE.colors.accent;
                button.style.background = 'rgba(255, 0, 212, 0.1)';
            });
            button.addEventListener('mouseout', () => {
                button.style.color = STYLE.colors.textPrimary;
                button.style.background = 'none';
            });
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleCollapse();
            });

            return button;
        }

        /**
         * Make element draggable
         */
        makeDraggable(header) {
            let offsetX = 0;
            let offsetY = 0;

            const onMouseMove = (event) => {
                if (this.isDragging) {
                    const newLeft = event.clientX - offsetX;
                    const newTop = event.clientY - offsetY;

                    // Use absolute positioning during drag
                    this.floatingUI.style.left = `${newLeft}px`;
                    this.floatingUI.style.right = 'auto';
                    this.floatingUI.style.top = `${newTop}px`;
                }
            };

            const onMouseUp = () => {
                this.isDragging = false;
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                this.dragMoveHandler = null;
                this.dragUpHandler = null;
            };

            const onMouseDown = (event) => {
                this.isDragging = true;

                // Calculate offset from panel's current screen position
                const rect = this.floatingUI.getBoundingClientRect();
                offsetX = event.clientX - rect.left;
                offsetY = event.clientY - rect.top;

                this.dragMoveHandler = onMouseMove;
                this.dragUpHandler = onMouseUp;

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            };

            if (this.dragHandle && this.dragMouseDownHandler) {
                this.dragHandle.removeEventListener('mousedown', this.dragMouseDownHandler);
            }

            this.dragHandle = header;
            this.dragMouseDownHandler = onMouseDown;

            header.addEventListener('mousedown', onMouseDown);
        }

        /**
         * Toggle panel collapse state
         */
        toggleCollapse() {
            this.isCollapsed = !this.isCollapsed;
            const content = document.getElementById('enhancementPanelContent');
            const button = document.getElementById('enhancementCollapseButton');

            if (this.isCollapsed) {
                // Collapsed state
                content.style.maxHeight = '0px';
                content.style.opacity = '0';
                content.style.padding = '0 15px';
                button.innerHTML = '▶';
                button.title = 'Expand panel';
                this.floatingUI.style.width = '250px';

                // Show compact summary after content fades
                const summaryTimeout = setTimeout(() => {
                    this.showCollapsedSummary();
                }, 200);
                this.timerRegistry.registerTimeout(summaryTimeout);
            } else {
                // Expanded state
                this.hideCollapsedSummary();
                content.style.maxHeight = '600px';
                content.style.opacity = '1';
                content.style.padding = '15px';
                button.innerHTML = '▼';
                button.title = 'Collapse panel';
                this.floatingUI.style.width = '350px';
            }
        }

        /**
         * Show compact summary in collapsed state
         */
        showCollapsedSummary() {
            if (!this.isCollapsed) return;

            const session = this.getCurrentSession();
            const sessions = Object.values(enhancementTracker.getAllSessions());

            // Remove any existing summary
            this.hideCollapsedSummary();

            if (sessions.length === 0 || !session) return;

            const gameData = dataManager.getInitClientData();
            const itemDetails = gameData?.itemDetailMap?.[session.itemHrid];
            const itemName = itemDetails?.name || 'Unknown Item';

            const totalAttempts = session.totalAttempts;
            const totalSuccess = session.totalSuccesses;
            const successRate = totalAttempts > 0 ? Math.floor((totalSuccess / totalAttempts) * 100) : 0;
            const statusIcon = session.state === SessionState.COMPLETED ? '✅' : '🟢';

            const summary = document.createElement('div');
            summary.id = 'enhancementCollapsedSummary';
            Object.assign(summary.style, {
                padding: '10px 15px',
                fontSize: '12px',
                borderTop: `1px solid ${STYLE.colors.border}`,
                color: STYLE.colors.textPrimary,
            });

            summary.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 4px;">${itemName} → +${session.targetLevel}</div>
            <div style="opacity: 0.8;">${statusIcon} ${totalAttempts} attempts | ${successRate}% rate</div>
        `;

            this.floatingUI.appendChild(summary);
        }

        /**
         * Hide collapsed summary
         */
        hideCollapsedSummary() {
            const summary = document.getElementById('enhancementCollapsedSummary');
            if (summary) {
                summary.remove();
            }
        }

        /**
         * Navigate between sessions
         */
        navigateSession(direction) {
            const sessions = Object.values(enhancementTracker.getAllSessions());
            if (sessions.length === 0) return;

            this.currentViewingIndex += direction;

            // Wrap around
            if (this.currentViewingIndex < 0) {
                this.currentViewingIndex = sessions.length - 1;
            } else if (this.currentViewingIndex >= sessions.length) {
                this.currentViewingIndex = 0;
            }

            this.updateUI();

            // Update collapsed summary if in collapsed state
            if (this.isCollapsed) {
                this.showCollapsedSummary();
            }
        }

        /**
         * Clear all sessions
         */
        async clearAllSessions() {
            // Clear from tracker
            const sessions = enhancementTracker.getAllSessions();
            for (const sessionId of Object.keys(sessions)) {
                delete sessions[sessionId];
            }

            await enhancementTracker.saveSessions();

            this.currentViewingIndex = 0;
            this.updateUI();

            // Hide collapsed summary if shown
            if (this.isCollapsed) {
                this.hideCollapsedSummary();
            }
        }

        /**
         * Update UI content (debounced)
         */
        scheduleUpdate() {
            if (this.updateDebounce) {
                clearTimeout(this.updateDebounce);
            }
            this.updateDebounce = setTimeout(() => this.updateUI(), 100);
            this.timerRegistry.registerTimeout(this.updateDebounce);
        }

        /**
         * Update UI content (immediate)
         */
        updateUI() {
            if (!this.floatingUI || !document.body.contains(this.floatingUI)) {
                return;
            }

            const content = document.getElementById('enhancementPanelContent');
            if (!content) return;

            // Update session counter
            this.updateSessionCounter();

            const sessions = Object.values(enhancementTracker.getAllSessions());

            // No sessions
            if (sessions.length === 0) {
                content.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: ${STYLE.colors.textSecondary};">
                    <div style="font-size: 32px; margin-bottom: 10px;">✧</div>
                    <div style="font-size: 14px;">Begin enhancing to populate data</div>
                </div>
            `;
                return;
            }

            const session = this.getCurrentSession();
            if (!session) {
                content.innerHTML = '<div style="text-align: center; color: ${STYLE.colors.danger};">Invalid session</div>';
                return;
            }

            // Remember expanded state before updating
            const detailsId = `cost-details-${session.id}`;
            const detailsElement = document.getElementById(detailsId);
            const wasExpanded = detailsElement && detailsElement.style.display !== 'none';

            // Build UI content
            content.innerHTML = this.generateSessionHTML(session);

            // Restore expanded state after updating
            if (wasExpanded) {
                const newDetailsElement = document.getElementById(detailsId);
                if (newDetailsElement) {
                    newDetailsElement.style.display = 'block';
                }
            }

            // Update collapsed summary if in collapsed state
            if (this.isCollapsed) {
                this.showCollapsedSummary();
            }
        }

        /**
         * Update session counter in header
         */
        updateSessionCounter() {
            const counter = document.getElementById('enhancementSessionCounter');
            if (!counter) return;

            const sessions = Object.values(enhancementTracker.getAllSessions());
            if (sessions.length === 0) {
                counter.textContent = '';
            } else {
                counter.textContent = `(${this.currentViewingIndex + 1}/${sessions.length})`;
            }
        }

        /**
         * Generate HTML for session display
         */
        generateSessionHTML(session) {
            const gameData = dataManager.getInitClientData();
            const itemDetails = gameData?.itemDetailMap?.[session.itemHrid];
            const itemName = itemDetails?.name || 'Unknown Item';

            // Calculate stats
            const totalAttempts = session.totalAttempts;
            const totalSuccess = session.totalSuccesses;
            session.totalFailures;
            totalAttempts > 0 ? formatters_js.formatPercentage(totalSuccess / totalAttempts, 1) : '0.0%';

            const duration = getSessionDuration(session);
            const durationText = this.formatDuration(duration);

            // Calculate XP/hour if we have enough data (at least 5 seconds + some XP)
            const xpPerHour = duration >= 5 && session.totalXP > 0 ? Math.floor((session.totalXP / duration) * 3600) : 0;

            // Status display
            const statusColor = session.state === SessionState.COMPLETED ? STYLE.colors.success : STYLE.colors.accent;
            const statusText = session.state === SessionState.COMPLETED ? 'Completed' : 'In Progress';

            // Build HTML
            let html = `
            <div style="margin-bottom: 10px; font-size: 13px;">
                <div style="display: flex; justify-content: space-between;">
                    <span>Item:</span>
                    <strong>${itemName}</strong>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>Target:</span>
                    <span>+${session.targetLevel}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>Prot:</span>
                    <span>+${session.protectFrom}</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 5px; color: ${statusColor};">
                    <span>Status:</span>
                    <strong>${statusText}</strong>
                </div>
            </div>
        `;

            // Per-level table
            html += this.generateLevelTable(session);

            // Summary stats
            html += `
            <div style="margin-top: 8px;">
                <div style="display: flex; justify-content: space-between; font-size: 13px;">
                    <div>
                        <span>Total Attempts:</span>
                        <strong> ${totalAttempts}</strong>
                    </div>
                    <div>
                        <span>Prots Used:</span>
                        <strong> ${session.protectionCount || 0}</strong>
                    </div>
                </div>
            </div>`;

            // Predictions (if available)
            if (session.predictions) {
                const predictions = session.predictions;
                const expAtt = predictions.expectedAttempts || 0;
                const expProt = predictions.expectedProtections || 0;
                const actualProt = session.protectionCount || 0;

                // Calculate factors (like Ultimate Tracker)
                const attFactor = expAtt > 0 ? (totalAttempts / expAtt).toFixed(2) : null;
                const protFactor = expProt > 0 ? (actualProt / expProt).toFixed(2) : null;

                html += `
            <div style="display: flex; justify-content: space-between; font-size: 12px; margin-top: 4px;">
                <div style="color: ${STYLE.colors.textSecondary};">
                    <span>Expected Attempts:</span>
                    <span> ${expAtt}</span>
                </div>
                <div style="color: ${STYLE.colors.textSecondary};">
                    <span>Expected Prots:</span>
                    <span> ${expProt}</span>
                </div>
            </div>`;

                if (attFactor || protFactor) {
                    html += `
            <div style="display: flex; justify-content: space-between; font-size: 12px; margin-top: 2px; color: ${STYLE.colors.textSecondary};">
                <div>
                    <span>Attempt Factor:</span>
                    <strong> ${attFactor ? attFactor + 'x' : '—'}</strong>
                </div>
                <div>
                    <span>Prot Factor:</span>
                    <strong> ${protFactor ? protFactor + 'x' : '—'}</strong>
                </div>
            </div>`;
                }
            }

            html += `
            <div style="margin-top: 8px; display: flex; justify-content: space-between; font-size: 13px;">
                <span>Total XP Gained:</span>
                <strong>${this.formatNumber(session.totalXP)}</strong>
            </div>

            <div style="margin-top: 8px; display: flex; justify-content: space-between; font-size: 13px;">
                <span>Session Duration:</span>
                <strong>${durationText}</strong>
            </div>

            <div style="margin-top: 8px; display: flex; justify-content: space-between; font-size: 13px;">
                <span>XP/Hour:</span>
                <strong>${xpPerHour > 0 ? this.formatNumber(xpPerHour) : 'Calculating...'}</strong>
            </div>
        `;

            // Material costs
            html += this.generateMaterialCostsHTML(session);

            return html;
        }

        /**
         * Generate per-level breakdown table
         */
        generateLevelTable(session) {
            const levels = Object.keys(session.attemptsPerLevel).sort((a, b) => b - a);

            if (levels.length === 0) {
                return '<div style="text-align: center; padding: 20px; color: ${STYLE.colors.textSecondary};">No attempts recorded yet</div>';
            }

            let rows = '';
            for (const level of levels) {
                const levelData = session.attemptsPerLevel[level];
                const rate = formatters_js.formatPercentage(levelData.successRate, 1);
                const isCurrent = parseInt(level) === session.currentLevel;

                const rowStyle = isCurrent
                    ? `
                background: linear-gradient(90deg, rgba(126, 87, 194, 0.25), rgba(0, 242, 255, 0.1));
                box-shadow: 0 0 12px rgba(126, 87, 194, 0.5), inset 0 0 6px rgba(0, 242, 255, 0.3);
                border-left: 3px solid ${STYLE.colors.accent};
                font-weight: bold;
            `
                    : '';

                rows += `
                <tr style="${rowStyle}">
                    <td style="${compactCellStyle} text-align: center;">${level}</td>
                    <td style="${compactCellStyle} text-align: right;">${levelData.success}</td>
                    <td style="${compactCellStyle} text-align: right;">${levelData.fail}</td>
                    <td style="${compactCellStyle} text-align: right;">${rate}</td>
                </tr>
            `;
            }

            return `
            <table style="${compactTableStyle}">
                <thead>
                    <tr>
                        <th style="${compactHeaderStyle}">Lvl</th>
                        <th style="${compactHeaderStyle}">Success</th>
                        <th style="${compactHeaderStyle}">Fail</th>
                        <th style="${compactHeaderStyle}">%</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        `;
        }

        /**
         * Generate material costs HTML (expandable)
         */
        generateMaterialCostsHTML(session) {
            // Check if there are any costs to display
            const hasMaterials = session.materialCosts && Object.keys(session.materialCosts).length > 0;
            const hasCoins = session.coinCost > 0;
            const hasProtection = session.protectionCost > 0;

            if (!hasMaterials && !hasCoins && !hasProtection) {
                return '';
            }

            const gameData = dataManager.getInitClientData();
            const detailsId = `cost-details-${session.id}`;

            let html = '<div style="margin-top: 12px; font-size: 13px;">';

            // Collapsible header
            html += `
            <div style="display: flex; justify-content: space-between; cursor: pointer; font-weight: bold; padding: 5px 0;"
                 onclick="document.getElementById('${detailsId}').style.display = document.getElementById('${detailsId}').style.display === 'none' ? 'block' : 'none'">
                <span>💰 Total Cost (click for details)</span>
                <span style="color: ${STYLE.colors.gold};">${this.formatNumber(session.totalCost)}</span>
            </div>
        `;

            // Expandable details section (hidden by default)
            html += `<div id="${detailsId}" style="display: none; margin-left: 10px; margin-top: 5px;">`;

            // Material costs
            if (hasMaterials) {
                html +=
                    '<div style="margin-bottom: 8px; padding: 5px; background: rgba(0, 255, 234, 0.05); border-radius: 4px;">';
                html +=
                    '<div style="font-weight: bold; margin-bottom: 3px; color: ${STYLE.colors.textSecondary};">Materials:</div>';

                for (const [itemHrid, data] of Object.entries(session.materialCosts)) {
                    const itemDetails = gameData?.itemDetailMap?.[itemHrid];
                    const itemName = itemDetails?.name || itemHrid;
                    const unitCost = Math.floor(data.totalCost / data.count);

                    html += `
                    <div style="display: flex; justify-content: space-between; margin-top: 2px; font-size: 12px;">
                        <span>${itemName}</span>
                        <span>${data.count} × ${this.formatNumber(unitCost)} = <span style="color: ${STYLE.colors.gold};">${this.formatNumber(data.totalCost)}</span></span>
                    </div>
                `;
                }
                html += '</div>';
            }

            // Coin costs
            if (hasCoins) {
                html += `
                <div style="display: flex; justify-content: space-between; margin-top: 2px; padding: 5px; background: rgba(0, 255, 234, 0.05); border-radius: 4px;">
                    <span style="font-weight: bold; color: ${STYLE.colors.textSecondary};">Coins (${session.coinCount || 0}×):</span>
                    <span style="color: ${STYLE.colors.gold};">${this.formatNumber(session.coinCost)}</span>
                </div>
            `;
            }

            // Protection costs
            if (hasProtection) {
                const protectionItemName = session.protectionItemHrid
                    ? gameData?.itemDetailMap?.[session.protectionItemHrid]?.name || 'Protection'
                    : 'Protection';

                html += `
                <div style="display: flex; justify-content: space-between; margin-top: 2px; padding: 5px; background: rgba(0, 255, 234, 0.05); border-radius: 4px;">
                    <span style="font-weight: bold; color: ${STYLE.colors.textSecondary};">${protectionItemName} (${session.protectionCount || 0}×):</span>
                    <span style="color: ${STYLE.colors.gold};">${this.formatNumber(session.protectionCost)}</span>
                </div>
            `;
            }

            html += '</div>'; // Close details
            html += '</div>'; // Close container

            return html;
        }

        /**
         * Format number with commas
         */
        formatNumber(num) {
            return Math.floor(num).toLocaleString();
        }

        /**
         * Format duration (seconds to h:m:s)
         */
        formatDuration(seconds) {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = seconds % 60;

            if (h > 0) {
                return `${h}h ${m}m ${s}s`;
            } else if (m > 0) {
                return `${m}m ${s}s`;
            } else {
                return `${s}s`;
            }
        }

        /**
         * Show the UI
         */
        show() {
            if (this.floatingUI) {
                this.floatingUI.style.display = 'flex';
            }
        }

        /**
         * Hide the UI
         */
        hide() {
            if (this.floatingUI) {
                this.floatingUI.style.display = 'none';
            }
        }

        /**
         * Toggle UI visibility
         */
        toggle() {
            if (this.floatingUI) {
                const isVisible = this.floatingUI.style.display !== 'none';
                if (isVisible) {
                    this.hide();
                } else {
                    this.show();
                }
            }
        }

        /**
         * Cleanup all UI resources
         */
        cleanup() {
            // Clear any pending update debounces
            if (this.updateDebounce) {
                clearTimeout(this.updateDebounce);
                this.updateDebounce = null;
            }

            // Clear poll interval
            if (this.pollInterval) {
                clearInterval(this.pollInterval);
                this.pollInterval = null;
            }

            if (this.updateInterval) {
                clearInterval(this.updateInterval);
                this.updateInterval = null;
            }

            // Unregister DOM observer
            if (this.unregisterScreenObserver) {
                this.unregisterScreenObserver();
                this.unregisterScreenObserver = null;
            }

            if (this.dragMoveHandler) {
                document.removeEventListener('mousemove', this.dragMoveHandler);
                this.dragMoveHandler = null;
            }

            if (this.dragUpHandler) {
                document.removeEventListener('mouseup', this.dragUpHandler);
                this.dragUpHandler = null;
            }

            if (this.dragHandle && this.dragMouseDownHandler) {
                this.dragHandle.removeEventListener('mousedown', this.dragMouseDownHandler);
            }

            this.dragHandle = null;
            this.dragMouseDownHandler = null;

            this.timerRegistry.clearAll();

            // Remove floating UI from DOM
            if (this.floatingUI && this.floatingUI.parentNode) {
                this.floatingUI.parentNode.removeChild(this.floatingUI);
                this.floatingUI = null;
            }

            // Reset state
            this.isOnEnhancingScreen = false;
            this.isCollapsed = false;
            this.currentViewingIndex = 0;
            this.isDragging = false;
        }
    }

    const enhancementUI = new EnhancementUI();

    /**
     * Enhancement Event Handlers
     * Automatically detects and tracks enhancement events from WebSocket messages
     */


    /**
     * Setup enhancement event handlers
     */
    function setupEnhancementHandlers() {
        // Listen for action_completed (when enhancement completes)
        webSocketHook.on('action_completed', handleActionCompleted);

        // Listen for wildcard to catch all messages for debugging
        webSocketHook.on('*', handleDebugMessage);
    }

    /**
     * Debug handler to log all messages temporarily
     * @param {Object} _data - WebSocket message data
     */
    function handleDebugMessage(_data) {
        // Debug logging removed
    }

    /**
     * Handle action_completed message (detects enhancement results)
     * @param {Object} data - WebSocket message data
     */
    async function handleActionCompleted(data) {
        if (!config.getSetting('enhancementTracker')) return;
        if (!enhancementTracker.isInitialized) return;

        const action = data.endCharacterAction;
        if (!action) return;

        // Check if this is an enhancement action
        // Ultimate Enhancement Tracker checks: actionHrid === "/actions/enhancing/enhance"
        if (action.actionHrid !== '/actions/enhancing/enhance') {
            return;
        }

        // Handle the enhancement
        await handleEnhancementResult(action);
    }

    /**
     * Extract protection item HRID from action data
     * @param {Object} action - Enhancement action data
     * @returns {string|null} Protection item HRID or null
     */
    function getProtectionItemHrid(action) {
        // Check if protection is enabled
        if (!action.enhancingProtectionMinLevel || action.enhancingProtectionMinLevel < 2) {
            return null;
        }

        // Extract protection item from secondaryItemHash (Ultimate Tracker method)
        if (action.secondaryItemHash) {
            const parts = action.secondaryItemHash.split('::');
            if (parts.length >= 3 && parts[2].startsWith('/items/')) {
                return parts[2];
            }
        }

        // Fallback: check if there's a direct enhancingProtectionItemHrid field
        if (action.enhancingProtectionItemHrid) {
            return action.enhancingProtectionItemHrid;
        }

        return null;
    }

    /**
     * Parse item hash to extract HRID and level
     * Based on Ultimate Enhancement Tracker's parseItemHash function
     * @param {string} primaryItemHash - Item hash from action
     * @returns {Object} {itemHrid, level}
     */
    function parseItemHash(primaryItemHash) {
        try {
            // Handle different possible formats:
            // 1. "/item_locations/inventory::/items/enhancers_bottoms::0" (level 0)
            // 2. "161296::/item_locations/inventory::/items/enhancers_bottoms::5" (level 5)
            // 3. Direct HRID like "/items/enhancers_bottoms" (no level)

            let itemHrid = null;
            let level = 0; // Default to 0 if not specified

            // Split by :: to parse components
            const parts = primaryItemHash.split('::');

            // Find the part that starts with /items/
            const itemPart = parts.find((part) => part.startsWith('/items/'));
            if (itemPart) {
                itemHrid = itemPart;
            }
            // If no /items/ found but it's a direct HRID
            else if (primaryItemHash.startsWith('/items/')) {
                itemHrid = primaryItemHash;
            }

            // Try to extract enhancement level (last part after ::)
            const lastPart = parts[parts.length - 1];
            if (lastPart && !lastPart.startsWith('/')) {
                const parsedLevel = parseInt(lastPart, 10);
                if (!isNaN(parsedLevel)) {
                    level = parsedLevel;
                }
            }

            return { itemHrid, level };
        } catch {
            return { itemHrid: null, level: 0 };
        }
    }

    /**
     * Get enhancement materials and costs for an item
     * Based on Ultimate Enhancement Tracker's getEnhancementMaterials function
     * @param {string} itemHrid - Item HRID
     * @returns {Array|null} Array of [hrid, count] pairs or null
     */
    function getEnhancementMaterials(itemHrid) {
        try {
            const gameData = dataManager.getInitClientData();
            const itemData = gameData?.itemDetailMap?.[itemHrid];

            if (!itemData) {
                return null;
            }

            // Get the costs array
            const costs = itemData.enhancementCosts;

            if (!costs) {
                return null;
            }

            let materials = [];

            // Case 1: Array of objects (current format)
            if (Array.isArray(costs) && costs.length > 0 && typeof costs[0] === 'object') {
                materials = costs.map((cost) => [cost.itemHrid, cost.count]);
            }
            // Case 2: Already in correct format [["/items/foo", 30], ["/items/bar", 20]]
            else if (Array.isArray(costs) && costs.length > 0 && Array.isArray(costs[0])) {
                materials = costs;
            }
            // Case 3: Object format {"/items/foo": 30, "/items/bar": 20}
            else if (typeof costs === 'object' && !Array.isArray(costs)) {
                materials = Object.entries(costs);
            }

            // Filter out any invalid entries
            materials = materials.filter(
                (m) => Array.isArray(m) && m.length === 2 && typeof m[0] === 'string' && typeof m[1] === 'number'
            );

            return materials.length > 0 ? materials : null;
        } catch {
            return null;
        }
    }

    /**
     * Track material costs for current attempt
     * Based on Ultimate Enhancement Tracker's trackMaterialCosts function
     * @param {string} itemHrid - Item HRID
     * @returns {Promise<{materialCost: number, coinCost: number}>}
     */
    async function trackMaterialCosts(itemHrid) {
        const materials = getEnhancementMaterials(itemHrid) || [];
        let materialCost = 0;
        let coinCost = 0;

        for (const [resourceHrid, count] of materials) {
            // Check if this is coins
            if (resourceHrid.includes('/items/coin')) {
                // Track coins for THIS ATTEMPT ONLY
                coinCost = count; // Coins are 1:1 value
                await enhancementTracker.trackCoinCost(count);
            } else {
                // Track material costs
                await enhancementTracker.trackMaterialCost(resourceHrid, count);
                // Add to material cost total
                const priceData = marketAPI.getPrice(resourceHrid, 0);
                const unitCost = priceData ? priceData.ask || priceData.bid || 0 : 0;
                materialCost += unitCost * count;
            }
        }

        return { materialCost, coinCost };
    }

    /**
     * Handle enhancement result (success or failure)
     * @param {Object} action - Enhancement action data
     * @param {Object} _data - Full WebSocket message data
     */
    async function handleEnhancementResult(action, _data) {
        try {
            const { itemHrid, level: newLevel } = parseItemHash(action.primaryItemHash);
            const rawCount = action.currentCount || 0;

            if (!itemHrid) {
                return;
            }

            // Check for item changes on EVERY attempt (not just rawCount === 1)
            let currentSession = enhancementTracker.getCurrentSession();
            let justCreatedNewSession = false;

            // If session exists but is for a different item, finalize and start new session
            if (currentSession && currentSession.itemHrid !== itemHrid) {
                await enhancementTracker.finalizeCurrentSession();
                currentSession = null;

                // Create new session for the new item
                const protectFrom = action.enhancingProtectionMinLevel || 0;
                const targetLevel = action.enhancingMaxLevel || Math.min(newLevel + 5, 20);

                // Infer starting level from current level
                let startLevel = newLevel;
                if (newLevel > 0 && newLevel < Math.max(2, protectFrom)) {
                    startLevel = newLevel - 1;
                }

                const sessionId = await enhancementTracker.startSession(itemHrid, startLevel, targetLevel, protectFrom);
                currentSession = enhancementTracker.getCurrentSession();
                justCreatedNewSession = true; // Flag that we just created this session

                // Switch UI to new session and update display
                enhancementUI.switchToSession(sessionId);
                enhancementUI.scheduleUpdate();
            }

            // On first attempt (rawCount === 1), start session if auto-start is enabled
            // BUT: Ignore if we already have an active session (handles out-of-order events)
            if (rawCount === 1) {
                // Skip early return if we just created a session for item change
                if (!justCreatedNewSession && currentSession && currentSession.itemHrid === itemHrid) {
                    // Already have a session for this item, ignore this late rawCount=1 event
                    return;
                }

                if (!currentSession) {
                    // CRITICAL: On first event, primaryItemHash shows RESULT level, not starting level
                    // We need to infer the starting level from the result
                    const protectFrom = action.enhancingProtectionMinLevel || 0;
                    let startLevel = newLevel;

                    // If result > 0 and below protection threshold, must have started one level lower
                    if (newLevel > 0 && newLevel < Math.max(2, protectFrom)) {
                        startLevel = newLevel - 1; // Successful enhancement (e.g., 0→1)
                    }
                    // Otherwise, started at same level (e.g., 0→0 failure, or protected failure)

                    // Always start new session when tracker is enabled
                    const targetLevel = action.enhancingMaxLevel || Math.min(newLevel + 5, 20);
                    const sessionId = await enhancementTracker.startSession(itemHrid, startLevel, targetLevel, protectFrom);
                    currentSession = enhancementTracker.getCurrentSession();

                    // Switch UI to new session and update display
                    enhancementUI.switchToSession(sessionId);
                    enhancementUI.scheduleUpdate();

                    if (!currentSession) {
                        return;
                    }
                }
            }

            // If no active session, check if we can extend a completed session
            if (!currentSession) {
                // Try to extend a completed session for the same item
                const extendableSessionId = enhancementTracker.findExtendableSession(itemHrid, newLevel);
                if (extendableSessionId) {
                    const newTarget = Math.min(newLevel + 5, 20);
                    await enhancementTracker.extendSessionTarget(extendableSessionId, newTarget);
                    currentSession = enhancementTracker.getCurrentSession();

                    // Switch UI to extended session and update display
                    enhancementUI.switchToSession(extendableSessionId);
                    enhancementUI.scheduleUpdate();
                } else {
                    return;
                }
            }

            // Calculate adjusted attempt count (resume-proof)
            const adjustedCount = calculateAdjustedAttemptCount(currentSession);

            // Track costs for EVERY attempt (including first)
            const { materialCost: _materialCost, coinCost: _coinCost } = await trackMaterialCosts(itemHrid);

            // Get previous level from lastAttempt
            const previousLevel = currentSession.lastAttempt?.level ?? currentSession.startLevel;

            // Check protection item usage BEFORE recording attempt
            // Track protection cost if protection item exists in action data
            // Protection items are consumed when:
            // 1. Level would have decreased (Mirror of Protection prevents decrease, level stays same)
            // 2. Level increased (Philosopher's Mirror guarantees success)
            const protectionItemHrid = getProtectionItemHrid(action);
            if (protectionItemHrid) {
                // Only track if we're at a level where protection might be used
                // (either level stayed same when it could have decreased, or succeeded at high level)
                const protectFrom = currentSession.protectFrom || 0;
                const shouldTrack = previousLevel >= Math.max(2, protectFrom);

                if (shouldTrack && (newLevel <= previousLevel || newLevel === previousLevel + 1)) {
                    // Use market price (like Ultimate Tracker) instead of vendor price
                    const marketPrice = marketAPI.getPrice(protectionItemHrid, 0);
                    let protectionCost = marketPrice?.ask || marketPrice?.bid || 0;

                    // Fall back to vendor price if market price unavailable
                    if (protectionCost === 0) {
                        const gameData = dataManager.getInitClientData();
                        const protectionItem = gameData?.itemDetailMap?.[protectionItemHrid];
                        protectionCost = protectionItem?.vendorSellPrice || 0;
                    }

                    await enhancementTracker.trackProtectionCost(protectionItemHrid, protectionCost);
                }
            }

            // Determine result type
            const wasSuccess = newLevel > previousLevel;

            // Failure detection:
            // 1. Level decreased (1→0, 5→4, etc.)
            // 2. Stayed at 0 (0→0 fail)
            // 3. Stayed at non-zero level WITH protection item (protected failure)
            const levelDecreased = newLevel < previousLevel;
            const failedAtZero = previousLevel === 0 && newLevel === 0;
            const protectedFailure = previousLevel > 0 && newLevel === previousLevel && protectionItemHrid !== null;
            const wasFailure = levelDecreased || failedAtZero || protectedFailure;

            const _wasBlessed = wasSuccess && newLevel - previousLevel >= 2; // Blessed tea detection

            // Update lastAttempt BEFORE recording (so next attempt compares correctly)
            currentSession.lastAttempt = {
                attemptNumber: adjustedCount,
                level: newLevel,
                timestamp: Date.now(),
            };

            // Record the result and track XP
            if (wasSuccess) {
                const xpGain = calculateSuccessXP(previousLevel, itemHrid);
                currentSession.totalXP += xpGain;

                await enhancementTracker.recordSuccess(previousLevel, newLevel);
                enhancementUI.scheduleUpdate(); // Update UI after success

                // Check if we've reached target
                if (newLevel >= currentSession.targetLevel) {
                    // Target reached - session will auto-complete on next UI update
                }
            } else if (wasFailure) {
                const xpGain = calculateFailureXP(previousLevel, itemHrid);
                currentSession.totalXP += xpGain;

                await enhancementTracker.recordFailure(previousLevel);
                enhancementUI.scheduleUpdate(); // Update UI after failure
            }
            // Note: If newLevel === previousLevel (and not 0->0), we track costs but don't record attempt
            // This happens with protection items that prevent level decrease
        } catch {
            // Silent failure
        }
    }

    /**
     * Cleanup event handlers
     */
    function cleanupEnhancementHandlers() {
        webSocketHook.off('action_completed', handleActionCompleted);
        webSocketHook.off('*', handleDebugMessage);
    }

    /**
     * Enhancement Feature Wrapper
     * Manages initialization and cleanup of all enhancement-related components
     * Fixes handler accumulation by coordinating tracker, UI, and handlers
     */


    class EnhancementFeature {
        constructor() {
            this.isInitialized = false;
        }

        /**
         * Initialize all enhancement components
         */
        async initialize() {
            if (this.isInitialized) {
                return;
            }

            this.isInitialized = true;

            // Initialize tracker (async)
            await enhancementTracker.initialize();

            // Setup WebSocket handlers
            setupEnhancementHandlers();

            // Initialize UI
            enhancementUI.initialize();
        }

        /**
         * Cleanup all enhancement components
         */
        disable() {
            // Cleanup WebSocket handlers
            cleanupEnhancementHandlers();

            // Cleanup UI
            enhancementUI.cleanup();

            // Cleanup tracker (has its own disable method)
            if (enhancementTracker.disable) {
                enhancementTracker.disable();
            }

            this.isInitialized = false;
        }
    }

    const enhancementFeature = new EnhancementFeature();

    /**
     * Empty Queue Notification
     * Sends browser notification when action queue becomes empty
     */


    class EmptyQueueNotification {
        constructor() {
            this.wasEmpty = false;
            this.unregisterHandlers = [];
            this.permissionGranted = false;
            this.characterSwitchingHandler = null;
            this.timerRegistry = timerRegistry_js.createTimerRegistry();
        }

        /**
         * Initialize empty queue notification
         */
        async initialize() {
            if (!config.getSetting('notifiEmptyAction')) {
                return;
            }

            // Request notification permission
            await this.requestPermission();

            // Listen for action updates
            this.registerWebSocketListeners();

            this.characterSwitchingHandler = () => {
                this.disable();
            };

            dataManager.on('character_switching', this.characterSwitchingHandler);
        }

        /**
         * Request browser notification permission
         */
        async requestPermission() {
            if (!('Notification' in window)) {
                console.warn('[Empty Queue Notification] Browser notifications not supported');
                return;
            }

            if (Notification.permission === 'granted') {
                this.permissionGranted = true;
                return;
            }

            if (Notification.permission !== 'denied') {
                try {
                    const permission = await Notification.requestPermission();
                    this.permissionGranted = permission === 'granted';
                } catch (error) {
                    console.warn('[Empty Queue Notification] Permission request failed:', error);
                }
            }
        }

        /**
         * Register WebSocket message listeners
         */
        registerWebSocketListeners() {
            const actionsHandler = (data) => {
                this.checkActionQueue(data);
            };

            webSocketHook.on('actions_updated', actionsHandler);

            this.unregisterHandlers.push(() => {
                webSocketHook.off('actions_updated', actionsHandler);
            });
        }

        /**
         * Check if action queue is empty and send notification
         * @param {Object} _data - WebSocket data (unused, but kept for handler signature)
         */
        checkActionQueue(_data) {
            if (!config.getSetting('notifiEmptyAction')) {
                return;
            }

            if (!this.permissionGranted) {
                return;
            }

            // Get current actions from dataManager (source of truth for all queued actions)
            const allActions = dataManager.getCurrentActions();
            const isEmpty = allActions.length === 0;

            // Only notify on transition from not-empty to empty
            if (isEmpty && !this.wasEmpty) {
                this.sendNotification();
            }

            this.wasEmpty = isEmpty;
        }

        /**
         * Send browser notification
         */
        sendNotification() {
            try {
                if (typeof Notification === 'undefined') {
                    console.error('[Empty Queue Notification] Notification API not available');
                    return;
                }

                if (Notification.permission !== 'granted') {
                    console.error('[Empty Queue Notification] Notification permission not granted');
                    return;
                }

                // Use standard Notification API
                const notification = new Notification('Milky Way Idle', {
                    body: 'Your action queue is empty!',
                    icon: 'https://www.milkywayidle.com/favicon.ico',
                    tag: 'empty-queue',
                    requireInteraction: false,
                });

                notification.onclick = () => {
                    window.focus();
                    notification.close();
                };

                notification.onerror = (error) => {
                    console.error('[Empty Queue Notification] Notification error:', error);
                };

                // Auto-close after 5 seconds
                const closeTimeout = setTimeout(() => notification.close(), 5000);
                this.timerRegistry.registerTimeout(closeTimeout);
            } catch (error) {
                console.error('[Empty Queue Notification] Failed to send notification:', error);
            }
        }

        /**
         * Cleanup
         */
        disable() {
            if (this.characterSwitchingHandler) {
                dataManager.off('character_switching', this.characterSwitchingHandler);
                this.characterSwitchingHandler = null;
            }

            this.unregisterHandlers.forEach((unregister) => unregister());
            this.unregisterHandlers = [];
            this.wasEmpty = false;
            this.timerRegistry.clearAll();
        }
    }

    const emptyQueueNotification = new EmptyQueueNotification();

    /**
     * UI Library
     * UI enhancements, tasks, skills, house, settings, and misc features
     *
     * Exports to: window.Toolasha.UI
     */


    // Export to global namespace
    const toolashaRoot = window.Toolasha || {};
    window.Toolasha = toolashaRoot;

    if (typeof unsafeWindow !== 'undefined') {
        unsafeWindow.Toolasha = toolashaRoot;
    }

    toolashaRoot.UI = {
        equipmentLevelDisplay,
        alchemyItemDimming,
        skillExperiencePercentage,
        externalLinks,
        taskProfitDisplay,
        taskRerollTracker,
        taskSorter,
        taskIcons,
        remainingXP,
        housePanelObserver,
        settingsUI,
        transmuteRates,
        enhancementFeature,
        emptyQueueNotification,
    };

    console.log('[Toolasha] UI library loaded');

})(Toolasha.Core.config, Toolasha.Core.dataManager, Toolasha.Core.domObserver, Toolasha.Utils.formatters, Toolasha.Utils.timerRegistry, Toolasha.Core.webSocketHook, Toolasha.Core.marketAPI, Toolasha.Utils.tokenValuation, Toolasha.Utils.marketData, Toolasha.Utils.profitHelpers, Toolasha.Utils.equipmentParser, Toolasha.Utils.teaParser, Toolasha.Utils.bonusRevenueCalculator, Toolasha.Utils.profitConstants, Toolasha.Utils.efficiency, Toolasha.Utils.houseEfficiency, Toolasha.Utils.selectors, Toolasha.Core.storage, Toolasha.Utils.domObserverHelpers, Toolasha.Utils.cleanupRegistry, Toolasha.Core, Toolasha.Core.settingsStorage, Toolasha.Utils.enhancementCalculator);
