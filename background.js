// Default settings
const DEFAULT_SETTINGS = {
  autoGroup: false,
  autoCollapse: true,
  collapseDelay: 0, // instant
  groupColors: true,
  ignorePinned: true,
  ignoreUrls: ['chrome://', 'chrome-extension://', 'about:'],
  excludedDomains: [] // User-defined domains to exclude from grouping
};

// Color palette for groups
const COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'];
let colorIndex = 0;
const domainColorMap = new Map();

// Flag to prevent recursive collapse triggers
let isCollapsingGroups = false;

// Get settings from storage
async function getSettings() {
  const result = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...result.settings };
}

// Extract domain from URL and format it nicely
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    let hostname = urlObj.hostname;

    // Remove www. prefix
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }

    return hostname;
  } catch {
    return null;
  }
}

// Format domain for display (Capitalize first letter of each part)
function formatDomainName(domain) {
  if (!domain) return 'Other';

  // Get the main part of the domain (before TLD)
  const parts = domain.split('.');
  if (parts.length >= 2) {
    // Use the second-to-last part as the name (e.g., "github" from "github.com")
    const name = parts[parts.length - 2];
    // Capitalize first letter, rest lowercase
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }

  return domain.charAt(0).toUpperCase() + domain.slice(1).toLowerCase();
}

// Get a consistent color for a domain
function getColorForDomain(domain) {
  if (!domainColorMap.has(domain)) {
    domainColorMap.set(domain, COLORS[colorIndex % COLORS.length]);
    colorIndex++;
  }
  return domainColorMap.get(domain);
}

// Check if URL should be ignored
function shouldIgnoreUrl(url, settings) {
  if (!url) return true;
  return settings.ignoreUrls.some(prefix => url.startsWith(prefix));
}

// Check if domain is excluded by user
function isDomainExcluded(domain, settings) {
  if (!domain || !settings.excludedDomains) return false;
  const lowerDomain = domain.toLowerCase();
  return settings.excludedDomains.some(excluded => {
    const lowerExcluded = excluded.toLowerCase();
    // Match exact domain or subdomain (e.g., "google.com" matches "mail.google.com")
    return lowerDomain === lowerExcluded || lowerDomain.endsWith('.' + lowerExcluded);
  });
}

// Find existing group for a domain
async function findExistingGroupForDomain(domain, windowId) {
  const groups = await chrome.tabGroups.query({ windowId });
  const tabs = await chrome.tabs.query({ windowId });
  const groupName = formatDomainName(domain);

  for (const group of groups) {
    // Match by title
    if (group.title === groupName) {
      return group;
    }

    // Or match by checking if group contains tabs from this domain
    const groupTabs = tabs.filter(t => t.groupId === group.id);
    for (const tab of groupTabs) {
      if (extractDomain(tab.url) === domain) {
        return group;
      }
    }
  }
  return null;
}

// Group all tabs by domain
async function groupTabsByDomain() {
  const settings = await getSettings();
  const currentWindow = await chrome.windows.getCurrent();
  const tabs = await chrome.tabs.query({ windowId: currentWindow.id });

  // Group tabs by domain
  const domainTabs = new Map();

  for (const tab of tabs) {
    if (settings.ignorePinned && tab.pinned) continue;
    if (shouldIgnoreUrl(tab.url, settings)) continue;

    const domain = extractDomain(tab.url);
    if (!domain) continue;
    if (isDomainExcluded(domain, settings)) continue;

    if (!domainTabs.has(domain)) {
      domainTabs.set(domain, []);
    }
    domainTabs.get(domain).push(tab.id);
  }

  // Create or update groups for each domain
  for (const [domain, tabIds] of domainTabs) {
    if (tabIds.length === 0) continue;

    // Check if there's already a group for this domain
    const existingGroup = await findExistingGroupForDomain(domain, currentWindow.id);

    if (existingGroup) {
      // Add tabs to existing group - don't change its color or title
      await chrome.tabs.group({ tabIds, groupId: existingGroup.id });
    } else {
      // Create new group
      const groupId = await chrome.tabs.group({ tabIds });

      // Set properties only for new groups
      const groupName = formatDomainName(domain);
      const updateProps = {
        title: groupName,
        collapsed: settings.autoCollapse
      };

      if (settings.groupColors) {
        updateProps.color = getColorForDomain(domain);
      }

      await chrome.tabGroups.update(groupId, updateProps);
    }
  }
}

