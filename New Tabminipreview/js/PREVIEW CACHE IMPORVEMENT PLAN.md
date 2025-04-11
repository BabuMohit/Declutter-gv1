PREVIEW CACHE IMPORVEMENT PLAN

# Smart Preview Caching Implementation Plan

## Current Implementation Analysis

### How Preview Caching Currently Works

The Declutter X GoFullPage extension currently captures and stores tab previews using the following mechanism:

1. **Storage Method**: Uses IndexedDB to store full-page screenshots of tabs
2. **Caching Behavior**:
   - Defines a 30-minute expiry time: `this.CACHE_EXPIRY = 30 * 60 * 1000;`
   - Only checks for expiry when retrieving a screenshot:
     ```javascript
     // When retrieving a preview
     if (now - timestamp > this.CACHE_EXPIRY) {
         console.log(`Cached screenshot for tab ${tabId} has expired`);
         await this.removeScreenshot(tabId);
         return null;
     }
     ```
3. **Cleanup Logic**:
   - No proactive deletion of expired previews
   - Previews remain in storage indefinitely until:
     - Manually cleared with the "Clear Cache" button
     - Replaced with a new preview of the same tab
     - Accessed and found to be expired
4. **User Control**: Limited to manually clearing the entire cache

### Issues with Current Implementation

This approach has several limitations that contradict the extension's goal of being a lightweight, efficient tool for managing tabs and reducing clutter:

1. **Inefficient Storage Usage**: Previews can accumulate indefinitely, consuming significant storage space even when they're never viewed again
2. **Inconsistent Expiry Logic**: Expiry is only checked on retrieval, meaning unused previews stay in storage forever
3. **All-or-Nothing Clearing**: Users can only clear the entire cache, not selectively manage previews
4. **Heavy Resource Footprint**: Accumulated previews can consume substantial storage resources
5. **Misaligned with User Behavior**: Does not account for how users actually work with the extension during active sessions

## Proposed Solution: Session-Based Smart Caching

### Core Concept

I propose implementing a smarter caching system that balances efficient resource usage with a seamless user experience:

1. **Session-Based Expiry**: Previews remain available during active work sessions but expire after 30 minutes of extension inactivity
2. **Proactive Cleanup**: Regularly remove truly expired previews to prevent accumulation
3. **Activity-Aware Logic**: Detect when users are actively working with the extension and maintain relevant previews

### How It Will Work

1. **Extension Activity Tracking**:
   - Track when the user is actively using the extension
   - Define "activity" as any user interaction with the extension UI
   - Maintain a global `lastActivityTimestamp` that updates with each interaction

2. **Intelligent Expiry Logic**:
   - All previews remain valid as long as the extension is in active use
   - The 30-minute expiry countdown begins only after the extension becomes inactive
   - "Inactive" means no user interaction with the extension for 30 minutes

3. **Smarter Cleanup Process**:
   - On extension startup: Check if the extension has been inactive for >30 minutes; if so, clean up old previews
   - Periodic background cleanup: Every 10 minutes, check global activity status and remove truly expired previews
   - Better storage efficiency: Prevent indefinite accumulation of unused previews

## Technical Implementation Details

### Activity Tracking Component

```javascript
// Activity Tracker Module
const ActivityTracker = {
    // Last timestamp of any activity
    lastActivity: Date.now(),
    
    // Start tracking
    init() {
        // Track UI interactions
        document.addEventListener('click', this.updateActivity.bind(this));
        document.addEventListener('keydown', this.updateActivity.bind(this));
        
        // Track visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this.updateActivity();
            }
        });
        
        // Persist activity state periodically
        setInterval(() => this.persistState(), 60000);
        
        // Load previous state
        this.loadState();
    },
    
    updateActivity() {
        this.lastActivity = Date.now();
        this.persistState();
    },
    
    async persistState() {
        try {
            await chrome.storage.local.set({
                'activityState': {
                    lastActivity: this.lastActivity
                }
            });
        } catch (e) {
            console.error('Failed to persist activity state:', e);
        }
    },
    
    async loadState() {
        try {
            const data = await chrome.storage.local.get('activityState');
            if (data.activityState) {
                this.lastActivity = data.activityState.lastActivity || Date.now();
            }
        } catch (e) {
            console.error('Failed to load activity state:', e);
            this.lastActivity = Date.now();
        }
    },
    
    isActive() {
        return (Date.now() - this.lastActivity) < 30 * 60 * 1000;
    }
};
```

### Modified Cache Manager

