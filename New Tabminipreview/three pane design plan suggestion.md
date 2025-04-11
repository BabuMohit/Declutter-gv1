# Declutter X GoFullPage Plus: Three-Pane Design Implementation Plan

## Introduction

This document outlines a comprehensive plan for implementing a practical three-pane design in the Declutter X GoFullPage Plus extension. The goal is to shift from managing only open tabs to a broader tool for organizing and working with content from three sources: Open Tabs, Tab Groups, and Bookmarks.

## Core Design Philosophy

The extension will follow a clean, intuitive design pattern seen in many successful applications:

1. **Navigation Pane**: Used solely for selecting content sources and navigating hierarchies
2. **Main Content Area**: Displays the actual working set of tabs/items
3. **Preview Area**: Shows previews of selected items

This approach ensures a consistent user experience while maintaining practical workflows.

## Detailed User Flows

### Primary Flow: Working with Open Tabs

1. User opens the extension
2. Navigation pane shows "Open Tabs" as selected by default
3. Main content area shows current window's open tabs
4. User selects tabs and generates previews as needed
5. User can save the collection as a workspace if desired

### Primary Flow: Working with Bookmarks

1. User selects "Bookmarks" in the navigation pane
2. Navigation pane displays bookmark folders in a hierarchical tree
3. User browses through folders without changing the main content area
4. When user finds a desired folder, they click "Import" on that folder
5. If main content area has unsaved changes, prompt to save as workspace
6. Main content area updates to show bookmarks from selected folder
7. User works with these bookmarks (generate previews, open, etc.)

### Primary Flow: Working with Tab Groups

1. User selects "Tab Groups" in the navigation pane
2. Navigation pane displays available tab groups
3. User clicks "Import" on a specific group
4. Main content area updates to show tabs from selected group
5. User works with these tabs similar to open tabs

## Detailed Component Specifications

### 1. Navigation Pane (Left Side)

