class CombatUtilities {
    /**
     * Task Damage is only earned while undertaking the relevant task (CSIM-AUD-023): a player's
     * taskDamage bonus applies against `opponent` only when `opponent` is that player's active
     * Monster-task target. Non-player units (monsters) have no task concept, so their own
     * (effectively always-zero) taskDamage stat is returned unconditionally rather than gated.
     * @param {CombatUnit} unit - The unit whose taskDamage stat is being considered
     * @param {CombatUnit} opponent - The unit on the other side of this damage exchange
     * @returns {number}
     */
    static getEffectiveTaskDamage(unit, opponent) {
        if (!unit.isPlayer) return unit.combatDetails.combatStats.taskDamage;
        const isEligible = unit.taskEligibleMonsterHrids?.includes(opponent.hrid);
        return isEligible ? unit.combatDetails.combatStats.taskDamage : 0;
    }

    static getTarget(enemies) {
        if (!enemies) {
            return null;
        }
        const target = enemies.find((enemy) => enemy.combatDetails.currentHitpoints > 0);

        return target ?? null;
    }

    static randomInt(min, max) {
        if (max < min) {
            const temp = min;
            min = max;
            max = temp;
        }

        const minCeil = Math.ceil(min);
        const maxFloor = Math.floor(max);

        if (Math.floor(min) === maxFloor) {
            return Math.floor((min + max) / 2 + Math.random());
        }

        const minTail = -1 * (min - minCeil);
        const maxTail = max - maxFloor;

        const balancedWeight = 2 * minTail + (maxFloor - minCeil);
        const balancedAverage = (maxFloor + minCeil) / 2;
        const average = (max + min) / 2;
        const extraTailWeight = (balancedWeight * (average - balancedAverage)) / (maxFloor + 1 - average);
        const extraTailChance = Math.abs(extraTailWeight / (extraTailWeight + balancedWeight));

        if (Math.random() < extraTailChance) {
            if (maxTail > minTail) {
                return Math.floor(maxFloor + 1);
            } else {
                return Math.floor(minCeil - 1);
            }
        }

        if (maxTail > minTail) {
            return Math.floor(min + Math.random() * (maxFloor + minTail - min + 1));
        } else {
            return Math.floor(minCeil - maxTail + Math.random() * (max - (minCeil - maxTail) + 1));
        }
    }

