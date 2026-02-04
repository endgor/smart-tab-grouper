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

- **Group by Domain** - Organize all tabs by their domain with one click
- **Instant Auto-collapse** - Other groups collapse immediately when you switch tabs
- **Exclude Domains** - Keep specific domains ungrouped
- **Colorful Groups** - Each domain gets a unique, soft color
- **Preserve Colors** - Manual color changes are respected
- **Ignore Pinned Tabs** - Pinned tabs stay ungrouped
- **Auto-group New Tabs** - Optionally group tabs as you browse

## Installation

### From Chrome Web Store
*(Coming soon)*

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
   - **Auto-collapse groups** - Collapse other groups when switching tabs
   - **Auto-group new tabs** - Automatically group tabs as you browse
   - **Colorful groups** - Assign colors to each domain
   - **Ignore pinned tabs** - Don't group pinned tabs
4. Add domains to the exclude list to keep them ungrouped

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