#### Visual Design
- Width: 250px (collapsible via toggle button)
- Background: Light neutral (#f8f9fa)
- Border: 1px solid #e0e0e0 on right side

#### Content Structure
- **Header**: Extension name and version
- **Source Selector**: 3 clear buttons for switching between:
  - Open Tabs
  - Tab Groups
  - Bookmarks
- **Content Tree**: 
  - Shows hierarchical structure for bookmarks or groups
  - Tree-like indentation for subfolders
  - Expand/collapse indicators for folders with children
  - Empty state messages when no content is available

#### Interaction Model
- Selecting a source (Tabs/Groups/Bookmarks) updates the tree view
- Expanding/collapsing folders changes only the navigation pane
- Clicking "Import" on a folder/group loads its content to main area
- Clicking "Back" navigates up one level in the hierarchy
- Navigation pane maintains its state when switching between sources

### 2. Main Content Area (Center)

#### Visual Design
- Background: White (#ffffff)
- Item layout: Clean rows with consistent spacing
- Clear visual hierarchy with section headers

#### Header Components
- Title showing current content source (e.g., "Open Tabs", "Bookmarks: Research")
- Action buttons relevant to current content:
  - For Open Tabs: "Load New", "Sync List", "Clear Cache"
  - For imported content: "Reload", "Clear"
- Batch operation buttons: "Select All", "Deselect All"

#### Content Display
- Consistent item rendering regardless of source:
  - Favicon/icon
  - Title
  - URL/domain (abbreviated)
  - Selection checkbox
  - Action buttons (Preview, Open, Remove)
- Clear empty states with helpful messages
- Loading states during content fetching

#### Interaction Model
- Items can be selected individually or in batch
- Selected items can be operated on (preview generation, opening, etc.)
- Double-click opens the item in foreground
- Single-click selects the item
- Right-click shows context menu with additional options

### 3. Preview Area (Right)

#### Visual Design
- Background: Light gray (#f5f5f5)
- Clear padding around preview content
- Responsive sizing based on window dimensions

#### Components
- Preview header with item title
- Full-size preview of selected content
- Close button
- Loading indicator during preview generation
- Error state for failed previews

#### Interaction Model
- Preview updates when selecting items in main content
- Scroll/zoom controls for large previews
- Preview can be closed to provide more space for main content

## Technical Implementation Details

### Data Flow Architecture

1. **Data Sources**:
   - `chrome.tabs` API for open tabs
   - `chrome.tabGroups` API for tab groups
   - `chrome.bookmarks` API for bookmarks

2. **Data Providers**:
   - `TabProvider`: Manages open tabs retrieval and state
   - `TabGroupProvider`: Manages tab group data
   - `BookmarkProvider`: Manages bookmark data

3. **Controllers**:
   - `NavigationController`: Manages navigation pane state and selection
   - `ContentController`: Manages main content area and operations
   - `PreviewController`: Manages preview generation and display

4. **State Management**:
   - Use a central state object to track:
     - Current source (tabs/groups/bookmarks)
     - Current path in hierarchy
     - Selected items
     - Generated previews
     - Expanded/collapsed state of folders

5. **Events System**:
   - Use custom events for communication between components:
     - `source-changed`: When switching between tabs/groups/bookmarks
     - `content-imported`: When loading items to main content
     - `selection-changed`: When selecting/deselecting items
     - `preview-generated`: When a preview is ready

### Storage Strategy

1. **IndexedDB Usage**:
   - Store generated previews with metadata
   - Cache favicon data to reduce API calls
   - Store user preferences and settings

2. **Chrome Storage API**:
   - Store lightweight data like recent locations and preferences
   - Use sync storage for cross-device preferences

3. **Temporary Storage**:
   - Use for preview generation in progress
   - Clear on extension restart

### Performance Considerations

1. **Lazy Loading**:
   - Load deep bookmark hierarchies only when expanded
   - Retrieve tab data only when needed

2. **Preview Optimization**:
   - Generate previews on demand, not automatically
   - Use efficient image compression
   - Cache previews with reasonable expiration

3. **Batch Operations**:
   - Implement batch processing for multiple items
   - Use request throttling to prevent API limits

## User Interface Details

### Navigation Pane Elements

#### Source Selector
- Three equal-width buttons: Open Tabs, Tab Groups, Bookmarks
- Active state clearly indicated
- Simple icons + text labels

#### Tree View Items
- **Folder Items**:
  - Chevron indicator for expand/collapse
  - Folder icon
  - Folder name
  - Item count badge
  - "Import" button on hover

- **Group Items**:
  - Group color indicator
  - Group name
  - Tab count badge
  - "Import" button on hover

#### Empty States
- Clear, helpful messages:
  - "No tab groups found"
  - "No bookmarks found"
  - "This folder is empty"

### Main Content Area Elements

#### Tab/Item Display
- **Item Row**:
  - Selection checkbox
  - Favicon (with fallback)
  - Title (truncated with ellipsis if needed)
  - Domain/URL info
  - "Generate Preview" button
  - "Open" button (with dropdown for foreground/background)

#### Batch Operation Controls
- **Selection Buttons**:
  - "Select All" button
  - "Deselect All" button
  - Selection count indicator

- **Action Buttons**:
  - "Generate Previews" for selected
  - "Open Selected" dropdown (Foreground/Background)
  - "Remove Selected" button

### Content Switching Logic

1. **When Importing New Content**:
   - Check if current content has unsaved changes:
     - Items with generated previews
     - Custom selections
   - If changes exist, prompt:
     "Would you like to save current items as a workspace before importing new content?"
     [Yes] [No] [Cancel]
   - If "Yes," use existing "Save Workspace" functionality
   - If "No," proceed with import
   - If "Cancel," abort import

2. **After Import Completion**:
   - Show "Imported from: [Source]" indicator
   - Maintain consistent UI for working with items
   - Enable same operations as with open tabs

## Chrome Web Store Compliance

Based on Chrome Web Store policies and guidelines, the following considerations ensure compliance:

### Permissions
- Required permissions:
  - `tabs`: For accessing tab information
  - `tabGroups`: For accessing tab groups
  - `bookmarks`: For accessing bookmarks
  - `storage`: For saving previews and settings

### Permission Justification
- Each permission will be clearly explained to users
- No unnecessary permissions will be requested
- All API usage will comply with Chrome's intended usage

### Privacy Compliance
- No personal data will be transmitted externally
- All data processing happens locally
- Clear documentation of data storage and usage
- Option to clear all stored data

### Manifest V3 Compatibility
- Use event-driven service worker instead of background page
- Implement non-persistent background logic
- Follow recommended patterns for API usage

## Implementation Phases

### Phase 1: Navigation Structure
- Implement basic 3-pane layout
- Add source selection (Tabs/Groups/Bookmarks)
- Create tree view component for hierarchy display

### Phase 2: Content Integration
- Implement Open Tabs view in main content area
- Add Tab Groups retrieval and display in navigation
- Add Bookmarks retrieval and display in navigation

### Phase 3: Import Functionality
- Implement "Import" functionality for groups/folders
- Add content switching with save prompt
- Ensure consistent content display

### Phase 4: Preview Generation
- Integrate existing preview functionality
- Optimize for batch operations
- Add progress indicators and error handling

### Phase 5: Polish & Optimization
- Add responsive adjustments
- Implement performance optimizations
- Add helpful tooltips and documentation
- Final testing across different environments

## Implementation Dos and Don'ts

### Dos
- DO keep navigation separate from content manipulation until explicitly importing
- DO use a simple confirmation prompt when replacing content in the main area
- DO maintain consistent UI patterns across all content sources
- DO reuse existing functionality (like Save Workspace) rather than creating new systems
- DO make background tab opening a simple, practical option
- DO ensure all functionality works with keyboard navigation
- DO maintain clean separation between the three panes
- DO implement proper error handling for all API calls
- DO provide clear visual feedback for all user actions

### Don'ts
- DON'T change the main content when merely browsing in the navigation pane
- DON'T overcomplicate the UI with too many options or modes
- DON'T implement duplicate functionality across different views
- DON'T create custom UIs when standard Chrome patterns would work
- DON'T use excessive animations that might slow performance
- DON'T request unnecessary permissions from users
- DON'T store sensitive data unnecessarily
- DON'T implement features that could break with Chrome updates
- DON'T sacrifice simplicity for added functionality

## Testing Plan

### Functionality Testing
- Test all navigation paths
- Verify bookmark hierarchy display
- Test tab group integration
- Verify import functionality
- Test preview generation
- Verify batch operations

### Edge Cases
- Empty bookmark folders
- Very large bookmark hierarchies
- Tab groups with special characters
- Missing favicons
- Network interruptions during preview generation

### Browser Compatibility
- Test across Chrome versions
- Test on various operating systems
- Test with different display resolutions

## User Education

### First-Run Experience
- Brief tutorial highlighting the three-pane design
- Clear explanation of navigation vs. content areas
- Tips for effective workflow

### Documentation
- Tooltips for important functions
- Help section explaining key concepts
- Examples of common workflows

## Conclusion

This three-pane design provides a practical, intuitive interface for managing browser content from multiple sources. By clearly separating navigation, content management, and previews, users gain a powerful yet straightforward tool for organizing their browsing experience.

The implementation prioritizes:
- Practical workflows
- Consistent user experience
- Performance and reliability
- Compliance with Chrome guidelines

This approach directly addresses the core goal of shifting from real-time open tab management to deliberate organization of content from multiple sources.
