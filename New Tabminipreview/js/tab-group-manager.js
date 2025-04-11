/**
 * Tab Group Manager Module
 * Handles the display and interaction with Chrome's native tab groups
 */

export default class TabGroupManager {
    constructor() {
        this.groups = [];
        this.tabsInGroups = new Map(); // Map of groupId to array of tabIds
    }

    /**
     * Initialize the tab group manager
     * @returns {Promise<void>}
     */
    async init() {
        try {
            // Check if tabGroups API is available
            if (!chrome.tabGroups) {
                console.warn('Chrome Tab Groups API is not available. Some features will be disabled.');
                return;
            }

            // Safely check and add listeners
            this.setupTabGroupListeners();

            // Initial load of tab groups
            await this.refreshTabGroups();
        } catch (error) {
            console.error('Error initializing Tab Group Manager:', error);
        }
    }

    /**
     * Set up event listeners for tab group changes
     */
    setupTabGroupListeners() {
        try {
            // Safely add listeners with optional chaining
            chrome.tabGroups?.onCreated?.addListener?.(async (group) => {
                console.log('Tab group created:', group);
                await this.refreshTabGroups();
            });

            chrome.tabGroups?.onUpdated?.addListener?.(async (group) => {
                console.log('Tab group updated:', group);
                await this.refreshTabGroups();
            });

            chrome.tabGroups?.onRemoved?.addListener?.(async (groupId) => {
                console.log('Tab group removed:', groupId);
                await this.refreshTabGroups();
            });

            // Additional tab-related listeners for comprehensive group tracking
            chrome.tabs.onAttached.addListener(async () => {
                await this.refreshTabGroups();
            });

            chrome.tabs.onDetached.addListener(async () => {
                await this.refreshTabGroups();
            });

            chrome.tabs.onMoved.addListener(async () => {
                await this.refreshTabGroups();
            });

            // Safely check for tab grouping events availability first
            // These APIs might not be available in all Chrome versions
            if (chrome.tabs?.onGrouped) {
                chrome.tabs.onGrouped.addListener(async () => {
                    console.log('Tabs grouped');
                    await this.refreshTabGroups();
                });
            }

            if (chrome.tabs?.onUngrouped) {
                chrome.tabs.onUngrouped.addListener(async () => {
                    console.log('Tabs ungrouped');
                    await this.refreshTabGroups();
                });
            }
        } catch (error) {
            console.error('Error setting up Tab Group listeners:', error);
            // Continue execution despite errors - don't let listener errors break functionality
        }
    }

    /**
     * Refresh the tab groups data
     * @returns {Promise<void>}
     */
    async refreshTabGroups() {
        try {
            // Always get the current window first for accurate context
            const currentWindow = await this.getCurrentWindow();

            // Get all tab groups in the current window
            this.groups = await chrome.tabGroups.query({
                windowId: currentWindow.id
            });

            // Get fresh tab information to ensure accurate positioning
            // Specifically query only the tabs in the current window for consistency
            const freshTabs = await chrome.tabs.query({
                windowId: currentWindow.id
            });

            // Clear any existing mapping data
            this.tabsInGroups = new Map();

            // Initialize empty arrays for each group
            this.groups.forEach(group => {
                this.tabsInGroups.set(group.id, []);
            });

            // Assign each tab to its group using the latest tab indices
            freshTabs.forEach(tab => {
                if (tab.groupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                    if (this.tabsInGroups.has(tab.groupId)) {
                        // Store the complete tab object to retain all metadata
                        this.tabsInGroups.get(tab.groupId).push(tab);
                    }
                }
            });

            // Don't sort the groups here - let the render logic handle exact positioning

            // Dispatch an event to notify that groups have been updated
            window.dispatchEvent(new CustomEvent('tabGroupsUpdated', {
                detail: {
                    groups: this.groups,
                    tabsInGroups: this.tabsInGroups,
                    windowId: currentWindow.id
                }
            }));
        } catch (error) {
            console.error('Error refreshing tab groups:', error);
        }
    }

    /**
     * Sort groups by their position in the Chrome tab bar  
     * This ensures the groups are displayed in the same order as in Chrome
     * @private
     */
    sortGroupsByPosition() {
        // First, get the absolute tab indices for each group
        const groupPositions = new Map();

        for (const [groupId, tabs] of this.tabsInGroups.entries()) {
            // Filter tabs that are actually in this group
            const validTabs = tabs.filter(tab => tab.groupId === groupId);

            if (validTabs.length > 0) {
                // Store the absolute minimum tab index for this group
                groupPositions.set(groupId, Math.min(...validTabs.map(tab => tab.index)));
            }
        }

        // Sort groups based on their absolute position in the tab bar
        this.groups.sort((a, b) => {
            const aPosition = groupPositions.get(a.id) ?? Infinity;
            const bPosition = groupPositions.get(b.id) ?? Infinity;

            // Ensure groups with no tabs are placed at the end
            if (aPosition === Infinity) return 1;
            if (bPosition === Infinity) return -1;

            // Sort by absolute tab index to match Chrome's exact positioning
            return aPosition - bPosition;
        });
    }

    /**
     * Map tabs to their respective groups
     * @param {number} windowId - Window ID to query tabs from
     * @returns {Promise<void>}
     */
    async mapTabsToGroups(windowId) {
        try {
            // Clear the current mapping
            this.tabsInGroups.clear();

            // Get all tabs in the window
            const tabs = await chrome.tabs.query({ windowId });

            // Create empty arrays for each group
            this.groups.forEach(group => {
                this.tabsInGroups.set(group.id, []);
            });

            // Assign tabs to their groups
            tabs.forEach(tab => {
                if (tab.groupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                    const groupTabs = this.tabsInGroups.get(tab.groupId) || [];
                    groupTabs.push(tab);
                    this.tabsInGroups.set(tab.groupId, groupTabs);
                }
            });

            // Sort tabs within each group by their index
            for (const [groupId, groupTabs] of this.tabsInGroups.entries()) {
                this.tabsInGroups.set(
                    groupId,
                    groupTabs.sort((a, b) => a.index - b.index)
                );
            }
        } catch (error) {
            console.error('Error mapping tabs to groups:', error);
        }
    }

    /**
     * Get the current Chrome window
     * @returns {Promise<chrome.windows.Window>}
     */
    async getCurrentWindow() {
        return new Promise((resolve, reject) => {
            chrome.windows.getCurrent(window => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(window);
                }
            });
        });
    }

    /**
     * Get all tab groups with their tabs
     * @returns {Object} Object containing groups and tabsInGroups
     */
    getTabGroups() {
        return {
            groups: this.groups,
            tabsInGroups: this.tabsInGroups
        };
    }

    /**
     * Toggle the collapsed state of a tab group dropdown in the UI
     * @param {string} groupElementId - The DOM ID of the group element to toggle
     */
    toggleGroupCollapse(groupElementId) {
        const groupContent = document.getElementById(groupElementId);
        if (groupContent) {
            groupContent.classList.toggle('collapsed');

            const indicator = groupContent.previousElementSibling?.querySelector('.group-collapse-indicator');
            if (indicator) {
                indicator.textContent = groupContent.classList.contains('collapsed') ? '▶' : '▼';
            }
        }
    }
} 