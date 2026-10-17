// RPG Adventure - Flask Frontend JavaScript
//
// "+ New Game" adds a new tab INSIDE the page. Every tab is its own game with its own
// session id, chat, settings and buttons state, so several games can run at the same time.
// With only one tab the tab bar stays hidden, so the page looks exactly as before.

const MAX_TABS = 6; // browsers allow about 6 parallel connections per server
const DEFAULT_STATUS = 'Ready to start your adventure. Configure your AI provider, then click <strong>Start Game</strong> or <strong>Auto-play All Steps</strong>.';

const tabs = [];
let activeTabId = null;
let tabCounter = 0;
let selectedContinueMode = 'manual'; // 'manual' or 'auto'
let modalTab = null;                 // tab the Continue dialog was opened for
let settingsLoadToken = 0;
const providerCache = new Map();

// DOM Elements
const providerSelect = document.getElementById('providerSelect');
const modelSelect = document.getElementById('modelSelect');
const apiKeyInput = document.getElementById('apiKey');
const apiUrlInput = document.getElementById('apiUrl');
const stepsSlider = document.getElementById('stepsSlider');
const stepsValue = document.getElementById('stepsValue');
const delaySlider = document.getElementById('delaySlider');
const delayValue = document.getElementById('delayValue');
const repetitionsSlider = document.getElementById('repetitionsSlider');
const repetitionsValue = document.getElementById('repetitionsValue');
const chatbox = document.getElementById('chatbox');
const statusBar = document.getElementById('statusBar');
const modelBadge = document.getElementById('modelBadge');
const tabBar = document.getElementById('tabBar');
const startBtn = document.getElementById('startBtn');
const nextBtn = document.getElementById('nextBtn');
const autoplayBtn = document.getElementById('autoplayBtn');
const stopBtn = document.getElementById('stopBtn');
const resumeBtn = document.getElementById('resumeBtn');
const continueBtn = document.getElementById('continueBtn');
const newGameBtn = document.getElementById('newGameBtn');
const resetBtn = document.getElementById('resetBtn');

// Modal Elements
const continueModal = document.getElementById('continueModal');
const closeModal = document.getElementById('closeModal');
const addStepsInput = document.getElementById('addStepsInput');
const modeManual = document.getElementById('modeManual');
const modeAuto = document.getElementById('modeAuto');
const cancelContinue = document.getElementById('cancelContinue');
const confirmContinue = document.getElementById('confirmContinue');

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    updateSliderLabels();

    const config = await getProviderConfig(providerSelect.value);
    if (config) populateModels(config, null);

    const first = createTab(readSettingsFromUI());
    activeTabId = first.id;
    updateBadge(first);
    renderTabs();
    refreshControls();
});

function setupEventListeners() {
    // Provider change
    providerSelect.addEventListener('change', async () => {
        const config = await getProviderConfig(providerSelect.value);
        if (!config) return;
        populateModels(config, null);
        syncSettingsFromUI();
    });

    // Sidebar settings belong to the tab you are looking at
    modelSelect.addEventListener('change', syncSettingsFromUI);
    apiKeyInput.addEventListener('input', syncSettingsFromUI);
    apiUrlInput.addEventListener('input', syncSettingsFromUI);
    stepsSlider.addEventListener('input', () => { updateSliderLabels(); syncSettingsFromUI(); });
    delaySlider.addEventListener('input', () => { updateSliderLabels(); syncSettingsFromUI(); });
    repetitionsSlider.addEventListener('input', () => { updateSliderLabels(); syncSettingsFromUI(); });

    // Buttons (always act on the tab you are looking at)
    startBtn.addEventListener('click', () => startGame(activeTab()));
    nextBtn.addEventListener('click', () => nextStep(activeTab()));
    autoplayBtn.addEventListener('click', () => autoplay(activeTab()));
    stopBtn.addEventListener('click', () => stopAutoplay(activeTab()));
    resumeBtn.addEventListener('click', () => resumeAutoplay(activeTab()));
    continueBtn.addEventListener('click', showContinueModal);
    newGameBtn.addEventListener('click', addTab);            // "+ New Game" = new tab in the app
    resetBtn.addEventListener('click', () => resetGame(activeTab()));

    // Tab bar (event delegation)
    tabBar.addEventListener('click', (e) => {
        if (e.target.closest('.tab-add')) {
            addTab();
            return;
        }
        const tabEl = e.target.closest('.game-tab');
        if (!tabEl) return;
        if (e.target.closest('.tab-close')) {
            closeTab(tabEl.dataset.id);
        } else {
            switchTab(tabEl.dataset.id);
        }
    });

    // Modal events
    closeModal.addEventListener('click', hideContinueModal);
    cancelContinue.addEventListener('click', hideContinueModal);
    confirmContinue.addEventListener('click', confirmContinueStory);

    // Mode selection
    modeManual.addEventListener('click', () => selectMode('manual'));
    modeAuto.addEventListener('click', () => selectMode('auto'));

    // Close modal on outside click
    continueModal.addEventListener('click', (e) => {
        if (e.target === continueModal) {
            hideContinueModal();
        }
    });

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && continueModal.classList.contains('active')) {
            hideContinueModal();
        }
    });
}