```javascript
// In the cache manager

// When checking if a preview is expired
async isExpired(item) {
    // If extension has been active recently, nothing expires
    if (ActivityTracker.isActive()) {
        return false;
    }
    
    // Otherwise, calculate expiry from the last activity time
    const expiryTime = ActivityTracker.lastActivity + this.CACHE_EXPIRY;
    return Date.now() > expiryTime;
}

// When retrieving a preview
async getScreenshot(tabId) {
    const result = await this._getItem(tabId);
    if (!result) {
        return null;
    }
    
    // Check against session-based expiry logic
    if (await this.isExpired(result)) {
        console.log(`Cached screenshot for tab ${tabId} has expired due to extension inactivity`);
        await this.removeScreenshot(tabId);
        return null;
    }
    
    return result;
}

// Proactive cleanup
async cleanExpiredCache() {
    // Only clean if the extension has been inactive
    if (ActivityTracker.isActive()) {
        return 0; // No cleanup during active sessions
    }
    
    const items = await this._getAllItems();
    let removedCount = 0;
    
    for (const item of items) {
        if (await this.isExpired(item)) {
            await this.removeScreenshot(item.id);
            removedCount++;
        }
    }
    
    console.log(`Cleaned ${removedCount} expired items from cache`);
    return removedCount;
}

// Initialize cleanup on startup
async init() {
    // Normal initialization...
    
    // Check if we need to clean up on startup
    if (!ActivityTracker.isActive()) {
        await this.cleanExpiredCache();
    }
    
    // Set up periodic cleanup
    this.cleanupInterval = setInterval(() => {
        this.cleanExpiredCache();
    }, 10 * 60 * 1000); // Every 10 minutes
}
```

## User Experience Benefits

This approach provides significant improvements to the user experience:

1. **Seamless Active Experience**: During active work sessions, all previews remain available without unexpected expiration
2. **Reduced Storage Usage**: Previews are automatically cleaned up after genuine abandonment
3. **Improved Performance**: Lower storage overhead leads to better overall extension performance
4. **More Intuitive Behavior**: Aligns with user expectations - things you're actively using stay available
5. **Lower Resource Footprint**: Prevents indefinite accumulation of unused previews

## Scenario Examples

### Scenario 1: Active Usage Session
- **User action**: Opens extension and actively uses it for 2 hours
- **System behavior**: All previews remain available throughout the session
- **Result**: Seamless experience with all previews available

### Scenario 2: Short Break
- **User action**: Uses extension, then switches to other tabs for 15 minutes before returning
- **System behavior**: Previews remain available when the user returns
- **Result**: Continuous workflow without interruptions

### Scenario 3: Extended Inactivity
- **User action**: Uses extension, then doesn't return for over 30 minutes
- **System behavior**: Previews expire and are cleaned up during next cleanup cycle
- **Result**: Storage is freed up after genuine abandonment

### Scenario 4: Browser Closed and Reopened
- **User action**: Closes browser entirely, reopens it the next day
- **System behavior**: Detects inactivity and cleans up old previews on startup
- **Result**: Fresh start without accumulated previews from previous day

## Implementation Plan

1. **Create Activity Tracker Module**: Implement the session tracking logic
2. **Modify Cache Manager**: Update expiry and cleanup logic to be session-aware
3. **Add Startup Cleanup**: Implement cleanup on extension initialization
4. **Add Periodic Cleanup**: Set up background cleanup process
5. **Test Each Scenario**: Verify behavior in all expected user workflows

## Alignment with Extension Vision

This implementation aligns perfectly with the vision of making the extension a practical tool for organizing browser content:

1. Supports the "on-demand, temporary previews by default" principle
2. Maintains previews during active work sessions when they're most needed
3. Reduces background resource usage to keep the extension lightweight
4. Provides a more intuitive experience that matches how users actually work

By implementing this smarter caching approach, the extension will better serve its purpose as a decluttering tool that helps users manage their browser content effectively without creating additional storage burden.


---------------------

IMPORTANT POINTS TO CONSIDER WHILE IMPLEMENTING THE PLAN AND DEFINING THE PLAN:


example, it wasn't happening in this case:

"      However, this expiry check only happens when attempting to retrieve a screenshot - the previews are not proactively deleted
This means that previews are already stored in the cache until:

They're explicitly deleted with "Clear Cache"
They're replaced with a new preview
The expiry check happens when trying to retrieve them     "

•We practically do not need the advanced settings button, and also don't need two options for preview storing.

Does the plan mentioned, cover logic that will cover all test case/ application/ use case of users?Are we covering all scenarios?

Will this plan ensure and satisfy all cases where previews werent supposed to be permanently storred and they are not?

ensure these points too:
"


What if the user has not quit the extension and is still viewing the tab previews?In such a case, it would be wrong to apply only the 30 minutes expiration logic as their still working? Maybe we must add some logic like applying the expiration logic only after the extension or the extensions tab is closed and reopened and some method that is logical, deeply thought and practical, similar to that.
we don't practically need the advanced settings button, right now 

I have a doubt....will the timer reset only for the previews that were interacted with, or all the previews that are part of the list? i don't think you are understanding what I mean.

what is the point of not extending the previews if the user is still using them in a bunch of tabs?
I hope you are understanding what i mean."

 the timer reset only for the previews that were interacted with, or all the previews that are part of the list? i don't think you are understanding what I mean.

what is the point of not extending the previews if the user is still using them in a bunch of tabs?
I hope you are understanding what i mean.
