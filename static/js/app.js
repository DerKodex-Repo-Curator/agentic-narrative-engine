// RPG Adventure - Flask Frontend JavaScript

const sessionId = 'session_' + Date.now();
let isProcessing = false;
let gameStarted = false;
let isAutoPlaying = false;
let storyComplete = false;
let autoplayStopped = false; // Track if auto-play was manually stopped
let abortController = null;
let selectedContinueMode = 'manual'; // 'manual' or 'auto'
let lastRunSteps = 10; // size of the last run; the Repeat button runs this many more steps

// DOM Elements
const providerSelect = document.getElementById('providerSelect');
const modelSelect = document.getElementById('modelSelect');
const apiKeyInput = document.getElementById('apiKey');
const apiUrlInput = document.getElementById('apiUrl');
const stepsSlider = document.getElementById('stepsSlider');
const stepsValue = document.getElementById('stepsValue');
const delaySlider = document.getElementById('delaySlider');
const delayValue = document.getElementById('delayValue');
const chatbox = document.getElementById('chatbox');
const statusBar = document.getElementById('statusBar');
const modelBadge = document.getElementById('modelBadge');
const startBtn = document.getElementById('startBtn');
const nextBtn = document.getElementById('nextBtn');
const autoplayBtn = document.getElementById('autoplayBtn');
const stopBtn = document.getElementById('stopBtn');
const resumeBtn = document.getElementById('resumeBtn');
const continueBtn = document.getElementById('continueBtn');
const repeatBtn = document.getElementById('repeatBtn');
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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadProviderModels(providerSelect.value);
    updateSliderLabels();
    setupEventListeners();
});

function setupEventListeners() {
    // Provider change
    providerSelect.addEventListener('change', () => {
        loadProviderModels(providerSelect.value);
    });

    // Slider updates
    stepsSlider.addEventListener('input', updateSliderLabels);
    delaySlider.addEventListener('input', updateSliderLabels);

    // Buttons
    startBtn.addEventListener('click', startGame);
    nextBtn.addEventListener('click', nextStep);
    autoplayBtn.addEventListener('click', autoplay);
    stopBtn.addEventListener('click', stopAutoplay);
    resumeBtn.addEventListener('click', resumeAutoplay);
    continueBtn.addEventListener('click', showContinueModal);
    // Repeat: one click, continues the SAME story from where it ended for another lastRunSteps steps
    repeatBtn.addEventListener('click', () => continueWithAutoplay(lastRunSteps));
    newGameBtn.addEventListener('click', resetGame);
    resetBtn.addEventListener('click', resetGame);

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

function updateSliderLabels() {
    stepsValue.textContent = stepsSlider.value;
    delayValue.textContent = delaySlider.value;
}

async function loadProviderModels(provider) {
    try {
        const response = await fetch(`/api/provider/${encodeURIComponent(provider)}`);
        const config = await response.json();

        modelSelect.innerHTML = '';
        config.models.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            if (model === config.default_model) {
                option.selected = true;
            }
            modelSelect.appendChild(option);
        });

        // Show/hide API key based on requirement
        apiKeyInput.style.display = config.requires_key ? 'block' : 'none';

        // Update model badge
        modelBadge.textContent = `${provider} - ${config.default_model}`;
    } catch (error) {
        console.error('Error loading provider config:', error);
    }
}

function setStatus(message) {
    statusBar.innerHTML = message;
}

function setProcessing(processing) {
    isProcessing = processing;
    startBtn.disabled = processing || gameStarted;
    nextBtn.disabled = processing || !gameStarted || storyComplete;
    autoplayBtn.disabled = processing || gameStarted;

    // Show/hide stop button based on auto-play state
    stopBtn.style.display = isAutoPlaying ? 'block' : 'none';

    // Show resume button when auto-play was stopped (and not complete)
    resumeBtn.style.display = (autoplayStopped && !storyComplete && !isAutoPlaying) ? 'block' : 'none';

    // Show continue button when story is complete
    continueBtn.style.display = storyComplete ? 'block' : 'none';

    // Show Repeat button when story is complete
    repeatBtn.textContent = `Repeat (+${lastRunSteps} steps)`;
    repeatBtn.style.display = storyComplete ? 'block' : 'none';
    repeatBtn.disabled = processing;
}

