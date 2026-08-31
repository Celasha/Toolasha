import Ability from './ability.js';
import CombatUnit from './combat-unit.js';
import Drops from './drops.js';
import { getGameData } from './game-data.js';

const LABYRINTH_BASE_ROOM_LEVEL = 100;

class Monster extends CombatUnit {
    difficultyTier = 0;
    roomLevel = 0;

    constructor(hrid, difficultyTier = 0, roomLevel = 0) {
        super();

        this.isPlayer = false;
        this.hrid = hrid;
        this.difficultyTier = difficultyTier;
        this.roomLevel = roomLevel;

        const combatMonsterDetailMap = getGameData().combatMonsterDetailMap;
        const gameMonster = combatMonsterDetailMap[this.hrid];
        if (!gameMonster) {
            throw new Error('No monster found for hrid: ' + this.hrid);
        }

        this.enrageTime = gameMonster.enrageTime;

        // Labyrinth scaling: ability levels scale by roomLevel / 100
        const labyrinthScaleFactor = this.roomLevel > 0 ? this.roomLevel / LABYRINTH_BASE_ROOM_LEVEL : 1;

        for (let i = 0; i < gameMonster.abilities.length; i++) {
            if (gameMonster.abilities[i].minDifficultyTier > this.difficultyTier) {
                continue;
            }
            const baseLevel = gameMonster.abilities[i].level;
            const scaledLevel = this.roomLevel > 0 ? Math.floor(baseLevel * labyrinthScaleFactor) : baseLevel;
            this.abilities[i] = new Ability(gameMonster.abilities[i].abilityHrid, scaledLevel);
        }
        if (gameMonster.dropTable) {
            for (let i = 0; i < gameMonster.dropTable.length; i++) {
                this.dropTable[i] = new Drops(
                    gameMonster.dropTable[i].itemHrid,
                    gameMonster.dropTable[i].dropRate,
                    gameMonster.dropTable[i].minCount,
                    gameMonster.dropTable[i].maxCount,
                    gameMonster.dropTable[i].difficultyTier
                );
            }
        }
        for (let i = 0; i < gameMonster.rareDropTable.length; i++) {
            const dropTableItem =
                gameMonster.dropTable && i < gameMonster.dropTable.length ? gameMonster.dropTable[i] : null;
            const difficultyTier = dropTableItem?.difficultyTier ?? gameMonster.rareDropTable[i].minDifficultyTier;

            this.rareDropTable[i] = new Drops(
                gameMonster.rareDropTable[i].itemHrid,
                gameMonster.rareDropTable[i].dropRate,
                gameMonster.rareDropTable[i].minCount,
                difficultyTier
            );
        }
    }

    updateCombatDetails() {
        const combatMonsterDetailMap = getGameData().combatMonsterDetailMap;
        const gameMonster = combatMonsterDetailMap[this.hrid];

        const levelMultiplier = 1.0 + 0.25 * this.difficultyTier;
        const defLevelMultiplier = 1.0 + 0.15 * this.difficultyTier;
        const levelBonus = 20.0 * this.difficultyTier;

        // Labyrinth scaling: all levels multiply by roomLevel / 100
        const labyrinthScaleFactor = this.roomLevel > 0 ? this.roomLevel / LABYRINTH_BASE_ROOM_LEVEL : 1;

        this.staminaLevel =
            levelMultiplier * (gameMonster.combatDetails.staminaLevel + levelBonus) * labyrinthScaleFactor;
        this.intelligenceLevel =
            levelMultiplier * (gameMonster.combatDetails.intelligenceLevel + levelBonus) * labyrinthScaleFactor;
        this.attackLevel =
            levelMultiplier * (gameMonster.combatDetails.attackLevel + levelBonus) * labyrinthScaleFactor;
        this.meleeLevel = levelMultiplier * (gameMonster.combatDetails.meleeLevel + levelBonus) * labyrinthScaleFactor;
        this.defenseLevel =
            defLevelMultiplier * (gameMonster.combatDetails.defenseLevel + levelBonus) * labyrinthScaleFactor;
        this.rangedLevel =
            levelMultiplier * (gameMonster.combatDetails.rangedLevel + levelBonus) * labyrinthScaleFactor;
        this.magicLevel = levelMultiplier * (gameMonster.combatDetails.magicLevel + levelBonus) * labyrinthScaleFactor;

        const expMultiplier = 1.0 + 0.5 * this.difficultyTier;
        const expBonus = 5.0 * this.difficultyTier;

        this.experience = expMultiplier * (gameMonster.experience + expBonus);

        this.combatDetails.combatStats.combatStyleHrid = gameMonster.combatDetails.combatStats.combatStyleHrids[0];

        for (const [key, value] of Object.entries(gameMonster.combatDetails.combatStats)) {
            this.combatDetails.combatStats[key] = value;
        }

        [
            'stabAccuracy',
            'slashAccuracy',
            'smashAccuracy',
            'rangedAccuracy',
            'magicAccuracy',
            'stabDamage',
            'slashDamage',
            'smashDamage',
            'rangedDamage',
            'magicDamage',
            'defensiveDamage',
            'taskDamage',
            'physicalAmplify',
            'waterAmplify',
            'natureAmplify',
            'fireAmplify',
            'healingAmplify',
            'stabEvasion',
            'slashEvasion',
            'smashEvasion',
            'rangedEvasion',
            'magicEvasion',
            'armor',
            'waterResistance',
            'natureResistance',
            'fireResistance',
            'maxHitpoints',
            'maxManapoints',
            'lifeSteal',
            'hpRegenPer10',
            'mpRegenPer10',
            'physicalThorns',
            'elementalThorns',
            'combatDropRate',
            'combatRareFind',
            'combatDropQuantity',
            'combatExperience',
            'criticalRate',
            'criticalDamage',
            'armorPenetration',
            'waterPenetration',
            'naturePenetration',
            'firePenetration',
            'abilityHaste',
            'tenacity',
            'manaLeech',
            'castSpeed',
            'threat',
            'parry',
            'mayhem',
            'pierce',
            'curse',
            'fury',
            'weaken',
            'ripple',
            'bloom',
            'blaze',
            'attackSpeed',
            'foodHaste',
            'drinkConcentration',
            'autoAttackDamage',
            'abilityDamage',
            'retaliation',
        ].forEach((stat) => {
            if (gameMonster.combatDetails.combatStats[stat] == null) {
                this.combatDetails.combatStats[stat] = 0;
            }
        });

        if (this.combatDetails.combatStats.attackInterval === 0) {
            this.combatDetails.combatStats.attackInterval = gameMonster.combatDetails.attackInterval;
        }

        // Labyrinth room scaling applies once to the monster's base armor/resistance contributions.
        // Defense level is already room-scaled above (labyrinthScaleFactor); scaling the derived
        // totalArmor/totalXResistance again after super.updateCombatDetails() would double-apply it.
        if (this.roomLevel > 0) {
            this.combatDetails.combatStats.armor *= labyrinthScaleFactor;
            this.combatDetails.combatStats.waterResistance *= labyrinthScaleFactor;
            this.combatDetails.combatStats.natureResistance *= labyrinthScaleFactor;
            this.combatDetails.combatStats.fireResistance *= labyrinthScaleFactor;
        }

        super.updateCombatDetails();
    }
}

export default Monster;
