/**
 * Utilities to parse the MWI character share modal into a urpt string
 * for https://tib-san.github.io/mwi-character-sheet/. Food is not present in the modal, so it is
 * emitted as empty entries.
 *
 * Usage:
 *   import { buildCharacterSheetLink } from './character-sheet.js';
 *   const url = buildCharacterSheetLink(); // assumes modal is open in DOM
 */

const CLASS_COLORS_BLOCKLIST = [
  '_name__',
  '_characterName__',
  '_xlarge__',
  '_large__',
  '_medium__',
  '_small__',
];

const SKILL_ORDER = ['combat', 'stamina', 'intelligence', 'attack', 'defense', 'melee', 'ranged', 'magic'];
const EQUIPMENT_ORDER = [
  'back',
  'head',
  'trinket',
  'main_hand',
  'body',
  'off_hand',
  'hands',
  'legs',
  'pouch',
  'shoes',
  'necklace',
  'earrings',
  'ring',
  'charm',
];
const HOUSING_ORDER = ['dining_room', 'library', 'dojo', 'armory', 'gym', 'archery_range', 'mystical_study'];
const ACH_ORDER = ['Beginner', 'Novice', 'Adept', 'Veteran', 'Elite', 'Champion'];

const SLOT_POS_TO_KEY = {
  '1,1': 'back',
  '1,2': 'head',
  '1,3': 'trinket',
  '2,1': 'main_hand',
  '2,2': 'body',
  '2,3': 'off_hand',
  '3,1': 'hands',
  '3,2': 'legs',
  '3,3': 'pouch',
  '4,2': 'shoes',
  '1,5': 'necklace',
  '2,5': 'earrings',
  '3,5': 'ring',
  '4,5': 'charm',
};

const HOUSE_KEY_BY_NAME = {
  'Dining Room': 'dining_room',
  Library: 'library',
  Dojo: 'dojo',
  Armory: 'armory',
  Gym: 'gym',
  'Archery Range': 'archery_range',
  'Mystical Study': 'mystical_study',
};

const getId = (useEl) => {
  const href = useEl?.getAttribute('href') || useEl?.getAttribute('xlink:href') || '';
  return href.split('#')[1] || '';
};

const getColor = (el) => {
  if (!el) return '';
  const classes = Array.from(el.classList || []);
  const match = classes.find(
    (c) =>
      /^CharacterName_[a-z]+__/.test(c) &&
      !CLASS_COLORS_BLOCKLIST.some((block) => c.includes(block))
  );
  if (!match) return '';
  const colorMatch = match.match(/^CharacterName_([a-z]+)__/);
  return colorMatch ? colorMatch[1] : '';
};

const getNum = (txt) => {
  const m = (txt || '').match(/\d+/);
  return m ? m[0] : '';
};

const extractGeneral = (modal) => {
  const name =
    modal.querySelector('.CharacterName_name__1amXp')?.dataset?.name?.trim() ||
    modal.querySelector('.CharacterName_name__1amXp span')?.textContent?.trim() ||
    '';
  const iconUse = modal.querySelector('.CharacterName_chatIcon__22lxV use');
  const nameColor = getColor(modal.querySelector('.CharacterName_name__1amXp'));
  const [avatarUse, outfitUse] = modal.querySelectorAll('.SharableProfile_avatar__1hHtL use');
  return [name, getId(avatarUse), getId(outfitUse), getId(iconUse), nameColor].join(',');
};

const extractSkills = (modal) => {
  const statRows = [...modal.querySelectorAll('.SharableProfile_statRow__2bT8_')];
  const combat = getNum(
    statRows.find((r) => r.textContent?.toLowerCase().includes('combat level'))?.textContent
  );
  const skillMap = {};
  modal.querySelectorAll('.SharableProfile_skillGrid__3vIqO .Skill_skill__3MrMc').forEach((el) => {
    const id = getId(el.querySelector('use'));
    const lvl = getNum(el.querySelector('.Skill_level__39kts')?.textContent);
    if (id) skillMap[id] = lvl;
  });

  return [
    combat,
    skillMap.stamina || '',
    skillMap.intelligence || '',
    skillMap.attack || '',
    skillMap.defense || '',
    skillMap.melee || '',
    skillMap.ranged || '',
    skillMap.magic || '',
  ].join(',');
};