function addMessage(role, content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    messageDiv.innerHTML = formatContent(content);
    chatbox.appendChild(messageDiv);
    chatbox.scrollTop = chatbox.scrollHeight;
    return messageDiv;
}

function updateLastBotMessage(content) {
    const messages = chatbox.querySelectorAll('.message.bot');
    if (messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        lastMessage.innerHTML = formatContent(content);
        chatbox.scrollTop = chatbox.scrollHeight;
    }
}

function formatContent(content) {
    // Basic markdown-like formatting
    return content
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
}

function clearChat() {
    chatbox.innerHTML = '';
}

function getRequestData(extraSteps = 0) {
    return {
        provider: providerSelect.value,
        model: modelSelect.value,
        api_key: apiKeyInput.value,
        api_url: apiUrlInput.value,
        max_steps: parseInt(stepsSlider.value) + extraSteps,
        delay: parseInt(delaySlider.value),
        session_id: sessionId
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

// Modal functions
function showContinueModal() {
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
    hideContinueModal();

    if (selectedContinueMode === 'auto') {
        continueWithAutoplay(stepsToAdd);
    } else {
        continueStoryManual(stepsToAdd);
    }
}

async function startGame() {
    if (isProcessing) return;
    lastRunSteps = parseInt(stepsSlider.value);

    setProcessing(true);
    storyComplete = false;
    autoplayStopped = false;
    clearChat();
    setStatus('<strong>Status:</strong> Starting adventure...');
    modelBadge.textContent = `${providerSelect.value} - ${modelSelect.value}`;

    let currentContent = '';
    addMessage('bot', '');

    try {
        const response = await fetch('/api/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(getRequestData())
        });

        await readSSE(response, (data) => {
            if (data.type === 'chunk') {
                currentContent += data.content;
                updateLastBotMessage(currentContent);
            } else if (data.type === 'done') {
                gameStarted = true;
                setStatus(`<strong>Status:</strong> Game started. Step ${data.step}/${stepsSlider.value}`);
            } else if (data.type === 'error') {
                setStatus(`<strong>Error:</strong> ${data.message}`);
            }
        });
    } catch (error) {
        setStatus(`<strong>Error:</strong> ${error.message}`);
    }

    setProcessing(false);
}

async function nextStep() {
    if (isProcessing || !gameStarted) return;

    // Clear the autoplayStopped flag when manually stepping
    autoplayStopped = false;

    setProcessing(true);
    setStatus('<strong>Status:</strong> Taking next step...');

    let currentContent = '';

    try {
        const response = await fetch('/api/step', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(getRequestData())
        });

        let messageAdded = false;

        await readSSE(response, (data) => {
            if (data.type === 'chunk') {
                if (!messageAdded) {
                    // Add player choice (none when the GM is just continuing the story)
                    if (data.choice) addMessage('user', data.choice.toString());
                    addMessage('bot', '');
                    messageAdded = true;
                }
                currentContent += data.content;
                updateLastBotMessage(currentContent);
            } else if (data.type === 'done') {
                if (data.complete) {
                    storyComplete = true;
                    setStatus(`<strong>Status:</strong> Adventure complete! (${data.step} steps) - Click "Continue Story" to keep playing`);
                } else {
                    setStatus(`<strong>Status:</strong> Step ${data.step}/${stepsSlider.value}`);
                }
            } else if (data.type === 'error') {
                setStatus(`<strong>Error:</strong> ${data.message}`);
            }
        });
    } catch (error) {
        setStatus(`<strong>Error:</strong> ${error.message}`);
    }

    setProcessing(false);
}