// Ungroup all tabs in current window
async function ungroupAllTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true, groupId: { $ne: chrome.tabGroups.TAB_GROUP_ID_NONE } });

  for (const tab of tabs) {
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      await chrome.tabs.ungroup(tab.id);
    }
  }
}

// Collapse all groups except the specified one
async function collapseOtherGroups(keepExpandedGroupId, windowId) {
  const settings = await getSettings();
  if (!settings.autoCollapse) return;
  if (isCollapsingGroups) return;

  isCollapsingGroups = true;

  try {
    const groups = await chrome.tabGroups.query({ windowId });

    for (const group of groups) {
      const shouldCollapse = group.id !== keepExpandedGroupId;
      if (group.collapsed !== shouldCollapse) {
        await chrome.tabGroups.update(group.id, { collapsed: shouldCollapse });
      }
    }
  } finally {
    // Small delay before allowing new collapse operations
    setTimeout(() => {
      isCollapsingGroups = false;
    }, 100);
  }
}

// Handle keyboard commands
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'group-tabs') {
    await groupTabsByDomain();
  } else if (command === 'ungroup-tabs') {
    await ungroupAllTabs();
  }
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'groupTabs') {
    groupTabsByDomain().then(() => sendResponse({ success: true }));
    return true;
  } else if (message.action === 'ungroupTabs') {
    ungroupAllTabs().then(() => sendResponse({ success: true }));
    return true;
  } else if (message.action === 'getSettings') {
    getSettings().then(settings => sendResponse(settings));
    return true;
  } else if (message.action === 'saveSettings') {
    chrome.storage.sync.set({ settings: message.settings }).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// Listen for tab activation to auto-collapse other groups
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const settings = await getSettings();
  if (settings.autoCollapse) {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      collapseOtherGroups(tab.groupId, tab.windowId);
    }
  }
});

// Listen for group expansion (when user clicks on a group header)
chrome.tabGroups.onUpdated.addListener(async (group) => {
  // Only act when a group is expanded (not collapsed)
  if (!group.collapsed && !isCollapsingGroups) {
    const settings = await getSettings();
    if (settings.autoCollapse) {
      collapseOtherGroups(group.id, group.windowId);
    }
  }
});

// Auto-group new tabs if enabled
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    const settings = await getSettings();
    if (settings.autoGroup && !shouldIgnoreUrl(tab.url, settings)) {
      const domain = extractDomain(tab.url);
      if (!domain) return;
      if (isDomainExcluded(domain, settings)) return;

      const allTabs = await chrome.tabs.query({ currentWindow: true });
      const groups = await chrome.tabGroups.query({ windowId: tab.windowId });

      // Check if there's already a group for this domain
      for (const group of groups) {
        const groupTabs = allTabs.filter(t => t.groupId === group.id);
        if (groupTabs.length > 0) {
          const groupDomain = extractDomain(groupTabs[0].url);
          if (groupDomain === domain && tab.groupId !== group.id) {
            await chrome.tabs.group({ tabIds: tabId, groupId: group.id });
            return;
          }
        }
      }

      // No existing group found - check if there are other ungrouped tabs with same domain
      const ungroupedSameDomain = allTabs.filter(t =>
        t.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE &&
        extractDomain(t.url) === domain &&
        !shouldIgnoreUrl(t.url, settings)
      );

      // If there are 2+ ungrouped tabs from same domain, create a new group
      if (ungroupedSameDomain.length >= 2) {
        const tabIds = ungroupedSameDomain.map(t => t.id);
        const groupId = await chrome.tabs.group({ tabIds });

        const groupName = formatDomainName(domain);
        const updateProps = {
          title: groupName,
          collapsed: false
        };

        if (settings.groupColors) {
          updateProps.color = getColorForDomain(domain);
        }

        await chrome.tabGroups.update(groupId, updateProps);
      }
    }
  }
});

// Log when service worker starts
console.log('Smart Tab Grouper extension loaded');
