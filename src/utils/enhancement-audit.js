/**
 * Enhancement Audit Module
 *
 * Systematically validates that all expected effects from game mechanics are being detected.
 * Warns about missing effects to prevent systematic bugs where secondary effects are overlooked.
 */

/**
 * Expected buff types for house rooms (Observatory)
 */
const EXPECTED_HOUSE_BUFFS = {
    '/house_rooms/observatory': [
        '/buff_types/enhancing_success',  // +0.05% per level
        '/buff_types/action_speed',       // +1% per level
    ]
};

/**
 * Expected buff types for enhancing consumables
 * Each tea should have multiple buffs (not just one)
 */
const EXPECTED_TEA_BUFFS = {
    '/items/enhancing_tea': [
        '/buff_types/skill_level_change',  // +3 levels
        '/buff_types/action_speed',        // +2% speed
    ],
    '/items/super_enhancing_tea': [
        '/buff_types/skill_level_change',  // +6 levels
        '/buff_types/action_speed',        // +4% speed
    ],
    '/items/ultra_enhancing_tea': [
        '/buff_types/skill_level_change',  // +8 levels
        '/buff_types/action_speed',        // +6% speed
    ],
    '/items/blessed_tea': [
        '/buff_types/double_enhancement_jump',  // 1% double jump
    ]
};

/**
 * Expected noncombat stats for enhancing equipment
 */
const EXPECTED_EQUIPMENT_STATS = [
    'enhancingSuccess',      // Success rate bonus
    'enhancingSpeed',        // Action speed bonus
    'enhancingRareFind',     // Rare find bonus
    'enhancingExperience',   // Experience bonus
    'drinkConcentration',    // Scales consumable effects
];

/**
 * Expected community buff types for enhancing
 */
const EXPECTED_COMMUNITY_BUFFS = [
    '/community_buff_types/enhancing_speed',  // 20% + 0.5% per level
];

/**
 * Audit house room buffs for enhancing
 * @param {Object} gameData - Game data from init_client_data
 * @returns {Object} Audit results
 */
export function auditHouseRoomBuffs(gameData) {
    const results = {
        valid: true,
        warnings: [],
        info: []
    };

    if (!gameData?.houseRoomDetailMap) {
        results.valid = false;
        results.warnings.push('Game data missing houseRoomDetailMap');
        return results;
    }

    // Check Observatory
    for (const [roomHrid, expectedBuffs] of Object.entries(EXPECTED_HOUSE_BUFFS)) {
        const room = gameData.houseRoomDetailMap[roomHrid];

        if (!room) {
            results.warnings.push(`House room not found: ${roomHrid}`);
            continue;
        }

        if (!room.actionBuffs || room.actionBuffs.length === 0) {
            results.valid = false;
            results.warnings.push(`${room.name}: Missing actionBuffs array`);
            continue;
        }

        // Get all buff types present
        const foundBuffTypes = room.actionBuffs.map(buff => buff.typeHrid);

        // Check for missing expected buffs
        const missingBuffs = expectedBuffs.filter(expected => !foundBuffTypes.includes(expected));

        if (missingBuffs.length > 0) {
            results.valid = false;
            results.warnings.push(`${room.name}: Missing expected buffs: ${missingBuffs.join(', ')}`);
        } else {
            results.info.push(`${room.name}: All expected buffs found (${foundBuffTypes.length} buffs)`);
        }

        // Log detailed buff info
        room.actionBuffs.forEach(buff => {
            const buffDetail = gameData.buffTypeDetailMap?.[buff.typeHrid];
            if (buffDetail) {
                results.info.push(`  → ${buffDetail.name}: ${buff.skillHrid} (+${buff.flat || buff.percent || 0})`);
            }
        });
    }

    return results;
}

/**
 * Audit tea consumable buffs for enhancing
 * @param {Object} gameData - Game data from init_client_data
 * @returns {Object} Audit results
 */
export function auditTeaBuffs(gameData) {
    const results = {
        valid: true,
        warnings: [],
        info: []
    };

    if (!gameData?.itemDetailMap) {
        results.valid = false;
        results.warnings.push('Game data missing itemDetailMap');
        return results;
    }

    // Check each tea
    for (const [teaHrid, expectedBuffs] of Object.entries(EXPECTED_TEA_BUFFS)) {
        const tea = gameData.itemDetailMap[teaHrid];

        if (!tea) {
            results.warnings.push(`Tea not found: ${teaHrid}`);
            continue;
        }

        // Check for buffs array (NOT singular buff field!)
        if (!tea.buffs || !Array.isArray(tea.buffs)) {
            results.valid = false;
            results.warnings.push(`${tea.name}: Missing buffs ARRAY (found singular buff field instead?)`);
            continue;
        }

        if (tea.buffs.length === 0) {
            results.valid = false;
            results.warnings.push(`${tea.name}: buffs array is empty`);
            continue;
        }

        // Get all buff types present
        const foundBuffTypes = tea.buffs.map(buff => buff.typeHrid);

        // Check for missing expected buffs
        const missingBuffs = expectedBuffs.filter(expected => !foundBuffTypes.includes(expected));

        if (missingBuffs.length > 0) {
            results.valid = false;
            results.warnings.push(`${tea.name}: Missing expected buffs: ${missingBuffs.join(', ')}`);
        } else {
            results.info.push(`${tea.name}: All expected buffs found (${foundBuffTypes.length} buffs)`);
        }

        // Log detailed buff info
        tea.buffs.forEach(buff => {
            const buffDetail = gameData.buffTypeDetailMap?.[buff.typeHrid];
            if (buffDetail) {
                results.info.push(`  → ${buffDetail.name}: ${buff.skillHrid || 'all'} (+${buff.flat || (buff.percent * 100) || 0})`);
            }
        });
    }

    return results;
}

