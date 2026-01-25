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

export function parseModalToSegments(modal = document.querySelector('.SharableProfile_modal__2OmCQ')) {
  if (!modal) throw new Error('Profile modal not found');

  return {
    general: extractGeneral(modal),
    skills: extractSkills(modal),
    equipment: extractEquipment(modal),
    abilities: extractAbilities(modal),
    food: new Array(6).fill('').join(','),
    housing: extractHousing(modal),
    achievements: extractAchievements(modal),
  };
}

export function buildUrptString(segments) {
  if (!segments) throw new Error('Segments are required to build urpt');
  const { general, skills, equipment, abilities, food, housing, achievements } = segments;
  return [general, skills, equipment, abilities, food, housing, achievements].join(';');
}

/**
 * Extracts character data from the share modal and builds a render URL.
 */
export function buildCharacterSheetLink(
  modal = document.querySelector('.SharableProfile_modal__2OmCQ'),
  baseUrl = 'https://tib-san.github.io/mwi-character-sheet/'
) {
  const segments = parseModalToSegments(modal);
  const urpt = buildUrptString(segments);
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${base}?urpt=${urpt}`;
}
