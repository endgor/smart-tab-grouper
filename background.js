// Default settings
const DEFAULT_SETTINGS = {
  autoGroup: true,
  autoCollapse: true,
  collapseDelay: 0, // milliseconds before collapsing other groups (0 = instant)
  groupColors: true,
  ignorePinned: true,
  groupBySubdomain: false, // When true, subdomains get separate groups
  minTabsToGroup: 2, // Minimum tabs from same domain before auto-grouping
  autoUngroupOrphans: true, // Ungroup tabs when their group has only 1 tab left
  ignoreUrls: ['chrome://', 'chrome-extension://', 'about:'],
  excludedDomains: [] // User-defined domains to exclude from grouping
};

// Known second-level registry suffixes (e.g., "co" in "co.uk", "com" in "com.au")
// When the TLD is a 2-letter country code and the second-level part matches one of these,
// treat the combination as a single TLD (e.g., "co.uk" -> need 3 parts for base domain)
const REGISTRY_SUFFIXES = new Set([
  'ac', 'co', 'com', 'edu', 'gov', 'mil', 'net', 'org',
  'gen', 'gob', 'info', 'nom', 'or', 'ne', 'nic', 'web',
]);

// Check if the last two parts of a hostname form a multi-part TLD
// e.g., "co.uk" -> true (2-letter TLD + registry suffix)
// e.g., "com" -> false (single TLD)
function isMultiPartTld(parts) {
  if (parts.length < 2) return false;
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  // Country-code TLDs are 2 letters; if the second-level is a known registry suffix, it's multi-part
  return tld.length === 2 && REGISTRY_SUFFIXES.has(sld);
}

// Color palette for groups
const COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'];
let colorIndex = Math.floor(Math.random() * COLORS.length);
const domainColorMap = new Map();

// Flag to prevent recursive collapse triggers
let isCollapsingGroups = false;

// Cached settings — refreshed from storage on change
let cachedSettings = null;

async function getSettings() {
  if (cachedSettings) return cachedSettings;
  const result = await chrome.storage.sync.get('settings');
  cachedSettings = { ...DEFAULT_SETTINGS, ...result.settings };
  return cachedSettings;
}

// Invalidate cache when settings change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    cachedSettings = null;
  }
});

// Retry a chrome tab/group operation that may fail due to user dragging a tab
async function retryTabOp(fn, retries = 3, delay = 150) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i < retries - 1 && e.message?.includes('cannot be edited')) {
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw e;
      }
    }
  }
}

// Extract domain from URL
// When groupBySubdomain is false (default), strips subdomains to base domain
// When groupBySubdomain is true, keeps full hostname (minus www.)
function extractDomain(url, groupBySubdomain = false) {
  try {
    const urlObj = new URL(url);
    let hostname = urlObj.hostname;

    // If it's an IP address, return as-is (don't strip octets as if they were subdomains)
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':')) {
      return hostname;
    }

    if (groupBySubdomain) {
      // Keep full hostname but strip www.
      if (hostname.startsWith('www.')) {
        hostname = hostname.substring(4);
      }
    } else {
      // Strip subdomains to base domain
      // "dns.ender.nu" -> "ender.nu", "www.bbc.co.uk" -> "bbc.co.uk"
      const parts = hostname.split('.');
      if (parts.length > 2) {
        const keep = isMultiPartTld(parts) ? -3 : -2;
        if (parts.length > Math.abs(keep)) {
          hostname = parts.slice(keep).join('.');
        }
      }
    }

    return hostname;
  } catch {
    return null;
  }
}