async function autoplay() {
    if (isProcessing) return;
    lastRunSteps = parseInt(stepsSlider.value);

    setProcessing(true);
    isAutoPlaying = true;
    storyComplete = false;
    autoplayStopped = false;
    clearChat();
    setStatus('<strong>Status:</strong> Auto-play starting...');
    modelBadge.textContent = `${providerSelect.value} - ${modelSelect.value}`;

    // Show stop button
    stopBtn.style.display = 'block';
    resumeBtn.style.display = 'none';

    let currentContent = '';
    let currentStep = 0;

    // Create abort controller for this request
    abortController = new AbortController();

    try {
        const response = await fetch('/api/autoplay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(getRequestData()),
            signal: abortController.signal
        });

        let lastMessageType = null;

        await readSSE(response, (data) => {
            if (data.type === 'status') {
                setStatus(`<strong>Status:</strong> ${data.message}`);
            } else if (data.type === 'chunk') {
                if (data.choice && lastMessageType !== 'user') {
                    // Add player choice
                    addMessage('user', data.choice.toString());
                    addMessage('bot', '');
                    currentContent = '';
                    lastMessageType = 'user';
                } else if (!lastMessageType || lastMessageType === 'step_done') {
                    // Start new bot message
                    addMessage('bot', '');
                    currentContent = '';
                    lastMessageType = 'bot';
                }
                currentContent += data.content;
                updateLastBotMessage(currentContent);
            } else if (data.type === 'step_done') {
                currentStep = data.step;
                setStatus(`<strong>Status:</strong> Auto-play Step ${currentStep}/${stepsSlider.value}`);
                lastMessageType = 'step_done';
                currentContent = '';
                gameStarted = true;
            } else if (data.type === 'complete') {
                storyComplete = true;
                setStatus(`<strong>Status:</strong> Auto-play complete! (${data.step} steps) - Click "Continue Story" to keep playing`);
            } else if (data.type === 'error') {
                setStatus(`<strong>Error:</strong> ${data.message}`);
            }
        });
    } catch (error) {
        if (error.name === 'AbortError') {
            autoplayStopped = true;
            setStatus(`<strong>Status:</strong> Auto-play stopped at step ${currentStep}. Click "Resume" to continue auto-play or "Next Step" for manual.`);
        } else {
            setStatus(`<strong>Error:</strong> ${error.message}`);
        }
    }

    isAutoPlaying = false;
    abortController = null;
    setProcessing(false);
}

function stopAutoplay() {
    if (abortController) {
        abortController.abort();
        isAutoPlaying = false;
        stopBtn.style.display = 'none';
        setStatus('<strong>Status:</strong> Stopping auto-play...');
    }
}

async function resumeAutoplay() {
    if (isProcessing) return;

    // Clear the stopped flag and resume auto-play
    autoplayStopped = false;
    setProcessing(true);
    isAutoPlaying = true;
    stopBtn.style.display = 'block';
    resumeBtn.style.display = 'none';
    setStatus('<strong>Status:</strong> Resuming auto-play...');

    let currentContent = '';
    let currentStep = 0;

    // Create abort controller for this request
    abortController = new AbortController();

    try {
        const maxSteps = parseInt(stepsSlider.value);

        // Loop and take steps until we reach max or get stopped
        while (true) {
            if (abortController.signal.aborted) break;

            const response = await fetch('/api/step', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(getRequestData()),
                signal: abortController.signal
            });

            let messageAdded = false;
            currentContent = '';

            await readSSE(response, (data) => {
                if (data.type === 'chunk') {
                    if (!messageAdded) {
                        if (data.choice) addMessage('user', data.choice.toString());
                        addMessage('bot', '');
                        messageAdded = true;
                    }
                    currentContent += data.content;
                    updateLastBotMessage(currentContent);
                } else if (data.type === 'done') {
                    currentStep = data.step;
                    if (data.complete) {
                        storyComplete = true;
                        setStatus(`<strong>Status:</strong> Auto-play complete! (${data.step} steps) - Click "Continue Story" to keep playing`);
                    } else {
                        setStatus(`<strong>Status:</strong> Auto-play Step ${currentStep}/${maxSteps}`);
                    }
                } else if (data.type === 'error') {
                    setStatus(`<strong>Error:</strong> ${data.message}`);
                    throw new Error(data.message);
                }
            });

            // Check if we've reached the max or story is complete
            if (currentStep >= maxSteps || storyComplete) {
                if (!storyComplete) {
                    storyComplete = true;
                    setStatus(`<strong>Status:</strong> Auto-play complete! (${currentStep} steps) - Click "Continue Story" to keep playing`);
                }
                break;
            }

            // Delay between steps
            const delay = parseInt(delaySlider.value) * 1000;
            if (delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            autoplayStopped = true;
            setStatus(`<strong>Status:</strong> Auto-play stopped at step ${currentStep}. Click "Resume" to continue auto-play or "Next Step" for manual.`);
        } else {
            setStatus(`<strong>Error:</strong> ${error.message}`);
        }
    }

    isAutoPlaying = false;
    abortController = null;
    setProcessing(false);
}