// ---------------------------------------------------------------------------
// Tab management
// ---------------------------------------------------------------------------
function readSettingsFromUI() {
    return {
        provider: providerSelect.value,
        model: modelSelect.value,
        apiKey: apiKeyInput.value,
        apiUrl: apiUrlInput.value,
        steps: parseInt(stepsSlider.value),
        stepsMax: parseInt(stepsSlider.max),
        delay: parseInt(delaySlider.value),
        repetitions: parseInt(repetitionsSlider.value) || 0,
    };
}

function createTab(settings) {
    tabCounter++;
    const tab = {
        id: 'session_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        title: 'Game ' + tabCounter,
        holder: document.createElement('div'), // keeps this tab's messages while it is in the background
        settings: { ...settings },
        isProcessing: false,
        gameStarted: false,
        isAutoPlaying: false,
        storyComplete: false,
        autoplayStopped: false,
        hasError: false,
        abortController: null,
        currentStep: 0,
        totalRuns: 1,                 // games in the current auto-play series (1 + repetitions)
        currentRun: 1,                // game of the series that is running / was running last
        runsFinished: 0,              // games of the series that are completely finished
        epoch: 0,                     // bumped on reset/close so stale async code can detect it
        statusHtml: DEFAULT_STATUS,
    };
    tabs.push(tab);
    return tab;
}

function getTab(id) {
    return tabs.find(t => t.id === id) || null;
}

function activeTab() {
    return getTab(activeTabId);
}

function isActive(tab) {
    return tab.id === activeTabId;
}

// The element that currently holds this tab's messages
function messageBox(tab) {
    return isActive(tab) ? chatbox : tab.holder;
}

function addTab() {
    const current = activeTab();
    if (tabs.length >= MAX_TABS) {
        if (current) setStatus(current, `<strong>Status:</strong> Maximum of ${MAX_TABS} game tabs reached. Close one to open another.`);
        return;
    }
    // New game: same provider / model / key as the current tab, but a fresh 10-step game
    const base = current ? current.settings : readSettingsFromUI();
    const tab = createTab({ ...base, steps: 10, stepsMax: 20, repetitions: 0 });
    switchTab(tab.id);
}

async function switchTab(id) {
    if (id === activeTabId) return;
    const next = getTab(id);
    if (!next) return;

    // Move the visible messages into the outgoing tab's holder and bring in the new tab's.
    // Synchronous, so streaming callbacks can never interleave with it.
    const prev = activeTab();
    if (prev) {
        while (chatbox.firstChild) prev.holder.appendChild(chatbox.firstChild);
    }
    activeTabId = id;
    while (next.holder.firstChild) chatbox.appendChild(next.holder.firstChild);
    chatbox.scrollTop = chatbox.scrollHeight;

    statusBar.innerHTML = next.statusHtml;
    renderTabs();
    refreshControls();
    await applySettingsToUI(next);
}

