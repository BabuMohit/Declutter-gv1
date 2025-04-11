/**
 * Closed Tab Tracker Module
 * Handles tracking and management of closed tabs
 */

export default class ClosedTabTracker {
    constructor() {
        this.closedTabs = [];
        this.extensionTabId = null;
        this.maxUndoHistory = 50; // Maximum number of closed tabs to remember
    }

    /**
     * Initialize the closed tab tracker
     * @param {number} extensionTabId - ID of the extension's own tab
     */
    async init(extensionTabId) {
        this.extensionTabId = extensionTabId;

        // Listen for tab removal events
        chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
            // Don't track the extension's own tab
            if (tabId === this.extensionTabId) return;

            // Store the closed tab info
            this.closedTabs.unshift({
                id: tabId,
                url: removeInfo.url,
                title: removeInfo.title,
                groupId: removeInfo.groupId,
                windowId: removeInfo.windowId,
                timestamp: Date.now()
            });

            // Limit the history size
            if (this.closedTabs.length > this.maxUndoHistory) {
                this.closedTabs.pop();
            }

            // Notify listeners
            this.notifyTabClosed();
        });
    }

    /**
     * Close all tabs except the extension tab
     * @param {boolean} retainInList - Whether to keep closed tabs in the list
     * @returns {Promise<void>}
     */
    async closeAllTabs(retainInList = false) {
        try {
            // Get all tabs in the current window
            const tabs = await chrome.tabs.query({ currentWindow: true });

            // Filter out the extension's own tab
            const tabsToClose = tabs.filter(tab => tab.id !== this.extensionTabId);

            // Close each tab
            for (const tab of tabsToClose) {
                await chrome.tabs.remove(tab.id);

                // If retaining in list, store the tab info
                if (retainInList) {
                    this.closedTabs.unshift({
                        id: tab.id,
                        url: tab.url,
                        title: tab.title,
                        groupId: tab.groupId,
                        windowId: tab.windowId,
                        timestamp: Date.now()
                    });
                }
            }

            // Limit history size
            if (this.closedTabs.length > this.maxUndoHistory) {
                this.closedTabs = this.closedTabs.slice(0, this.maxUndoHistory);
            }

            // Notify listeners
            this.notifyTabClosed();
        } catch (error) {
            console.error('Error closing tabs:', error);
        }
    }

    /**
     * Reopen all closed tabs
     * @returns {Promise<void>}
     */
    async reopenAllTabs() {
        try {
            // Create a copy of closed tabs to work with
            const tabsToReopen = [...this.closedTabs];

            // Clear the closed tabs list
            this.closedTabs = [];

            // Reopen each tab
            for (const tab of tabsToReopen) {
                try {
                    // Create the tab with its original properties
                    await chrome.tabs.create({
                        url: tab.url,
                        active: false
                    });
                } catch (error) {
                    console.warn('Failed to reopen tab:', tab.url, error);
                }
            }

            // Notify listeners
            this.notifyTabClosed();
        } catch (error) {
            console.error('Error reopening tabs:', error);
        }
    }

    /**
     * Get the list of closed tabs
     * @returns {Array} Array of closed tab objects
     */
    getClosedTabs() {
        return this.closedTabs;
    }

    /**
     * Clear the closed tabs history
     */
    clearHistory() {
        this.closedTabs = [];
        this.notifyTabClosed();
    }

    /**
     * Notify listeners that the closed tabs list has changed
     */
    notifyTabClosed() {
        window.dispatchEvent(new CustomEvent('closedTabsUpdated', {
            detail: { closedTabs: this.closedTabs }
        }));
    }
} 