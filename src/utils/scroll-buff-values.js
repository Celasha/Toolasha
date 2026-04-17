/**
 * Scroll Buff Values
 * Hardcoded buff definitions for Labyrinth scrolls (formerly "Seals").
 * The game JSON has no consumableDetail for scroll items — values sourced from item descriptions.
 */

export const SCROLL_BUFF_VALUES = {
    '/buff_types/efficiency': 0.14,
    '/buff_types/gathering': 0.18,
    '/buff_types/wisdom': 0.2,
    '/buff_types/action_speed': 0.15,
    '/buff_types/rare_find': 0.6,
    '/buff_types/processing': 0.2,
    '/buff_types/gourmet': 0.16,
};

export const SCROLL_BUFF_ITEMS = {
    '/buff_types/efficiency': 'seal_of_efficiency',
    '/buff_types/gathering': 'seal_of_gathering',
    '/buff_types/wisdom': 'seal_of_wisdom',
    '/buff_types/action_speed': 'seal_of_action_speed',
    '/buff_types/rare_find': 'seal_of_rare_find',
    '/buff_types/processing': 'seal_of_processing',
    '/buff_types/gourmet': 'seal_of_gourmet',
};

export const SCROLL_BUFF_LABELS = {
    '/buff_types/efficiency': 'Scroll of Efficiency (+14%)',
    '/buff_types/gathering': 'Scroll of Gathering (+18%)',
    '/buff_types/wisdom': 'Scroll of Wisdom (+20%)',
    '/buff_types/action_speed': 'Scroll of Action Speed (+15%)',
    '/buff_types/rare_find': 'Scroll of Rare Find (+60%)',
    '/buff_types/processing': 'Scroll of Processing (+20%)',
    '/buff_types/gourmet': 'Scroll of Gourmet (+16%)',
};
