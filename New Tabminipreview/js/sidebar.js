/**
 * Sidebar Component for Workspaces
 * Handles the sidebar display and interaction for saved workspaces
 */
export default class Sidebar {
    constructor(workspaceManager) {
        this.workspaceManager = workspaceManager;
        this.sidebarElement = null;
        this.isVisible = false;
        this.isPinned = false;
        this.hoverTimer = null;
        this.leaveTimer = null;
        this.toggleButton = null;
    }

    /**
     * Initialize the sidebar
     */
    init() {
        this.createSidebar();
        this.createToggleButton();
        this.setupEventListeners();
        return this;
    }

    /**
     * Create the sidebar element and add it to the DOM
     */
    createSidebar() {
        // Create sidebar container
        this.sidebarElement = document.createElement('div');
        this.sidebarElement.className = 'workspace-sidebar';
        this.sidebarElement.innerHTML = `
            <div class="sidebar-content">
                <div class="sidebar-header">
                    <h3>Workspaces</h3>
                    <div class="sidebar-header-actions">
                        <button class="sidebar-pin" title="Pin Sidebar">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 2v20M2 12h20"/>
                            </svg>
                        </button>
                        <button class="sidebar-close" title="Hide Sidebar">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M18 6L6 18"></path><path d="M6 6l12 12"></path>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="sidebar-body">
                    <div class="workspaces-list"></div>
                </div>
            </div>
        `;

        // Add sidebar to document
        document.body.appendChild(this.sidebarElement);

        // Get sidebar close button
        const closeButton = this.sidebarElement.querySelector('.sidebar-close');
        closeButton.addEventListener('click', () => {
            this.hideSidebar();
        });

        // Get sidebar pin button
        const pinButton = this.sidebarElement.querySelector('.sidebar-pin');
        pinButton.addEventListener('click', () => {
            this.togglePin();
        });

        // Create hover area
        const hoverArea = document.createElement('div');
        hoverArea.className = 'sidebar-hover-trigger';
        document.body.appendChild(hoverArea);
    }

