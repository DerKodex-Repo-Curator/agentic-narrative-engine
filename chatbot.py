import requests
import json
import re
import time
import logging
import os
import unicodedata
from typing import List, Dict, Generator, Any, Optional
from config import Config, ErrorMessages

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ChatClient:
    """Universal chat client that auto-detects and adapts to any API provider"""

    def __init__(self, model: Optional[str] = None):
        self.api_url = Config.API_URL
        self.model = model or Config.MODEL
        self.api_provider = Config.API_PROVIDER
        self.ai_settings = Config.get_ai_settings()
        self.timeout = Config.REQUEST_TIMEOUT
        self.api_key = Config.API_KEY  # This will be overridden by app.py
        self._provider_config = None
        self._detected_provider = None
        self.is_final_step = False  # Add flag for final step handling

    def _get_effective_api_key(self) -> str:
        """Get the effective API key, prioritizing dynamically set key"""
        # First check if api_key was set dynamically (from UI)
        if hasattr(self, "api_key") and self.api_key:
            return self.api_key

        # Then check environment variables based on provider
        if self.api_provider and self.api_provider.lower() == "groq":
            env_key = os.getenv("GROQ_API_KEY")
            if env_key:
                return env_key
        elif self.api_provider and self.api_provider.lower() == "openai":
            env_key = os.getenv("OPENAI_API_KEY")
            if env_key:
                return env_key
        elif self.api_provider and self.api_provider.lower() == "anthropic":
            env_key = os.getenv("ANTHROPIC_API_KEY")
            if env_key:
                return env_key

        # Fallback to generic API_KEY
        return os.getenv("API_KEY", "")

    def _detect_provider(self) -> Dict[str, Any]:
        """Auto-detect API provider based on URL and response format"""
        if self._provider_config:
            return self._provider_config

        url_lower = (self.api_url or "").lower()
        provider_lower = (self.api_provider or "").lower()

        # Provider detection patterns - FIXED ORDER: URL first, then explicit provider, then model
        # NOTE: More specific URL patterns should be checked first to avoid false matches
        detection_patterns = {
            "openai": {
                "url_patterns": ["api.openai.com"],  # Only match actual OpenAI API
                "explicit_names": ["openai", "gpt"],
                "model_indicators": ["gpt-4", "gpt-3.5", "gpt-4o"],
                "config": {
                    "auth_header": "Authorization",
                    "auth_format": "Bearer {}",
                    "message_field": "messages",
                    "model_field": "model",
                    "stream_field": "stream",
                    "content_paths": [
                        ["choices", 0, "delta", "content"],
                        ["choices", 0, "message", "content"],
                    ],
                    "payload_style": "openai",
                },
            },
            "anthropic": {
                "url_patterns": ["api.anthropic.com", "anthropic"],
                "explicit_names": ["anthropic", "claude"],
                "model_indicators": ["claude-3", "claude-2", "claude-instant"],
                "config": {
                    "auth_header": "x-api-key",
                    "auth_format": "{}",
                    "message_field": "messages",
                    "model_field": "model",
                    "stream_field": "stream",
                    "content_paths": [
                        ["content", 0, "text"],
                        ["completion"],
                        ["delta", "text"],
                    ],
                    "payload_style": "anthropic",
                },
            },
            "ollama": {
                "url_patterns": ["11434", "ollama", "/api/chat"],
                "explicit_names": ["ollama"],
                "model_indicators": [
                    "llama3.1",
                    "llama3:latest",
                    "mistral",
                    "codellama",
                    "vicuna",
                    "gemma:2b",
                ],
                "config": {
                    "auth_header": None,
                    "message_field": "messages",
                    "model_field": "model",
                    "stream_field": "stream",
                    "content_paths": [
                        ["message", "content"],
                        ["choices", 0, "delta", "content"],
                        ["choices", 0, "message", "content"],
                        ["response"],
                    ],
                    "payload_style": "openai",
                },
            },
            "groq": {
                "url_patterns": ["api.groq.com", "groq"],
                "explicit_names": ["groq"],
                "model_indicators": [
                    "llama-3.1-8b-instant",
                    "meta-llama/llama",
                    "mixtral",
                    "gemma2-9b-it",
                ],
                "config": {
                    "auth_header": "Authorization",
                    "auth_format": "Bearer {}",
                    "message_field": "messages",
                    "model_field": "model",
                    "stream_field": "stream",
                    "content_paths": [
                        ["choices", 0, "delta", "content"],
                        ["choices", 0, "message", "content"],
                    ],
                    "payload_style": "openai",
                },
            },
            "lmstudio": {
                "url_patterns": ["1234", "lmstudio"],
                "explicit_names": ["lmstudio"],
                "model_indicators": ["local-model"],
                "config": {
                    "auth_header": "Authorization",
                    "auth_format": "Bearer {}",
                    "message_field": "messages",
                    "model_field": "model",
                    "stream_field": "stream",
                    "content_paths": [
                        ["choices", 0, "delta", "content"],
                        ["choices", 0, "message", "content"],
                    ],
                    "payload_style": "openai",
                },
            },
            "textgen": {
                "url_patterns": ["5000", "textgen", "text-generation-webui"],
                "explicit_names": ["textgen", "webui"],
                "model_indicators": ["local-model"],
                "config": {
                    "auth_header": "Authorization",
                    "auth_format": "Bearer {}",
                    "message_field": "messages",
                    "model_field": "model",
                    "stream_field": "stream",
                    "content_paths": [
                        ["choices", 0, "delta", "content"],
                        ["choices", 0, "message", "content"],
                    ],
                    "payload_style": "openai",
                },
            },
            "vllm": {
                "url_patterns": ["8000", "vllm"],
                "explicit_names": ["vllm"],
                "model_indicators": ["local-model"],
                "config": {
                    "auth_header": "Authorization",
                    "auth_format": "Bearer {}",
                    "message_field": "messages",
                    "model_field": "model",
                    "stream_field": "stream",
                    "content_paths": [
                        ["choices", 0, "delta", "content"],
                        ["choices", 0, "message", "content"],
                    ],
                    "payload_style": "openai",
                },
            },
            "gemini": {
                "url_patterns": ["generativelanguage.googleapis.com", "gemini"],
                "explicit_names": ["gemini", "google"],
                "model_indicators": ["gemini-3", "gemini-2", "gemini-1.5", "gemini-pro", "gemini-flash"],
                "config": {
                    "auth_header": "Authorization",
                    "auth_format": "Bearer {}",
                    "message_field": "messages",
                    "model_field": "model",
                    "stream_field": "stream",
                    "content_paths": [
                        ["choices", 0, "delta", "content"],
                        ["choices", 0, "message", "content"],
                    ],
                    "payload_style": "openai",
                    "requires_max_tokens": True,
                },
            },
            "deepseek": {
                "url_patterns": ["api.deepseek.com", "deepseek"],
                "explicit_names": ["deepseek"],
                "model_indicators": ["deepseek-chat", "deepseek-coder", "deepseek-reasoner"],
                "config": {
                    "auth_header": "Authorization",
                    "auth_format": "Bearer {}",
                    "message_field": "messages",
                    "model_field": "model",
                    "stream_field": "stream",
                    "content_paths": [
                        ["choices", 0, "delta", "content"],
                        ["choices", 0, "message", "content"],
                    ],
                    "payload_style": "openai",
                },
            },
        }

        # PRIORITY 1: URL pattern matching (most reliable)
        for provider, data in detection_patterns.items():
            if any(pattern in url_lower for pattern in data["url_patterns"]):
                self._detected_provider = provider
                self._provider_config = data["config"]
                logger.info(f"Auto-detected provider from URL: {provider}")
                return self._provider_config

        # PRIORITY 2: Explicit provider setting
        if provider_lower and provider_lower != "auto":
            for provider, data in detection_patterns.items():
                if provider in provider_lower or any(
                    name in provider_lower for name in data["explicit_names"]
                ):
                    self._detected_provider = provider
                    self._provider_config = data["config"]
                    logger.info(f"Using explicit provider: {provider}")
                    return self._provider_config

        # PRIORITY 3: Model name matching (least reliable, only as fallback)
        model_lower = (self.model or "").lower()
        for provider, data in detection_patterns.items():
            if any(indicator in model_lower for indicator in data["model_indicators"]):
                self._detected_provider = provider
                self._provider_config = data["config"]
                logger.info(f"Auto-detected provider from model: {provider}")
                return self._provider_config

        # Default fallback - use OpenAI format (most common)
        self._detected_provider = "generic_openai"
        self._provider_config = detection_patterns["openai"]["config"]
        logger.info("Using generic OpenAI-compatible format as fallback")
        return self._provider_config

    def _build_payload(
        self, messages: List[Dict[str, str]], stream: bool = False
    ) -> Dict[str, Any]:
        """Build request payload based on detected provider"""
        config = self._detect_provider()

        # Handle Anthropic differently - it requires system message as separate param
        if config.get("payload_style") == "anthropic":
            return self._build_anthropic_payload(messages, stream, config)

        # Base payload for OpenAI-compatible providers
        payload: Dict[str, Any] = {
            config["model_field"]: self.model,
            config["message_field"]: messages,
            config["stream_field"]: stream,
        }

        # ADJUST TOKEN LIMIT FOR FINAL STEPS (8-9 lines)
        if hasattr(self, "is_final_step") and self.is_final_step:
            payload["max_tokens"] = 400  # Increased for better completion
            payload["temperature"] = 0.5  # Balanced creativity
        else:
            # OpenAI-style parameters (default)
            payload.update(
                {k: v for k, v in self.ai_settings.items() if v is not None}
            )

        # Gemini requires max_tokens to be set explicitly for complete responses
        # Preview models especially need this to avoid truncation
        if config.get("requires_max_tokens") or self._detected_provider == "gemini":
            if "max_tokens" not in payload or payload.get("max_tokens") is None:
                payload["max_tokens"] = 1024  # Ensure complete responses for Gemini

        return payload

    def _build_anthropic_payload(
        self, messages: List[Dict[str, str]], stream: bool, config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Build Anthropic-specific payload with proper system message handling"""
        # Extract system message from messages array (Anthropic requires it separately)
        system_content = ""
        filtered_messages = []

        for msg in messages:
            if msg.get("role") == "system":
                # Concatenate multiple system messages if present
                if system_content:
                    system_content += "\n\n"
                system_content += msg.get("content", "")
            else:
                filtered_messages.append(msg)

        # Build Anthropic payload
        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": filtered_messages,
            "stream": stream,
            "max_tokens": 1024,  # Anthropic REQUIRES max_tokens
        }

        # Add system message if present
        if system_content:
            payload["system"] = system_content

        # ADJUST TOKEN LIMIT FOR FINAL STEPS
        if hasattr(self, "is_final_step") and self.is_final_step:
            payload["max_tokens"] = 400
            payload["temperature"] = 0.5
        else:
            # Apply AI settings
            if self.ai_settings.get("max_tokens") is not None:
                payload["max_tokens"] = self.ai_settings["max_tokens"]
            if self.ai_settings.get("temperature") is not None:
                payload["temperature"] = self.ai_settings["temperature"]
            if self.ai_settings.get("top_p") is not None:
                payload["top_p"] = self.ai_settings["top_p"]

        return payload

    def _build_headers(self) -> Dict[str, str]:
        """Build request headers based on detected provider"""
        config = self._detect_provider()

        headers = {"Content-Type": "application/json", "Accept": "application/json"}

        # Get the effective API key
        effective_api_key = self._get_effective_api_key()

        # Add authentication if configured and key is available
        if effective_api_key and config.get("auth_header"):
            auth_format = config.get("auth_format", "{}")
            headers[config["auth_header"]] = auth_format.format(effective_api_key)
            logger.info(
                f"Added auth header: {config['auth_header']} with key: {effective_api_key[:10]}..."
            )

        # Anthropic requires version header
        if self._detected_provider == "anthropic":
            headers["anthropic-version"] = "2023-06-01"

        return headers

    def chat_streaming(self, messages: List[Dict[str, str]]) -> Generator[str, None, None]:
        """Streaming chat with robust final step handling and emergency logging"""
        try:
            # For final steps, use non-streaming to get complete response
            if self.is_final_step:
                logger.info("=== FINAL STEP CHAT_STREAMING START ===")
                logger.info("Final step detected - using non-streaming approach for complete response")

                result = self.chat(messages)
                logger.info(f"Non-streaming chat() returned: {len(result) if result else 0} characters")

                if result:
                    logger.info(f"Result preview: {result[:150]}...")
                    logger.info(f"Result ending: ...{result[-150:]}")

                    # NOTE: the reply is NOT logged here. GameState.take_step_streaming() logs the final
                    # GM message once, after it has completed it (logging here too wrote it twice).

                    # Yield the complete response
                    logger.info("Yielding final response...")
                    yield result
                    logger.info("Final response yielded successfully")

                else:
                    logger.error("Non-streaming returned empty result for final step")
                    fallback = "The story concludes with a sense of resolution and completion."

                    yield fallback

                logger.info("=== FINAL STEP CHAT_STREAMING END ===")
                return

            # Regular streaming for non-final steps
            logger.info("=== REGULAR STREAMING START ===")
            payload = self._build_payload(messages, stream=True)
            headers = self._build_headers()

            logger.info(f"Making streaming request to: {self.api_url}")
            logger.info(f"Provider: {self._detected_provider}")
            logger.info(f"Stream payload: {payload.get('stream', 'not set')}")

            response = None
            try:
                response = requests.post(
                    self.api_url,
                    json=payload,
                    headers=headers,
                    stream=True,
                    timeout=self.timeout,
                )
                response.raise_for_status()
                logger.info(f"Streaming request successful: HTTP {response.status_code}")
            except requests.exceptions.RequestException as e:
                logger.error(f"Streaming request exception: {e}")
                logger.info("Falling back to non-streaming approach")
                payload["stream"] = False
                try:
                    response = requests.post(
                        self.api_url, json=payload, headers=headers, timeout=self.timeout
                    )
                    response.raise_for_status()
                    logger.info(f"Fallback request successful: HTTP {response.status_code}")
                except Exception as fallback_error:
                    logger.error(f"Fallback request also failed: {fallback_error}")
                    yield f"Error: Both streaming and non-streaming requests failed"
                    return

            if response.status_code != 200:
                error_msg = f"HTTP {response.status_code}: {response.text[:200]}"
                logger.error(error_msg)
                yield error_msg
                return

            full_content = ""
            chunk_count = 0

            if payload.get("stream"):
                logger.info("Processing streaming response...")
                for content_chunk in self._parse_stream_response_simple(response):
                    if content_chunk:
                        chunk_count += 1
                        full_content += content_chunk
                        logger.debug(f"Chunk {chunk_count}: {len(content_chunk)} chars")
                        yield content_chunk
            else:
                logger.info("Processing non-streaming response...")
                try:
                    result = response.json()
                    content = (
                        result.get("choices", [{}])[0]
                        .get("message", {})
                        .get("content", "")
                    )
                    if content:
                        full_content = content
                        logger.info(f"Non-streaming content: {len(content)} chars")
                        yield content
                    else:
                        logger.warning("No content found in non-streaming response")
                except (json.JSONDecodeError, KeyError, IndexError) as e:
                    logger.error(f"Error parsing response: {e}")
                    yield f"Error parsing response: {e}"

            logger.info(f"Regular streaming complete. Total chunks: {chunk_count}, total chars: {len(full_content)}")

            if not full_content.strip():
                logger.warning("Empty response received, using fallback")
                fallback_msg = "The GM seems silent... but the adventure continues!"
                yield fallback_msg

            logger.info("=== REGULAR STREAMING END ===")

        except Exception as e:
            logger.error(f"Critical streaming error: {e}")
            logger.error(f"Error type: {type(e).__name__}")
            logger.error(f"Error args: {e.args}")
            yield f"Request failed: {str(e)}"

    def _parse_stream_response_simple(self, response: requests.Response):
        """Simplified stream parsing to avoid encoding issues"""
        is_anthropic = self._detected_provider == "anthropic"

        for raw_line in response.iter_lines(decode_unicode=False):
            if not raw_line:
                continue

            try:
                line = raw_line.decode("utf-8").strip()
            except UnicodeDecodeError:
                continue  # Skip problematic lines

            # Handle Anthropic SSE events
            if line.startswith("event:"):
                continue  # Skip event type lines

            if line.startswith("data: "):
                data = line[6:].strip()
                if data in ("[DONE]", "data: [DONE]"):
                    break
                if data:
                    content = self._extract_content_simple(data, is_anthropic)
                    if content:
                        yield content

    def _extract_content_simple(self, json_str: str, is_anthropic: bool = False) -> str:
        """Simplified content extraction with Anthropic support"""
        if not json_str or json_str in ("[DONE]", "data: [DONE]"):
            return ""

        try:
            data = json.loads(json_str)

            # Handle Anthropic streaming format specifically
            if is_anthropic:
                # Anthropic streaming events:
                # content_block_delta: {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}
                # message_stop: end of message
                event_type = data.get("type", "")

                if event_type == "content_block_delta":
                    delta = data.get("delta", {})
                    if delta.get("type") == "text_delta":
                        return delta.get("text", "")

                # Skip other event types (message_start, content_block_start, etc.)
                return ""

            # Try common paths for OpenAI-compatible content
            paths_to_try = [
                ["choices", 0, "delta", "content"],
                ["choices", 0, "message", "content"],
                ["message", "content"],
                ["response"],
            ]

            for path in paths_to_try:
                try:
                    value = data
                    for key in path:
                        if (
                            isinstance(key, int)
                            and isinstance(value, list)
                            and len(value) > key
                        ):
                            value = value[key]
                        elif isinstance(value, dict) and key in value:
                            value = value[key]
                        else:
                            value = None
                            break

                    if value and isinstance(value, str):
                        return value
                except (KeyError, IndexError, TypeError):
                    continue

        except json.JSONDecodeError:
            pass

        return ""

    def chat(self, messages: List[Dict[str, str]]) -> str:
        """Non-streaming chat completion with enhanced final step handling"""
        try:
            payload = self._build_payload(messages, stream=False)
            headers = self._build_headers()

            logger.info(f"Making non-streaming request to: {self.api_url}")
            if self.is_final_step:
                logger.info("This is a final step non-streaming request")
                logger.info(f"Payload max_tokens: {payload.get('max_tokens', 'not set')}")
                logger.info(f"Payload temperature: {payload.get('temperature', 'not set')}")

            response = requests.post(
                self.api_url, json=payload, headers=headers, timeout=self.timeout
            )

            if response.status_code != 200:
                logger.error(f"HTTP {response.status_code}: {response.text[:200]}")
                return f"Error: HTTP {response.status_code}"

            result = response.json()
            logger.info(f"Received response JSON keys: {list(result.keys()) if isinstance(result, dict) else 'Not a dict'}")

            # Handle Anthropic non-streaming response format
            # Anthropic returns: {"content": [{"type": "text", "text": "..."}], ...}
            if self._detected_provider == "anthropic":
                content_list = result.get("content", [])
                if content_list and isinstance(content_list, list):
                    for block in content_list:
                        if block.get("type") == "text":
                            text = block.get("text", "")
                            if text:
                                logger.info(f"Extracted Anthropic content: {len(text)} chars")
                                return text.strip()
                logger.error(f"Could not extract Anthropic content from: {result}")
                return "Error: Could not extract content from Anthropic response"

            # Try multiple paths to extract content for OpenAI-compatible APIs
            content_paths = [
                ["choices", 0, "message", "content"],
                ["message", "content"],
                ["response"],
                ["completion"],
            ]

            for path in content_paths:
                try:
                    value = result
                    for key in path:
                        if (
                            isinstance(key, int)
                            and isinstance(value, list)
                            and len(value) > key
                        ):
                            value = value[key]
                        elif isinstance(value, dict) and key in value:
                            value = value[key]
                        else:
                            value = None
                            break

                    if value and isinstance(value, str):
                        logger.info(f"Successfully extracted content using path {path}: {len(value)} chars")
                        return value.strip()
                except (KeyError, IndexError, TypeError):
                    continue

            logger.error(f"Could not extract content from response: {result}")
            return "Error: Could not extract content from response"

        except Exception as e:
            logger.error(f"Non-streaming error: {e}")
            return f"Request failed: {str(e)}"

    def test_connection(self) -> Dict[str, Any]:
        """Test API connection with auto-detection"""
        try:
            # Simple test message
            test_messages = [{"role": "user", "content": "Hi"}]

            # Build test payload with minimal tokens
            test_payload = self._build_payload(test_messages, stream=False)
            if "max_tokens" in test_payload:
                test_payload["max_tokens"] = 5

            headers = self._build_headers()

            logger.info(f"Testing connection to {self.api_url}")
            logger.info(
                f"Using API key: {'Yes' if self._get_effective_api_key() else 'No'}"
            )

            response = requests.post(
                self.api_url, json=test_payload, headers=headers, timeout=10
            )

            if response.status_code == 200:
                # avoid large dumps
                preview = ""
                try:
                    preview_json = response.json()
                    preview = str(preview_json)[:200]
                except Exception:
                    preview = response.text[:200] if response.text else ""
                return {
                    "connected": True,
                    "status": "API connection successful",
                    "detected_provider": self._detected_provider,
                    "model": self.model,
                    "response_preview": preview,
                }
            else:
                error_text = response.text[:200] if response.text else "Unknown error"
                return {
                    "connected": False,
                    "status": f"HTTP {response.status_code}",
                    "error": error_text,
                    "detected_provider": self._detected_provider,
                }

        except requests.exceptions.ConnectionError:
            return {
                "connected": False,
                "status": "Connection failed",
                "error": f"Cannot reach {self.api_url}. Check if the server is running.",
                "detected_provider": self._detected_provider,
            }
        except Exception as e:
            return {
                "connected": False,
                "status": "Test failed",
                "error": str(e),
                "detected_provider": self._detected_provider,
            }

    def get_client_info(self) -> Dict[str, Any]:
        """Get comprehensive client information"""
        config = self._detect_provider()
        return {
            "api_url": self.api_url,
            "model": self.model,
            "detected_provider": self._detected_provider,
            "explicit_provider": self.api_provider,
            "timeout": self.timeout,
            "has_api_key": bool(self._get_effective_api_key()),
            "ai_settings": self.ai_settings,
            "provider_config": config,
        }