const extractEquipment = (modal) => {
  const equipment = {};
  modal.querySelectorAll('.SharableProfile_playerModel__o34sV .SharableProfile_equipmentSlot__kOrug').forEach((slot) => {
    const style = slot.getAttribute('style') || '';
    const rowMatch = style.match(/grid-row-start:\s*(\d+)/);
    const colMatch = style.match(/grid-column-start:\s*(\d+)/);
    const row = rowMatch ? rowMatch[1] : '';
    const col = colMatch ? colMatch[1] : '';
    const key = row && col ? SLOT_POS_TO_KEY[`${row},${col}`] : null;
    if (!key) return;
    const itemId = getId(slot.querySelector('use'));
    const enh = getNum(slot.querySelector('.Item_enhancementLevel__19g-e')?.textContent);
    equipment[key] = itemId ? `${itemId}.${enh || ''}` : '';
  });
  return EQUIPMENT_ORDER.map((k) => equipment[k] || '').join(',');
};

const extractAbilities = (modal) => {
  const abilitiesRaw = [];
  modal.querySelectorAll('.SharableProfile_equippedAbilities__1NNpC > div').forEach((wrap) => {
    const id = getId(wrap.querySelector('use'));
    const lvl = getNum(wrap.querySelector('.Ability_level__1L-do')?.textContent);
    abilitiesRaw.push(id ? `${id}.${lvl || ''}` : '');
  });
  // Profiles only carry 5 abilities; move the first to the end so order is 2-3-4-5-1.
  const abilities = (() => {
    if (!abilitiesRaw.length) return abilitiesRaw;
    const [first, ...rest] = abilitiesRaw;
    return [...rest, first];
  })().slice(0, 5);
  while (abilities.length < 8) abilities.push('');
  return abilities.slice(0, 8).join(',');
};

const extractHousing = (modal) => {
  const housing = {};
  modal.querySelectorAll('.SharableProfile_houseRooms__3QGPc .SharableProfile_houseRoom__2FW_d').forEach((room) => {
    const nameText = room.querySelector('.SharableProfile_name__1RDS1')?.textContent?.trim();
    const key = HOUSE_KEY_BY_NAME[nameText];
    if (!key) return;
    housing[key] = getNum(room.querySelector('.SharableProfile_level__1vQoc')?.textContent);
  });
  return HOUSING_ORDER.map((k) => housing[k] || '').join(',');
};

const extractAchievements = (modal) => {
  const achievements = {};
  modal.querySelectorAll('.SharableProfile_achievementTier__2izCL').forEach((tier) => {
    const header = tier.querySelector('.SharableProfile_tierHeader__1iNyx');
    if (!header) return;
    const name = header.querySelector('.SharableProfile_tierName__3pBrY')?.textContent?.trim();
    const counts = header.querySelector('.SharableProfile_tierCount__3mJd2')?.textContent || '';
    const match = counts.match(/(\d+)\s*\/\s*(\d+)/);
    const have = match ? parseInt(match[1], 10) : 0;
    const total = match ? parseInt(match[2], 10) : 0;
    achievements[name] = have && total && have === total ? '1' : '0';
  });
  return ACH_ORDER.map((n) => achievements[n] || '0').join('');
};

/**
 * Build character sheet segments from cached character data
 * @param {Object} characterData - Character data from dataManager or profile cache
 * @param {Object} clientData - Init client data for lookups
 * @param {Object} consumablesData - Optional character data containing consumables (for profile_shared data)
 * @returns {Object} Character sheet segments
 */
