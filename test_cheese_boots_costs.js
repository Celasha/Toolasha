// Test script - paste into browser console
const gameData = Toolasha.dataManager.getInitClientData();
const itemData = gameData.itemDetailMap['/items/cheese_boots'];
console.log('Cheese Boots enhancement costs:', itemData.enhancementCosts);