    static processAttack(source, target, abilityEffect = null) {
        const combatStyle = abilityEffect
            ? abilityEffect.combatStyleHrid
            : source.combatDetails.combatStats.combatStyleHrid;
        const damageType = abilityEffect ? abilityEffect.damageType : source.combatDetails.combatStats.damageType;

        let sourceAccuracyRating = 1;
        let sourceAutoAttackMaxDamage = 1;
        let targetEvasionRating = 1;

        switch (combatStyle) {
            case '/combat_styles/stab':
                sourceAccuracyRating = source.combatDetails.stabAccuracyRating;
                sourceAutoAttackMaxDamage = source.combatDetails.stabMaxDamage;
                targetEvasionRating = target.combatDetails.stabEvasionRating;
                break;
            case '/combat_styles/slash':
                sourceAccuracyRating = source.combatDetails.slashAccuracyRating;
                sourceAutoAttackMaxDamage = source.combatDetails.slashMaxDamage;
                targetEvasionRating = target.combatDetails.slashEvasionRating;
                break;
            case '/combat_styles/smash':
                sourceAccuracyRating = source.combatDetails.smashAccuracyRating;
                sourceAutoAttackMaxDamage = source.combatDetails.smashMaxDamage;
                targetEvasionRating = target.combatDetails.smashEvasionRating;
                break;
            case '/combat_styles/ranged':
                sourceAccuracyRating = source.combatDetails.rangedAccuracyRating;
                sourceAutoAttackMaxDamage = source.combatDetails.rangedMaxDamage;
                targetEvasionRating = target.combatDetails.rangedEvasionRating;
                break;
            case '/combat_styles/magic':
                sourceAccuracyRating = source.combatDetails.magicAccuracyRating;
                sourceAutoAttackMaxDamage = source.combatDetails.magicMaxDamage;
                targetEvasionRating = target.combatDetails.magicEvasionRating;
                break;
            default:
                throw new Error('Unknown combat style: ' + combatStyle);
        }

        let sourceDamageMultiplier = 1;
        let sourceResistance = 0;
        let sourcePenetration = 0;
        let targetResistance = 0;
        let targetThornPower = 0;
        let targetPenetration = 0;
        let thornType;

        switch (damageType) {
            case '/damage_types/physical':
                sourceDamageMultiplier = 1 + source.combatDetails.combatStats.physicalAmplify;
                sourceResistance = source.combatDetails.totalArmor;
                sourcePenetration = source.combatDetails.combatStats.armorPenetration;
                targetResistance = target.combatDetails.totalArmor;
                targetThornPower = target.combatDetails.combatStats.physicalThorns;
                targetPenetration = target.combatDetails.combatStats.armorPenetration;
                thornType = 'physicalThorns';
                break;
            case '/damage_types/water':
                sourceDamageMultiplier = 1 + source.combatDetails.combatStats.waterAmplify;
                sourceResistance = source.combatDetails.totalWaterResistance;
                sourcePenetration = source.combatDetails.combatStats.waterPenetration;
                targetResistance = target.combatDetails.totalWaterResistance;
                targetThornPower = target.combatDetails.combatStats.elementalThorns;
                targetPenetration = target.combatDetails.combatStats.waterPenetration;
                thornType = 'elementalThorns';
                break;
            case '/damage_types/nature':
                sourceDamageMultiplier = 1 + source.combatDetails.combatStats.natureAmplify;
                sourceResistance = source.combatDetails.totalNatureResistance;
                sourcePenetration = source.combatDetails.combatStats.naturePenetration;
                targetResistance = target.combatDetails.totalNatureResistance;
                targetThornPower = target.combatDetails.combatStats.elementalThorns;
                targetPenetration = target.combatDetails.combatStats.naturePenetration;
                thornType = 'elementalThorns';
                break;
            case '/damage_types/fire':
                sourceDamageMultiplier = 1 + source.combatDetails.combatStats.fireAmplify;
                sourceResistance = source.combatDetails.totalFireResistance;
                sourcePenetration = source.combatDetails.combatStats.firePenetration;
                targetResistance = target.combatDetails.totalFireResistance;
                targetThornPower = target.combatDetails.combatStats.elementalThorns;
                targetPenetration = target.combatDetails.combatStats.firePenetration;
                thornType = 'elementalThorns';
                break;
            default:
                throw new Error('Unknown damage type: ' + damageType);
        }

        let hitChance = 1;
        let critChance = 0;
        let isCrit = false;
        const bonusCritChance = source.combatDetails.combatStats.criticalRate;
        const bonusCritDamage = source.combatDetails.combatStats.criticalDamage;

        if (abilityEffect) {
            sourceAccuracyRating *= 1 + abilityEffect.bonusAccuracyRatio;
        }

        if (source.isWeakened) {
            sourceAccuracyRating = sourceAccuracyRating - source.weakenPercentage * sourceAccuracyRating;
        }

        hitChance =
            Math.pow(sourceAccuracyRating, 1.4) /
            (Math.pow(sourceAccuracyRating, 1.4) + Math.pow(targetEvasionRating, 1.4));

        if (combatStyle === '/combat_styles/ranged') {
            critChance = 0.3 * hitChance;
        }

        critChance = critChance + bonusCritChance;

        const baseDamageFlat = abilityEffect ? abilityEffect.damageFlat : 0;
        const baseDamageRatio = abilityEffect ? abilityEffect.damageRatio : 1;

        const armorDamageRatioFlat = abilityEffect
            ? abilityEffect.armorDamageRatio * source.combatDetails.totalArmor
            : 0;

        let sourceMinDamage = sourceDamageMultiplier * (1 + baseDamageFlat + armorDamageRatioFlat);
        let sourceMaxDamage =
            sourceDamageMultiplier *
            (baseDamageRatio * sourceAutoAttackMaxDamage + baseDamageFlat + armorDamageRatioFlat);

        if (Math.random() < critChance) {
            sourceMaxDamage = sourceMaxDamage * (1 + bonusCritDamage);
            sourceMinDamage = sourceMaxDamage;
            isCrit = true;
        }

        let damageRoll = CombatUtilities.randomInt(sourceMinDamage, sourceMaxDamage);
        // taskDamage intentionally excluded — trinket slot not exported by reference sims
        // damageRoll *= 1 + source.combatDetails.combatStats.taskDamage;
        damageRoll *= 1 + target.combatDetails.combatStats.damageTaken;
        if (!abilityEffect) {
            damageRoll += damageRoll * source.combatDetails.combatStats.autoAttackDamage;
        } else {
            damageRoll *= 1 + source.combatDetails.combatStats.abilityDamage;
        }

        let damageDone = 0;
        let thornDamageDone = 0;

        let didHit = false;
        if (Math.random() < hitChance) {
            didHit = true;
            let penetratedTargetResistance = targetResistance;

            if (sourcePenetration > 0 && targetResistance > 0) {
                penetratedTargetResistance = targetResistance / (1 + sourcePenetration);
            }

            let targetDamageTakenRatio = 100 / (100 + penetratedTargetResistance);
            if (penetratedTargetResistance < 0) {
                targetDamageTakenRatio = (100 - penetratedTargetResistance) / 100;
            }

            const mitigatedDamage = Math.ceil(targetDamageTakenRatio * damageRoll);
            damageDone = Math.min(mitigatedDamage, target.combatDetails.currentHitpoints);
            target.combatDetails.currentHitpoints -= damageDone;
        }

        if (targetThornPower > 0.0 && targetResistance > -99.0) {
            let penetratedSourceResistance = sourceResistance;

            if (sourceResistance > 0) {
                penetratedSourceResistance = sourceResistance / (1 + targetPenetration);
            }

            let sourceDamageTakenRatio = 100.0 / (100 + penetratedSourceResistance);
            if (penetratedSourceResistance < 0) {
                sourceDamageTakenRatio = (100 - penetratedSourceResistance) / 100;
            }

            const targetTaskDamageMultiplier = 1.0 + CombatUtilities.getEffectiveTaskDamage(target, source);
            const sourceDamageTakenMultiplier = 1.0 + source.combatDetails.combatStats.damageTaken;
            const targetDamageMultiplier = targetTaskDamageMultiplier * sourceDamageTakenMultiplier;

            const thornsDamageRoll = CombatUtilities.randomInt(
                1,
                targetDamageMultiplier *
                    target.combatDetails.defensiveMaxDamage *
                    (1.0 + targetResistance / 100.0) *
                    targetThornPower
            );

            const mitigatedThornsDamage = Math.ceil(sourceDamageTakenRatio * thornsDamageRoll);

            thornDamageDone = Math.min(mitigatedThornsDamage, source.combatDetails.currentHitpoints);
            source.combatDetails.currentHitpoints -= thornDamageDone;
        }

        let retaliationDamageDone = 0;
        if (target.combatDetails.combatStats.retaliation > 0) {
            const retaliationHitChance =
                Math.pow(target.combatDetails.smashAccuracyRating, 1.4) /
                (Math.pow(target.combatDetails.smashAccuracyRating, 1.4) +
                    Math.pow(source.combatDetails.smashEvasionRating, 1.4));

            if (retaliationHitChance > Math.random()) {
                let sourceEffectiveArmor = source.combatDetails.totalArmor;
                if (sourceEffectiveArmor > 0) {
                    sourceEffectiveArmor =
                        sourceEffectiveArmor / (1.0 + target.combatDetails.combatStats.armorPenetration);
                }

                let sourceDamageTakenRatio = 100.0 / (100.0 + sourceEffectiveArmor);
                if (sourceEffectiveArmor < 0) {
                    sourceDamageTakenRatio = (100.0 - sourceEffectiveArmor) / 100.0;
                }

                const targetTaskDamageMultiplier = 1.0 + CombatUtilities.getEffectiveTaskDamage(target, source);
                const sourceDamageTakenMultiplier = 1.0 + source.combatDetails.combatStats.damageTaken;
                const retaliationDamageMultiplier = targetTaskDamageMultiplier * sourceDamageTakenMultiplier;

                let premitigatedDamage = damageRoll;
                premitigatedDamage = Math.min(premitigatedDamage, target.combatDetails.defensiveMaxDamage * 5);

                const retaliationMinDamage =
                    retaliationDamageMultiplier * target.combatDetails.combatStats.retaliation * premitigatedDamage;
                const retaliationMaxDamage =
                    retaliationDamageMultiplier *
                    target.combatDetails.combatStats.retaliation *
                    (target.combatDetails.defensiveMaxDamage + premitigatedDamage);

                const retaliationDamageRoll = CombatUtilities.randomInt(retaliationMinDamage, retaliationMaxDamage);
                const mitigatedRetaliationDamage = Math.ceil(sourceDamageTakenRatio * retaliationDamageRoll);
                retaliationDamageDone = Math.min(mitigatedRetaliationDamage, source.combatDetails.currentHitpoints);
                source.combatDetails.currentHitpoints -= retaliationDamageDone;
            }
        }

        let lifeStealHeal = 0;
        if (!abilityEffect && didHit && source.combatDetails.combatStats.lifeSteal > 0) {
            lifeStealHeal = source.addHitpoints(Math.floor(source.combatDetails.combatStats.lifeSteal * damageDone));
        }

        let hpDrain = 0;
        if (abilityEffect && didHit && abilityEffect.hpDrainRatio > 0) {
            const healingAmplify = 1 + source.combatDetails.combatStats.healingAmplify;
            hpDrain = source.addHitpoints(Math.floor(abilityEffect.hpDrainRatio * damageDone * healingAmplify));
        }

        let manaLeechMana = 0;
        if (!abilityEffect && didHit && source.combatDetails.combatStats.manaLeech > 0) {
            manaLeechMana = source.addManapoints(Math.floor(source.combatDetails.combatStats.manaLeech * damageDone));
        }

        return {
            damageDone,
            didHit,
            thornDamageDone,
            thornType,
            retaliationDamageDone,
            lifeStealHeal,
            hpDrain,
            manaLeechMana,
            isCrit,
        };
    }