// Format domain for display
// For base domains: "github.com" -> "Github", "bbc.co.uk" -> "Bbc"
// For subdomains (when groupBySubdomain is true): "dns.ender.nu" -> "Dns.ender"
function formatDomainName(domain) {
  if (!domain) return 'Other';

  const parts = domain.split('.');

  // Determine how many parts form the TLD suffix
  const tldParts = isMultiPartTld(parts) ? 2 : 1;
  const nameParts = parts.length - tldParts;

  if (nameParts > 1) {
    // Subdomain: use subdomain + base name (e.g., "dns.ender.nu" -> "Dns.ender")
    const sub = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
    const base = parts[nameParts - 1].toLowerCase();
    return sub + '.' + base;
  }
  if (nameParts === 1) {
    // Base domain: use the name part (e.g., "github.com" -> "Github", "bbc.co.uk" -> "Bbc")
    const name = parts[0];
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

// Build a map of groupId -> domain using pre-fetched tabs
function buildGroupDomainMap(tabs, groups, groupBySubdomain) {
  const map = new Map();
  for (const group of groups) {
    for (const tab of tabs) {
      if (tab.groupId === group.id) {
        const domain = extractDomain(tab.url, groupBySubdomain);
        if (domain) {
          map.set(group.id, { group, domain });
          break;
        }
      }
    }
  }
  return map;
}

// Group all tabs by domain
async function groupTabsByDomain() {
  const settings = await getSettings();
  const currentWindow = await chrome.windows.getCurrent();
  const bySub = settings.groupBySubdomain ?? false;

  // Fetch tabs and groups once
  const [tabs, groups] = await Promise.all([
    chrome.tabs.query({ windowId: currentWindow.id }),
    chrome.tabGroups.query({ windowId: currentWindow.id })
  ]);

  // Build domain -> existing group lookup
  const groupDomainMap = buildGroupDomainMap(tabs, groups, bySub);
  const domainToGroup = new Map();
  for (const [, { group, domain }] of groupDomainMap) {
    domainToGroup.set(domain, group);
  }

  // Group tabs by domain
  const domainTabs = new Map();

  for (const tab of tabs) {
    if (settings.ignorePinned && tab.pinned) continue;
    if (shouldIgnoreUrl(tab.url, settings)) continue;

    const domain = extractDomain(tab.url, bySub);
    if (!domain) continue;
    if (isDomainExcluded(domain, settings)) continue;

    if (!domainTabs.has(domain)) {
      domainTabs.set(domain, []);
    }
    domainTabs.get(domain).push(tab.id);
  }

  // Create or update groups for each domain
  for (const [domain, tabIds] of domainTabs) {
    try {
      const existingGroup = domainToGroup.get(domain);

      if (existingGroup) {
        // Add tabs to existing group - don't change its color or title
        await retryTabOp(() => chrome.tabs.group({ tabIds, groupId: existingGroup.id }));
      } else {
        // Create new group
        const groupId = await retryTabOp(() => chrome.tabs.group({ tabIds }));

        // Set properties only for new groups
        const groupName = formatDomainName(domain);
        const updateProps = {
          title: groupName,
          collapsed: settings.autoCollapse
        };

        if (settings.groupColors) {
          updateProps.color = getColorForDomain(domain);
        }

        await retryTabOp(() => chrome.tabGroups.update(groupId, updateProps));
      }
    } catch (e) {
      // Tab may have been closed between querying and grouping
      console.warn(`Failed to group tabs for ${domain}:`, e.message);
    }
  }
}

// Ungroup all tabs in current window
async function ungroupAllTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const groupedTabs = tabs.filter(t => t.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE);

  // Ungroup all at once where possible
  for (const tab of groupedTabs) {
    try {
      await retryTabOp(() => chrome.tabs.ungroup(tab.id));
    } catch (e) {
      console.warn(`Failed to ungroup tab ${tab.id}:`, e.message);
    }
  }
}

// Collapse all groups except the specified one (pass TAB_GROUP_ID_NONE to collapse all)
let collapseTimer = null;

async function collapseOtherGroups(keepExpandedGroupId, windowId) {
  const settings = await getSettings();
  if (!settings.autoCollapse) return;
  if (isCollapsingGroups) return;

  const delay = settings.collapseDelay ?? 0;

  // Clear any pending collapse
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }

  const doCollapse = async () => {
    if (isCollapsingGroups) return;
    isCollapsingGroups = true;

    try {
      const groups = await chrome.tabGroups.query({ windowId });

      for (const group of groups) {
        const shouldCollapse = group.id !== keepExpandedGroupId;
        if (group.collapsed !== shouldCollapse) {
          await retryTabOp(() => chrome.tabGroups.update(group.id, { collapsed: shouldCollapse }));
        }
      }
    } catch (e) {
      console.warn('Failed to collapse groups:', e.message);
    } finally {
      // Small delay before allowing new collapse operations
      setTimeout(() => {
        isCollapsingGroups = false;
      }, 100);
    }
  };

  if (delay > 0) {
    collapseTimer = setTimeout(doCollapse, delay);
  } else {
    await doCollapse();
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
    groupTabsByDomain()
      .then(() => sendResponse({ success: true }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  } else if (message.action === 'ungroupTabs') {
    ungroupAllTabs()
      .then(() => sendResponse({ success: true }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  } else if (message.action === 'getSettings') {
    getSettings()
      .then(settings => sendResponse(settings))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  } else if (message.action === 'saveSettings') {
    chrome.storage.sync.set({ settings: message.settings })
      .then(() => sendResponse({ success: true }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }
});

// Listen for tab activation to auto-collapse other groups
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const settings = await getSettings();
    if (settings.autoCollapse) {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      await collapseOtherGroups(tab.groupId, tab.windowId);
    }
  } catch (e) {
    console.warn('Failed to collapse groups on tab switch:', e.message);
  }
});

// Listen for group expansion (when user clicks on a group header)
chrome.tabGroups.onUpdated.addListener(async (group) => {
  try {
    // Only act when a group is expanded (not collapsed)
    if (!group.collapsed && !isCollapsingGroups) {
      const settings = await getSettings();
      if (settings.autoCollapse) {
        await collapseOtherGroups(group.id, group.windowId);
      }
    }
  } catch (e) {
    console.warn('Failed to collapse groups on group update:', e.message);
  }
});

// Auto-group new tabs if enabled
// Trigger on 'loading' (URL is known immediately) instead of 'complete' (waits for all resources)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading' || !changeInfo.url) return;

  const settings = await getSettings();
  if (!settings.autoGroup) return;
  if (shouldIgnoreUrl(tab.url, settings)) return;
  if (settings.ignorePinned && tab.pinned) return;

  const bySub = settings.groupBySubdomain ?? false;
  const domain = extractDomain(tab.url, bySub);
  if (!domain) return;
  if (isDomainExcluded(domain, settings)) return;

  try {
    // Fetch tabs and groups in parallel (single query pair for the whole operation)
    const [allTabs, groups] = await Promise.all([
      chrome.tabs.query({ windowId: tab.windowId }),
      chrome.tabGroups.query({ windowId: tab.windowId })
    ]);

    // Check if there's already a group for this domain
    for (const group of groups) {
      const groupTabs = allTabs.filter(t => t.groupId === group.id);
      if (groupTabs.length > 0) {
        const groupDomain = extractDomain(groupTabs[0].url, bySub);
        if (groupDomain === domain && tab.groupId !== group.id) {
          await retryTabOp(() => chrome.tabs.group({ tabIds: [tabId], groupId: group.id }));
          return;
        }
      }
    }

    // No existing group found - check if there are other ungrouped tabs with same domain
    const ungroupedSameDomain = allTabs.filter(t =>
      t.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE &&
      !(settings.ignorePinned && t.pinned) &&
      extractDomain(t.url, bySub) === domain &&
      !shouldIgnoreUrl(t.url, settings)
    );

    // If there are 2+ ungrouped tabs from same domain, create a new group
    if (ungroupedSameDomain.length >= (settings.minTabsToGroup ?? 2)) {
      const tabIds = ungroupedSameDomain.map(t => t.id);
      const groupId = await retryTabOp(() => chrome.tabs.group({ tabIds }));

      const groupName = formatDomainName(domain);
      const updateProps = {
        title: groupName,
        collapsed: false
      };

      if (settings.groupColors) {
        updateProps.color = getColorForDomain(domain);
      }

      await retryTabOp(() => chrome.tabGroups.update(groupId, updateProps));
    }
  } catch (e) {
    console.warn(`Failed to auto-group tab for ${domain}:`, e.message);
  }
});

// Auto-ungroup orphaned groups (groups with only 1 tab left)
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  if (removeInfo.isWindowClosing) return;

  const settings = await getSettings();
  if (!settings.autoUngroupOrphans) return;

  try {
    const groups = await chrome.tabGroups.query({ windowId: removeInfo.windowId });
    for (const group of groups) {
      const groupTabs = await chrome.tabs.query({ windowId: removeInfo.windowId, groupId: group.id });
      if (groupTabs.length === 1) {
        await retryTabOp(() => chrome.tabs.ungroup(groupTabs[0].id));
      }
    }
  } catch (e) {
    console.warn('Failed to ungroup orphaned tab:', e.message);
  }
});

// Log when service worker starts
console.log('Smart Tab Grouper extension loaded');
