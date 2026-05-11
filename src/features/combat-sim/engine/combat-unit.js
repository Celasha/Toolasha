class CombatUnit {
    isPlayer;
    isStunned = false;
    stunExpireTime = null;
    isBlinded = false;
    blindExpireTime = null;
    isSilenced = false;
    silenceExpireTime = null;

    isOutOfMana = false;

    // Base levels which don't change after initialization
    staminaLevel = 1;
    intelligenceLevel = 1;
    attackLevel = 1;
    meleeLevel = 1;
    defenseLevel = 1;
    rangedLevel = 1;
    magicLevel = 1;

    experience = 0;
    experienceRate = 0;
    enrageTime = 0;

    abilities = [null, null, null, null];
    food = [null, null, null];
    drinks = [null, null, null];
    houseRooms = [];
    dropTable = [];
    rareDropTable = [];
    abilityManaCosts = new Map();

    // Calculated combat stats including temporary buffs
    combatDetails = {
        staminaLevel: 1,
        intelligenceLevel: 1,
        attackLevel: 1,
        meleeLevel: 1,
        defenseLevel: 1,
        rangedLevel: 1,
        magicLevel: 1,
        maxHitpoints: 110,
        currentHitpoints: 110,
        maxManapoints: 110,
        currentManapoints: 110,
        stabAccuracyRating: 11,
        slashAccuracyRating: 11,
        smashAccuracyRating: 11,
        rangedAccuracyRating: 11,
        magicAccuracyRating: 11,
        stabMaxDamage: 11,
        slashMaxDamage: 11,
        smashMaxDamage: 11,
        rangedMaxDamage: 11,
        magicMaxDamage: 11,
        stabEvasionRating: 11,
        slashEvasionRating: 11,
        smashEvasionRating: 11,
        rangedEvasionRating: 11,
        magicEvasionRating: 11,
        defensiveMaxDamage: 0,
        totalArmor: 0.2,
        totalWaterResistance: 0.4,
        totalNatureResistance: 0.4,
        totalFireResistance: 0.4,
        abilityHaste: 0,
        tenacity: 0,
        totalThreat: 100,
        combatStats: {
            combatStyleHrid: '/combat_styles/smash',
            damageType: '/damage_types/physical',
            attackInterval: 3000000000,
            autoAttackDamage: 0,
            abilityDamage: 0,
            criticalRate: 0,
            criticalDamage: 0,
            stabAccuracy: 0,
            slashAccuracy: 0,
            smashAccuracy: 0,
            rangedAccuracy: 0,
            magicAccuracy: 0,
            stabDamage: 0,
            slashDamage: 0,
            smashDamage: 0,
            rangedDamage: 0,
            magicDamage: 0,
            defensiveDamage: 0,
            taskDamage: 0,
            physicalAmplify: 0,
            waterAmplify: 0,
            natureAmplify: 0,
            fireAmplify: 0,
            healingAmplify: 0,
            physicalThorns: 0,
            elementalThorns: 0,
            maxHitpoints: 0,
            maxManapoints: 0,
            stabEvasion: 0,
            slashEvasion: 0,
            smashEvasion: 0,
            rangedEvasion: 0,
            magicEvasion: 0,
            armor: 0,
            waterResistance: 0,
            natureResistance: 0,
            fireResistance: 0,
            lifeSteal: 0,
            hpRegenPer10: 0.01,
            mpRegenPer10: 0.01,
            combatDropRate: 0,
            combatDropQuantity: 0,
            combatRareFind: 0,
            combatExperience: 0,
            maxHitpointsRatio: 0,
            maxManapointsRatio: 0,
            foodSlots: 1,
            drinkSlots: 1,
            armorPenetration: 0,
            waterPenetration: 0,
            naturePenetration: 0,
            firePenetration: 0,
            manaLeech: 0,
            castSpeed: 0,
            threat: 100,
            parry: 0,
            mayhem: 0,
            pierce: 0,
            curse: 0,
            ripple: 0,
            bloom: 0,
            blaze: 0,
            weaken: 0,
            fury: 0,
            foodHaste: 0,
            drinkConcentration: 0,
            damageTaken: 0,
            attackSpeed: 0,
            armorDamageRatio: 0,
            hpDrainRatio: 0,
            primaryTraining: '',
            focusTraining: '',
            staminaExperience: 0,
            intelligenceExperience: 0,
            attackExperience: 0,
            defenseExperience: 0,
            meleeExperience: 0,
            rangedExperience: 0,
            magicExperience: 0,
            retaliation: 0,
        },
    };
    combatBuffs = {};
    permanentBuffs = {};
    zoneBuffs = {};
    extraBuffs = {};
    furyAmount = 0;
    furyExpireTime = 0;

    constructor() {}

    updateCombatDetails() {
        if (this.isPlayer) {
            if (this.combatDetails.combatStats.hpRegenPer10 === 0) {
                this.combatDetails.combatStats.hpRegenPer10 = 0.01;
            } else {
                this.combatDetails.combatStats.hpRegenPer10 = 0.01 + this.combatDetails.combatStats.hpRegenPer10;
            }
            if (this.combatDetails.combatStats.mpRegenPer10 === 0) {
                this.combatDetails.combatStats.mpRegenPer10 = 0.01;
            } else {
                this.combatDetails.combatStats.mpRegenPer10 = 0.01 + this.combatDetails.combatStats.mpRegenPer10;
            }
        }

        ['stamina', 'intelligence', 'attack', 'melee', 'defense', 'ranged', 'magic'].forEach((stat) => {
            this.combatDetails[stat + 'Level'] = this[stat + 'Level'];
            const boosts = this.getBuffBoosts('/buff_types/' + stat + '_level');
            boosts.forEach((buff) => {
                this.combatDetails[stat + 'Level'] += this[stat + 'Level'] * buff.ratioBoost;
                this.combatDetails[stat + 'Level'] += buff.flatBoost;
            });
        });

        this.combatDetails.maxHitpoints = Math.floor(
            (10 * (10 + this.combatDetails.staminaLevel) + this.combatDetails.combatStats.maxHitpoints) *
                (1 + this.combatDetails.combatStats.maxHitpointsRatio)
        );
        this.combatDetails.maxManapoints = Math.floor(
            (10 * (10 + this.combatDetails.intelligenceLevel) + this.combatDetails.combatStats.maxManapoints) *
                (1 + this.combatDetails.combatStats.maxManapointsRatio)
        );

        const accuracyRatioBoostFromFury = this.getBuffBoost('/buff_types/fury_accuracy').ratioBoost;
        const damageRatioBoostFromFury = this.getBuffBoost('/buff_types/fury_damage').ratioBoost;

        const accuracyRatioBoost = this.getBuffBoost('/buff_types/accuracy').ratioBoost;
        const damageRatioBoost = this.getBuffBoost('/buff_types/damage').ratioBoost;

        ['stab', 'slash', 'smash'].forEach((style) => {
            this.combatDetails[style + 'AccuracyRating'] =
                (10 + this.combatDetails.attackLevel) *
                (1 + this.combatDetails.combatStats[style + 'Accuracy']) *
                (1 + accuracyRatioBoost) *
                (1 + accuracyRatioBoostFromFury);
            this.combatDetails[style + 'MaxDamage'] =
                (10 + this.combatDetails.meleeLevel) *
                (1 + this.combatDetails.combatStats[style + 'Damage']) *
                (1 + damageRatioBoost) *
                (1 + damageRatioBoostFromFury);
            const baseEvasion =
                (10 + this.combatDetails.defenseLevel) * (1 + this.combatDetails.combatStats[style + 'Evasion']);
            this.combatDetails[style + 'EvasionRating'] = baseEvasion;
            const evasionBoosts = this.getBuffBoosts('/buff_types/evasion');
            for (const boost of evasionBoosts) {
                this.combatDetails[style + 'EvasionRating'] += boost.flatBoost;
                this.combatDetails[style + 'EvasionRating'] += baseEvasion * boost.ratioBoost;
            }
        });

        this.combatDetails.defensiveMaxDamage =
            (10 + this.combatDetails.defenseLevel) *
            (1 + this.combatDetails.combatStats.defensiveDamage) *
            (1 + damageRatioBoost) *
            (1 + damageRatioBoostFromFury);

        // when equiped bulwark
        if (this.equipment?.['/equipment_types/two_hand']?.hrid.includes('bulwark')) {
            this.combatDetails.smashMaxDamage += this.combatDetails.defensiveMaxDamage;
        }

        this.combatDetails.rangedAccuracyRating =
            (10 + this.combatDetails.attackLevel) *
            (1 + this.combatDetails.combatStats.rangedAccuracy) *
            (1 + accuracyRatioBoost) *
            (1 + accuracyRatioBoostFromFury);
        this.combatDetails.rangedMaxDamage =
            (10 + this.combatDetails.rangedLevel) *
            (1 + this.combatDetails.combatStats.rangedDamage) *
            (1 + damageRatioBoost) *
            (1 + damageRatioBoostFromFury);

        const baseRangedEvasion =
            (10 + this.combatDetails.defenseLevel) * (1 + this.combatDetails.combatStats.rangedEvasion);
        this.combatDetails.rangedEvasionRating = baseRangedEvasion;
        const evasionBoosts = this.getBuffBoosts('/buff_types/evasion');
        for (const boost of evasionBoosts) {
            this.combatDetails.rangedEvasionRating += boost.flatBoost;
            this.combatDetails.rangedEvasionRating += baseRangedEvasion * boost.ratioBoost;
        }

        this.combatDetails.combatStats.damageTaken = this.getBuffBoost('/buff_types/damage_taken').flatBoost;

        this.combatDetails.magicAccuracyRating =
            (10 + this.combatDetails.attackLevel) *
            (1 + this.combatDetails.combatStats.magicAccuracy) *
            (1 + accuracyRatioBoost) *
            (1 + accuracyRatioBoostFromFury);
        this.combatDetails.magicMaxDamage =
            (10 + this.combatDetails.magicLevel) *
            (1 + this.combatDetails.combatStats.magicDamage) *
            (1 + damageRatioBoost) *
            (1 + damageRatioBoostFromFury);

        const baseMagicEvasion =
            (10 + this.combatDetails.defenseLevel) * (1 + this.combatDetails.combatStats.magicEvasion);
        this.combatDetails.magicEvasionRating = baseMagicEvasion;
        for (const boost of evasionBoosts) {
            this.combatDetails.magicEvasionRating += boost.flatBoost;
            this.combatDetails.magicEvasionRating += baseMagicEvasion * boost.ratioBoost;
        }

        this.combatDetails.combatStats.physicalAmplify += this.getBuffBoost('/buff_types/physical_amplify').flatBoost;
        this.combatDetails.combatStats.waterAmplify += this.getBuffBoost('/buff_types/water_amplify').flatBoost;
        this.combatDetails.combatStats.natureAmplify += this.getBuffBoost('/buff_types/nature_amplify').flatBoost;
        this.combatDetails.combatStats.fireAmplify += this.getBuffBoost('/buff_types/fire_amplify').flatBoost;
        this.combatDetails.combatStats.healingAmplify += this.getBuffBoost('/buff_types/healing_amplify').flatBoost;

        this.combatDetails.combatStats.attackInterval /= 1 + this.combatDetails.attackLevel / 2000;

        const baseAttackSpeed = this.combatDetails.combatStats.attackSpeed;
        this.combatDetails.combatStats.attackInterval /= 1 + baseAttackSpeed;
        const attackIntervalBoosts = this.getBuffBoosts('/buff_types/attack_speed');
        const attackIntervalRatioBoost = attackIntervalBoosts
            .map((boost) => boost.ratioBoost)
            .reduce((prev, cur) => prev + cur, 0);
        this.combatDetails.combatStats.attackInterval /= 1 + attackIntervalRatioBoost;

        const baseArmor = 0.2 * this.combatDetails.defenseLevel + this.combatDetails.combatStats.armor;
        this.combatDetails.totalArmor = baseArmor;
        const armorBoosts = this.getBuffBoosts('/buff_types/armor');
        for (const boost of armorBoosts) {
            this.combatDetails.totalArmor += boost.flatBoost;
            this.combatDetails.totalArmor += baseArmor * boost.ratioBoost;
        }

        const baseWaterResistance =
            0.2 * this.combatDetails.defenseLevel + this.combatDetails.combatStats.waterResistance;
        this.combatDetails.totalWaterResistance = baseWaterResistance;
        const waterResistanceBoosts = this.getBuffBoosts('/buff_types/water_resistance');
        for (const boost of waterResistanceBoosts) {
            this.combatDetails.totalWaterResistance += boost.flatBoost;
            this.combatDetails.totalWaterResistance += baseWaterResistance * boost.ratioBoost;
        }

        const baseNatureResistance =
            0.2 * this.combatDetails.defenseLevel + this.combatDetails.combatStats.natureResistance;
        this.combatDetails.totalNatureResistance = baseNatureResistance;
        const natureResistanceBoosts = this.getBuffBoosts('/buff_types/nature_resistance');
        for (const boost of natureResistanceBoosts) {
            this.combatDetails.totalNatureResistance += boost.flatBoost;
            this.combatDetails.totalNatureResistance += baseNatureResistance * boost.ratioBoost;
        }

        const baseFireResistance =
            0.2 * this.combatDetails.defenseLevel + this.combatDetails.combatStats.fireResistance;
        this.combatDetails.totalFireResistance = baseFireResistance;
        const fireResistanceBoosts = this.getBuffBoosts('/buff_types/fire_resistance');
        for (const boost of fireResistanceBoosts) {
            this.combatDetails.totalFireResistance += boost.flatBoost;
            this.combatDetails.totalFireResistance += baseFireResistance * boost.ratioBoost;
        }

        const hpRegenBoosts = this.getBuffBoost('/buff_types/hp_regen');
        this.combatDetails.combatStats.hpRegenPer10 +=
            this.combatDetails.combatStats.hpRegenPer10 * hpRegenBoosts.ratioBoost;
        this.combatDetails.combatStats.hpRegenPer10 += hpRegenBoosts.flatBoost;

        const mpRegenBoosts = this.getBuffBoost('/buff_types/mp_regen');
        this.combatDetails.combatStats.mpRegenPer10 +=
            this.combatDetails.combatStats.mpRegenPer10 * mpRegenBoosts.ratioBoost;
        this.combatDetails.combatStats.mpRegenPer10 += mpRegenBoosts.flatBoost;

        this.combatDetails.combatStats.lifeSteal += this.getBuffBoost('/buff_types/life_steal').flatBoost;
        this.combatDetails.combatStats.physicalThorns += this.getBuffBoost('/buff_types/physical_thorns').flatBoost;
        this.combatDetails.combatStats.elementalThorns += this.getBuffBoost('/buff_types/elemental_thorns').flatBoost;
        this.combatDetails.combatStats.combatExperience += this.getBuffBoost('/buff_types/wisdom').flatBoost;
        this.combatDetails.combatStats.criticalRate += this.getBuffBoost('/buff_types/critical_rate').flatBoost;
        this.combatDetails.combatStats.criticalDamage += this.getBuffBoost('/buff_types/critical_damage').flatBoost;

        this.combatDetails.combatStats.castSpeed += this.getBuffBoost('/buff_types/cast_speed').flatBoost;
        this.combatDetails.combatStats.castSpeed += this.combatDetails['attackLevel'] / 2000;

        const combatDropRateBoosts = this.getBuffBoost('/buff_types/combat_drop_rate');
        this.combatDetails.combatStats.combatDropRate +=
            (1 + this.combatDetails.combatStats.combatDropRate) * combatDropRateBoosts.ratioBoost;
        this.combatDetails.combatStats.combatDropRate += combatDropRateBoosts.flatBoost;
        const combatRareFindBoosts = this.getBuffBoost('/buff_types/rare_find');
        this.combatDetails.combatStats.combatRareFind +=
            (1 + this.combatDetails.combatStats.combatRareFind) * combatRareFindBoosts.ratioBoost;
        this.combatDetails.combatStats.combatRareFind += combatRareFindBoosts.flatBoost;
        const combatDropQuantityBoosts = this.getBuffBoost('/buff_types/combat_drop_quantity');
        this.combatDetails.combatStats.combatDropQuantity +=
            (1 + this.combatDetails.combatStats.combatDropQuantity) * combatDropQuantityBoosts.ratioBoost;
        this.combatDetails.combatStats.combatDropQuantity += combatDropQuantityBoosts.flatBoost;

        const baseThreat = 100 + this.combatDetails.combatStats.threat;
        this.combatDetails.totalThreat = baseThreat;
        const threatBoosts = this.getBuffBoost('/buff_types/threat');
        if (threatBoosts.ratioBoost !== 0) {
            this.combatDetails.combatStats.threat += baseThreat * threatBoosts.ratioBoost;
        } else {
            this.combatDetails.combatStats.threat = baseThreat;
        }
        this.combatDetails.combatStats.threat += threatBoosts.flatBoost;

        this.combatDetails.combatStats.retaliation += this.getBuffBoost('/buff_types/retaliation').flatBoost;
        this.combatDetails.combatStats.tenacity += this.getBuffBoost('/buff_types/tenacity').flatBoost;
    }

    addBuff(buff, currentTime) {
        buff.startTime = currentTime;
        this.combatBuffs[buff.uniqueHrid] = buff;

        this.updateCombatDetails();
    }

    removeBuff(buff) {
        if (!this.combatBuffs[buff.uniqueHrid]) {
            return;
        }
        delete this.combatBuffs[buff.uniqueHrid];

        this.updateCombatDetails();
    }

    /**
     * Update fury accuracy and damage buffs in a single batch, calling updateCombatDetails() once.
     * @param {number} furyAmount - Current fury stack count (0-5)
     * @param {number} furyStat - Fury combat stat value
     * @param {number} currentTime - Simulation time for buff start
     * @param {number} duration - Buff duration (fury expire time)
     */
    updateFuryBuffs(furyAmount, furyStat, currentTime, duration) {
        if (furyAmount > 0) {
            this.combatBuffs['/buff_uniques/fury_accuracy'] = {
                uniqueHrid: '/buff_uniques/fury_accuracy',
                typeHrid: '/buff_types/fury_accuracy',
                ratioBoost: furyAmount * furyStat,
                ratioBoostLevelBonus: 0,
                flatBoost: 0,
                flatBoostLevelBonus: 0,
                startTime: currentTime,
                duration: duration,
            };
            this.combatBuffs['/buff_uniques/fury_damage'] = {
                uniqueHrid: '/buff_uniques/fury_damage',
                typeHrid: '/buff_types/fury_damage',
                ratioBoost: furyAmount * furyStat,
                ratioBoostLevelBonus: 0,
                flatBoost: 0,
                flatBoostLevelBonus: 0,
                startTime: currentTime,
                duration: duration,
            };
        } else {
            delete this.combatBuffs['/buff_uniques/fury_accuracy'];
            delete this.combatBuffs['/buff_uniques/fury_damage'];
        }
        this.updateCombatDetails();
    }

    addPermanentBuff(buff) {
        if (this.permanentBuffs[buff.typeHrid]) {
            this.permanentBuffs[buff.typeHrid].flatBoost += buff.flatBoost;
            this.permanentBuffs[buff.typeHrid].ratioBoost += buff.ratioBoost;
        } else {
            this.permanentBuffs[buff.typeHrid] = buff;
        }
    }

    generatePermanentBuffs() {
        for (let i = 0; i < this.houseRooms.length; i++) {
            const houseRoom = this.houseRooms[i];
            houseRoom.buffs.forEach((buff) => {
                this.addPermanentBuff(buff);
            });
        }
        if (this.zoneBuffs) {
            this.zoneBuffs.forEach((buff) => {
                this.addPermanentBuff(buff);
            });
        }
        if (this.extraBuffs) {
            this.extraBuffs.forEach((buff) => {
                this.addPermanentBuff(buff);
            });
        }
    }

    removeExpiredBuffs(currentTime) {
        const expiredBuffs = Object.values(this.combatBuffs).filter(
            (buff) => buff.startTime + buff.duration <= currentTime
        );
        expiredBuffs.forEach((buff) => {
            delete this.combatBuffs[buff.uniqueHrid];
        });

        this.updateCombatDetails();
    }

    clearBuffs() {
        this.combatBuffs = structuredClone(this.permanentBuffs);
        this.furyAmount = 0;
        this.furyExpireTime = 0;
        this.updateCombatDetails();
    }

    clearCCs() {
        this.isStunned = false;
        this.stunExpireTime = null;
        this.isSilenced = false;
        this.silenceExpireTime = null;
        this.isBlinded = false;
        this.blindExpireTime = null;
        this.combatDetails.combatStats.damageTaken = 0;
    }

    getBuffBoosts(type) {
        const boosts = [];
        Object.values(this.combatBuffs)
            .filter((buff) => buff.typeHrid === type)
            .forEach((buff) => {
                boosts.push({ ratioBoost: buff.ratioBoost, flatBoost: buff.flatBoost });
            });

        return boosts;
    }

    getBuffBoost(type) {
        const boosts = this.getBuffBoosts(type);

        const boost = {
            ratioBoost: 0,
            flatBoost: 0,
        };

        for (let i = 0; i < boosts.length; i++) {
            boost.ratioBoost += boosts[i]?.ratioBoost ?? 0;
            boost.flatBoost += boosts[i]?.flatBoost ?? 0;
        }

        return boost;
    }

    reset(currentTime = 0) {
        this.clearCCs();

        if (currentTime === 0 || !this.isPlayer) {
            // First combat start or enemy reset: full reset
            this.clearBuffs();
            this.resetCooldowns(currentTime);
        } else {
            // Dungeon wipe restart (players only): remove expired buffs, keep cooldowns
            this.removeExpiredBuffs(currentTime);
        }

        this.updateCombatDetails();
        this.combatDetails.currentHitpoints = this.combatDetails.maxHitpoints;
        this.combatDetails.currentManapoints = this.combatDetails.maxManapoints;
    }

    resetCooldowns(currentTime = 0) {
        this.food.filter((food) => food !== null).forEach((food) => (food.lastUsed = Number.MIN_SAFE_INTEGER));
        this.drinks.filter((drink) => drink !== null).forEach((drink) => (drink.lastUsed = Number.MIN_SAFE_INTEGER));

        const haste = this.combatDetails.combatStats.abilityHaste;

        this.abilities
            .filter((ability) => ability !== null)
            .forEach((ability) => {
                if (this.isPlayer) {
                    ability.lastUsed = Number.MIN_SAFE_INTEGER;
                } else {
                    let cooldownDuration = ability.cooldownDuration;
                    if (haste > 0) {
                        cooldownDuration = (cooldownDuration * 100) / (100 + haste);
                    }
                    ability.lastUsed =
                        currentTime -
                        Math.floor(cooldownDuration * 0.5) +
                        Math.floor(Math.random() * cooldownDuration * 0.5);
                }
            });
    }

    addHitpoints(hitpoints) {
        let hitpointsAdded = 0;

        if (this.combatDetails.currentHitpoints >= this.combatDetails.maxHitpoints) {
            return hitpointsAdded;
        }

        const newHitpoints = Math.min(this.combatDetails.currentHitpoints + hitpoints, this.combatDetails.maxHitpoints);
        hitpointsAdded = newHitpoints - this.combatDetails.currentHitpoints;
        this.combatDetails.currentHitpoints = newHitpoints;

        return hitpointsAdded;
    }

    addManapoints(manapoints) {
        let manapointsAdded = 0;

        if (this.combatDetails.currentManapoints >= this.combatDetails.maxManapoints) {
            return manapointsAdded;
        }

        const newManapoints = Math.min(
            this.combatDetails.currentManapoints + manapoints,
            this.combatDetails.maxManapoints
        );
        manapointsAdded = newManapoints - this.combatDetails.currentManapoints;
        this.combatDetails.currentManapoints = newManapoints;

        return manapointsAdded;
    }
}

export default CombatUnit;
