// Default settings
const DEFAULT_SETTINGS = {
  autoGroup: true,
  autoCollapse: true,
  collapseDelay: 0, // milliseconds before collapsing other groups (0 = instant)
  colorMode: 'auto', // 'auto' = cycle palette, 'fixed' = always fixedColor, 'default' = let Chrome pick
  fixedColor: 'grey',
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
const NO_GROUP = chrome.tabGroups.TAB_GROUP_ID_NONE;

// ---------------------------------------------------------------------------
// Session state
//
// MV3 service workers are terminated after ~30s idle, so anything we want to
// survive between events lives in chrome.storage.session (cleared when the
// browser closes, which is fine for this data).
//   colorState:    { index, map: { domain: color } } — stable colors per domain
//   managedGroups: [groupId, ...] — groups this extension created
// ---------------------------------------------------------------------------

async function getSessionState() {
  const { colorState, managedGroups } = await chrome.storage.session.get(['colorState', 'managedGroups']);
  return {
    colorState: colorState ?? { index: Math.floor(Math.random() * COLORS.length), map: {} },
    managedGroups: new Set(managedGroups ?? [])
  };
}

// Round-robin palette color, persisted for the session
async function getPaletteColorForDomain(domain) {
  const { colorState } = await getSessionState();
  if (!colorState.map[domain]) {
    colorState.map[domain] = COLORS[colorState.index % COLORS.length];
    colorState.index++;
    await chrome.storage.session.set({ colorState });
  }
  return colorState.map[domain];
}

async function rememberManagedGroup(groupId) {
  const { managedGroups } = await getSessionState();
  managedGroups.add(groupId);
  await chrome.storage.session.set({ managedGroups: [...managedGroups] });
}

// Drop ids of groups that no longer exist so the set doesn't grow forever
chrome.tabGroups.onRemoved.addListener(async (group) => {
  try {
    const { managedGroups } = await getSessionState();
    if (managedGroups.delete(group.id)) {
      await chrome.storage.session.set({ managedGroups: [...managedGroups] });
    }
  } catch (e) {
    console.warn('Failed to forget removed group:', e.message);
  }
});

// Resolve the color for a new group according to the color mode (null = let Chrome pick)
async function getColorForDomain(domain, settings) {
  switch (settings.colorMode) {
    case 'auto': return getPaletteColorForDomain(domain);
    case 'fixed': return COLORS.includes(settings.fixedColor) ? settings.fixedColor : 'grey';
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

// Cached settings — refreshed from storage on change
let cachedSettings = null;

async function getSettings() {
  if (cachedSettings) return cachedSettings;
  const result = await chrome.storage.sync.get('settings');
  const stored = result.settings ?? {};
  // Migrate older color settings to colorMode
  if (stored.colorMode === undefined && stored.groupColors === false) stored.colorMode = 'default';
  if (stored.colorMode === 'site' || stored.colorMode === 'random') stored.colorMode = 'auto';
  if (stored.colorMode === 'off') stored.colorMode = 'default';
  cachedSettings = { ...DEFAULT_SETTINGS, ...stored };
  return cachedSettings;
}

// Invalidate cache when settings change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    cachedSettings = null;
  }
});

// Keys the popup is allowed to persist. Anything else (e.g. ignoreUrls) stays
// a code-level default so it can be changed in future releases.
const USER_SETTING_KEYS = [
  'autoGroup', 'autoCollapse', 'collapseDelay', 'colorMode', 'fixedColor',
  'groupBySubdomain', 'minTabsToGroup', 'autoUngroupOrphans', 'excludedDomains'
];

async function saveSettings(incoming) {
  const settings = {};
  for (const key of USER_SETTING_KEYS) {
    if (key in incoming) settings[key] = incoming[key];
  }
  await chrome.storage.sync.set({ settings });
}

// ---------------------------------------------------------------------------
// Concurrency helpers
// ---------------------------------------------------------------------------

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

// Serialize grouping operations per window. Several tabs opening at once
// (session restore, ctrl-clicking links) fire concurrent onUpdated events;
// without this each handler would see "no group yet" and create duplicates.
const windowLocks = new Map();

