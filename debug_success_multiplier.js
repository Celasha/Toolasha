// Debug script to verify success multiplier calculation
// Paste this into console after MWI Tools has loaded

console.log('=== Success Multiplier Debug ===');

// Get auto-detected params
const MWITools = window.MWITools;

if (!MWITools) {
    console.error('MWI Tools not loaded yet!');
} else {
    const config = MWITools.config;
    const dataManager = MWITools.dataManager;
    // Get character data
    const equipment = dataManager.getEquipment();
    const inventory = dataManager.getInventory();
    const skills = dataManager.getSkills();
    const itemDetailMap = dataManager.getInitClientData()?.itemDetailMap || {};

    // Get enhancing level
    const enhancingSkill = skills.find(s => s.skillHrid === '/skills/enhancing');
    const baseEnhancingLevel = enhancingSkill?.level || 1;

    // Get house level
    const houseLevel = dataManager.getHouseRoomLevel('/house_rooms/observatory');

    // Get equipment success bonus (scan inventory for best enhancing gear)
    let equipmentSuccessBonus = 0;
    const itemsToScan = inventory ? inventory.filter(item => item && item.itemHrid) : [];

    for (const item of itemsToScan) {
        const itemDetails = itemDetailMap[item.itemHrid];
        if (!itemDetails?.equipmentDetail?.noncombatStats?.enhancingSuccess) continue;

        const enhLevel = item.enhancementLevel || 0;
        const equipType = itemDetails.equipmentDetail.type;

        // Calculate multiplier based on slot
        let slotMultiplier = 1.0;
        if (equipType === '/equipment_types/neck' ||
            equipType === '/equipment_types/ring' ||
            equipType === '/equipment_types/earring') {
            slotMultiplier = 5.0; // Accessories get 5× multiplier
        }

        // Calculate enhancement multiplier
        const enhancementBonus = [0, 0.02, 0.042, 0.066, 0.092, 0.12, 0.15, 0.182, 0.216, 0.252, 0.29,
                                   0.334, 0.384, 0.44, 0.502, 0.57, 0.644, 0.724, 0.81, 0.902, 1.0];
        const enhancementMultiplier = 1 + (enhancementBonus[enhLevel] || 0) * slotMultiplier;

        const baseSuccess = itemDetails.equipmentDetail.noncombatStats.enhancingSuccess;
        const totalSuccess = baseSuccess * 100 * enhancementMultiplier;

        equipmentSuccessBonus += totalSuccess;
    }

    // Get tea level bonus
    const drinkSlots = dataManager.getActionDrinkSlots('/action_types/enhancing');
    let drinkConcentration = 0;
    let teaLevelBonus = 0;

    // Detect drink concentration
    for (const item of itemsToScan) {
        const itemDetails = itemDetailMap[item.itemHrid];
        if (!itemDetails?.equipmentDetail?.noncombatStats?.drinkConcentration) continue;
        const concentration = itemDetails.equipmentDetail.noncombatStats.drinkConcentration;
        drinkConcentration += concentration * 100;
    }

    // Detect tea level bonus
    if (drinkSlots && drinkSlots.length > 0) {
        for (const drink of drinkSlots) {
            if (!drink || !drink.itemHrid) continue;

            if (drink.itemHrid === '/items/ultra_enhancing_tea') {
                teaLevelBonus = 8;
            } else if (drink.itemHrid === '/items/super_enhancing_tea') {
                teaLevelBonus = Math.max(teaLevelBonus, 6);
            } else if (drink.itemHrid === '/items/enhancing_tea') {
                teaLevelBonus = Math.max(teaLevelBonus, 3);
            }
        }
    }

    // Scale tea by drink concentration
    if (teaLevelBonus > 0) {
        teaLevelBonus = teaLevelBonus * (1 + drinkConcentration / 100);
    }

    // Calculate totals
    const houseSuccessBonus = houseLevel * 0.05;
    const totalSuccessBonus = equipmentSuccessBonus + houseSuccessBonus;
    const effectiveEnhancingLevel = baseEnhancingLevel + teaLevelBonus;

    console.log('Base Enhancing Level:', baseEnhancingLevel);
    console.log('Tea Level Bonus:', teaLevelBonus.toFixed(2));
    console.log('Drink Concentration:', drinkConcentration.toFixed(2) + '%');
    console.log('Effective Enhancing Level:', effectiveEnhancingLevel.toFixed(2));
    console.log('');
    console.log('Equipment Success Bonus:', equipmentSuccessBonus.toFixed(2) + '%');
    console.log('House Success Bonus (Observatory):', houseSuccessBonus.toFixed(2) + '%');
    console.log('Total Success Bonus (toolBonus):', totalSuccessBonus.toFixed(2) + '%');
    console.log('');

    // Test with item level 90 (Cheese Sword)
    const itemLevel = 90;
    const levelAdvantage = 0.05 * (effectiveEnhancingLevel - itemLevel);
    const successMultiplier = 1 + (totalSuccessBonus + levelAdvantage) / 100;

    console.log('Item Level:', itemLevel);
    console.log('Level Advantage:', levelAdvantage.toFixed(2) + '%');
    console.log('Success Multiplier:', successMultiplier.toFixed(4));
    console.log('Expected: 1.0519');
    console.log('');
    console.log('Breakdown:');
    console.log('  1 + (toolBonus + levelAdvantage) / 100');
    console.log('  1 + (' + totalSuccessBonus.toFixed(2) + ' + ' + levelAdvantage.toFixed(2) + ') / 100');
    console.log('  1 + ' + (totalSuccessBonus + levelAdvantage).toFixed(2) + ' / 100');
    console.log('  = ' + successMultiplier.toFixed(4));
}