async function closeTab(id) {
    const tab = getTab(id);
    if (!tab) return;

    if (tab.isProcessing && !confirm(`"${tab.title}" is still running. Close it anyway?`)) {
        return;
    }

    // Closing the only tab just resets it
    if (tabs.length === 1) {
        await resetGame(tab);
        return;
    }

    tab.epoch++;
    if (tab.abortController) tab.abortController.abort();
    fetch('/api/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: tab.id })
    }).catch(() => {});

    const idx = tabs.indexOf(tab);
    tabs.splice(idx, 1);

    if (id === activeTabId) {
        chatbox.innerHTML = ''; // these messages belonged to the closed tab
        activeTabId = null;
        await switchTab(tabs[Math.min(idx, tabs.length - 1)].id);
    } else {
        renderTabs();
    }
}

function renderTabs() {
    // With a single game the bar stays hidden, so the page looks like it always did
    tabBar.style.display = tabs.length > 1 ? 'flex' : 'none';
    tabBar.innerHTML = '';

    tabs.forEach(tab => {
        const el = document.createElement('div');
        el.className = 'game-tab'
            + (isActive(tab) ? ' active' : '')
            + (tab.isProcessing ? ' running' : '')
            + (tab.storyComplete && !tab.isProcessing ? ' done' : '')
            + (tab.hasError ? ' error' : '');
        el.dataset.id = tab.id;
        el.setAttribute('role', 'tab');

        const dot = document.createElement('span');
        dot.className = 'tab-dot';

        const title = document.createElement('span');
        title.className = 'tab-title';
        title.textContent = tab.title;

        const close = document.createElement('button');
        close.className = 'tab-close';
        close.type = 'button';
        close.title = 'Close tab';
        close.setAttribute('aria-label', `Close ${tab.title}`);
        close.innerHTML = '&times;';

        el.append(dot, title, close);
        tabBar.appendChild(el);
    });

    const add = document.createElement('button');
    add.className = 'tab-add';
    add.type = 'button';
    add.title = 'New game tab';
    add.textContent = '+';
    add.disabled = tabs.length >= MAX_TABS;
    tabBar.appendChild(add);
}

// ---------------------------------------------------------------------------
// Sidebar <-> tab settings
// ---------------------------------------------------------------------------
async function getProviderConfig(provider) {
    if (providerCache.has(provider)) return providerCache.get(provider);
    try {
        const response = await fetch(`/api/provider/${encodeURIComponent(provider)}`);
        const config = await response.json();
        providerCache.set(provider, config);
        return config;
    } catch (error) {
        console.error('Error loading provider config:', error);
        return null;
    }
}

function populateModels(config, preferredModel) {
    modelSelect.innerHTML = '';
    config.models.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        modelSelect.appendChild(option);
    });

    const wanted = preferredModel && config.models.includes(preferredModel)
        ? preferredModel
        : config.default_model;
    modelSelect.value = wanted;

    // Show/hide API key based on requirement
    apiKeyInput.style.display = config.requires_key ? 'block' : 'none';
}

async function applySettingsToUI(tab) {
    const token = ++settingsLoadToken;
    const s = tab.settings;

    providerSelect.value = s.provider;
    const config = await getProviderConfig(s.provider);
    if (token !== settingsLoadToken || !config) return; // user switched again meanwhile

    populateModels(config, s.model);
    s.model = modelSelect.value;
    apiKeyInput.value = s.apiKey;
    apiUrlInput.value = s.apiUrl;
    stepsSlider.max = s.stepsMax; // max first, then value
    stepsSlider.value = s.steps;
    delaySlider.value = s.delay;
    repetitionsSlider.value = s.repetitions || 0;
    updateSliderLabels();
    updateBadge(tab);
}

function syncSettingsFromUI() {
    const tab = activeTab();
    if (!tab) return;
    tab.settings = { ...tab.settings, ...readSettingsFromUI() };
    updateBadge(tab);
}

function updateBadge(tab) {
    if (isActive(tab)) {
        modelBadge.textContent = `${tab.settings.provider} - ${tab.settings.model}`;
    }
}

function updateSliderLabels() {
    stepsValue.textContent = stepsSlider.value;
    delayValue.textContent = delaySlider.value;
    repetitionsValue.textContent = repetitionsSlider.value;
}