function withWindowLock(windowId, fn) {
  const prev = windowLocks.get(windowId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  windowLocks.set(windowId, next);
  next.finally(() => {
    if (windowLocks.get(windowId) === next) windowLocks.delete(windowId);
  });
  return next;
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

const IP_RE = /^\d+\.\d+\.\d+\.\d+$/;

// Extract domain from URL
// When groupBySubdomain is false (default), strips subdomains to base domain
// When groupBySubdomain is true, keeps full hostname (minus www.)
function extractDomain(url, groupBySubdomain = false) {
  try {
    const urlObj = new URL(url);
    let hostname = urlObj.hostname;

    // If it's an IP address, return as-is (don't strip octets as if they were subdomains)
    if (IP_RE.test(hostname) || hostname.includes(':')) {
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
      const keep = isMultiPartTld(parts) ? 3 : 2;
      if (parts.length > keep) {
        hostname = parts.slice(-keep).join('.');
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

  // IP addresses: return as-is
  if (IP_RE.test(domain) || domain.includes(':')) {
    return domain;
  }

  const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const parts = domain.split('.');

  // Determine how many parts form the TLD suffix
  const tldParts = isMultiPartTld(parts) ? 2 : 1;
  const nameParts = parts.length - tldParts;

  if (nameParts > 1) {
    // Subdomain: use subdomain + base name (e.g., "dns.ender.nu" -> "Dns.ender")
    return capitalize(parts[0]) + '.' + parts[nameParts - 1].toLowerCase();
  }
  if (nameParts === 1) {
    // Base domain: use the name part (e.g., "github.com" -> "Github", "bbc.co.uk" -> "Bbc")
    return capitalize(parts[0]);
  }

  return capitalize(domain);
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

// Should this tab take part in grouping at all?
// Pinned tabs are always skipped: Chrome unpins a tab when it is grouped.
function isGroupableTab(tab, settings) {
  if (tab.pinned) return false;
  if (shouldIgnoreUrl(tab.url, settings)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Group helpers
// ---------------------------------------------------------------------------

// Build a map of domain -> group for groups this extension manages.
// A group is "managed" if we created it this browser session, or if its title
// matches what we'd name a group for its first tab's domain (covers groups
// created before a restart). User-created groups with other titles are left alone.
function buildDomainGroupMap(tabs, groups, bySub, managedGroups) {
  const firstTabByGroup = new Map();
  for (const tab of tabs) {
    if (tab.groupId !== NO_GROUP && !firstTabByGroup.has(tab.groupId)) {
      firstTabByGroup.set(tab.groupId, tab);
    }
  }

  const map = new Map();
  for (const group of groups) {
    const firstTab = firstTabByGroup.get(group.id);
    if (!firstTab) continue;
    const domain = extractDomain(firstTab.url, bySub);
    if (!domain) continue;

    const managed = managedGroups.has(group.id) || group.title === formatDomainName(domain);
    if (managed && !map.has(domain)) {
      map.set(domain, group);
    }
  }
  return map;
}

// Create a new group for a domain and apply title/color/collapsed state
async function createDomainGroup(tabIds, domain, settings, collapsed) {
  const groupId = await retryTabOp(() => chrome.tabs.group({ tabIds }));
  await rememberManagedGroup(groupId);

  const updateProps = { title: formatDomainName(domain), collapsed };
  const color = await getColorForDomain(domain, settings);
  if (color) updateProps.color = color;

  await retryTabOp(() => chrome.tabGroups.update(groupId, updateProps));
  return groupId;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

// Group all tabs by domain in the current window
async function groupTabsByDomain() {
  const currentWindow = await chrome.windows.getCurrent();
  return withWindowLock(currentWindow.id, async () => {
    const settings = await getSettings();
    const bySub = settings.groupBySubdomain;

    const [tabs, groups, { managedGroups }] = await Promise.all([
      chrome.tabs.query({ windowId: currentWindow.id }),
      chrome.tabGroups.query({ windowId: currentWindow.id }),
      getSessionState()
    ]);

    const domainToGroup = buildDomainGroupMap(tabs, groups, bySub, managedGroups);
    const activeTab = tabs.find(t => t.active);

    // Bucket tabs by domain
    const domainTabs = new Map();
    for (const tab of tabs) {
      if (!isGroupableTab(tab, settings)) continue;
      const domain = extractDomain(tab.url, bySub);
      if (!domain || isDomainExcluded(domain, settings)) continue;

      if (!domainTabs.has(domain)) domainTabs.set(domain, []);
      domainTabs.get(domain).push(tab);
    }

    for (const [domain, domainTabList] of domainTabs) {
      const tabIds = domainTabList.map(t => t.id);
      try {
        const existingGroup = domainToGroup.get(domain);
        if (existingGroup) {
          // Add tabs to existing group - don't change its color or title
          const toAdd = domainTabList.filter(t => t.groupId !== existingGroup.id).map(t => t.id);
          if (toAdd.length > 0) {
            await retryTabOp(() => chrome.tabs.group({ tabIds: toAdd, groupId: existingGroup.id }));
          }
        } else {
          // Never collapse the group holding the active tab
          const containsActive = activeTab && tabIds.includes(activeTab.id);
          const collapsed = settings.autoCollapse && !containsActive;
          await createDomainGroup(tabIds, domain, settings, collapsed);
        }
      } catch (e) {
        // Tab may have been closed between querying and grouping
        console.warn(`Failed to group tabs for ${domain}:`, e.message);
      }
    }
  });
}

// Ungroup all tabs in current window
async function ungroupAllTabs() {
  const currentWindow = await chrome.windows.getCurrent();
  return withWindowLock(currentWindow.id, async () => {
    const tabs = await chrome.tabs.query({ windowId: currentWindow.id });
    const tabIds = tabs.filter(t => t.groupId !== NO_GROUP).map(t => t.id);
    if (tabIds.length === 0) return;
    try {
      await retryTabOp(() => chrome.tabs.ungroup(tabIds));
    } catch (e) {
      console.warn('Failed to ungroup tabs:', e.message);
    }
  });
}

// Domain of the active tab in the current window (for "Exclude current site")
async function getCurrentDomain() {
  const settings = await getSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || shouldIgnoreUrl(tab.url, settings)) return null;
  return extractDomain(tab.url, settings.groupBySubdomain);
}

// ---------------------------------------------------------------------------
// Auto-collapse
// ---------------------------------------------------------------------------

// Group ids whose collapsed state we are changing ourselves. tabGroups.onUpdated
// fires for those too; this lets us ignore our own updates deterministically
// instead of relying on a timing-based flag.
const selfUpdatedGroups = new Set();
let collapseTimer = null;

// Collapse all groups except the specified one (pass TAB_GROUP_ID_NONE to collapse all)
async function collapseOtherGroups(keepExpandedGroupId, windowId) {
  const settings = await getSettings();
  if (!settings.autoCollapse) return;

  // Clear any pending collapse
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }

  const doCollapse = async () => {
    collapseTimer = null;
    try {
      const groups = await chrome.tabGroups.query({ windowId });

      for (const group of groups) {
        const shouldCollapse = group.id !== keepExpandedGroupId;
        if (group.collapsed === shouldCollapse) continue;

        selfUpdatedGroups.add(group.id);
        try {
          await retryTabOp(() => chrome.tabGroups.update(group.id, { collapsed: shouldCollapse }));
        } finally {
          // The onUpdated event for this change is dispatched before the update
          // promise resolves, but keep a short grace period just in case.
          setTimeout(() => selfUpdatedGroups.delete(group.id), 250);
        }
      }
    } catch (e) {
      console.warn('Failed to collapse groups:', e.message);
    }
  };

  // Note: a plain timer can be lost if the service worker is suspended before it
  // fires. chrome.alarms has a 30s minimum, so for delays up to 5s this is the
  // best available option.
  const delay = settings.collapseDelay ?? 0;
  if (delay > 0) {
    collapseTimer = setTimeout(doCollapse, delay);
  } else {
    await doCollapse();
  }
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

// Handle keyboard commands
chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === 'group-tabs') {
      await groupTabsByDomain();
    } else if (command === 'ungroup-tabs') {
      await ungroupAllTabs();
    }
  } catch (e) {
    console.warn(`Command ${command} failed:`, e.message);
  }
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handlers = {
    groupTabs: () => groupTabsByDomain().then(() => ({ success: true })),
    ungroupTabs: () => ungroupAllTabs().then(() => ({ success: true })),
    getSettings: () => getSettings().then(settings => ({ success: true, settings })),
    saveSettings: () => saveSettings(message.settings ?? {}).then(() => ({ success: true })),
    getCurrentDomain: () => getCurrentDomain().then(domain => ({ success: true, domain }))
  };

  const handler = handlers[message.action];
  if (!handler) return false;

  handler()
    .then(sendResponse)
    .catch(e => sendResponse({ success: false, error: e.message }));
  return true;
});

// Listen for tab activation to auto-collapse other groups
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    await collapseOtherGroups(tab.groupId, tab.windowId);
  } catch (e) {
    console.warn('Failed to collapse groups on tab switch:', e.message);
  }
});

// Listen for group expansion (when user clicks on a group header)
chrome.tabGroups.onUpdated.addListener(async (group) => {
  // Only act when a group is expanded by the user, not by us
  if (group.collapsed || selfUpdatedGroups.has(group.id)) return;
  try {
    await collapseOtherGroups(group.id, group.windowId);
  } catch (e) {
    console.warn('Failed to collapse groups on group update:', e.message);
  }
});

// Auto-group tabs as they navigate
// Trigger on 'loading' (URL is known immediately) instead of 'complete' (waits for all resources)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading' || !changeInfo.url) return;

  withWindowLock(tab.windowId, async () => {
    const settings = await getSettings();
    if (!settings.autoGroup) return;

    const bySub = settings.groupBySubdomain;
    const groupable = isGroupableTab(tab, settings);
    const domain = groupable ? extractDomain(tab.url, bySub) : null;
    const excluded = domain ? isDomainExcluded(domain, settings) : false;

    const [allTabs, groups, { managedGroups }] = await Promise.all([
      chrome.tabs.query({ windowId: tab.windowId }),
      chrome.tabGroups.query({ windowId: tab.windowId }),
      getSessionState()
    ]);

    const domainToGroup = buildDomainGroupMap(allTabs, groups, bySub, managedGroups);
    // Re-read the tab from the fresh query; its groupId may have changed since the event
    const current = allTabs.find(t => t.id === tabId) ?? tab;
    let currentGroupId = current.groupId;

    // If the tab sits in one of our domain groups that no longer matches its
    // URL, take it out so it doesn't linger in the wrong group.
    if (currentGroupId !== NO_GROUP) {
      const isManaged = [...domainToGroup.values()].some(g => g.id === currentGroupId);
      const target = domain && !excluded ? domainToGroup.get(domain) : undefined;
      if (isManaged && target?.id !== currentGroupId) {
        await retryTabOp(() => chrome.tabs.ungroup(tabId));
        currentGroupId = NO_GROUP;
      }
    }

    if (!domain || excluded) return;

    // Existing group for this domain → join it
    const existingGroup = domainToGroup.get(domain);
    if (existingGroup) {
      if (currentGroupId !== existingGroup.id) {
        await retryTabOp(() => chrome.tabs.group({ tabIds: [tabId], groupId: existingGroup.id }));
      }
      return;
    }

    // Still in a user-created group: leave it alone
    if (currentGroupId !== NO_GROUP) return;

    // No existing group - gather ungrouped tabs with the same domain (including this one)
    const ungroupedSameDomain = allTabs.filter(t =>
      (t.id === tabId || t.groupId === NO_GROUP) &&
      isGroupableTab(t, settings) &&
      extractDomain(t.id === tabId ? tab.url : t.url, bySub) === domain
    );

    if (ungroupedSameDomain.length >= (settings.minTabsToGroup ?? 2)) {
      await createDomainGroup(ungroupedSameDomain.map(t => t.id), domain, settings, false);
    }
  }).catch(e => {
    console.warn(`Failed to auto-group tab ${tabId}:`, e.message);
  });
});

