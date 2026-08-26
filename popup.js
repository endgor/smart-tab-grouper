// Elements
const groupBtn = document.getElementById('groupBtn');
const ungroupBtn = document.getElementById('ungroupBtn');
const autoCollapseToggle = document.getElementById('autoCollapse');
const collapseDelayInput = document.getElementById('collapseDelay');
const autoGroupToggle = document.getElementById('autoGroup');
const colorModeSelect = document.getElementById('colorMode');
const colorModeDesc = document.getElementById('colorModeDesc');
const collapseDelaySetting = document.getElementById('collapseDelaySetting');
const fixedColorSelect = document.getElementById('fixedColor');
const fixedColorSetting = document.getElementById('fixedColorSetting');
const fixedColorSwatch = document.getElementById('fixedColorSwatch');
const excludeCurrentBtn = document.getElementById('excludeCurrentBtn');
const excludeCurrentDomain = document.getElementById('excludeCurrentDomain');
const groupBySubdomainToggle = document.getElementById('groupBySubdomain');
const minTabsToGroupInput = document.getElementById('minTabsToGroup');
const autoUngroupOrphansToggle = document.getElementById('autoUngroupOrphans');
const newDomainInput = document.getElementById('newDomain');
const addDomainBtn = document.getElementById('addDomainBtn');
const excludedList = document.getElementById('excludedList');

// Current settings
let currentSettings = {};
let currentDomain = null;

const COLOR_MODE_DESC = {
  auto: 'Cycle through the palette',
  fixed: 'Every group gets the same color',
  default: 'Let Chrome choose'
};

// Send a message to the background and return its response, throwing on failure
async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.success) {
    throw new Error(response?.error ?? 'No response from background');
  }
  return response;
}

// Clamp a number input to its min/max attributes
function readNumber(input, fallback) {
  const value = parseInt(input.value, 10);
  if (Number.isNaN(value)) return fallback;
  const min = input.min !== '' ? Number(input.min) : -Infinity;
  const max = input.max !== '' ? Number(input.max) : Infinity;
  return Math.min(max, Math.max(min, value));
}

// Load settings on popup open
async function loadSettings() {
  try {
    ({ settings: currentSettings } = await sendMessage({ action: 'getSettings' }));
  } catch (e) {
    console.warn('Failed to load settings:', e.message);
    currentSettings = {};
  }

  autoCollapseToggle.checked = currentSettings.autoCollapse ?? true;
  collapseDelayInput.value = currentSettings.collapseDelay ?? 0;
  autoGroupToggle.checked = currentSettings.autoGroup ?? true;
  colorModeSelect.value = currentSettings.colorMode ?? 'auto';
  fixedColorSelect.value = currentSettings.fixedColor ?? 'grey';
  groupBySubdomainToggle.checked = currentSettings.groupBySubdomain ?? false;
  minTabsToGroupInput.value = currentSettings.minTabsToGroup ?? 2;
  autoUngroupOrphansToggle.checked = currentSettings.autoUngroupOrphans ?? true;

  updateDependentControls();
  renderExcludedDomains();
}

// Reflect relationships between controls
function updateDependentControls() {
  colorModeDesc.textContent = COLOR_MODE_DESC[colorModeSelect.value] ?? '';
  collapseDelaySetting.classList.toggle('disabled', !autoCollapseToggle.checked);
  fixedColorSetting.classList.toggle('hidden', colorModeSelect.value !== 'fixed');
  fixedColorSwatch.dataset.color = fixedColorSelect.value;
}

// Load the active tab's domain for the "Exclude current site" button
async function loadCurrentDomain() {
  try {
    ({ domain: currentDomain } = await sendMessage({ action: 'getCurrentDomain' }));
  } catch {
    currentDomain = null;
  }
  updateExcludeCurrentButton();
}

function updateExcludeCurrentButton() {
  const excluded = currentDomain && (currentSettings.excludedDomains ?? []).includes(currentDomain);
  excludeCurrentBtn.disabled = !currentDomain || excluded;
  excludeCurrentDomain.textContent = currentDomain ? (excluded ? `${currentDomain} excluded` : currentDomain) : '';
}

// Save settings
async function saveSettings() {
  currentSettings = {
    ...currentSettings,
    autoCollapse: autoCollapseToggle.checked,
    collapseDelay: readNumber(collapseDelayInput, 0),
    autoGroup: autoGroupToggle.checked,
    colorMode: colorModeSelect.value,
    fixedColor: fixedColorSelect.value,
    groupBySubdomain: groupBySubdomainToggle.checked,
    minTabsToGroup: readNumber(minTabsToGroupInput, 2),
    autoUngroupOrphans: autoUngroupOrphansToggle.checked
  };

  updateDependentControls();
  await persistSettings();
}

// Persist current settings; the background keeps only the keys the UI owns
async function persistSettings() {
  try {
    await sendMessage({ action: 'saveSettings', settings: currentSettings });
  } catch (e) {
    console.warn('Failed to save settings:', e.message);
  }
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

// Add a domain to the excluded list (no-op if already present)
async function excludeDomain(domain) {
  if (!domain) return;
  if (!currentSettings.excludedDomains) {
    currentSettings.excludedDomains = [];
  }
  if (!currentSettings.excludedDomains.includes(domain)) {
    currentSettings.excludedDomains.push(domain);
    await persistSettings();
  }
  renderExcludedDomains();
  updateExcludeCurrentButton();
}

// Add the typed domain to the excluded list
async function addExcludedDomain() {
  let domain = newDomainInput.value.trim().toLowerCase();

  // Remove protocol if present
  domain = domain.replace(/^(https?:\/\/)?(www\.)?/, '');
  // Remove trailing slashes and paths
  domain = domain.split('/')[0];

  newDomainInput.value = '';
  await excludeDomain(domain);
}

// Remove domain from excluded list
async function removeExcludedDomain(domain) {
  if (!currentSettings.excludedDomains) return;

  currentSettings.excludedDomains = currentSettings.excludedDomains.filter(d => d !== domain);
  await persistSettings();

  renderExcludedDomains();
  updateExcludeCurrentButton();
}

// Run an action and flash the button green on success
async function runAction(button, action) {
  button.disabled = true;
  try {
    await sendMessage({ action });
    button.classList.add('success');
    setTimeout(() => button.classList.remove('success'), 600);
  } catch (e) {
    console.warn(`${action} failed:`, e.message);
  } finally {
    button.disabled = false;
  }
}

// Event listeners
groupBtn.addEventListener('click', () => runAction(groupBtn, 'groupTabs'));
ungroupBtn.addEventListener('click', () => runAction(ungroupBtn, 'ungroupTabs'));

for (const el of [
  autoCollapseToggle, collapseDelayInput, autoGroupToggle, colorModeSelect, fixedColorSelect,
  groupBySubdomainToggle, minTabsToGroupInput, autoUngroupOrphansToggle
]) {
  el.addEventListener('change', saveSettings);
}

excludeCurrentBtn.addEventListener('click', () => excludeDomain(currentDomain));
addDomainBtn.addEventListener('click', addExcludedDomain);

newDomainInput.addEventListener('keydown', (e) => {
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
loadSettings().then(loadCurrentDomain);