function setTabSteps(tab, steps, max) {
    tab.settings.steps = steps;
    tab.settings.stepsMax = max !== undefined ? max : Math.max(tab.settings.stepsMax, 20, steps);
    if (isActive(tab)) {
        stepsSlider.max = tab.settings.stepsMax;
        stepsSlider.value = steps;
        updateSliderLabels();
    }
}

// ---------------------------------------------------------------------------
// Per-tab UI helpers
// ---------------------------------------------------------------------------
function setStatus(tab, message) {
    tab.statusHtml = message;
    if (isActive(tab)) statusBar.innerHTML = message;
}

function setProcessing(tab, processing) {
    tab.isProcessing = processing;
    renderTabs();
    if (isActive(tab)) refreshControls();
}

// Update the button row to reflect the tab you are looking at
function refreshControls() {
    const tab = activeTab();
    if (!tab) return;

    startBtn.disabled = tab.isProcessing || tab.gameStarted;
    nextBtn.disabled = tab.isProcessing || !tab.gameStarted || tab.storyComplete;
    autoplayBtn.disabled = tab.isProcessing || tab.gameStarted;

    // Show/hide stop button based on auto-play state
    stopBtn.style.display = tab.isAutoPlaying ? 'block' : 'none';

    // Show resume button when auto-play was stopped (and not complete)
    resumeBtn.style.display = (tab.autoplayStopped && !tab.storyComplete && !tab.isAutoPlaying) ? 'block' : 'none';

    // Show continue button when story is complete
    continueBtn.style.display = tab.storyComplete ? 'block' : 'none';
}

function addMessage(tab, role, content) {
    const box = messageBox(tab);
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    messageDiv.innerHTML = formatContent(content);
    box.appendChild(messageDiv);
    if (isActive(tab)) box.scrollTop = box.scrollHeight;
    return messageDiv;
}

function updateLastBotMessage(tab, content) {
    const box = messageBox(tab);
    const messages = box.querySelectorAll('.message.bot');
    if (messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        lastMessage.innerHTML = formatContent(content);
        if (isActive(tab)) box.scrollTop = box.scrollHeight;
    }
}

function formatContent(content) {
    // Basic markdown-like formatting
    return content
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
}

function clearChat(tab) {
    removeLoader(tab);
    messageBox(tab).innerHTML = '';
}

// ---------------------------------------------------------------------------
// Loader: a Game Master bubble with animated dots, shown while we wait for the AI,
// so the player can see that something is happening and nothing has failed.
// ---------------------------------------------------------------------------
const LOADER_TEXT = 'The Game Master is writing the next scene...';
const LOADER_SLOW_TEXT = 'Still working... the model is taking a while (normal for local models or the first request).';

function showLoader(tab, text) {
    if (tab.loaderEl && tab.loaderEl.parentNode) return tab.loaderEl;   // already showing
    const el = addMessage(tab, 'bot', '');
    el.classList.add('loading');
    el.innerHTML = '<span class="typing"><span class="typing-dots"><span></span><span></span><span></span></span>'
                 + '<span class="typing-text"></span></span>';
    const label = el.querySelector('.typing-text');
    label.textContent = text || LOADER_TEXT;
    tab.loaderEl = el;
    tab.loaderTimer = setTimeout(() => { label.textContent = LOADER_SLOW_TEXT; }, 20000);
    return el;
}

// The player's choice arrives before the AI's text: show it in front of the loader bubble,
// which keeps spinning until the reply really starts.
function addChoice(tab, choice) {
    if (!choice) return;
    const el = (tab.loaderEl && tab.loaderEl.parentNode) ? tab.loaderEl : null;
    if (!el) { addMessage(tab, 'user', String(choice)); return; }
    const user = document.createElement('div');
    user.className = 'message user';
    user.innerHTML = formatContent(String(choice));
    el.parentNode.insertBefore(user, el);
}

// The reply text has started: turn the loader bubble into the real Game Master bubble.
function takeLoader(tab) {
    const el = (tab.loaderEl && tab.loaderEl.parentNode) ? tab.loaderEl : null;
    clearTimeout(tab.loaderTimer);
    tab.loaderEl = null;
    if (el) {
        el.classList.remove('loading');
        el.innerHTML = '';
        return el;
    }
    return addMessage(tab, 'bot', '');
}