export function buildSegmentsFromCharacterData(characterData, clientData, consumablesData = null) {
  if (!characterData) {
    throw new Error('Character data is required');
  }

  // Use consumablesData if provided, otherwise try characterData
  const dataForConsumables = consumablesData || characterData;

  // Extract general info
  const character = characterData.sharableCharacter || characterData;
  const name = character.name || 'Player';

  // Avatar/outfit/icon - extract from sharableCharacter first, then fall back to items
  let avatar = 'person_default';
  let outfit = 'tshirt_default';
  let nameIcon = '';
  let nameColor = '';

  // Extract from sharableCharacter object (profile_shared data)
  if (character.avatarHrid) {
    avatar = character.avatarHrid.replace('/avatars/', '');
  }
  if (character.avatarOutfitHrid) {
    outfit = character.avatarOutfitHrid.replace('/avatar_outfits/', '');
  }
  if (character.chatIconHrid) {
    nameIcon = character.chatIconHrid.replace('/chat_icons/', '');
  }

  // Try to get avatar/outfit from character items
  if (characterData.characterItems) {
    for (const item of characterData.characterItems) {
      if (item.itemLocationHrid === '/item_locations/avatar') {
        avatar = item.itemHrid.replace('/items/', '');
      } else if (item.itemLocationHrid === '/item_locations/outfit') {
        outfit = item.itemHrid.replace('/items/', '');
      } else if (item.itemLocationHrid === '/item_locations/chat_icon') {
        nameIcon = item.itemHrid.replace('/items/', '');
      }
    }
  }
  // Check wearableItemMap (for profile_shared data)
  else if (characterData.wearableItemMap) {
    if (characterData.wearableItemMap['/item_locations/avatar']) {
      avatar = characterData.wearableItemMap['/item_locations/avatar'].itemHrid.replace('/items/', '');
    }
    if (characterData.wearableItemMap['/item_locations/outfit']) {
      outfit = characterData.wearableItemMap['/item_locations/outfit'].itemHrid.replace('/items/', '');
    }
    if (characterData.wearableItemMap['/item_locations/chat_icon']) {
      nameIcon = characterData.wearableItemMap['/item_locations/chat_icon'].itemHrid.replace('/items/', '');
    }
  }

  // Name color - try to extract from character data
  if (character.chatBorderColorHrid) {
    nameColor = character.chatBorderColorHrid.replace('/chat_border_colors/', '');
  }

  const general = [name, avatar, outfit, nameIcon, nameColor].join(',');

  // Extract skills
  const skillMap = {};
  if (characterData.characterSkills) {
    for (const skill of characterData.characterSkills) {
      const skillName = skill.skillHrid.replace('/skills/', '');
      skillMap[skillName] = skill.level || 0;
    }
  }

  const skills = [
    skillMap.combat || '',
    skillMap.stamina || '',
    skillMap.intelligence || '',
    skillMap.attack || '',
    skillMap.defense || '',
    skillMap.melee || '',
    skillMap.ranged || '',
    skillMap.magic || ''
  ].join(',');

  // Extract equipment
  const equipmentSlots = {
    back: '', head: '', trinket: '', main_hand: '', body: '', off_hand: '',
    hands: '', legs: '', pouch: '', shoes: '', necklace: '', earrings: '', ring: '', charm: ''
  };

  const slotMapping = {
    // For characterItems (own character data)
    '/equipment_types/back': 'back',
    '/equipment_types/head': 'head',
    '/equipment_types/trinket': 'trinket',
    '/equipment_types/main_hand': 'main_hand',
    '/equipment_types/two_hand': 'main_hand',
    '/equipment_types/body': 'body',
    '/equipment_types/off_hand': 'off_hand',
    '/equipment_types/hands': 'hands',
    '/equipment_types/legs': 'legs',
    '/equipment_types/pouch': 'pouch',
    '/equipment_types/feet': 'shoes',
    '/equipment_types/neck': 'necklace',
    '/equipment_types/earrings': 'earrings',
    '/equipment_types/ring': 'ring',
    '/equipment_types/charm': 'charm',
    // For wearableItemMap (profile_shared data)
    '/item_locations/back': 'back',
    '/item_locations/head': 'head',
    '/item_locations/trinket': 'trinket',
    '/item_locations/main_hand': 'main_hand',
    '/item_locations/two_hand': 'main_hand',
    '/item_locations/body': 'body',
    '/item_locations/off_hand': 'off_hand',
    '/item_locations/hands': 'hands',
    '/item_locations/legs': 'legs',
    '/item_locations/pouch': 'pouch',
    '/item_locations/feet': 'shoes',
    '/item_locations/neck': 'necklace',
    '/item_locations/earrings': 'earrings',
    '/item_locations/ring': 'ring',
    '/item_locations/charm': 'charm'
  };

  if (characterData.characterItems) {
    for (const item of characterData.characterItems) {
      if (item.itemLocationHrid && item.itemLocationHrid.startsWith('/equipment_types/')) {
        const slot = slotMapping[item.itemLocationHrid];
        if (slot) {
          const itemId = item.itemHrid.replace('/items/', '');
          const enhancement = item.enhancementLevel || 0;
          equipmentSlots[slot] = enhancement > 0 ? `${itemId}.${enhancement}` : `${itemId}.`;
        }
      }
    }
  }
  // Check for wearableItemMap (profile data from other players)
  else if (characterData.wearableItemMap) {
    for (const key in characterData.wearableItemMap) {
      const item = characterData.wearableItemMap[key];
      const slot = slotMapping[item.itemLocationHrid];
      if (slot) {
        const itemId = item.itemHrid.replace('/items/', '');
        const enhancement = item.enhancementLevel || 0;
        equipmentSlots[slot] = enhancement > 0 ? `${itemId}.${enhancement}` : `${itemId}.`;
      }
    }
  }

  const equipment = [
    equipmentSlots.back, equipmentSlots.head, equipmentSlots.trinket,
    equipmentSlots.main_hand, equipmentSlots.body, equipmentSlots.off_hand,
    equipmentSlots.hands, equipmentSlots.legs, equipmentSlots.pouch,
    equipmentSlots.shoes, equipmentSlots.necklace, equipmentSlots.earrings,
    equipmentSlots.ring, equipmentSlots.charm
  ].join(',');

  // Extract abilities
  const abilitySlots = new Array(8).fill('');

  if (characterData.combatUnit?.combatAbilities || characterData.equippedAbilities) {
    // equippedAbilities (profile data) or combatUnit.combatAbilities (own character)
    const abilities = characterData.equippedAbilities || characterData.combatUnit?.combatAbilities || [];

    // Separate special and normal abilities
    let specialAbility = null;
    const normalAbilities = [];

    for (const ability of abilities) {
      if (!ability || !ability.abilityHrid) continue;

      const isSpecial = clientData?.abilityDetailMap?.[ability.abilityHrid]?.isSpecialAbility || false;

      if (isSpecial) {
        specialAbility = ability;
      } else {
        normalAbilities.push(ability);
      }
    }

    // Format abilities: slots 2-5 are normal abilities, slot 1 is special
    // But render-map expects them in order 1-8, so we need to rotate
    const orderedAbilities = [...normalAbilities.slice(0, 4)];
    if (specialAbility) {
      orderedAbilities.push(specialAbility);
    }

    orderedAbilities.forEach((ability, i) => {
      const abilityId = ability.abilityHrid.replace('/abilities/', '');
      const level = ability.level || 1;
      abilitySlots[i] = `${abilityId}.${level}`;
    });
  }

  const abilitiesStr = abilitySlots.join(',');

  // Extract food and drinks (consumables)
  // Use dataForConsumables (from parameter) instead of characterData
  const foodSlots = dataForConsumables.actionTypeFoodSlotsMap?.['/action_types/combat'];
  const drinkSlots = dataForConsumables.actionTypeDrinkSlotsMap?.['/action_types/combat'];
  const food = formatFoodData(foodSlots, drinkSlots);

  // Extract housing
  const housingLevels = {
    dining_room: '', library: '', dojo: '', armory: '',
    gym: '', archery_range: '', mystical_study: ''
  };

  const houseMapping = {
    '/house_rooms/dining_room': 'dining_room',
    '/house_rooms/library': 'library',
    '/house_rooms/dojo': 'dojo',
    '/house_rooms/armory': 'armory',
    '/house_rooms/gym': 'gym',
    '/house_rooms/archery_range': 'archery_range',
    '/house_rooms/mystical_study': 'mystical_study'
  };

  if (characterData.characterHouseRoomMap) {
    for (const [hrid, room] of Object.entries(characterData.characterHouseRoomMap)) {
      const key = houseMapping[hrid];
      if (key) {
        housingLevels[key] = room.level || '';
      }
    }
  }

  const housing = [
    housingLevels.dining_room, housingLevels.library, housingLevels.dojo,
    housingLevels.armory, housingLevels.gym, housingLevels.archery_range,
    housingLevels.mystical_study
  ].join(',');

  // Extract achievements (6 tiers: Beginner, Novice, Adept, Veteran, Elite, Champion)
  const achievementTiers = ['Beginner', 'Novice', 'Adept', 'Veteran', 'Elite', 'Champion'];
  const achievementFlags = new Array(6).fill('0');

  if (characterData.characterAchievements) {
    const tierCounts = {};

    // Count achievements by tier
    for (const achievement of characterData.characterAchievements) {
      if (achievement.achievementTier) {
        tierCounts[achievement.achievementTier] = (tierCounts[achievement.achievementTier] || 0) + 1;
      }
    }

    // Check if each tier is complete (need to get total count from clientData)
    if (clientData?.achievementDetailMap) {
      const tierTotals = {};

      for (const achData of Object.values(clientData.achievementDetailMap)) {
        if (achData.achievementTier) {
          tierTotals[achData.achievementTier] = (tierTotals[achData.achievementTier] || 0) + 1;
        }
      }

      achievementTiers.forEach((tier, i) => {
        const have = tierCounts[tier] || 0;
        const total = tierTotals[tier] || 0;
        achievementFlags[i] = (have > 0 && have === total) ? '1' : '0';
      });
    }
  }

  const achievements = achievementFlags.join('');

  return {
    general,
    skills,
    equipment,
    abilities: abilitiesStr,
    food,
    housing,
    achievements
  };
}