    static processHeal(source, abilityEffect, target) {
        if (abilityEffect.combatStyleHrid !== '/combat_styles/magic') {
            throw new Error('Heal ability effect not supported for combat style: ' + abilityEffect.combatStyleHrid);
        }

        const healingAmplify = 1 + source.combatDetails.combatStats.healingAmplify;
        const magicMaxDamage = source.combatDetails.magicMaxDamage;

        const baseHealFlat = abilityEffect.damageFlat;
        const baseHealRatio = abilityEffect.damageRatio;

        const minHeal = healingAmplify * (1 + baseHealFlat);
        const maxHeal = healingAmplify * (baseHealRatio * magicMaxDamage + baseHealFlat);

        const heal = this.randomInt(minHeal, maxHeal);
        const amountHealed = target.addHitpoints(heal);

        return amountHealed;
    }

    static processRevive(source, abilityEffect, target) {
        if (abilityEffect.combatStyleHrid !== '/combat_styles/magic') {
            throw new Error('Heal ability effect not supported for combat style: ' + abilityEffect.combatStyleHrid);
        }

        const healingAmplify = 1 + source.combatDetails.combatStats.healingAmplify;
        const magicMaxDamage = source.combatDetails.magicMaxDamage;

        const baseHealFlat = abilityEffect.damageFlat;
        const baseHealRatio = abilityEffect.damageRatio;

        const minHeal = healingAmplify * (1 + baseHealFlat);
        const maxHeal = healingAmplify * (baseHealRatio * magicMaxDamage + baseHealFlat);

        const heal = this.randomInt(minHeal, maxHeal);
        const amountHealed = target.addHitpoints(heal);
        target.combatDetails.currentManapoints = target.combatDetails.maxManapoints;
        target.clearCCs();

        // target.clearBuffs();

        return amountHealed;
    }

    static processSpendHp(source, abilityEffect) {
        const currentHp = source.combatDetails.currentHitpoints;
        const spendHpRatio = abilityEffect.spendHpRatio;

        const spentHp = Math.floor(currentHp * spendHpRatio);

        source.combatDetails.currentHitpoints -= spentHp;

        return spentHp;
    }

    static calculateTickValue(totalValue, totalTicks, currentTick) {
        const currentSum = Math.floor((currentTick * totalValue) / totalTicks);
        const previousSum = Math.floor(((currentTick - 1) * totalValue) / totalTicks);

        return currentSum - previousSum;
    }
}

export default CombatUtilities;