function removeLoader(tab) {
    clearTimeout(tab.loaderTimer);
    if (tab.loaderEl && tab.loaderEl.parentNode) tab.loaderEl.remove();
    tab.loaderEl = null;
}

function getRequestData(tab) {
    const s = tab.settings;
    return {
        provider: s.provider,
        model: s.model,
        api_key: s.apiKey,
        api_url: s.apiUrl,
        max_steps: s.steps,
        delay: s.delay,
        session_id: tab.id
    };
}

// ---------------------------------------------------------------------------
// SSE reader: buffers network chunks and only parses COMPLETE events.
// A network chunk can end in the middle of a JSON payload; parsing it directly
// causes "Unterminated string in JSON". Events end with a blank line (\n\n).
// Only JSON.parse is inside try/catch, so errors thrown by onEvent (for example
// a server-reported error) still propagate to the caller.
// ---------------------------------------------------------------------------
async function readSSE(response, onEvent) {
    if (!response.body) {
        throw new Error('No response body from server');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const dispatch = (rawEvent) => {
        for (const line of rawEvent.split('\n')) {
            if (!line.startsWith('data: ')) continue;

            let data;
            try {
                data = JSON.parse(line.slice(6));
            } catch (e) {
                console.error('Bad SSE payload:', e, line.slice(0, 200));
                continue;
            }
            onEvent(data);
        }
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            dispatch(rawEvent);
        }
    }

    // Flush anything left over at end of stream
    buffer += decoder.decode();
    if (buffer.trim()) {
        dispatch(buffer);
    }
}

// ---------------------------------------------------------------------------
// Continue-story modal (acts on the tab that was visible when it was opened)
// ---------------------------------------------------------------------------
function showContinueModal() {
    modalTab = activeTab();
    continueModal.classList.add('active');
    addStepsInput.value = 5;
    selectMode('manual');
}

function hideContinueModal() {
    continueModal.classList.remove('active');
}

function selectMode(mode) {
    selectedContinueMode = mode;
    modeManual.classList.toggle('active', mode === 'manual');
    modeAuto.classList.toggle('active', mode === 'auto');
}

function confirmContinueStory() {
    const stepsToAdd = parseInt(addStepsInput.value) || 5;
    const tab = modalTab && tabs.includes(modalTab) ? modalTab : activeTab();
    hideContinueModal();
    if (!tab) return;

    if (selectedContinueMode === 'auto') {
        continueWithAutoplay(tab, stepsToAdd);
    } else {
        continueStoryManual(tab, stepsToAdd);
    }
}

// ---------------------------------------------------------------------------
// Game actions
// ---------------------------------------------------------------------------
async function startGame(tab) {
    if (!tab || tab.isProcessing) return;

    const epoch = tab.epoch;
    tab.storyComplete = false;
    tab.autoplayStopped = false;
    tab.hasError = false;
    tab.currentStep = 0;

    setProcessing(tab, true);
    clearChat(tab);
    setStatus(tab, '<strong>Status:</strong> Starting adventure...');
    updateBadge(tab);

    let currentContent = '';
    showLoader(tab, 'The Game Master is setting the scene...');

    try {
        const response = await fetch('/api/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(getRequestData(tab))
        });

        await readSSE(response, (data) => {
            if (data.type === 'chunk') {
                if (data.content && tab.loaderEl) takeLoader(tab);
                currentContent += data.content;
                updateLastBotMessage(tab, currentContent);
            } else if (data.type === 'done') {
                tab.gameStarted = true;
                setStatus(tab, `<strong>Status:</strong> Game started. Step ${data.step}/${tab.settings.steps} - press "Next Step" to play`);
            } else if (data.type === 'error') {
                removeLoader(tab);
                tab.hasError = true;
                setStatus(tab, `<strong>Error:</strong> ${data.message}`);
            }
        });
    } catch (error) {
        tab.hasError = true;
        setStatus(tab, `<strong>Error:</strong> ${error.message}`);
    }

    if (tab.epoch !== epoch) return; // tab was reset or closed meanwhile
    removeLoader(tab);
    setProcessing(tab, false);
}