export function buildUrptString(segments) {
  if (!segments) throw new Error('Segments are required to build urpt');
  const { general, skills, equipment, abilities, food, housing, achievements } = segments;
  return [general, skills, equipment, abilities, food, housing, achievements].join(';');
}

/**
 * Format food and drink data for character sheet
 * @param {Array} foodSlots - Array of food items from actionTypeFoodSlotsMap
 * @param {Array} drinkSlots - Array of drink items from actionTypeDrinkSlotsMap
 * @returns {string} Comma-separated list of 6 item IDs (food 1-3, drink 1-3)
 */
export function formatFoodData(foodSlots, drinkSlots) {
  const slots = new Array(6).fill('');

  // Fill food slots (1-3)
  if (Array.isArray(foodSlots)) {
    foodSlots.slice(0, 3).forEach((item, i) => {
      if (item && item.itemHrid) {
        // Strip '/items/' prefix
        slots[i] = item.itemHrid.replace('/items/', '');
      }
    });
  }

  // Fill drink slots (4-6)
  if (Array.isArray(drinkSlots)) {
    drinkSlots.slice(0, 3).forEach((item, i) => {
      if (item && item.itemHrid) {
        // Strip '/items/' prefix
        slots[i + 3] = item.itemHrid.replace('/items/', '');
      }
    });
  }

  return slots.join(',');
}

/**
 * Extracts character data from the share modal and builds a render URL.
 * @param {Element} modal - Profile modal element (optional, for DOM fallback)
 * @param {string} baseUrl - Base URL for character sheet
 * @param {Object} characterData - Character data from cache (preferred)
 * @param {Object} clientData - Init client data for lookups
 * @param {Object} consumablesData - Optional character data containing consumables (for profile_shared data)
 * @returns {string} Character sheet URL
 */
export function buildCharacterSheetLink(
  modal = document.querySelector('.SharableProfile_modal__2OmCQ'),
  baseUrl = 'https://tib-san.github.io/mwi-character-sheet/',
  characterData = null,
  clientData = null,
  consumablesData = null
) {
  let segments;

  // Prefer cached character data over DOM parsing
  if (characterData && clientData) {
    segments = buildSegmentsFromCharacterData(characterData, clientData, consumablesData);
  } else if (modal) {
    // Fallback to DOM parsing (for viewing other players without full cache)
    segments = parseModalToSegments(modal);
  } else {
    throw new Error('Either character data or modal is required');
  }

  const urpt = buildUrptString(segments);
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}?urpt=${urpt}`;
}
