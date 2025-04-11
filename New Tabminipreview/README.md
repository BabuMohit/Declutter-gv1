# Declutter!

Manage browser tabs by capturing full-page screenshots and advanced organization tools.

## Features

- **Tab Management**: View and navigate between all open tabs in your current window
- **Full-Page Screenshots**: Capture complete screenshots of web pages, not just the visible area
- **Visual Feedback**: See the capture process in real-time with progress indicators
- **Efficient Design**: Modern, modular code structure for better performance and maintainability
- **Privacy-Focused**: All data is stored locally on your device and never sent to external servers

## Recent Improvements

- **Memory Management**: Enhanced handling of large pages with tiled processing to prevent memory issues
- **Error Handling**: Robust error handling with retry mechanisms throughout the capture process
- **Browser Compatibility**: Added compatibility checks to ensure proper functionality
- **Cross-Origin Support**: Improved handling of cross-origin restrictions
- **Fixed Position Elements**: Better handling of pages with fixed position elements
- **Resource Management**: Proper cleanup of resources to prevent memory leaks
- **Scroll Direction**: Updated to match the original GoFullPage method for more reliable captures

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in the top-right corner)
4. Click "Load unpacked" and select the extension directory

## Usage

1. Click the extension icon to open the main interface in a new tab
2. Browse the list of open tabs on the left side
3. Click on any tab to:
   - Navigate to that tab
   - Begin the screenshot capture process
   - Return to the extension tab when complete
4. View the full-page screenshot in the preview area
5. Download the screenshot if desired

## Privacy

Declutter! is built with privacy as a core principle:

- **Local Storage Only**: All data (tab information, screenshots, workspaces) is stored locally on your device
- **No Data Transmission**: The extension never sends your data to any external servers
- **Permission Usage**:
  - `tabs`: Used to manage and display your open tabs
  - `activeTab`: Used to interact with the currently active tab
  - `scripting`: Required to capture screenshots and inject capture script
  - `storage` & `unlimitedStorage`: Used to store tab screenshots and workspaces locally
  - `tabGroups`: Used to manage Chrome's native tab groups

## Project Structure

- `manifest.json`: Extension configuration and permissions
- `background.js`: Service worker that handles tab navigation and coordinates messaging
- `js/page-capture.js`: Content script for screenshot capture
- `js/image-processor.js`: Module for processing and stitching screenshots
- `js/tab-manager.js`: Handles tab listing and interaction
- `js/ui-controller.js`: Manages the extension's user interface
- `js/main.js`: Coordinates all modules for the main extension flow
- `html/main.html`: Main extension interface
- `css/styles.css`: Styling for the extension

## Technical Implementation

This extension implements the full-page screenshot methodology used by the GoFullPage extension:

1. Calculate the full dimensions of the page
2. Create a grid of scroll positions (from bottom to top)
3. Systematically scroll through the page, capturing each visible portion
4. Stitch the captured images together to create a complete screenshot

### Memory Optimization

For very large pages, the extension:
1. Detects if dimensions exceed browser canvas limits
2. Switches to tiled processing for memory-efficient handling
3. Progressively builds the image to prevent out-of-memory errors
4. Implements proper resource cleanup with `URL.revokeObjectURL()`

### Error Handling

The extension implements robust error handling:
1. Capture retry mechanisms at multiple levels
2. Fallback to partial screenshots when full stitching fails
3. Clear error messages with retry options
4. Security restriction detection and handling

## Development

The project uses modern JavaScript features and follows a modular architecture:

- ES modules for better code organization
- Async/await for handling asynchronous operations
- Classes for encapsulating functionality
- Promise-based messaging between components

## Browser Compatibility

The extension has been tested with:
- Chrome 120+
- Chromium-based browsers (Edge, Brave, etc.)

## Technical Limitations

While the extension works reliably in most scenarios, there are some limitations:
- Extremely large pages (>32000px in any dimension) may be scaled down
- Some secure websites might restrict canvas operations due to security policies
- Dynamic content that changes based on scroll position may not capture perfectly
- Pages with complex layouts might require manual scrolling to ensure all content loads

## Credits

This extension was inspired by and builds upon the work of:
- [GoFullPage](https://github.com/mrcoles/full-page-screen-capture-chrome-extension) by Peter Coles

## License

MIT License 