async function nextStep(tab) {
    if (!tab || tab.isProcessing || !tab.gameStarted) return;

    const epoch = tab.epoch;
    // Clear the autoplayStopped flag when manually stepping
    tab.autoplayStopped = false;
    tab.hasError = false;

    setProcessing(tab, true);
    setStatus(tab, '<strong>Status:</strong> Taking next step...');

    let currentContent = '';
    showLoader(tab);

    try {
        const response = await fetch('/api/step', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(getRequestData(tab))
        });

        let messageAdded = false;

        await readSSE(response, (data) => {
            if (data.type === 'chunk') {
                if (!messageAdded) {
                    // Player choice goes in front of the loader (none when the GM is just continuing the story)
                    addChoice(tab, data.choice);
                    messageAdded = true;
                }
                if (data.content) {
                    if (tab.loaderEl) takeLoader(tab);
                    currentContent += data.content;
                    updateLastBotMessage(tab, currentContent);
                }
            } else if (data.type === 'done') {
                tab.currentStep = data.step;
                if (data.complete) {
                    tab.storyComplete = true;
                    setStatus(tab, `<strong>Status:</strong> Adventure complete! (${data.step} steps) - Click "Add Custom Steps..." to keep going`);
                } else {
                    setStatus(tab, `<strong>Status:</strong> Step ${data.step}/${tab.settings.steps}`);
                }
            } else if (data.type === 'error') {
                removeLoader(tab);
                tab.hasError = true;
                setStatus(tab, `<strong>Error:</strong> ${data.message}`);
            }
        });
    } catch (error) {
        tab.hasError = true;
        setStatus(tab, `<strong>Error:</strong> ${error.message}`);
    }

    if (tab.epoch !== epoch) return;
    removeLoader(tab);
    setProcessing(tab, false);
}

function runLabel(tab) {
    return tab.totalRuns > 1 ? `Game ${tab.currentRun}/${tab.totalRuns} · ` : '';
}

async function autoplay(tab) {
    if (!tab || tab.isProcessing) return;

    const epoch = tab.epoch;
    tab.isAutoPlaying = true;
    tab.storyComplete = false;
    tab.autoplayStopped = false;
    tab.hasError = false;
    tab.currentStep = 0;
    tab.totalRuns = 1 + (tab.settings.repetitions || 0);   // repetitions = extra games after the first
    tab.currentRun = 1;
    tab.runsFinished = 0;
    tab.abortController = new AbortController();

    setProcessing(tab, true);
    clearChat(tab);
    setStatus(tab, '<strong>Status:</strong> Auto-play starting...');
    updateBadge(tab);
    showLoader(tab, 'Starting the adventure...');

    await streamAutoplay(tab, epoch, tab.totalRuns, 1);
}