    /**
     * Create the hamburger menu toggle button
     */
    createToggleButton() {
        this.toggleButton = document.createElement('button');
        this.toggleButton.className = 'sidebar-toggle-button';
        this.toggleButton.title = 'Toggle Workspaces Sidebar';
        this.toggleButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
        `;
        this.toggleButton.addEventListener('click', () => {
            if (this.isVisible) {
                this.hideSidebar();
            } else {
                this.showSidebar();
            }
        });
        document.body.appendChild(this.toggleButton);
    }

    /**
     * Toggle the pinned state of the sidebar
     */
    togglePin() {
        this.isPinned = !this.isPinned;
        const pinButton = this.sidebarElement.querySelector('.sidebar-pin');
        
        if (this.isPinned) {
            pinButton.classList.add('active');
            pinButton.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2v20M2 12h20"/>
                </svg>
            `;
            pinButton.title = "Unpin Sidebar";
        } else {
            pinButton.classList.remove('active');
            pinButton.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 2v20M2 12h20"/>
                </svg>
            `;
            pinButton.title = "Pin Sidebar";
        }
    }

    /**
     * Set up event listeners for sidebar interaction
     */
    setupEventListeners() {
        // Hover to show sidebar
        const hoverTrigger = document.querySelector('.sidebar-hover-trigger');
        
        hoverTrigger.addEventListener('mouseenter', () => {
            clearTimeout(this.leaveTimer);
            this.hoverTimer = setTimeout(() => {
                this.showSidebar();
            }, 300); // Show after 300ms hover
        });

        // Mouse leave to hide sidebar (with delay)
        this.sidebarElement.addEventListener('mouseleave', () => {
            if (this.isPinned) return; // Don't hide if pinned
            
            clearTimeout(this.hoverTimer);
            this.leaveTimer = setTimeout(() => {
                this.hideSidebar();
            }, 500); // Hide after 500ms of mouse leaving
        });

        // Cancel hide on re-entering
        this.sidebarElement.addEventListener('mouseenter', () => {
            clearTimeout(this.leaveTimer);
        });
        
        // Close sidebar when clicking outside
        document.addEventListener('click', (event) => {
            if (this.isVisible && !this.isPinned) {
                // Check if click is outside the sidebar and not on the toggle button
                if (!this.sidebarElement.contains(event.target) && 
                    !this.toggleButton.contains(event.target) &&
                    !document.querySelector('.sidebar-hover-trigger').contains(event.target)) {
                    this.hideSidebar();
                }
            }
        });
    }

    /**
     * Show the sidebar
     */
    showSidebar() {
        this.isVisible = true;
        this.sidebarElement.classList.add('visible');
        this.renderWorkspaces();
    }

    /**
     * Hide the sidebar
     */
    hideSidebar() {
        if (this.isPinned) return; // Don't hide if pinned
        
        this.isVisible = false;
        this.sidebarElement.classList.remove('visible');
    }

    /**
     * Render the list of workspaces in the sidebar
     */
    async renderWorkspaces() {
        const workspacesList = this.sidebarElement.querySelector('.workspaces-list');
        workspacesList.innerHTML = '';

        try {
            // Get workspaces
            const workspaces = await this.workspaceManager.loadWorkspaces();

            if (workspaces.length === 0) {
                workspacesList.innerHTML = '<div class="empty-state">No saved workspaces</div>';
                return;
            }

            // Sort workspaces by creation date (newest first)
            workspaces.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            // Create workspace items
            workspaces.forEach(workspace => {
                const workspaceItem = document.createElement('div');
                workspaceItem.className = 'workspace-item';
                workspaceItem.dataset.id = workspace.id;
                workspaceItem.innerHTML = `
                    <div class="workspace-info">
                        <div class="workspace-name">${this.escapeHtml(workspace.name)}</div>
                        <div class="workspace-meta">${workspace.tabs.length} tabs - ${this.formatDate(workspace.createdAt)}</div>
                    </div>
                    <div class="workspace-actions">
                        <button class="workspace-view" data-id="${workspace.id}" title="View Workspace Tabs">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M5 12h14"></path>
                                <path d="m12 5 7 7-7 7"></path>
                            </svg>
                        </button>
                        <div class="workspace-menu-dropdown">
                            <button class="workspace-menu-trigger" data-id="${workspace.id}" title="Workspace Options">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="1"></circle>
                                    <circle cx="19" cy="12" r="1"></circle>
                                    <circle cx="5" cy="12" r="1"></circle>
                                </svg>
                            </button>
                            <div class="workspace-menu-content" id="menu-${workspace.id}">
                                <button class="workspace-menu-item workspace-load" data-id="${workspace.id}">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M4 11V4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-5"></path>
                                        <path d="M4 15l4-4 4 4"></path>
                                        <path d="M8 15v5"></path>
                                    </svg>
                                    Open All Tabs
                                </button>
                                <button class="workspace-menu-item workspace-view-as-current" data-id="${workspace.id}">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                        <circle cx="8.5" cy="8.5" r="1.5"></circle>
                                        <polyline points="21 15 16 10 5 21"></polyline>
                                    </svg>
                                    View As Current
                                </button>
                                <button class="workspace-menu-item workspace-duplicate" data-id="${workspace.id}">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                    </svg>
                                    Duplicate Workspace
                                </button>
                                <button class="workspace-menu-item workspace-rename" data-id="${workspace.id}">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                                    </svg>
                                    Rename Workspace
                                </button>
                                <button class="workspace-menu-item workspace-delete" data-id="${workspace.id}">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M3 6h18"></path>
                                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                                    </svg>
                                    Delete Workspace
                                </button>
                            </div>
                        </div>
                    </div>
                `;
                workspacesList.appendChild(workspaceItem);

                // Add event listeners to buttons
                const viewButton = workspaceItem.querySelector('.workspace-view');
                viewButton.addEventListener('click', () => {
                    this.showWorkspaceTabs(workspace.id);
                });

                const menuTrigger = workspaceItem.querySelector('.workspace-menu-trigger');
                menuTrigger.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const menuContent = workspaceItem.querySelector('.workspace-menu-content');
                    
                    // Close all other menus first
                    document.querySelectorAll('.workspace-menu-content.active').forEach(menu => {
                        if (menu !== menuContent) {
                            menu.classList.remove('active');
                        }
                    });
                    
                    // Toggle this menu
                    menuContent.classList.toggle('active');
                });

                const loadButton = workspaceItem.querySelector('.workspace-menu-item.workspace-load');
                loadButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.loadWorkspace(workspace.id);
                });

                const viewAsCurrentButton = workspaceItem.querySelector('.workspace-menu-item.workspace-view-as-current');
                viewAsCurrentButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.viewWorkspaceAsCurrent(workspace.id);
                });
                
                const duplicateButton = workspaceItem.querySelector('.workspace-menu-item.workspace-duplicate');
                duplicateButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.duplicateWorkspace(workspace.id);
                });

                const renameButton = workspaceItem.querySelector('.workspace-menu-item.workspace-rename');
                renameButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.renameWorkspace(workspace.id);
                });

                const deleteButton = workspaceItem.querySelector('.workspace-menu-item.workspace-delete');
                deleteButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteWorkspace(workspace.id);
                });
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.workspace-menu-dropdown')) {
                    document.querySelectorAll('.workspace-menu-content.active').forEach(menu => {
                        menu.classList.remove('active');
                    });
                }
            });
        } catch (error) {
            console.error('Error rendering workspaces:', error);
            workspacesList.innerHTML = '<div class="error-state">Failed to load workspaces</div>';
        }
    }

    /**
     * Show the tabs of a workspace without loading them
     * @param {string} id - Workspace ID
     */
    async showWorkspaceTabs(id) {
        try {
            const workspace = await this.workspaceManager.getWorkspace(id);
            if (!workspace) {
                throw new Error('Workspace not found');
            }

            // Check if workspace tabs container already exists
            let tabsContainer = document.getElementById(`workspace-tabs-${id}`);
            
            // If it exists, toggle its visibility
            if (tabsContainer) {
                tabsContainer.classList.toggle('visible');
                return;
            }
            
            // Create tabs container
            tabsContainer = document.createElement('div');
            tabsContainer.id = `workspace-tabs-${id}`;
            tabsContainer.className = 'workspace-tabs-container visible';
            
            // Add header
            const header = document.createElement('div');
            header.className = 'workspace-tabs-header';
            header.textContent = `Tabs in "${workspace.name}"`;
            tabsContainer.appendChild(header);
            
            // Add tabs list
            const tabsList = document.createElement('div');
            tabsList.className = 'workspace-tabs-list';
            
            workspace.tabs.forEach(tab => {
                const tabItem = document.createElement('div');
                tabItem.className = 'workspace-tab-item';
                
                // Get favicon
                const favicon = tab.favIconUrl || '../icons/default-favicon.png';
                
                tabItem.innerHTML = `
                    <img src="${favicon}" alt="" class="tab-favicon" onerror="this.src='../icons/default-favicon.png'">
                    <div class="tab-title">${this.escapeHtml(tab.title || 'Untitled Tab')}</div>
                `;
                tabsList.appendChild(tabItem);
            });
            
            tabsContainer.appendChild(tabsList);
            
            // Add to DOM after the workspace item
            const workspaceItem = document.querySelector(`.workspace-item .workspace-view[data-id="${id}"]`)
                .closest('.workspace-item');
            workspaceItem.insertAdjacentElement('afterend', tabsContainer);
        } catch (error) {
            console.error('Error showing workspace tabs:', error);
            alert('Failed to show workspace tabs');
        }
    }

    /**
     * Format date to readable string
     * @param {string} dateString - ISO date string
     * @returns {string} Formatted date
     */
    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString();
    }

    /**
     * Escape HTML to prevent XSS
     * @param {string} str - String to escape
     * @returns {string} Escaped string
     */
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Load a workspace
     * @param {string} id - Workspace ID to load
     */
    loadWorkspace(id) {
        // Dispatch custom event to be handled by main.js
        const event = new CustomEvent('loadWorkspace', { detail: { workspaceId: id } });
        document.dispatchEvent(event);
    }

    /**
     * Delete a workspace
     * @param {string} id - Workspace ID to delete
     */
    async deleteWorkspace(id) {
        try {
            const confirmed = confirm('Are you sure you want to delete this workspace?');
            if (confirmed) {
                await this.workspaceManager.deleteWorkspace(id);
                this.renderWorkspaces();
            }
        } catch (error) {
            console.error('Error deleting workspace:', error);
            alert('Failed to delete workspace');
        }
    }

    /**
     * View a workspace as the current one, saving the current workspace automatically
     * @param {string} id - Workspace ID to view as current
     */
    viewWorkspaceAsCurrent(id) {
        // Create a dialog with options
        const optionsDialog = document.createElement('div');
        optionsDialog.className = 'options-dialog';
        optionsDialog.innerHTML = `
            <div class="options-dialog-content">
                <h3>View Workspace Options</h3>
                <div class="options-list">
                    <button class="option-item option-view-only" data-id="${id}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                        View tabs only (don't open in Chrome)
                    </button>
                    <div class="option-info-message">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3498db" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                        <span>To open all tabs in this workspace, you have two options:
1. Use the 'Open all tabs in list' option from the Close Tabs dropdown in the preview section.
2. Click the "Load New" button in the Open Tabs section, which will intelligently open tabs without creating duplicates.</span>
                    </div>
                </div>
                <div class="dialog-actions">
                    <button class="btn cancel-btn">Cancel</button>
                </div>
            </div>
        `;
        
        // Add to DOM
        document.body.appendChild(optionsDialog);
        
        // Add event listeners
        const viewOnlyBtn = optionsDialog.querySelector('.option-view-only');
        const cancelBtn = optionsDialog.querySelector('.cancel-btn');
        
        // Option 1: View only
        viewOnlyBtn.addEventListener('click', () => {
            // Dispatch custom event to be handled by main.js
            const event = new CustomEvent('viewWorkspaceAsCurrent', { 
                detail: { 
                    workspaceId: id,
                    openTabs: false
                } 
            });
            document.dispatchEvent(event);
            optionsDialog.remove();
        });
        
        // Cancel
        cancelBtn.addEventListener('click', () => {
            optionsDialog.remove();
        });
        
        // Close on click outside
        optionsDialog.addEventListener('click', (e) => {
            if (e.target === optionsDialog) {
                optionsDialog.remove();
            }
        });
    }

    /**
     * Highlight the current workspace in the sidebar
     * @param {string} workspaceId - The ID of the workspace to highlight
     */
    highlightCurrentWorkspace(workspaceId) {
        // First, remove the highlight from all workspaces
        const allWorkspaceItems = this.sidebarElement.querySelectorAll('.workspace-item');
        allWorkspaceItems.forEach(item => {
            item.classList.remove('current-workspace');
        });
        
        // Add the highlight to the current workspace
        const currentWorkspaceItem = this.sidebarElement.querySelector(`.workspace-item[data-id="${workspaceId}"]`);
        if (currentWorkspaceItem) {
            currentWorkspaceItem.classList.add('current-workspace');
            
            // Ensure the sidebar is visible to show the highlight
            if (!this.isVisible) {
                this.showSidebar();
            }
        }
    }
    
    /**
     * Duplicate a workspace
     * @param {string} id - Workspace ID to duplicate
     */
    async duplicateWorkspace(id) {
        try {
            // Dispatch custom event to be handled by main.js
            const event = new CustomEvent('duplicateWorkspace', { detail: { workspaceId: id } });
            document.dispatchEvent(event);
        } catch (error) {
            console.error('Error duplicating workspace:', error);
            alert('Failed to duplicate workspace');
        }
    }

    /**
     * Rename a workspace
     * @param {string} id - Workspace ID to rename
     */
    async renameWorkspace(id) {
        try {
            const newName = prompt('Rename the workspace to:');
            if (newName) {
                await this.workspaceManager.renameWorkspace(id, newName);
                this.renderWorkspaces();
            }
        } catch (error) {
            console.error('Error renaming workspace:', error);
            alert('Failed to rename workspace');
        }
    }
} 