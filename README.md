<p align="center">
  <img src="images/icon-128.png" alt="Smart Tab Grouper" width="128" height="128">
</p>

<h1 align="center">Smart Tab Grouper</h1>

<p align="center">
  A Chrome extension that automatically groups browser tabs by domain with instant auto-collapse.
  <br>
  Clean, fast, and smart.
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#keyboard-shortcuts">Shortcuts</a> •
  <a href="#license">License</a>
</p>

---

## Features

- **Group by Domain** - Organize all tabs by their domain instantly
- **Instant Auto-collapse** - Other groups collapse immediately when you switch tabs
- **Exclude Domains** - Keep specific domains ungrouped
- **Group Colors** - Cycle through Chrome's palette, use a single color, or let Chrome decide
- **Preserve Colors** - Manual color changes are respected
- **Auto-group New Tabs** - Optionally group tabs as you browse
- **Respects Your Groups** - Groups you create yourself are never touched

## Installation

### From Chrome Web Store
**[Download Smart Tab Grouper](https://chromewebstore.google.com/detail/smart-tab-grouper/heieojkjneffbibmejagocpmeoalgflb?authuser=0&hl=en-GB)**



### Manual Installation (Developer Mode)
1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the `smart-tab-grouper` folder

## Usage

1. Click the extension icon in your toolbar to open the popup
2. Click **"Group by Domain"** to organize all your tabs
3. Toggle settings as needed:
   - **Auto-group new tabs** - Automatically group tabs as you browse
   - **Auto-collapse groups** - Collapse other groups when switching tabs
   - **Ungroup orphaned tabs** - Dissolve a group when only one tab is left
   - **Group colors** - *Auto* (cycle the palette), *Single color*, or *Chrome default*
   - **Advanced** - Minimum tabs before grouping, group by subdomain, collapse delay
4. Use **Exclude current site** or type a domain to keep it ungrouped

Pinned tabs are never grouped (Chrome unpins a tab when it joins a group).

## Keyboard Shortcuts

| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| Group all tabs | `⌘ + Shift + K` | `Ctrl + Shift + K` |
| Ungroup all tabs | `⌘ + Shift + J` | `Ctrl + Shift + J` |

## Permissions

This extension requires minimal permissions:
- **tabs** - To read tab URLs and group them
- **tabGroups** - To create and manage tab groups
- **storage** - To save your preferences

## Privacy

This extension:
- Does **not** collect any personal data
- Does **not** track your browsing history
- Does **not** send any data to external servers
- Stores settings locally using Chrome's sync storage

See [PRIVACY.md](PRIVACY.md) for the full privacy policy.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.
