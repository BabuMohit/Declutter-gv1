/**
 * Tab Manager Module
 * Handles tab listing, selection, and related functions
 */

export default class TabManager {
    constructor(activityTracker = null) {
        this.tabContainer = null;
        this.onTabSelect = null;
        this.tabs = [];
        this.extensionTabId = null;
        this.cachedTabIds = new Set();
        this.tabGroups = null;
        // New property to keep track of all tabs, including closed ones
        this.persistentTabs = [];
        // Add closed tabs history for undo functionality
        this.closedTabsHistory = [];
        // Add removed tabs history for undo functionality
        this.removedTabsHistory = [];
        // Flag to track whether auto-loading new tabs is enabled
        this.autoLoadNewTabs = true;
        // Reference to the activity tracker (can be set in constructor or init)
        this.activityTracker = activityTracker;
        // Flag to prevent multiple confirmations
        this.isConfirmationDialogActive = false;
    }

    /**
     * Initialize the tab manager
     * @param {HTMLElement} container - Container element for the tab list
     * @param {Function} selectCallback - Callback for tab selection
     * @param {Object} activityTracker - The activity tracker instance
     */
    async init(container, selectCallback, activityTracker = null) {
        this.tabContainer = container;
        this.onTabSelect = selectCallback;
        // Only set activityTracker if provided and not already set in constructor
        if (activityTracker) {
            this.activityTracker = activityTracker;
        }
        
        // Load saved autoLoadNewTabs state from localStorage if available
        try {
            const savedState = localStorage.getItem('autoLoadNewTabs');
            if (savedState !== null) {
                this.autoLoadNewTabs = savedState === 'true';
            }
        } catch (e) {
            console.warn('Failed to load autoLoadNewTabs state from localStorage', e);
        }
        
        // Log activity tracking initialization
        console.log('Tab manager initialized with activity tracking:', !!this.activityTracker);

        if (!this.tabContainer) {
            console.error('Tab container element not found');
            return;
        }

        // Get the current extension tab ID
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs && tabs.length > 0) {
                this.extensionTabId = tabs[0].id;
                console.log('Extension tab ID:', this.extensionTabId);
            }
        } catch (error) {
            console.error('Error getting extension tab ID:', error);
        }

        // Initialize control buttons
        this.initControlButtons();

        // Load initial tabs
        await this.refreshTabs();

        // Set up tab update listener
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            // Only refresh on complete to avoid excessive refreshes
            if (changeInfo.status === 'complete') {
                this.updateTabStatus();
            }
        });

        // Listen for tab removal
        chrome.tabs.onRemoved.addListener((tabId) => {
            // Instead of refreshing tabs (which would remove the closed tab),
            // we only update the status of the tab to indicate it's closed
            this.updateTabStatus();
        });

        // Listen for tab group updates if available
        if (chrome.tabGroups) {
            // Tab groups created
            chrome.tabGroups?.onCreated?.addListener(() => {
                this.updateTabStatus();
            });

            // Tab groups updated (color, title changes)
            chrome.tabGroups?.onUpdated?.addListener(() => {
                this.updateTabStatus();
            });

            // Tab groups removed
            chrome.tabGroups?.onRemoved?.addListener(() => {
                this.updateTabStatus();
            });
        }

        // Listen for custom events from the UI for close tabs actions
        document.addEventListener('closeAllTabs', () => this.handleCloseAllTabs());
        document.addEventListener('closeTabsWithPreviews', () => this.handleCloseTabsWithPreviews());
        document.addEventListener('removeClosedTabs', () => this.handleRemoveClosedTabs());
        document.addEventListener('undoClosedTabs', () => this.handleUndoClosedTabs());
    }

    /**
     * Refresh the tab list from Chrome tabs API
     */
    async refreshTabs() {
        try {
            // Get only tabs in the current window
            const tabs = await chrome.tabs.query({ currentWindow: true });

            // Store tabs and sort by ID
            this.tabs = tabs.sort((a, b) => a.index - b.index);

            // Update our persistent tabs list
            this.updatePersistentTabs(this.tabs);

            // Get tab groups if available
            if (chrome.tabGroups) {
                await this.getTabGroups();
            }

            // Render tab list
            this.renderTabs();
        } catch (error) {
            console.error('Error refreshing tabs:', error);
            this.renderError('Could not load tabs. Please try again.');
        }
    }

    /**
     * Update tab status without removing closed tabs
     */
    async updateTabStatus() {
        try {
            // Get only tabs in the current window
            const currentTabs = await chrome.tabs.query({ currentWindow: true });

            // Update our list of currently open tabs
            this.tabs = currentTabs.sort((a, b) => a.index - b.index);

            // If autoLoadNewTabs is true, update the persistent tabs with new tabs
            if (this.autoLoadNewTabs) {
                this.updatePersistentTabs(this.tabs);
            } else {
                // Only update the status of existing tabs, don't add new ones
                this.updateExistingTabsStatus(this.tabs);
            }

            // Get tab groups if available
            if (chrome.tabGroups) {
                await this.getTabGroups();
            }

            // Render tab list
            this.renderTabs();
        } catch (error) {
            console.error('Error updating tab status:', error);
        }
    }

    /**
     * Update only existing tabs' status without adding new tabs
     * @param {Array} currentTabs - Currently open tabs from Chrome
     */
    updateExistingTabsStatus(currentTabs) {
        // Create a map of existing persistent tabs for quick lookup
        const persistentTabsMap = new Map();
        this.persistentTabs.forEach(tab => {
            persistentTabsMap.set(tab.id, tab);
        });

        // Update status of existing tabs only
        for (const tab of currentTabs) {
            // Skip the extension's own tab
            if (tab.id === this.extensionTabId) continue;

            if (persistentTabsMap.has(tab.id)) {
                // Update existing tab properties
                const persistentTab = persistentTabsMap.get(tab.id);
                persistentTab.url = tab.url;
                persistentTab.title = tab.title;
                persistentTab.favIconUrl = tab.favIconUrl;
                persistentTab.groupId = tab.groupId;
                persistentTab.index = tab.index;
                persistentTab.isOpenInChrome = true;
            }
            // We do NOT add new tabs here
        }

        // Mark tabs not in currentTabs as closed
        this.persistentTabs.forEach(tab => {
            if (!currentTabs.some(currentTab => currentTab.id === tab.id)) {
                tab.isOpenInChrome = false;
                // Keep the same index value to maintain position
            }
        });

        // We don't sort by index to maintain the original order including closed tabs
        // Only sort open tabs among themselves to reflect Chrome's order
        // Get indices of open tabs
        const openTabPositions = this.persistentTabs
            .filter(tab => tab.isOpenInChrome)
            .map(tab => this.persistentTabs.indexOf(tab));

        // Sort open tabs by index within Chrome
        openTabPositions.sort((a, b) => {
            return this.persistentTabs[a].index - this.persistentTabs[b].index;
        });

        // Create a new array with tabs in the correct order
        const newOrder = [...this.persistentTabs];

        // Apply the sorting only to open tabs, leaving closed tabs in place
        for (let i = 0; i < openTabPositions.length; i++) {
            const originalIndex = openTabPositions[i];
            const tab = this.persistentTabs[originalIndex];
            // Only move items if needed
            if (newOrder.indexOf(tab) !== i) {
                // Remove from old position and add at new position
                newOrder.splice(newOrder.indexOf(tab), 1);
                newOrder.splice(i, 0, tab);
            }
        }

        // Update the persistent tabs array
        this.persistentTabs = newOrder;
    }

    /**
     * Update persistent tabs list
     * @param {Array} currentTabs - Currently open tabs from Chrome
     */
    updatePersistentTabs(currentTabs) {
        // Create a map of existing persistent tabs for quick lookup
        const persistentTabsMap = new Map();
        this.persistentTabs.forEach(tab => {
            persistentTabsMap.set(tab.id, tab);
        });

        // Update status of existing tabs and add new ones
        for (const tab of currentTabs) {
            // Skip the extension's own tab
            if (tab.id === this.extensionTabId) continue;

            if (persistentTabsMap.has(tab.id)) {
                // Update existing tab properties
                const persistentTab = persistentTabsMap.get(tab.id);
                persistentTab.url = tab.url;
                persistentTab.title = tab.title;
                persistentTab.favIconUrl = tab.favIconUrl;
                persistentTab.groupId = tab.groupId;
                persistentTab.index = tab.index;
                persistentTab.isOpenInChrome = true;
            } else {
                // Add new tab to persistent tabs
                const newTab = { ...tab, isOpenInChrome: true };
                this.persistentTabs.push(newTab);
                persistentTabsMap.set(tab.id, newTab);
            }
        }

        // Mark tabs not in currentTabs as closed
        this.persistentTabs.forEach(tab => {
            if (!currentTabs.some(currentTab => currentTab.id === tab.id)) {
                tab.isOpenInChrome = false;
                // Keep the same index value to maintain position
            }
        });

        // We don't sort closed tabs to maintain their original position
        // Only sort open tabs among themselves to reflect Chrome's order
        // Get indices of open tabs
        const openTabPositions = this.persistentTabs
            .filter(tab => tab.isOpenInChrome)
            .map(tab => this.persistentTabs.indexOf(tab));

        // Sort open tabs by index within Chrome
        openTabPositions.sort((a, b) => {
            return this.persistentTabs[a].index - this.persistentTabs[b].index;
        });

        // Create a new array with tabs in the correct order
        const newOrder = [...this.persistentTabs];

        // Apply the sorting only to open tabs, leaving closed tabs in place
        for (let i = 0; i < openTabPositions.length; i++) {
            const originalIndex = openTabPositions[i];
            const tab = this.persistentTabs[originalIndex];
            // Only move items if needed
            if (newOrder.indexOf(tab) !== i) {
                // Remove from old position and add at new position
                newOrder.splice(newOrder.indexOf(tab), 1);
                newOrder.splice(i, 0, tab);
            }
        }

        // Update the persistent tabs array
        this.persistentTabs = newOrder;
    }

    /**
     * Get tab groups from the chrome API
     */
    async getTabGroups() {
        try {
            if (!chrome.tabGroups) {
                return;
            }

            // Get current window
            const currentWindow = await this.getCurrentWindow();

            // Get all groups in the current window
            const groups = await chrome.tabGroups.query({
                windowId: currentWindow.id
            });

            // Query tabs specifically from the current window to ensure correct ordering
            // This should be consistent with the refreshTabs and updateTabStatus methods
            const freshTabs = await chrome.tabs.query({
                currentWindow: true
            });

            // Map tabs to their groups
            const tabsInGroups = new Map();

            // Initialize groups
            groups.forEach(group => {
                tabsInGroups.set(group.id, []);
            });

            // Assign tabs to groups with the most up-to-date position info
            freshTabs.forEach(tab => {
                if (tab.groupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
                    if (tabsInGroups.has(tab.groupId)) {
                        tabsInGroups.get(tab.groupId).push(tab);
                    }
                }
            });

            // Sort each group's tabs by index to ensure they appear in correct order
            for (const [groupId, tabs] of tabsInGroups.entries()) {
                tabsInGroups.set(groupId, tabs.sort((a, b) => a.index - b.index));
            }

            this.tabGroups = {
                groups,
                tabsInGroups,
                windowId: currentWindow.id
            };
        } catch (error) {
            console.error('Error getting tab groups:', error);
            this.tabGroups = null;
        }
    }

    /**
     * Get current window
     * @returns {Promise<chrome.windows.Window>} Current Chrome window
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
     * Render the tab list in the container
     */
    renderTabs() {
        if (!this.tabContainer) return;

        // Clear container
        this.tabContainer.innerHTML = '';

        if (this.persistentTabs.length === 0) {
            this.renderNoTabs();
            return;
        }

        // Get all tabs in the current window
        const currentWindowTabs = this.tabs.filter(tab => tab.windowId === chrome.windows.WINDOW_ID_CURRENT);

        // Create a map of tabs in groups
        const tabsInGroups = new Map();
        const renderedGroups = new Set();

        // Prepare map of group IDs to their tabs
        if (this.tabGroups && this.tabGroups.groups.length > 0) {
            this.tabGroups.groups.forEach(group => {
                tabsInGroups.set(group.id, this.tabGroups.tabsInGroups.get(group.id) || []);
            });
        }

        // Render tabs and groups in the exact order they appear in Chrome
        for (let i = 0; i < this.persistentTabs.length; i++) {
            const tab = this.persistentTabs[i];

            // Skip tabs that are in the extension itself
            if (tab.id === this.extensionTabId) {
                continue;
            }

            // If this tab belongs to a group and we haven't rendered that group yet
            if (tab.groupId &&
                tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE &&
                !renderedGroups.has(tab.groupId) &&
                this.tabGroups) {

                // Find the group data
                const group = this.tabGroups.groups.find(g => g.id === tab.groupId);
                if (group) {
                    // Get all tabs in this group
                    const groupTabs = tabsInGroups.get(group.id) || [];

                    // Get persistent tabs in this group
                    const persistentGroupTabs = this.persistentTabs.filter(t => t.groupId === group.id);

                    // Only render if there are tabs in the group
                    if (persistentGroupTabs.length > 0) {
                        // Sort tabs within the group by index
                        const sortedGroupTabs = [...persistentGroupTabs].sort((a, b) => a.index - b.index);

                        // Render the entire group
                        this.renderTabGroup(group, sortedGroupTabs);

                        // Mark this group as rendered
                        renderedGroups.add(group.id);
                    }
                }
            }
            // Render ungrouped tabs individually
            else if (!tab.groupId || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
                this.createTabElement(tab);
            }
        }
    }

    /**
     * Initialize control buttons - call this once during init
     */
    initControlButtons() {
        // Find existing Load New and Sync List buttons
        const existingLoadNew = document.querySelector('[data-action="load-new"]');
        const existingSyncList = document.querySelector('[data-action="sync-list"]');
        
        // Load New button
        if (existingLoadNew) {
            // Remove any existing event listeners to prevent duplicates
            const newLoadNew = existingLoadNew.cloneNode(true);
            existingLoadNew.parentNode.replaceChild(newLoadNew, existingLoadNew);
            
            // Set initial appearance based on autoLoadNewTabs state
            if (this.autoLoadNewTabs) {
                newLoadNew.classList.add('btn-primary');
                newLoadNew.classList.remove('btn-secondary');
                newLoadNew.title = 'Auto-detect new tabs is ON';
                newLoadNew.innerHTML = 'Load New: ON';
            } else {
                newLoadNew.classList.remove('btn-primary');
                newLoadNew.classList.add('btn-secondary');
                newLoadNew.title = 'Auto-detect new tabs is OFF';
                newLoadNew.innerHTML = 'Load New: OFF';
            }
            
            // Add event listener with explicit binding to ensure correct context
            newLoadNew.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent event bubbling
                this.handleLoadNew();
            });
        }
        
        if (existingSyncList) {
            existingSyncList.addEventListener('click', () => this.handleSyncList());
        }
    }

    /**
     * Handle "Load New" button click
     */
    async handleLoadNew() {
        // Toggle auto-load state
        this.autoLoadNewTabs = !this.autoLoadNewTabs;
        
        // Save state to localStorage for persistence
        try {
            localStorage.setItem('autoLoadNewTabs', this.autoLoadNewTabs ? 'true' : 'false');
        } catch (e) {
            console.warn('Failed to save autoLoadNewTabs state to localStorage', e);
        }

        // Get the Load New button
        const loadNewBtn = document.querySelector('[data-action="load-new"]');
        if (loadNewBtn) {
            if (this.autoLoadNewTabs) {
                // Update button appearance for ON state
                loadNewBtn.classList.add('btn-primary');
                loadNewBtn.classList.remove('btn-secondary');
                loadNewBtn.title = 'Auto-detect new tabs is ON';
                loadNewBtn.innerHTML = 'Load New: ON';

                // Refresh tabs to include any new ones
                try {
                    // Get all currently open tabs in Chrome
                    const currentTabs = await chrome.tabs.query({});

                    // Update our list with new tabs
                    this.updatePersistentTabs(currentTabs);

                    // Get tab groups if available
                    if (chrome.tabGroups) {
                        await this.getTabGroups();
                    }

                    // Render tab list
                    this.renderTabs();
                } catch (error) {
                    console.error('Error loading new tabs:', error);
                }
            } else {
                // Update button appearance for OFF state
                loadNewBtn.classList.remove('btn-primary');
                loadNewBtn.classList.add('btn-secondary');
                loadNewBtn.title = 'Auto-detect new tabs is OFF';
                loadNewBtn.innerHTML = 'Load New: OFF';
            }
            
            // Force a redraw to ensure visual update
            loadNewBtn.style.display = 'none';
            loadNewBtn.offsetHeight; // Trigger reflow
            loadNewBtn.style.display = '';
        }
    }

    /**
     * Handle "Sync List" button click
     */
    async handleSyncList() {
        // Show confirmation dialog
        if (confirm('Warning: This will remove all closed tabs from the list. Any tabs that are not currently open in Chrome will be removed. Continue?')) {
            try {
                // Get all currently open tabs in Chrome
                const currentTabs = await chrome.tabs.query({});

                // Replace persistent tabs with only currently open tabs
                this.persistentTabs = currentTabs.filter(tab => tab.id !== this.extensionTabId)
                    .map(tab => ({ ...tab, isOpenInChrome: true }));

                // Get tab groups if available
                if (chrome.tabGroups) {
                    await this.getTabGroups();
                }

                // Render tab list
                this.renderTabs();
            } catch (error) {
                console.error('Error syncing tab list:', error);
            }
        }
    }

    /**
     * Handle closing all tabs in the current window except the extension tab
     */
    async handleCloseAllTabs() {
        try {
            // Check if confirmation dialog is already active to prevent multiple dialogs
            if (this.isConfirmationDialogActive) {
                return;
            }
            
            this.isConfirmationDialogActive = true;

            if (!confirm('Are you sure you want to close all tabs in this window except this extension tab?')) {
                this.isConfirmationDialogActive = false;
                return;
            }

            // Get all tabs in the current window
            const currentWindow = await this.getCurrentWindow();
            const tabs = await chrome.tabs.query({ windowId: currentWindow.id });

            // Filter out the extension tab
            const tabsToClose = tabs.filter(tab => tab.id !== this.extensionTabId);

            if (tabsToClose.length === 0) {
                alert('No other tabs to close in this window.');
                this.isConfirmationDialogActive = false;
                return;
            }

            // Store tabs for undo functionality
            this.closedTabsHistory.push(tabsToClose.map(tab => ({
                url: tab.url,
                title: tab.title,
                pinned: tab.pinned,
                active: tab.active,
                windowId: tab.windowId
            })));

            // Close all tabs
            const tabIds = tabsToClose.map(tab => tab.id);
            await chrome.tabs.remove(tabIds);

            // Update tab status
            setTimeout(() => {
                this.updateTabStatus();
            }, 300);

            // Show success message
            alert(`Successfully closed ${tabIds.length} tab(s).`);
            this.isConfirmationDialogActive = false;
        } catch (error) {
            console.error('Error closing all tabs:', error);
            alert('Error closing tabs: ' + error.message);
            this.isConfirmationDialogActive = false;
        }
    }

    /**
     * Handle closing only tabs that have previews generated
     */
    async handleCloseTabsWithPreviews() {
        try {
            // Check if confirmation dialog is already active to prevent multiple dialogs
            if (this.isConfirmationDialogActive) {
                return;
            }
            
            this.isConfirmationDialogActive = true;

            if (!confirm('Are you sure you want to close all tabs that have previews generated?')) {
                this.isConfirmationDialogActive = false;
                return;
            }

            // Get tabs with previews (tabs that are cached)
            if (!this.cachedTabIds || this.cachedTabIds.size === 0) {
                alert('No tabs with previews to close.');
                this.isConfirmationDialogActive = false;
                return;
            }

            // Get all tabs that are still open in Chrome and have previews
            const currentWindow = await this.getCurrentWindow();
            const tabs = await chrome.tabs.query({ windowId: currentWindow.id });

            // Filter to tabs that have previews and are not the extension tab
            const tabsToClose = tabs.filter(tab =>
                tab.id !== this.extensionTabId &&
                this.cachedTabIds.has(tab.id)
            );

            if (tabsToClose.length === 0) {
                alert('No tabs with previews to close in this window.');
                this.isConfirmationDialogActive = false;
                return;
            }

            // Store tabs for undo functionality
            this.closedTabsHistory.push(tabsToClose.map(tab => ({
                url: tab.url,
                title: tab.title,
                pinned: tab.pinned,
                active: tab.active,
                windowId: tab.windowId
            })));

            // Store original positions of tabs to be closed
            // Create a map of tab IDs to their indices in the persistent tabs array
            const tabPositions = new Map();
            this.persistentTabs.forEach((tab, index) => {
                if (tabsToClose.some(closeTab => closeTab.id === tab.id)) {
                    tabPositions.set(tab.id, index);
                }
            });

            // Close tabs with previews
            const tabIds = tabsToClose.map(tab => tab.id);
            await chrome.tabs.remove(tabIds);

            // Update tab status while ensuring original order is preserved
            setTimeout(() => {
                // First mark the tabs as closed in our persistent tabs
                this.persistentTabs.forEach(tab => {
                    if (tabIds.includes(tab.id)) {
                        tab.isOpenInChrome = false;
                        // Ensure we keep the original index to maintain position
                    }
                });

                // Then update status of remaining open tabs
                this.updateTabStatus();

                // Render the tab list
                this.renderTabs();
            }, 300);

            // Show success message
            alert(`Successfully closed ${tabIds.length} tab(s) with previews.`);
            this.isConfirmationDialogActive = false;
        } catch (error) {
            console.error('Error closing tabs with previews:', error);
            alert('Error closing tabs: ' + error.message);
            this.isConfirmationDialogActive = false;
        }
    }

    /**
     * Handle removing closed tabs from the list
     */
    async handleRemoveClosedTabs() {
        try {
            // Check if confirmation dialog is already active to prevent multiple dialogs
            if (this.isConfirmationDialogActive) {
                return;
            }
            
            this.isConfirmationDialogActive = true;

            if (!confirm('Are you sure you want to remove all closed tabs from the list?')) {
                this.isConfirmationDialogActive = false;
                return;
            }

            // Get all closed tabs
            const closedTabs = this.persistentTabs.filter(tab => !tab.isOpenInChrome);
            
            if (!closedTabs || closedTabs.length === 0) {
                alert('There are no closed tabs in the list.');
                this.isConfirmationDialogActive = false;
                return;
            }
            
            // Remove closed tabs
            this.persistentTabs = this.persistentTabs.filter(tab => tab.isOpenInChrome);
            
            // Render updated tab list
            this.renderTabs();
            
            // Show success message
            alert(`Successfully removed ${closedTabs.length} closed tab(s) from the list.`);
            this.isConfirmationDialogActive = false;
        } catch (error) {
            console.error('Error removing closed tabs:', error);
            alert('Error removing closed tabs: ' + error.message);
            this.isConfirmationDialogActive = false;
        }
    }

    /**
     * Handle undoing closed tabs
     */
    async handleUndoClosedTabs() {
        try {
            // Check if we have any tabs to restore
            if (this.closedTabsHistory.length === 0 && this.removedTabsHistory.length === 0) {
                alert('No recently closed tabs to restore.');
                return;
            }

            // First handle tabs closed by Chrome actions
            if (this.closedTabsHistory.length > 0) {
                const tabsToRestore = this.closedTabsHistory.pop();

                // Reopen tabs
                for (const tab of tabsToRestore) {
                    await chrome.tabs.create({
                        url: tab.url,
                        pinned: tab.pinned,
                        active: tab.active,
                        windowId: tab.windowId
                    });
                }

                // Update tab status
                setTimeout(() => {
                    this.updateTabStatus();
                }, 300);

                alert(`Successfully reopened ${tabsToRestore.length} tab(s).`);
            }
            // Then handle tabs removed from the list
            else if (this.removedTabsHistory.length > 0) {
                const tabsToRestore = this.removedTabsHistory.pop();

                // Add tabs back to the list
                this.persistentTabs = [...this.persistentTabs, ...tabsToRestore];

                // Render tabs
                this.renderTabs();

                alert(`Successfully restored ${tabsToRestore.length} tab(s) to the list.`);
            }
        } catch (error) {
            console.error('Error undoing closed tabs:', error);
            alert('Error undoing closed tabs: ' + error.message);
        }
    }

    /**
     * Render a tab group with its tabs
     * @param {Object} group - Chrome tab group
     * @param {Array} tabs - Tabs in the group
     */
    renderTabGroup(group, tabs) {
        // Create group container
        const groupElement = document.createElement('div');
        groupElement.className = 'tab-group';
        groupElement.dataset.groupId = group.id;

        // Chrome has specific colors for tab groups, ensure we map them correctly
        const chromeColorMap = {
            'grey': '#5f6368',
            'blue': '#1a73e8',
            'red': '#ea4335',
            'yellow': '#fbbc04',
            'green': '#34a853',
            'pink': '#e83f64',
            'purple': '#a142f4',
            'cyan': '#24c1e0',
            'orange': '#fa903e'
        };

        // Get correct color from map or use the provided color with fallback
        const groupColor = chromeColorMap[group.color] || group.color || '#5f6368';

        // Create group header
        const groupHeader = document.createElement('div');
        groupHeader.className = 'tab-group-header';

        // Create title container with color indicator
        const titleContainer = document.createElement('div');
        titleContainer.className = 'group-title-container';

        // Add color indicator
        const colorIndicator = document.createElement('div');
        colorIndicator.className = 'group-color-indicator';
        colorIndicator.style.backgroundColor = groupColor;
        titleContainer.appendChild(colorIndicator);

        // Add group title
        const groupTitle = document.createElement('div');
        groupTitle.className = 'group-title';
        groupTitle.textContent = group.title || 'Unnamed Group';
        titleContainer.appendChild(groupTitle);

        // Add collapse indicator
        const collapseIndicator = document.createElement('div');
        collapseIndicator.className = 'group-collapse-indicator';
        collapseIndicator.textContent = '▼';

        // Assemble group header
        groupHeader.appendChild(titleContainer);
        groupHeader.appendChild(collapseIndicator);

        // Create content container for tabs
        const contentId = `group-content-${group.id}`;
        const groupContent = document.createElement('div');
        groupContent.id = contentId;
        groupContent.className = 'tab-group-content';

        // Apply subtle color border matching the group color
        groupElement.style.borderLeft = `3px solid ${groupColor}`;

        // Add tabs to group content
        if (tabs && tabs.length > 0) {
            // Ensure tabs are in the correct order
            tabs.forEach(tab => {
                this.createTabElement(tab, groupContent);
            });
        }

        // Set up click handler for collapse/expand
        groupHeader.addEventListener('click', (e) => {
            // Don't trigger collapse if clicking on a tab
            if (e.target.closest('.tab-item')) {
                return;
            }

            groupContent.classList.toggle('collapsed');
            collapseIndicator.textContent = groupContent.classList.contains('collapsed') ? '▶' : '▼';

            // Store collapsed state in session storage for persistence
            try {
                const collapsedGroups = JSON.parse(sessionStorage.getItem('collapsedGroups') || '{}');
                collapsedGroups[group.id] = groupContent.classList.contains('collapsed');
                sessionStorage.setItem('collapsedGroups', JSON.stringify(collapsedGroups));
            } catch (e) {
                console.warn('Could not save group collapsed state:', e);
            }
        });

        // Check if this group should be collapsed (based on previous state)
        try {
            const collapsedGroups = JSON.parse(sessionStorage.getItem('collapsedGroups') || '{}');
            if (collapsedGroups[group.id]) {
                groupContent.classList.add('collapsed');
                collapseIndicator.textContent = '▶';
            }
        } catch (e) {
            console.warn('Could not retrieve group collapsed state:', e);
        }

        // Assemble group
        groupElement.appendChild(groupHeader);
        groupElement.appendChild(groupContent);

        // Add to tab container
        this.tabContainer.appendChild(groupElement);
    }

    /**
     * Render a message when no tabs are found
     */
    renderNoTabs() {
        const noTabsElement = document.createElement('div');
        noTabsElement.className = 'no-tabs-message';
        noTabsElement.textContent = 'No tabs found';
        this.tabContainer.appendChild(noTabsElement);
    }

    /**
     * Render an error message
     * @param {string} message - Error message to display
     */
    renderError(message) {
        const errorElement = document.createElement('div');
        errorElement.className = 'error-message';
        errorElement.textContent = message;
        this.tabContainer.innerHTML = '';
        this.tabContainer.appendChild(errorElement);
    }

    /**
     * Update activity when user interacts with tabs
     * This keeps the cache fresh during active usage
     */
    updateActivity() {
        if (this.activityTracker) {
            this.activityTracker.updateActivity();
        }
    }

    /**
     * Create a tab element and add it to the container
     * @param {Object} tab - Chrome tab object
     * @param {HTMLElement} container - Container to add the tab to (optional)
     * @returns {HTMLElement} The created tab element
     */
    createTabElement(tab, container = null) {
        const tabElement = document.createElement('div');
        tabElement.className = 'tab-item';
        tabElement.dataset.tabId = tab.id;

        // Add class for closed tabs
        if (!tab.isOpenInChrome) {
            tabElement.classList.add('tab-closed');
        }

        // Mark extension's own tab
        if (tab.id === this.extensionTabId) {
            tabElement.classList.add('extension-tab');
        }

        // Mark tabs with cached previews - with safety check
        if (this.cachedTabIds && typeof this.cachedTabIds.has === 'function' && this.cachedTabIds.has(tab.id)) {
            tabElement.classList.add('cached');
        }

        // Check if tab is capturable
        const isCapturable = this.isCapturableUrl(tab.url);
        if (!isCapturable) {
            tabElement.classList.add('disabled');
            tabElement.title = 'This tab cannot be captured due to browser restrictions';
        }

        // Get sanitized favicon URL
        const faviconUrl = this.getSafeFavIconUrl(tab);

        // Create favicon
        const favicon = document.createElement('img');
        favicon.className = 'tab-favicon';
        favicon.src = faviconUrl;
        favicon.alt = '';

        // Add error handler properly
        favicon.addEventListener('error', () => {
            // Use data URI directly instead of chrome.runtime.getURL which can fail
            favicon.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyBpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMC1jMDYwIDYxLjEzNDc3NywgMjAxMC8wMi8xMi0xNzozMjowMCAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNSBXaW5kb3dzIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOjREQUNCODQzRjBBQTExRTM5RkYxQjAyMzhDMzVBNEQzIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOjREQUNCODQ0RjBBQTExRTM5RkYxQjAyMzhDMzVBNEQzIj4gPHhtcE1NOkRlcml2ZWRGcm9tIHN0UmVmOmluc3RhbmNlSUQ9InhtcC5paWQ6NERBQzA4NDRGMEFBMTFFMzlGRjFCMDIzOEMzNUE0RDMiIHN0UmVmOmRvY3VtZW50SUQ9InhtcC5kaWQ6NERBQzA4NDVGMEFBMTFFMzlGRjFCMDIzOEMzNUE0RDMiLz4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz7PXg8VAAAAoUlEQVR42mL8//8/AyWAiYFCQLEBLMic6dPnAyl3ZK6zszMDIyMjhsbFixfDxYSEhBiYgIpBgJERLMTg4uICVwCTAGl88OABQ0tLC0MtSEhERAQuaGFhAVYwc+ZMOD9s1BkEeXl5DCkpKShtb2/PwDBqwKgBox0SIysrC4xNTExQQh5kALIckgFhYWFoiQrGgowDxUBaWhpuIyrIzMyMbgMQYAAkbiT73LXJdgAAAABJRU5ErkJggg==';
        });

        // Create title
        const title = document.createElement('span');
        title.className = 'tab-title';
        title.textContent = this.sanitizeText(tab.title);

        // Create domain
        const domain = document.createElement('span');
        domain.className = 'tab-domain';
        domain.textContent = this.extractDomain(tab.url);

        // Append main elements to tab
        tabElement.appendChild(favicon);
        tabElement.appendChild(title);
        tabElement.appendChild(domain);

        // Create a container for tab action buttons
        const tabActions = document.createElement('div');
        tabActions.className = 'tab-actions';
        tabActions.style.cssText = `
            display: none;
            margin-left: auto;
            gap: 8px;
        `;

        // Add open tab button
        const openButton = document.createElement('button');
        openButton.className = 'tab-open-btn';
        openButton.title = tab.isOpenInChrome ? 'Switch to this tab' : 'Open this tab';
        openButton.innerHTML = '<span class="icon-open-tab"></span>';
        openButton.style.cssText = `
            background: none;
            border: none;
            cursor: pointer;
            color: #2196f3;
            font-size: 14px;
            padding: 3px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 3px;
        `;

        // Add click handler for open button
        openButton.addEventListener('click', async (e) => {
            e.stopPropagation(); // Prevent triggering the tab selection

            try {
                if (tab.isOpenInChrome) {
                    // Tab is open, switch to it
                    await chrome.tabs.update(tab.id, { active: true });

                    // Get the window and focus it
                    const tabDetails = await chrome.tabs.get(tab.id);
                    if (tabDetails.windowId) {
                        await chrome.windows.update(tabDetails.windowId, { focused: true });
                    }
                } else {
                    // Tab is closed, open it in background
                    const newTab = await chrome.tabs.create({
                        url: tab.url,
                        active: false
                    });

                    // Update the existing tab entry instead of creating a duplicate
                    tab.isOpenInChrome = true;
                    tab.id = newTab.id; // Update with new Chrome tab ID
                    tab.windowId = newTab.windowId;
                    
                    // Update UI to reflect the change
                    tabElement.classList.remove('tab-closed');
                    
                    // Add highlight effect to show tab has been reopened
                    tabElement.style.transition = 'background-color 0.5s ease';
                    tabElement.style.backgroundColor = '#fff9c4'; // Light yellow highlight
                    
                    // Remove highlight after animation completes
                    setTimeout(() => {
                        tabElement.style.backgroundColor = '';
                    }, 1500);
                    
                    // Update button title
                    openButton.title = 'Switch to this tab';
                    
                    // Update the tabs after a short delay
                    setTimeout(() => {
                        this.updateTabStatus();
                    }, 300);
                }
            } catch (error) {
                console.error('Error opening/switching to tab:', error);
                alert('Error opening tab: ' + error.message);
            }
        });

        tabActions.appendChild(openButton);

        // If not closed, create delete button
        if (isCapturable) {
            // Add delete button for manual removal
            const deleteButton = document.createElement('button');
            deleteButton.className = 'tab-delete-btn';
            deleteButton.title = 'Remove from list';
            deleteButton.innerHTML = '✕';
            deleteButton.style.cssText = `
                background: none;
                border: none;
                color: #f44336;
                cursor: pointer;
                font-size: 14px;
                padding: 3px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 3px;
            `;

            // Handle delete click
            deleteButton.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent triggering the tab selection
                this.removeTabFromList(tab.id);
            });

            tabActions.appendChild(deleteButton);

            // Add click event
            tabElement.addEventListener('click', () => {
                if (this.onTabSelect) {
                    this.onTabSelect(tab);
                }

                // Highlight selected tab
                this.highlightSelectedTab(tab.id);
            });
        }

        // Add the actions container to the tab element
        tabElement.appendChild(tabActions);

        // Show/hide action buttons on mouse enter/leave
        tabElement.addEventListener('mouseenter', () => {
            tabActions.style.display = 'flex';
        });

        tabElement.addEventListener('mouseleave', () => {
            tabActions.style.display = 'none';
        });

        // Add the tab to the container
        const targetContainer = container || this.tabContainer;
        if (targetContainer) {
            targetContainer.appendChild(tabElement);
        }
        return tabElement;
    }

    /**
     * Handle tab selection by user
     * @param {Event} event - Click event
     */
    handleTabSelect(event) {
        // Record user activity when they interact with tabs
        if (this.activityTracker) {
            this.activityTracker.updateActivity();
        } else {
            this.updateActivity();
        }

        const tabElement = event.currentTarget;
        if (!tabElement) return;

        const tabId = parseInt(tabElement.dataset.tabId);
        if (isNaN(tabId)) return;

        // Get the tab object by ID
        const tab = this.getTabById(tabId);
        if (!tab) return;

        // Track user interaction with tab
        this.persistentTabs = this.persistentTabs.filter(tab => tab.id !== tabId);

        // Rerender tabs
        this.renderTabs();
    }

    /**
     * Get all tabs
     * @returns {Array} - Array of tab objects
     */
    getAllTabs() {
        return this.tabs;
    }

    /**
     * Get a tab by ID
     * @param {number} tabId - Tab ID to find
     * @returns {Object|null} - Found tab or null
     */
    getTabById(tabId) {
        return this.tabs.find(tab => tab.id === tabId) || null;
    }

    /**
     * Check if a URL is capturable
     * @param {string} url - URL to check
     * @returns {boolean} - Whether the URL can be captured
     */
    isCapturableUrl(url) {
        return url &&
            !url.startsWith('chrome:') &&
            !url.startsWith('chrome-extension:') &&
            !url.startsWith('about:') &&
            !url.startsWith('data:') &&
            !url.startsWith('file:');
    }

    /**
     * Extract domain from URL
     * @param {string} url - URL to extract domain from
     * @returns {string} - Extracted domain
     */
    extractDomain(url) {
        if (!url) return '';
        try {
            const domain = new URL(url).hostname;
            return domain;
        } catch (e) {
            return '';
        }
    }

    /**
     * Get a safe favicon URL or default
     * @param {Object} tab - Chrome tab object
     * @returns {string} - Favicon URL or default
     */
    getSafeFavIconUrl(tab) {
        // Check for missing, empty, or restricted URLs
        if (!tab.favIconUrl || tab.favIconUrl === '' || 
            tab.favIconUrl.startsWith('chrome://') || 
            tab.favIconUrl.startsWith('chrome-extension://') || 
            tab.favIconUrl.includes('favicon-light.png') || 
            tab.favIconUrl.includes('favicon-dark.png')) {
            
            // Try to get favicon from Google's service if we have a valid URL
            if (tab.url && tab.url.startsWith('http')) {
                try {
                    const urlObj = new URL(tab.url);
                    return `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=32`;
                } catch (e) {
                    // If URL parsing fails, fall back to default icon
                }
            }
            
            // Use data URI for default favicon to avoid loading errors
            return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyBpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMC1jMDYwIDYxLjEzNDc3NywgMjAxMC8wMi8xMi0xNzozMjowMCAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNSBXaW5kb3dzIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOjREQUNCODQzRjBBQTExRTM5RkYxQjAyMzhDMzVBNEQzIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOjREQUNCODQ0RjBBQTExRTM5RkYxQjAyMzhDMzVBNEQzIj4gPHhtcE1NOkRlcml2ZWRGcm9tIHN0UmVmOmluc3RhbmNlSUQ9InhtcC5paWQ6NERBQzA4NDRGMEFBMTFFMzlGRjFCMDIzOEMzNUE0RDMiIHN0UmVmOmRvY3VtZW50SUQ9InhtcC5kaWQ6NERBQzA4NDVGMEFBMTFFMzlGRjFCMDIzOEMzNUE0RDMiLz4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz7PXg8VAAAAoUlEQVR42mL8//8/AyWAiYFCQLEBLMic6dPnAyl3ZK6zszMDIyMjhsbFixfDxYSEhBiYgIpBgJERLMTg4uICVwCTAGl88OABQ0tLC0MtSEhERAQuaGFhAVYwc+ZMOD9s1BkEeXl5DCkpKShtb2/PwDBqwKgBox0SIysrC4xNTExQQh5kALIckgFhYWFoiQrGgowDxUBaWhpuIyrIzMyMbgMQYAAkbiT73LXJdgAAAABJRU5ErkJggg==';
        }
        return tab.favIconUrl;
    }

    /**
     * Sanitize text to prevent XSS
     * @param {string} text - Text to sanitize
     * @returns {string} - Sanitized text
     */
    sanitizeText(text) {
        if (!text) return '';
        return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /**
     * Set the capture in progress state to disable tab selection
     * @param {boolean} inProgress - Whether capture is in progress
     */
    setCaptureInProgress(inProgress) {
        if (!this.tabContainer) return;

        if (inProgress) {
            this.tabContainer.classList.add('capture-in-progress');
        } else {
            this.tabContainer.classList.remove('capture-in-progress');
        }
    }

    /**
     * Update the cached tab IDs
     * @param {Set<number>|Array<number>} cachedIds - Tab IDs that have cached previews
     */
    updateCachedTabIds(cachedIds) {
        // Ensure cachedTabIds is always a Set object
        if (cachedIds instanceof Set) {
            this.cachedTabIds = cachedIds;
        } else if (Array.isArray(cachedIds)) {
            // Convert array to Set if needed
            this.cachedTabIds = new Set(cachedIds);
        } else if (cachedIds && typeof cachedIds === 'object') {
            // Handle any other object type by converting to Set
            try {
                this.cachedTabIds = new Set(Object.values(cachedIds));
            } catch (e) {
                console.error('Error converting cachedIds to Set:', e);
                this.cachedTabIds = new Set(); // Fallback to empty Set
            }
        } else {
            // Fallback to empty Set for any other type
            console.error('Invalid cachedIds type:', typeof cachedIds);
            this.cachedTabIds = new Set();
        }

        // Now refresh the tabs with the properly typed cachedTabIds
        this.refreshTabs();
    }

    /**
     * Highlight the selected tab in the UI
     * @param {number} tabId - ID of the selected tab
     */
    highlightSelectedTab(tabId) {
        // Remove active class from all tabs
        const tabElements = document.querySelectorAll('.tab-item');
        tabElements.forEach(el => el.classList.remove('active'));

        // Add active class to selected tab
        const selectedTabElement = Array.from(tabElements)
            .find(el => el.dataset.tabId === tabId.toString());

        if (selectedTabElement) {
            selectedTabElement.classList.add('active');
        }
    }

    /**
     * Update an existing tab element in the UI
     * @param {Object} tab - Tab object to update
     */
    updateTabElement(tab) {
        if (!tab || !tab.id) return;
        
        // Find the tab element in the DOM
        const tabElement = document.querySelector(`.tab-item[data-tab-id="${tab.id}"]`);
        if (!tabElement) {
            console.warn(`Tab element not found for tab ID ${tab.id}`);
            return;
        }
        
        // Update the title if it has changed
        const titleElement = tabElement.querySelector('.tab-title');
        if (titleElement) {
            titleElement.textContent = this.sanitizeText(tab.title);
        }
        
        // Update the star status if applicable
        if (tab.isStarred) {
            tabElement.classList.add('starred');
        } else {
            tabElement.classList.remove('starred');
        }
        
        // Update open/closed status
        if (tab.isOpenInChrome) {
            tabElement.classList.remove('tab-closed');
        } else {
            tabElement.classList.add('tab-closed');
        }
        
        // Update cached status
        if (this.cachedTabIds && this.cachedTabIds.has(tab.id)) {
            tabElement.classList.add('cached');
        } else {
            tabElement.classList.remove('cached');
        }
    }
    
    /**
     * Update the cached tab IDs
     * @param {Set<number>|Array<number>} cachedIds - Tab IDs that have cached previews
     */
    updateCachedTabIds(cachedIds) {
        // Ensure cachedTabIds is always a Set object
        if (cachedIds instanceof Set) {
            this.cachedTabIds = cachedIds;
        } else if (Array.isArray(cachedIds)) {
            // Convert array to Set if needed
            this.cachedTabIds = new Set(cachedIds);
        } else if (cachedIds && typeof cachedIds === 'object') {
            // Handle any other object type by converting to Set
            try {
                this.cachedTabIds = new Set(Object.values(cachedIds));
            } catch (e) {
                console.error('Error converting cachedIds to Set:', e);
                this.cachedTabIds = new Set(); // Fallback to empty Set
            }
        } else {
            // Fallback to empty Set for any other type
            console.error('Invalid cachedIds type:', typeof cachedIds);
            this.cachedTabIds = new Set();
        }
        
        // Rerender to update cached status indicators
        this.renderTabs();
    }
    
    /**
     * Remove a tab from the persistent tabs list
     * @param {number} tabId - ID of the tab to remove
     */
    removeTab(tabId) {
        // Use the existing removeTabFromList method to handle the removal
        this.removeTabFromList(tabId);
    }
}