// Plays `runs` complete games in a row on the server (each one reset + started fresh).
// Used by Auto-play and by Resume when whole games are still left.
async function streamAutoplay(tab, epoch, runs, firstRun) {
    let currentContent = '';
    let currentStep = 0;

    try {
        const response = await fetch('/api/autoplay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...getRequestData(tab), runs, first_run: firstRun, total_runs: tab.totalRuns }),
            signal: tab.abortController.signal
        });

        let bubbleOpen = false;   // true while a reply bubble is being filled
        let choiceShown = false;  // the player's pick of the current step is already on screen

        await readSSE(response, (data) => {
            if (data.type === 'run_start') {
                // A new game of the series: the game was reset, start with an empty chat
                tab.currentRun = data.run;
                tab.currentStep = 0;
                currentStep = 0;
                tab.gameStarted = false;
                bubbleOpen = false;
                choiceShown = false;
                currentContent = '';
                clearChat(tab);
                showLoader(tab, 'Starting the adventure...');
                setStatus(tab, `<strong>Status:</strong> ${runLabel(tab)}Starting adventure...`);
                renderTabs();
            } else if (data.type === 'status') {
                setStatus(tab, `<strong>Status:</strong> ${runLabel(tab)}${data.message}`);
                if (!bubbleOpen) showLoader(tab);   // a new step is starting: show that the AI is working
            } else if (data.type === 'chunk') {
                if (!choiceShown) { addChoice(tab, data.choice); choiceShown = true; }
                if (data.content) {
                    if (!bubbleOpen) { takeLoader(tab); currentContent = ''; bubbleOpen = true; }
                    currentContent += data.content;
                    updateLastBotMessage(tab, currentContent);
                }
            } else if (data.type === 'step_done') {
                currentStep = data.step;
                tab.currentStep = currentStep;
                setStatus(tab, `<strong>Status:</strong> ${runLabel(tab)}Auto-play Step ${currentStep}/${tab.settings.steps}`);
                bubbleOpen = false;
                choiceShown = false;
                currentContent = '';
                tab.gameStarted = true;
            } else if (data.type === 'run_complete') {
                tab.runsFinished = data.run;
            } else if (data.type === 'complete') {
                tab.storyComplete = true;
                const games = tab.totalRuns > 1 ? `All ${tab.totalRuns} games complete` : 'Auto-play complete';
                setStatus(tab, `<strong>Status:</strong> ${games}! (${data.step} steps${tab.totalRuns > 1 ? ' in the last game' : ''}) - Click "Add Custom Steps..." to keep going`);
            } else if (data.type === 'error') {
                removeLoader(tab);
                tab.hasError = true;
                setStatus(tab, `<strong>Error:</strong> ${runLabel(tab)}${data.message}`);
            }
        });
    } catch (error) {
        if (tab.epoch !== epoch) return; // tab was reset/closed
        if (error.name === 'AbortError') {
            tab.autoplayStopped = true;
            setStatus(tab, `<strong>Status:</strong> ${runLabel(tab)}Auto-play paused at step ${currentStep}. Click "Resume Auto-play" to continue automatically or "Next Step" to play manually.`);
        } else {
            tab.hasError = true;
            setStatus(tab, `<strong>Error:</strong> ${error.message}`);
        }
    }

    if (tab.epoch !== epoch) return;
    removeLoader(tab);
    tab.isAutoPlaying = false;
    tab.abortController = null;
    setProcessing(tab, false);
}

function stopAutoplay(tab) {
    if (tab && tab.abortController) {
        tab.abortController.abort();
        tab.isAutoPlaying = false;
        setStatus(tab, '<strong>Status:</strong> Stopping auto-play...');
        renderTabs();
        if (isActive(tab)) refreshControls();
    }
}