// Auto-ungroup orphaned groups (managed groups with only 1 tab left)
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (removeInfo.isWindowClosing) return;

  withWindowLock(removeInfo.windowId, async () => {
    const settings = await getSettings();
    if (!settings.autoUngroupOrphans) return;

    const [tabs, groups, { managedGroups }] = await Promise.all([
      chrome.tabs.query({ windowId: removeInfo.windowId }),
      chrome.tabGroups.query({ windowId: removeInfo.windowId }),
      getSessionState()
    ]);

    const managed = buildDomainGroupMap(tabs, groups, settings.groupBySubdomain, managedGroups);
    const managedIds = new Set([...managed.values()].map(g => g.id));

    const countByGroup = new Map();
    for (const t of tabs) {
      if (t.id === tabId || t.groupId === NO_GROUP) continue;
      countByGroup.set(t.groupId, (countByGroup.get(t.groupId) ?? 0) + 1);
    }

    for (const [groupId, count] of countByGroup) {
      if (count !== 1 || !managedIds.has(groupId)) continue;
      const lone = tabs.find(t => t.groupId === groupId && t.id !== tabId);
      if (lone) await retryTabOp(() => chrome.tabs.ungroup(lone.id));
    }
  }).catch(e => {
    console.warn('Failed to ungroup orphaned tab:', e.message);
  });
});

// Log when service worker starts
console.log('Smart Tab Grouper extension loaded');
