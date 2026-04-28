import os
from dotenv import load_dotenv
from typing import Dict, Any, Optional, List

# Load environment variables
load_dotenv()


class Config:
    """Universal configuration class supporting multiple AI providers"""

    # Helper methods
    @staticmethod
    def _safe_float(
        value: Optional[str], default: Optional[float] = None
    ) -> Optional[float]:
        """Safely convert string to float"""
        if not value:
            return default
        try:
            return float(value)
        except (ValueError, TypeError):
            return default

    @staticmethod
    def _safe_int(value: Optional[str], default: Optional[int] = None) -> Optional[int]:
        """Safely convert string to int"""
        if not value:
            return default
        try:
            return int(value)
        except (ValueError, TypeError):
            return default

    @staticmethod
    def _safe_bool(value: Optional[str], default: bool = False) -> bool:
        """Safely convert string to boolean"""
        if value is None:
            return default
        return value.strip().lower() in ("true", "1", "yes", "on")

    # API Configuration - Required for functionality
    API_PROVIDER = os.getenv("API_PROVIDER", "auto")  # auto-detect by default
    API_URL = os.getenv("API_URL")
    MODEL = os.getenv("MODEL")
    API_KEY = os.getenv("API_KEY", "")  # Empty string as default

    # Server Configuration with sensible defaults
    SERVER_HOST = os.getenv("SERVER_HOST", "localhost")
    SERVER_PORT = _safe_int.__func__(os.getenv("SERVER_PORT"), 7860)
    SHARE_GRADIO = _safe_bool.__func__(os.getenv("SHARE_GRADIO"), False)

    # Game Settings with defaults
    DEFAULT_MAX_STEPS = _safe_int.__func__(os.getenv("DEFAULT_MAX_STEPS"), 10)
    MAX_STEPS_LIMIT = _safe_int.__func__(os.getenv("MAX_STEPS_LIMIT"), 50)
    DEFAULT_DELAY = _safe_int.__func__(os.getenv("DEFAULT_DELAY"), 3)
    MAX_DELAY = _safe_int.__func__(os.getenv("MAX_DELAY"), 10)
    AUTOPLAY_REPEAT = _safe_int.__func__(os.getenv("AUTOPLAY_REPEAT"), 1)

    # Request Configuration
    REQUEST_TIMEOUT = _safe_int.__func__(os.getenv("REQUEST_TIMEOUT"), 30)

    # File Paths
    PROMPTS_DIR = os.getenv("PROMPTS_DIR", ".")
    GM_PROMPT_FILE = os.getenv("GM_PROMPT_FILE", "gm_prompt.txt")
    PLAYER_PROMPT_FILE = os.getenv("PLAYER_PROMPT_FILE", "rp_prompt.txt")

    # Ollama: comma-separated model override (leave empty to auto-detect from Ollama API)
    OLLAMA_MODELS = os.getenv("OLLAMA_MODELS", "")

    # Game context flag
    IS_GAME_CONTEXT = _safe_bool.__func__(os.getenv("IS_GAME_CONTEXT", "true"), True)

    # UI Configuration
    UI_CONFIG = {
        "title": "Universal AI RPG Adventure",
        "description": "*Compatible with OpenAI, Anthropic, Ollama, LM Studio, and more*",
        "chatbot_height": 500,
        "theme": "soft",
        "show_copy_button": True,
    }

    # Provider-specific default ports and endpoints
    PROVIDER_DEFAULTS = {
        "openai": {
            "url": "https://api.openai.com/v1/chat/completions",
            "port": 443,
            "requires_key": True,
        },
        "anthropic": {
            "url": "https://api.anthropic.com/v1/messages",
            "port": 443,
            "requires_key": True,
        },
        "ollama": {
            "url": "http://localhost:11434/v1/chat/completions",
            "port": 11434,
            "requires_key": False,
        },
        "lmstudio": {
            "url": "http://localhost:1234/v1/chat/completions",
            "port": 1234,
            "requires_key": False,
        },
        "textgen": {
            "url": "http://localhost:5000/v1/chat/completions",
            "port": 5000,
            "requires_key": False,
        },
        "vllm": {
            "url": "http://localhost:8000/v1/chat/completions",
            "port": 8000,
            "requires_key": False,
        },
        "kobold": {
            "url": "http://localhost:5001/api/v1/generate",
            "port": 5001,
            "requires_key": False,
        },
    }

    @classmethod
    def get_ai_settings(cls) -> Dict[str, Any]:
        """Get AI model parameters - Groq-safe version for testing"""
        settings = {}

        # Only Groq-supported parameters
        temp = cls._safe_float(os.getenv("AI_TEMPERATURE"), 0.7)
        if temp is not None:
            settings["temperature"] = max(0.0, min(2.0, temp))  # Groq range: 0-2

        max_tokens = cls._safe_int(os.getenv("AI_MAX_TOKENS"), 1000)
        if max_tokens is not None:
            settings["max_tokens"] = min(max_tokens, 8192)  # Groq limit

        top_p = cls._safe_float(os.getenv("AI_TOP_P"))
        if top_p is not None:
            settings["top_p"] = max(0.0, min(1.0, top_p))  # Groq range: 0-1

        return settings

    @classmethod
    def get_suggested_config(cls, provider: str) -> Dict[str, str]:
        """Get suggested configuration for a specific provider"""
        provider = provider.lower()
        defaults = cls.PROVIDER_DEFAULTS.get(provider, {})

        config = {
            "API_PROVIDER": provider,
            "API_URL": defaults.get("url", ""),
            "API_KEY": "your-api-key-here" if defaults.get("requires_key") else "",
        }

        # Add provider-specific model suggestions
        model_suggestions = {
            "openai": "gpt-4o-mini",
            "anthropic": "claude-3-haiku-20240307",
            "ollama": "llama3.1:latest",
            "lmstudio": "your-loaded-model-name",
            "textgen": "your-loaded-model-name",
            "vllm": "your-model-name",
        }

        if provider in model_suggestions:
            config["MODEL"] = model_suggestions[provider]

        return config

    @classmethod
    def validate_config(cls) -> Dict[str, Any]:
        """Comprehensive configuration validation"""
        issues = []
        warnings = []

        # Critical validation
        if not cls.API_URL:
            issues.append(
                "API_URL is required - specify the endpoint for your AI service"
            )

            # Suggest common configurations
            suggestions = []
            for provider, defaults in cls.PROVIDER_DEFAULTS.items():
                suggestions.append(f"  {provider}: {defaults['url']}")

            issues.append("Common API URLs:\n" + "\n".join(suggestions))

        if not cls.MODEL:
            issues.append("MODEL is required - specify the model name to use")

        # API key validation
        provider_lower = (cls.API_PROVIDER or "").lower()
        if provider_lower in ["openai", "anthropic"] and not cls.API_KEY:
            warnings.append(f"API_KEY may be required for {cls.API_PROVIDER}")

        # File system validation
        if not os.path.exists(cls.PROMPTS_DIR):
            try:
                os.makedirs(cls.PROMPTS_DIR)
                warnings.append(f"Created prompts directory: {cls.PROMPTS_DIR}")
            except Exception as e:
                issues.append(f"Cannot create prompts directory: {e}")

        # Prompt files
        gm_prompt_path = os.path.join(cls.PROMPTS_DIR, cls.GM_PROMPT_FILE)
        if not os.path.exists(gm_prompt_path):
            warnings.append(
                f"GM prompt file missing: {gm_prompt_path} (will use default)"
            )

        player_prompt_path = os.path.join(cls.PROMPTS_DIR, cls.PLAYER_PROMPT_FILE)
        if not os.path.exists(player_prompt_path):
            warnings.append(
                f"Player prompt file missing: {player_prompt_path} (will use default)"
            )

        # Parameter validation
        ai_settings = cls.get_ai_settings()

        temp = ai_settings.get("temperature")
        if temp is not None and not (0.0 <= temp <= 2.0):
            issues.append(f"AI temperature ({temp}) should be between 0.0 and 2.0")

        top_p = ai_settings.get("top_p")
        if top_p is not None and not (0.0 <= top_p <= 1.0):
            issues.append(f"AI top_p ({top_p}) should be between 0.0 and 1.0")

        # Game settings validation
        if cls.DEFAULT_MAX_STEPS > cls.MAX_STEPS_LIMIT:
            issues.append("DEFAULT_MAX_STEPS cannot exceed MAX_STEPS_LIMIT")

        if cls.DEFAULT_DELAY > cls.MAX_DELAY:
            issues.append("DEFAULT_DELAY cannot exceed MAX_DELAY")

        return {
            "valid": len(issues) == 0,
            "issues": issues,
            "warnings": warnings,
            "config_summary": {
                "api_provider": cls.API_PROVIDER,
                "api_url": cls.API_URL,
                "model": cls.MODEL,
                "has_api_key": bool(cls.API_KEY),
                "server": f"{cls.SERVER_HOST}:{cls.SERVER_PORT}",
                "prompts_dir": cls.PROMPTS_DIR,
                "ai_settings": ai_settings,
                "detected_provider": (
                    "Will auto-detect from URL/model"
                    if cls.API_PROVIDER == "auto"
                    else cls.API_PROVIDER
                ),
            },
        }


