/**
 * Activity Tracker Module
 * Tracks user interaction with the extension to determine when cache entries should expire
 */

class ActivityTracker {
    constructor() {
        // Last timestamp of any extension activity
        this.lastActivity = Date.now();
        
        // Cleanup interval reference
        this.intervalId = null;
        
        // Bind methods to ensure correct context
        this.updateActivity = this.updateActivity.bind(this);
        this.isActive = this.isActive.bind(this);
        this.init = this.init.bind(this);
    }
    
    /**
     * Initialize the activity tracker
     */
    async init() {
        console.log('Initializing activity tracker...');
        
        // Track direct UI interactions
        document.addEventListener('click', this.updateActivity);
        document.addEventListener('keydown', this.updateActivity);
        document.addEventListener('scroll', this.updateActivity);
        document.addEventListener('mousemove', this.updateActivity, { 
            passive: true,
            capture: false 
        });
        
        // Track extension visibility
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this.updateActivity();
            }
        });
        
        // Track when this extension tab becomes active (if possible)
        if (chrome.tabs) {
            try {
                chrome.tabs.onActivated.addListener((activeInfo) => {
                    chrome.tabs.get(activeInfo.tabId, (tab) => {
                        if (tab && tab.url && tab.url.includes(chrome.runtime.id)) {
                            this.updateActivity();
                        }
                    });
                });
            } catch (e) {
                console.warn('Unable to track tab activation:', e);
            }
        }
        
        // Save state periodically
        this.intervalId = setInterval(() => this.persistState(), 60000); // Every minute
        
        // Load previous state
        await this.loadState();
        
        // Update activity immediately to ensure fresh timestamp
        this.updateActivity();
        
        console.log('Activity tracker initialized with timestamp:', new Date(this.lastActivity).toLocaleString());
    }
    
    /**
     * Update the last activity timestamp
     */
    updateActivity() {
        this.lastActivity = Date.now();
        this.persistState();
    }
    
    /**
     * Check if the extension is currently considered active
     * @returns {boolean} - True if the extension has been active within the expiry period
     */
    isActive() {
        const inactiveTime = Date.now() - this.lastActivity;
        const isActive = inactiveTime < 30 * 60 * 1000; // 30 minutes
        return isActive;
    }
    
    /**
     * Save activity state to extension storage
     */
    async persistState() {
        try {
            await chrome.storage.local.set({
                'activityState': {
                    lastActivity: this.lastActivity
                }
            });
        } catch (e) {
            console.warn('Failed to persist activity state:', e);
        }
    }
    
    /**
     * Load previous activity state
     */
    async loadState() {
        try {
            const data = await chrome.storage.local.get('activityState');
            if (data.activityState) {
                this.lastActivity = data.activityState.lastActivity || Date.now();
            }
        } catch (e) {
            console.warn('Failed to load activity state:', e);
            this.lastActivity = Date.now();
        }
    }
    
    /**
     * Get the inactivity duration in milliseconds
     * @returns {number} - Milliseconds since last activity
     */
    getInactivityDuration() {
        return Date.now() - this.lastActivity;
    }
    
    /**
     * Clean up resources when extension is unloaded
     */
    dispose() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        
        // Remove event listeners
        document.removeEventListener('click', this.updateActivity);
        document.removeEventListener('keydown', this.updateActivity);
        document.removeEventListener('scroll', this.updateActivity);
        document.removeEventListener('mousemove', this.updateActivity, { 
            passive: true,
            capture: false 
        });
        
        document.removeEventListener('visibilitychange', this.updateActivity);
    }
}

// Export as a class - will be instantiated in main.js
export default ActivityTracker;
