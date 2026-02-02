/**
 * House Panel Observer
 * Detects house upgrade modal and injects cost displays
 */

import domObserver from '../../core/dom-observer.js';
import houseCostCalculator from './house-cost-calculator.js';
import houseCostDisplay from './house-cost-display.js';
import dataManager from '../../core/data-manager.js';
import { createMutationWatcher } from '../../utils/dom-observer-helpers.js';
import { createCleanupRegistry } from '../../utils/cleanup-registry.js';

class HousePanelObserver {
    constructor() {
        this.isActive = false;
        this.cleanupRegistry = createCleanupRegistry();
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
        const observer = createMutationWatcher(
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
        this.cleanupRegistry = createCleanupRegistry();
        this.processedCards = new WeakSet();
        this.isActive = false;
    }
}

const housePanelObserver = new HousePanelObserver();

export default housePanelObserver;