/**
 * Audit equipment noncombat stats coverage
 * @param {Object} gameData - Game data from init_client_data
 * @returns {Object} Audit results
 */
export function auditEquipmentStats(gameData) {
    const results = {
        valid: true,
        warnings: [],
        info: [],
        statsFound: new Set()
    };

    if (!gameData?.itemDetailMap) {
        results.valid = false;
        results.warnings.push('Game data missing itemDetailMap');
        return results;
    }

    // Scan all items for noncombat stats
    let itemsWithEnhancingStats = 0;

    for (const [itemHrid, item] of Object.entries(gameData.itemDetailMap)) {
        if (!item.equipmentDetail?.noncombatStats) continue;

        const stats = item.equipmentDetail.noncombatStats;

        // Check if this item has any enhancing-related stats
        const hasEnhancingStats = EXPECTED_EQUIPMENT_STATS.some(stat => stats[stat] !== undefined);

        if (hasEnhancingStats) {
            itemsWithEnhancingStats++;

            // Track which stats we've found
            EXPECTED_EQUIPMENT_STATS.forEach(stat => {
                if (stats[stat] !== undefined) {
                    results.statsFound.add(stat);
                }
            });
        }
    }

    results.info.push(`Found ${itemsWithEnhancingStats} items with enhancing stats`);
    results.info.push(`Stats found: ${Array.from(results.statsFound).join(', ')}`);

    // Check if we're missing any expected stat types
    const missingStats = EXPECTED_EQUIPMENT_STATS.filter(stat => !results.statsFound.has(stat));
    if (missingStats.length > 0) {
        results.warnings.push(`No items found with these enhancing stats: ${missingStats.join(', ')}`);
    }

    return results;
}

/**
 * Audit community buff detection
 * @param {Object} gameData - Game data from init_client_data
 * @returns {Object} Audit results
 */
export function auditCommunityBuffs(gameData) {
    const results = {
        valid: true,
        warnings: [],
        info: []
    };

    if (!gameData?.communityBuffTypeDetailMap) {
        results.valid = false;
        results.warnings.push('Game data missing communityBuffTypeDetailMap');
        return results;
    }

    // Check for expected community buffs
    for (const buffHrid of EXPECTED_COMMUNITY_BUFFS) {
        const buff = gameData.communityBuffTypeDetailMap[buffHrid];

        if (!buff) {
            results.valid = false;
            results.warnings.push(`Community buff not found: ${buffHrid}`);
            continue;
        }

        results.info.push(`${buff.name}: Found in game data`);

        // Log buff details if available
        if (buff.basePercent !== undefined) {
            results.info.push(`  → Base: ${buff.basePercent * 100}%`);
        }
        if (buff.perLevelPercent !== undefined) {
            results.info.push(`  → Per level: ${buff.perLevelPercent * 100}%`);
        }
    }

    return results;
}

/**
 * Run full enhancement mechanics audit
 * @param {Object} gameData - Game data from init_client_data
 * @returns {Object} Complete audit results
 */
export function runFullAudit(gameData) {
    console.log('[MWI Tools] 🔍 Running Enhancement Mechanics Audit...');

    const results = {
        houseRooms: auditHouseRoomBuffs(gameData),
        teas: auditTeaBuffs(gameData),
        equipment: auditEquipmentStats(gameData),
        communityBuffs: auditCommunityBuffs(gameData),
    };

    // Print results
    let hasWarnings = false;

    for (const [category, result] of Object.entries(results)) {
        console.log(`\n[MWI Tools] === ${category.toUpperCase()} ===`);

        if (result.warnings.length > 0) {
            hasWarnings = true;
            result.warnings.forEach(warning => {
                console.warn(`[MWI Tools] ⚠️ ${warning}`);
            });
        }

        if (result.info.length > 0) {
            result.info.forEach(info => {
                console.log(`[MWI Tools] ℹ️ ${info}`);
            });
        }
    }

    if (!hasWarnings) {
        console.log('\n[MWI Tools] ✅ Audit complete: No issues found!');
    } else {
        console.log('\n[MWI Tools] ⚠️ Audit complete: Issues found (see warnings above)');
    }

    return results;
}

/**
 * Data structure patterns to watch for (documentation)
 */
export const DATA_PATTERNS = {
    MULTIPLE_EFFECTS: [
        '✓ Arrays named "buffs" (plural) indicate multiple effects',
        '✓ Objects with "actionBuffs" array have multiple buff types',
        '✓ Equipment with multiple "*Bonus" fields (enhancingSuccess, enhancingSpeed, etc.)',
        '✓ Community buffs with "basePercent" + "perLevelPercent" fields',
    ],
    COMMON_MISTAKES: [
        '❌ Reading singular "buff" field instead of "buffs" array',
        '❌ Only checking first element of buffs array',
        '❌ Using wrong field name (equipmentType vs type)',
        '❌ Forgetting to scale consumable effects with drinkConcentration',
        '❌ Not checking all noncombat stat fields on equipment',
    ],
    VALIDATION_CHECKLIST: [
        '□ Check if data structure is an ARRAY (multiple effects)',
        '□ Iterate ALL elements in arrays, not just first',
        '□ Read correct field names from game data (check casing)',
        '□ Look for scaling factors (concentration, level advantage)',
        '□ Verify buff typeHrid matches expected types',
        '□ Check for multiple stat fields on same object',
    ]
};