function continueStoryManual(stepsToAdd) {
    lastRunSteps = stepsToAdd;
    // Update the max steps
    const newMax = parseInt(stepsSlider.value) + stepsToAdd;
    stepsSlider.value = newMax;
    stepsSlider.max = Math.max(20, newMax);
    stepsValue.textContent = newMax;

    // Reset story complete flag so user can continue manually
    storyComplete = false;
    autoplayStopped = false;

    // Update UI - user can now click "Next Step" to continue
    setProcessing(false);
    setStatus(`<strong>Status:</strong> Story extended! Click "Next Step" to continue. (${stepsSlider.value - getCurrentStep()}/${stepsSlider.value} steps remaining)`);
}

function getCurrentStep() {
    // Parse current step from status or return 0
    const statusText = statusBar.textContent;
    const match = statusText.match(/Step (\d+)/);
    return match ? parseInt(match[1]) : 0;
}

async function continueWithAutoplay(stepsToAdd) {
    if (isProcessing) return;
    lastRunSteps = stepsToAdd;

    // Update the max steps
    const currentMax = parseInt(stepsSlider.value);
    const newMax = currentMax + stepsToAdd;
    stepsSlider.value = newMax;
    stepsSlider.max = Math.max(20, newMax);
    stepsValue.textContent = newMax;

    // Reset story complete and start auto-playing
    storyComplete = false;
    autoplayStopped = false;
    setProcessing(true);
    isAutoPlaying = true;
    stopBtn.style.display = 'block';
    resumeBtn.style.display = 'none';
    setStatus('<strong>Status:</strong> Continuing with auto-play...');

    let currentContent = '';
    let currentStep = currentMax; // Start from where we were

    // Create abort controller for this request
    abortController = new AbortController();

    try {
        // We'll loop and take steps until we reach the new max
        while (currentStep < newMax) {
            if (abortController.signal.aborted) break;

            setStatus(`<strong>Status:</strong> Auto-play continuing... Step ${currentStep + 1}/${newMax}`);

            const response = await fetch('/api/step', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(getRequestData()),
                signal: abortController.signal
            });

            let messageAdded = false;
            currentContent = '';

            await readSSE(response, (data) => {
                if (data.type === 'chunk') {
                    if (!messageAdded) {
                        if (data.choice) addMessage('user', data.choice.toString());
                        addMessage('bot', '');
                        messageAdded = true;
                    }
                    currentContent += data.content;
                    updateLastBotMessage(currentContent);
                } else if (data.type === 'done') {
                    currentStep = data.step;
                    if (data.complete) {
                        storyComplete = true;
                        setStatus(`<strong>Status:</strong> Auto-play complete! (${data.step} steps) - Click "Continue Story" to keep playing`);
                    } else {
                        setStatus(`<strong>Status:</strong> Auto-play Step ${currentStep}/${newMax}`);
                    }
                } else if (data.type === 'error') {
                    setStatus(`<strong>Error:</strong> ${data.message}`);
                    throw new Error(data.message);
                }
            });

            // Check if we've reached the max
            if (currentStep >= newMax) {
                storyComplete = true;
                setStatus(`<strong>Status:</strong> Auto-play complete! (${currentStep} steps) - Click "Continue Story" to keep playing`);
                break;
            }

            // Delay between steps
            const delay = parseInt(delaySlider.value) * 1000;
            if (delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            autoplayStopped = true;
            setStatus(`<strong>Status:</strong> Auto-play stopped at step ${currentStep}. Click "Resume" to continue auto-play or "Next Step" for manual.`);
        } else {
            setStatus(`<strong>Error:</strong> ${error.message}`);
        }
    }

    isAutoPlaying = false;
    abortController = null;
    setProcessing(false);
}

async function resetGame() {
    // Stop any ongoing autoplay
    if (abortController) {
        abortController.abort();
    }

    try {
        await fetch('/api/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId })
        });
    } catch (e) {
        // Ignore reset errors
    }

    clearChat();
    gameStarted = false;
    isAutoPlaying = false;
    storyComplete = false;
    autoplayStopped = false;
    abortController = null;

    // Reset slider to default
    stepsSlider.value = 10;
    stepsSlider.max = 20;
    stepsValue.textContent = '10';
    lastRunSteps = 10;

    // Hide resume button
    resumeBtn.style.display = 'none';

    setStatus('Ready to start your adventure. Configure your AI provider and click <strong>Start</strong>.');
    setProcessing(false);
}