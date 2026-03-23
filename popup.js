// Elements
const groupBtn = document.getElementById('groupBtn');
const ungroupBtn = document.getElementById('ungroupBtn');
const autoCollapseToggle = document.getElementById('autoCollapse');
const collapseDelayInput = document.getElementById('collapseDelay');
const autoGroupToggle = document.getElementById('autoGroup');
const groupColorsToggle = document.getElementById('groupColors');
const ignorePinnedToggle = document.getElementById('ignorePinned');
const groupBySubdomainToggle = document.getElementById('groupBySubdomain');
const minTabsToGroupInput = document.getElementById('minTabsToGroup');
const autoUngroupOrphansToggle = document.getElementById('autoUngroupOrphans');
const newDomainInput = document.getElementById('newDomain');
const addDomainBtn = document.getElementById('addDomainBtn');
const excludedList = document.getElementById('excludedList');

// Current settings
let currentSettings = {};

// Load settings on popup open
async function loadSettings() {
  currentSettings = await chrome.runtime.sendMessage({ action: 'getSettings' });

  autoCollapseToggle.checked = currentSettings.autoCollapse ?? true;
  collapseDelayInput.value = currentSettings.collapseDelay ?? 0;
  autoGroupToggle.checked = currentSettings.autoGroup ?? true;
  groupColorsToggle.checked = currentSettings.groupColors ?? true;
  ignorePinnedToggle.checked = currentSettings.ignorePinned ?? true;
  groupBySubdomainToggle.checked = currentSettings.groupBySubdomain ?? false;
  minTabsToGroupInput.value = currentSettings.minTabsToGroup ?? 2;
  autoUngroupOrphansToggle.checked = currentSettings.autoUngroupOrphans ?? true;

  renderExcludedDomains();
}

// Save settings
async function saveSettings() {
  currentSettings = {
    ...currentSettings,
    autoCollapse: autoCollapseToggle.checked,
    collapseDelay: parseInt(collapseDelayInput.value, 10) || 0,
    autoGroup: autoGroupToggle.checked,
    groupColors: groupColorsToggle.checked,
    ignorePinned: ignorePinnedToggle.checked,
    groupBySubdomain: groupBySubdomainToggle.checked,
    minTabsToGroup: Math.max(2, parseInt(minTabsToGroupInput.value, 10) || 2),
    autoUngroupOrphans: autoUngroupOrphansToggle.checked
  };

  await chrome.runtime.sendMessage({ action: 'saveSettings', settings: currentSettings });
}

// Render excluded domains list
function renderExcludedDomains() {
  excludedList.innerHTML = '';

  const domains = currentSettings.excludedDomains || [];
  domains.forEach(domain => {
    const li = document.createElement('li');
    li.className = 'excluded-item';

    const span = document.createElement('span');
    span.textContent = domain;

    const btn = document.createElement('button');
    btn.className = 'btn-remove';
    btn.dataset.domain = domain;
    btn.title = 'Remove';
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    `;

    li.appendChild(span);
    li.appendChild(btn);
    excludedList.appendChild(li);
  });
}

// Add domain to excluded list
async function addExcludedDomain() {
  let domain = newDomainInput.value.trim().toLowerCase();

  // Remove protocol if present
  domain = domain.replace(/^(https?:\/\/)?(www\.)?/, '');
  // Remove trailing slashes and paths
  domain = domain.split('/')[0];

  if (!domain) return;

  // Check if already excluded
  if (!currentSettings.excludedDomains) {
    currentSettings.excludedDomains = [];
  }

  if (currentSettings.excludedDomains.includes(domain)) {
    newDomainInput.value = '';
    return;
  }

  currentSettings.excludedDomains.push(domain);
  await chrome.runtime.sendMessage({ action: 'saveSettings', settings: currentSettings });

  newDomainInput.value = '';
  renderExcludedDomains();
}

// Remove domain from excluded list
async function removeExcludedDomain(domain) {
  if (!currentSettings.excludedDomains) return;

  currentSettings.excludedDomains = currentSettings.excludedDomains.filter(d => d !== domain);
  await chrome.runtime.sendMessage({ action: 'saveSettings', settings: currentSettings });

  renderExcludedDomains();
}

// Show success feedback on button
function showSuccess(button) {
  button.classList.add('success');
  setTimeout(() => {
    button.classList.remove('success');
  }, 600);
}

// Event listeners
groupBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'groupTabs' });
  showSuccess(groupBtn);
});

ungroupBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'ungroupTabs' });
  showSuccess(ungroupBtn);
});

autoCollapseToggle.addEventListener('change', saveSettings);
collapseDelayInput.addEventListener('change', saveSettings);
autoGroupToggle.addEventListener('change', saveSettings);
groupColorsToggle.addEventListener('change', saveSettings);
ignorePinnedToggle.addEventListener('change', saveSettings);
groupBySubdomainToggle.addEventListener('change', saveSettings);
minTabsToGroupInput.addEventListener('change', saveSettings);
autoUngroupOrphansToggle.addEventListener('change', saveSettings);

addDomainBtn.addEventListener('click', addExcludedDomain);

newDomainInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addExcludedDomain();
  }
});

excludedList.addEventListener('click', (e) => {
  const removeBtn = e.target.closest('.btn-remove');
  if (removeBtn) {
    const domain = removeBtn.dataset.domain;
    removeExcludedDomain(domain);
  }
});

// Show platform-appropriate keyboard shortcut
const isMac = (navigator.userAgentData?.platform ?? navigator.platform).toUpperCase().includes('MAC');
document.getElementById(isMac ? 'shortcutMac' : 'shortcutOther').style.display = '';

// Initialize
loadSettings();
