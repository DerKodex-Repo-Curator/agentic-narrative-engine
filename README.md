# AI RPG Adventure Game

A real-time streaming RPG chatbot with **multi-provider support** that creates interactive text-based adventures using various AI services.

![UI Preview](https://img.shields.io/badge/UI-Modern%20Dark%20Sidebar-1e1e2e?style=flat-square)
![Python](https://img.shields.io/badge/Python-3.8+-3776ab?style=flat-square&logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-2.3-black?style=flat-square&logo=flask&logoColor=white)

## Features

### Core Features
* **Live Streaming**: Watch AI responses generate in real-time with proper Unicode handling
* **Multi-Provider Support**: Works with OpenAI, Anthropic, Ollama, Groq, LM Studio, and more
* **Dynamic Provider Switching**: Change AI providers and models during gameplay
* **Interactive RPG**: Dynamic story with player choices and intelligent final step handling
* **Auto-play Mode**: Watch AI vs AI gameplay with configurable delays and repeat count
* **Cross-Platform**: Works consistently on Mac, Windows, and Linux
* **Modern UI**: Clean, professional interface inspired by ChatGPT/Claude with dark sidebar

### Supported AI Providers
* **OpenAI** (GPT-4, GPT-4o, GPT-3.5-turbo)
* **Anthropic** (Claude-3.5 Sonnet, Claude-3 Haiku, Claude-3 Opus)
* **Google** (Gemini 2.5 Flash-Lite, Gemini 2.0 Flash)
* **DeepSeek** (DeepSeek Chat, DeepSeek Coder, DeepSeek Reasoner)
* **Ollama** (Local: auto-detects all installed models)
* **Groq** (Fast inference: Llama, Mixtral, Gemma models)
* **LM Studio** (Local model server)
* **Custom Providers** (Any OpenAI-compatible API)

## Quick Start

### Prerequisites

**Choose Your AI Provider:**

**For Local AI (Recommended for beginners):**
```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Pull a model
ollama pull llama3.1

# Start the server
ollama serve
```

**For Cloud AI:**
- Get API keys from OpenAI, Anthropic, Google, DeepSeek, or Groq
- No local setup required

### Installation

1. **Clone the Repository**
   ```bash
   git clone https://github.com/enayat-hussain/roleplay-chatbot.git
   cd roleplay-chatbot
   ```

2. **Install Dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure Environment Variables**
   ```bash
   # A .env file is included with sensible defaults.
   # Open it and fill in whichever API key(s) you need.
   ```

   Key `.env` options:
   ```env
   # API Keys
   OPENAI_API_KEY=your_openai_key_here
   ANTHROPIC_API_KEY=your_anthropic_key_here
   GROQ_API_KEY=your_groq_key_here

   # Ollama: leave empty to auto-detect, or set a fixed list
   OLLAMA_MODELS=llama3.1,mistral,gemma:2b

   # Auto-play: number of full runs back-to-back
   AUTOPLAY_REPEAT=1
   ```

4. **Run the Application**
   ```bash
   python app.py
   ```

5. **Open in Browser**
   * Navigate to [http://127.0.0.1:7860](http://127.0.0.1:7860)
   * Select your AI provider from the sidebar
   * Add API key if required
   * Click "Start Adventure" to begin!

## Usage

### Getting Started
1. **Select Provider**: Choose from OpenAI, Anthropic, Ollama, etc. in the dark sidebar
2. **Select Model**: Pick the specific model you want to use
3. **Add API Key**: Enter your API key (if required by provider)
4. **Set Max Steps**: Choose adventure length (1-20 steps)
5. **Start Playing**: Click "Start Adventure" and make choices!

### Game Modes

#### Manual Mode
* Click "Start Adventure" to begin
* Use "Next Step" to advance step by step
* Watch responses stream in real-time
* Final steps automatically provide conclusions

#### Auto-play Mode
* Click "Auto-play" for hands-free adventure
* Set delay between steps (0-10 seconds)
* Set **repeat count** (1-10x) to run multiple full adventures back-to-back
* Perfect for demonstrations or relaxed gameplay
* Watch AI make choices and respond automatically

#### Controls
* **New Game**: Reset and start fresh with "+ New Game" button
* **Start Adventure**: Begin a new game
* **Next Step**: Take the next step in the adventure
* **Auto-play**: Let the AI play automatically
* **Stop / Resume**: Pause and resume auto-play mid-run
* **Continue Story**: Extend the adventure after it completes

## Project Structure

```
roleplay-chatbot/
├── app.py                # Main Flask application
├── chatbot.py            # Universal AI client with auto-detection of LLMs
├── game_logic.py         # RPG game state management + intelligent endings
├── config.py             # Configuration settings (paths, constants, defaults)
│
├── templates/            # HTML templates
│   └── index.html        # Main UI template
│
├── static/               # Static assets
│   ├── css/
│   │   └── style.css     # UI styling (dark sidebar, light chat)
│   └── js/
│       └── app.js        # Frontend JavaScript (streaming, interactions)
│
├── requirements.txt      # Python dependencies
├── .env                  # Environment variables (edit this)
│
├── gm_prompt.txt         # Game Master instructions (edit to customise)
├── rp_prompt.txt         # Player role instructions (edit to customise)
│
├── chat_logs/            # Auto-saved conversation logs (.txt files)
│
└── README.md             # Project documentation
```

## Configuration

### Default Provider URLs and Models

| Provider | Default URL | Default Model | API Key Required |
|----------|-------------|---------------|------------------|
| **OpenAI (GPT)** | `https://api.openai.com/v1/chat/completions` | `gpt-4o-mini` | Yes |
| **Anthropic (Claude)** | `https://api.anthropic.com/v1/messages` | `claude-3-haiku-20240307` | Yes |
| **Google (Gemini)** | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` | `gemini-2.0-flash` | Yes |
| **DeepSeek** | `https://api.deepseek.com/chat/completions` | `deepseek-chat` | Yes |
| **Ollama (Local)** | `http://localhost:11434/v1/chat/completions` | auto-detected | No |
| **Groq** | `https://api.groq.com/openai/v1/chat/completions` | `llama-3.1-8b-instant` | Yes |
| **LM Studio** | `http://localhost:1234/v1/chat/completions` | `local-model` | No |

### Environment Variables

| Variable            | Default          | Description                                                   |
|---------------------|------------------|---------------------------------------------------------------|
| `API_PROVIDER`      | `auto`           | API provider (auto-detected from URL/model)                  |
| `API_URL`           | varies           | API endpoint URL                                              |
| `MODEL`             | varies           | AI model name                                                 |
| `API_KEY`           | —                | Generic API key fallback                                      |
| `OPENAI_API_KEY`    | —                | OpenAI API key                                                |
| `ANTHROPIC_API_KEY` | —                | Anthropic API key                                             |
| `GROQ_API_KEY`      | —                | Groq API key                                                  |
| `SERVER_HOST`       | `localhost`      | Flask server host                                             |
| `SERVER_PORT`       | `7860`           | Flask server port                                             |
| `DEFAULT_MAX_STEPS` | `10`             | Default number of game steps                                  |
| `MAX_STEPS_LIMIT`   | `50`             | Maximum allowed steps                                         |
| `DEFAULT_DELAY`     | `3`              | Default delay between auto-play steps (seconds)               |
| `MAX_DELAY`         | `10`             | Maximum delay between steps                                   |
| `AUTOPLAY_REPEAT`   | `1`              | How many full auto-play runs to execute back-to-back          |
| `OLLAMA_MODELS`     | *(empty)*        | Comma-separated Ollama model override; leave empty to auto-detect |
| `PROMPTS_DIR`       | `.`              | Directory containing prompt files                             |
| `GM_PROMPT_FILE`    | `gm_prompt.txt`  | Filename for Game Master prompt                               |
| `PLAYER_PROMPT_FILE`| `rp_prompt.txt`  | Filename for Player prompt                                    |
| `AI_TEMPERATURE`    | `0.7`            | Model temperature (0.0–2.0)                                   |
| `AI_MAX_TOKENS`     | `1000`           | Maximum tokens per response                                   |
| `REQUEST_TIMEOUT`   | `30`             | API request timeout in seconds                                |

### Custom Prompts

The Game Master and Player prompts are loaded from files in the project root at startup. Edit them to change the tone, setting, or rules of the adventure:

* `gm_prompt.txt` — Instructions for the Game Master AI
* `rp_prompt.txt` — Instructions for the Player AI (used in auto-play mode)

You can change the file locations via `.env`:
```env
PROMPTS_DIR=.
GM_PROMPT_FILE=gm_prompt.txt
PLAYER_PROMPT_FILE=rp_prompt.txt
```

If a file is missing or empty the app falls back to built-in default prompts automatically.

## Local AI Setup

### Ollama (Recommended)
```bash
# Install and setup
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull llama3.1
ollama serve
```
- URL: `http://localhost:11434/v1/chat/completions`
- No API key required
- The model dropdown is **automatically populated** with all models you have installed
- To override with a fixed list, set `OLLAMA_MODELS=model1,model2` in `.env`

### LM Studio
1. Download LM Studio from their website
2. Load your preferred model
3. Start the local server
- URL: `http://localhost:1234/v1/chat/completions`
- No API key required

## Troubleshooting

### Common Issues

**Connection Errors**
* Verify API key is correct
* Check if local servers are running (`ollama serve`)
* Try a different provider

**Prompts not loading / falling back to defaults**
* Check that `gm_prompt.txt` and `rp_prompt.txt` exist in the project root
* Or set `PROMPTS_DIR`, `GM_PROMPT_FILE`, `PLAYER_PROMPT_FILE` in `.env`
* Restart the server after any `.env` changes

**Ollama showing no models**
* Make sure `ollama serve` is running before starting the app
* The app queries `http://localhost:11434/api/tags` on provider select
* You can hardcode a list with `OLLAMA_MODELS=llama3.1,mistral` in `.env`

**429 Too Many Requests (Google Gemini)**
* Free tier has low rate limits — wait a moment and retry
* Switch to Groq for a free, higher-rate alternative

**Provider Issues**
* Try switching providers via the sidebar dropdown
* Test different models for your provider
* Check API rate limits and billing status

### Provider-Specific Support

**OpenAI**: Check API billing and rate limits  
**Anthropic**: Verify API key and model access  
**Google Gemini**: Get API key from Google AI Studio (https://aistudio.google.com)  
**DeepSeek**: Get API key from DeepSeek platform (https://platform.deepseek.com)  
**Ollama**: Ensure `ollama serve` is running  
**Groq**: Check free tier limits (free tier available at console.groq.com)

## Requirements

* Python 3.8+
* AI provider access (local server OR cloud API key)
* Modern web browser

## Contributing

Areas for improvement:
* Additional AI provider support
* Enhanced prompt templates
* UI/UX improvements

1. Fork the repository
2. Create a feature branch
3. Test thoroughly with multiple providers
4. Submit a pull request

---

*Built with Flask - Supporting 8+ AI providers!*