# Error Messages
class ErrorMessages:
    CONNECTION = "Connection failed - cannot reach API"
    TIMEOUT = "Request timed out after {timeout} seconds"
    REQUEST = "Failed to complete API request"
    EMPTY_RESPONSE = "Received empty response from API"
    INVALID_FORMAT = "Invalid response format"
    RATE_LIMIT = "Rate limit exceeded"
    AUTHENTICATION = "Authentication failed - check API key"
    GAME_START = "Failed to start game"
    GAME_STEP = "Error during game step"
    FILE_NOT_FOUND = "File not found: {filename}"
    PERMISSION_ERROR = "Permission denied accessing: {filename}"

    @classmethod
    def format_connection_error(cls) -> str:
        return f"Connection failed - cannot reach API at {Config.API_URL}"

    @classmethod
    def format_timeout_error(cls) -> str:
        return cls.TIMEOUT.format(timeout=Config.REQUEST_TIMEOUT)


# Status Messages
class StatusMessages:
    READY = "**Status:** Ready to start adventure"
    STARTING = "**Status:** Starting adventure..."
    IN_PROGRESS = "**Status:** Adventure in progress... (Max steps: {max_steps})"
    STARTED = "**Status:** Adventure started! Step 0/{max_steps}"
    NEXT_STEP = "**Status:** Taking next step..."
    STEP_COMPLETED = "**Status:** Step {step}/{max_steps} completed"
    GAME_COMPLETED = "**Status:** Game completed ({step}/{max_steps} steps)"
    AUTO_PLAY_START = "**Status:** Starting auto-play adventure..."
    AUTO_PLAY_STEP = "**Status:** Auto-play Step {step}/{max_steps} - {action}"
    AUTO_PLAY_COMPLETED = (
        "**Status:** Auto-play completed! {step}/{max_steps} steps finished"
    )
    RESET_COMPLETE = "**Status:** Reset complete. Ready for new adventure!"
    PROCESSING = "**Status:** No active game or already processing"

    @classmethod
    def format_in_progress(cls, max_steps: int) -> str:
        return cls.IN_PROGRESS.format(max_steps=max_steps)

    @classmethod
    def format_started(cls, max_steps: int) -> str:
        return cls.STARTED.format(max_steps=max_steps)

    @classmethod
    def format_step_completed(cls, step: int, max_steps: int) -> str:
        return cls.STEP_COMPLETED.format(step=step, max_steps=max_steps)

    @classmethod
    def format_game_completed(cls, step: int, max_steps: int) -> str:
        return cls.GAME_COMPLETED.format(step=step, max_steps=max_steps)

    @classmethod
    def format_auto_play_step(cls, step: int, max_steps: int, action: str) -> str:
        return cls.AUTO_PLAY_STEP.format(step=step, max_steps=max_steps, action=action)

    @classmethod
    def format_auto_play_completed(cls, step: int, max_steps: int) -> str:
        return cls.AUTO_PLAY_COMPLETED.format(step=step, max_steps=max_steps)