// Shared loop for Resume and "continue with auto-play": take /api/step until targetSteps.
// Returns false when the tab was reset/closed while it was running.
async function runStepLoop(tab, targetSteps, label) {
    const epoch = tab.epoch;
    let currentContent = '';

    try {
        while (tab.currentStep < targetSteps) {
            if (tab.abortController.signal.aborted) break;

            showLoader(tab);
            const response = await fetch('/api/step', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(getRequestData(tab)),
                signal: tab.abortController.signal
            });

            let messageAdded = false;
            currentContent = '';

            await readSSE(response, (data) => {
                if (data.type === 'chunk') {
                    if (!messageAdded) {
                        // Player choice is missing when the GM is just continuing a finished story
                        addChoice(tab, data.choice);
                        messageAdded = true;
                    }
                    if (data.content) {
                        if (tab.loaderEl) takeLoader(tab);
                        currentContent += data.content;
                        updateLastBotMessage(tab, currentContent);
                    }
                } else if (data.type === 'done') {
                    tab.currentStep = data.step;
                    if (data.complete) {
                        tab.storyComplete = true;
                    } else {
                        setStatus(tab, `<strong>Status:</strong> ${label} Step ${tab.currentStep}/${targetSteps}`);
                    }
                } else if (data.type === 'error') {
                    removeLoader(tab);
                    tab.hasError = true;
                    setStatus(tab, `<strong>Error:</strong> ${data.message}`);
                    throw new Error(data.message);
                }
            });

            // Check if we've reached the max or story is complete
            if (tab.currentStep >= targetSteps || tab.storyComplete) {
                tab.storyComplete = true;
                setStatus(tab, `<strong>Status:</strong> Auto-play complete! (${tab.currentStep} steps) - Click "Add Custom Steps..." to keep going`);
                break;
            }

            // Delay between steps
            const delay = tab.settings.delay * 1000;
            if (delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    } catch (error) {
        if (tab.epoch !== epoch) return false;
        if (error.name === 'AbortError') {
            tab.autoplayStopped = true;
            setStatus(tab, `<strong>Status:</strong> Auto-play paused at step ${tab.currentStep}. Click "Resume Auto-play" to continue automatically or "Next Step" to play manually.`);
        } else {
            tab.hasError = true;
            setStatus(tab, `<strong>Error:</strong> ${error.message}`);
        }
    }
    if (tab.epoch === epoch) removeLoader(tab);
    return tab.epoch === epoch;
}

async function resumeAutoplay(tab) {
    if (!tab || tab.isProcessing) return;

    const epoch = tab.epoch;
    tab.autoplayStopped = false;
    tab.hasError = false;
    tab.isAutoPlaying = true;
    tab.abortController = new AbortController();
    setProcessing(tab, true);
    setStatus(tab, `<strong>Status:</strong> ${runLabel(tab)}Resuming auto-play...`);

    const gameUnfinished = tab.runsFinished < tab.currentRun;
    if (gameUnfinished && tab.gameStarted) {
        // Finish the game that was paused, step by step
        if (!(await runStepLoop(tab, tab.settings.steps, `${runLabel(tab)}Auto-play`))) return;
        if (tab.autoplayStopped || tab.hasError) {
            tab.isAutoPlaying = false;
            tab.abortController = null;
            setProcessing(tab, false);
            return;
        }
        tab.runsFinished = tab.currentRun;
    }

    // Whole games still to play: the paused one if it never got going, then the remaining repetitions
    const firstRun = tab.runsFinished + 1;
    if (firstRun <= tab.totalRuns) {
        await streamAutoplay(tab, epoch, tab.totalRuns - firstRun + 1, firstRun);
        return;
    }

    tab.isAutoPlaying = false;
    tab.abortController = null;
    setProcessing(tab, false);
}

function continueStoryManual(tab, stepsToAdd) {
    const newMax = tab.settings.steps + stepsToAdd;
    setTabSteps(tab, newMax);

    // Reset story complete flag so user can continue manually
    tab.storyComplete = false;
    tab.autoplayStopped = false;

    setProcessing(tab, false);
    setStatus(tab, `<strong>Status:</strong> Story extended! Click "Next Step" to continue. (${newMax - tab.currentStep} steps remaining)`);
}

async function continueWithAutoplay(tab, stepsToAdd) {
    if (!tab || tab.isProcessing) return;

    const newMax = tab.settings.steps + stepsToAdd;
    setTabSteps(tab, newMax);

    // Reset story complete and start auto-playing
    tab.storyComplete = false;
    tab.autoplayStopped = false;
    tab.hasError = false;
    tab.isAutoPlaying = true;
    tab.abortController = new AbortController();
    setProcessing(tab, true);
    setStatus(tab, '<strong>Status:</strong> Continuing with auto-play...');

    if (!(await runStepLoop(tab, newMax, 'Auto-play continuing...'))) return;

    tab.isAutoPlaying = false;
    tab.abortController = null;
    setProcessing(tab, false);
}

async function resetGame(tab) {
    if (!tab) return;

    // Invalidate in-flight work for this tab, then stop it
    tab.epoch++;
    if (tab.abortController) {
        tab.abortController.abort();
    }

    try {
        await fetch('/api/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: tab.id })
        });
    } catch (e) {
        // Ignore reset errors
    }

    clearChat(tab);
    tab.gameStarted = false;
    tab.isAutoPlaying = false;
    tab.isProcessing = false;
    tab.storyComplete = false;
    tab.autoplayStopped = false;
    tab.hasError = false;
    tab.abortController = null;
    tab.currentStep = 0;

    // Reset slider to default
    setTabSteps(tab, 10, 20);
    tab.settings.repetitions = 0;
    tab.totalRuns = 1; tab.currentRun = 1; tab.runsFinished = 0;
    if (isActive(tab)) { repetitionsSlider.value = 0; updateSliderLabels(); }

    setStatus(tab, DEFAULT_STATUS);
    setProcessing(tab, false);
}