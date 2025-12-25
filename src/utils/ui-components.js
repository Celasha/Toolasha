/**
 * Shared UI Components
 *
 * Reusable UI component builders for MWI Tools
 */

/**
 * Create a collapsible section with expand/collapse functionality
 * @param {string} icon - Icon/emoji for the section (optional, pass empty string to omit)
 * @param {string} title - Section title
 * @param {string} summary - Summary text shown when collapsed (optional)
 * @param {HTMLElement} content - Content element to show/hide
 * @param {boolean} defaultOpen - Whether section starts open (default: false)
 * @param {number} indent - Indentation level: 0 = root, 1 = nested, etc. (default: 0)
 * @returns {HTMLElement} Section container
 */
export function createCollapsibleSection(icon, title, summary, content, defaultOpen = false, indent = 0) {
    const section = document.createElement('div');
    section.className = 'mwi-collapsible-section';
    section.style.cssText = `
        margin-top: ${indent > 0 ? '4px' : '8px'};
        margin-bottom: ${indent > 0 ? '4px' : '8px'};
        margin-left: ${indent * 16}px;
    `;

    // Create header
    const header = document.createElement('div');
    header.className = 'mwi-section-header';
    header.style.cssText = `
        display: flex;
        align-items: center;
        cursor: pointer;
        user-select: none;
        padding: 4px 0;
        color: var(--text-color-primary, #fff);
        font-weight: ${indent === 0 ? '500' : '400'};
        font-size: ${indent > 0 ? '0.9em' : '1em'};
    `;

    const arrow = document.createElement('span');
    arrow.textContent = defaultOpen ? '▼' : '▶';
    arrow.style.cssText = `
        margin-right: 6px;
        font-size: 0.7em;
        transition: transform 0.2s;
    `;

    const label = document.createElement('span');
    label.textContent = icon ? `${icon} ${title}` : title;

    header.appendChild(arrow);
    header.appendChild(label);

    // Create summary (shown when collapsed)
    const summaryDiv = document.createElement('div');
    summaryDiv.style.cssText = `
        margin-left: 16px;
        margin-top: 2px;
        color: var(--text-color-secondary, #888);
        font-size: 0.9em;
        display: ${defaultOpen ? 'none' : 'block'};
    `;
    if (summary) {
        summaryDiv.textContent = summary;
    }

    // Create content wrapper
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'mwi-section-content';
    contentWrapper.style.cssText = `
        display: ${defaultOpen ? 'block' : 'none'};
        margin-left: ${indent === 0 ? '16px' : '0px'};
        margin-top: 4px;
        color: var(--text-color-secondary, #888);
        font-size: 0.9em;
        line-height: 1.6;
    `;
    contentWrapper.appendChild(content);

    // Toggle functionality
    header.addEventListener('click', () => {
        const isOpen = contentWrapper.style.display === 'block';
        contentWrapper.style.display = isOpen ? 'none' : 'block';
        if (summary) {
            summaryDiv.style.display = isOpen ? 'block' : 'none';
        }
        arrow.textContent = isOpen ? '▶' : '▼';
    });

    section.appendChild(header);
    if (summary) {
        section.appendChild(summaryDiv);
    }
    section.appendChild(contentWrapper);

    return section;
}

export default {
    createCollapsibleSection
};
