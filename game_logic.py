import random
import uuid
import os
from typing import List, Tuple, Generator, Dict, Any, Optional
from config import Config, StatusMessages, ErrorMessages
from pathlib import Path
from datetime import datetime
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ChatLogger:
    """Handles writing chat messages with robust file operations"""

    def __init__(self, log_dir: str = "chat_logs"):
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.session_file = None

    def start_new_session(self, model_info: dict = None):
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.session_file = self.log_dir / f"chat_session_{timestamp}_{uuid.uuid4().hex[:6]}.txt"
        try:
            with open(self.session_file, "a", encoding="utf-8") as f:
                f.write(f"=== New Chat Session: {timestamp} ===\n")

                # Add model information if provided
                if model_info:
                    f.write("=== Model Configuration ===\n")
                    f.write(f"Provider: {model_info.get('provider', 'unknown')}\n")
                    f.write(f"Model: {model_info.get('model', 'unknown')}\n")
                    f.write(f"API URL: {model_info.get('api_url', 'unknown')}\n")
                    if model_info.get('temperature'):
                        f.write(f"Temperature: {model_info.get('temperature')}\n")
                    if model_info.get('max_tokens'):
                        f.write(f"Max Tokens: {model_info.get('max_tokens')}\n")
                    f.write("=" * 30 + "\n")
                f.write("\n")
                f.flush()
                os.fsync(f.fileno())
        except Exception as e:
            logger.error(f"Error creating log file: {e}")

    def append_message(self, role: str, message: str):
        if not self.session_file:
            self.start_new_session()

        if not message or not message.strip():
            logger.warning(f"Empty message from {role}, skipping log")
            return

        try:
            with open(self.session_file, "a", encoding="utf-8") as f:
                f.write(f"[{role}] {message.strip()}\n")
                f.flush()
                os.fsync(f.fileno())
            logger.info(f"Logged message from {role} ({len(message)} chars)")
        except Exception as e:
            logger.error(f"Error writing to log: {e}")

    def append_system_message(self, message: str):
        """Add system messages like game end notifications"""
        self.append_message("SYSTEM", message)

    def finalize_session(self):
        """Call this when game ends to ensure all logs are saved"""
        try:
            self.append_system_message("=== Game Session Ended ===")
        except Exception as e:
            logger.error(f"Error finalizing session: {e}")


class GameState:
    """Manages RPG game state with improved logging and completion handling"""

    def __init__(self, gm_prompt: str, player_prompt: str, model_name: Optional[str] = None, chat_client=None):
        self.gm_history = [{"role": "system", "content": gm_prompt}]
        self.conversation = []
        self.step_count = 0
        self.chat_logger = ChatLogger()

        if chat_client:
            self.chat_client = chat_client
        else:
            from chatbot import ChatClient
            self.chat_client = ChatClient(model=model_name)

        # 🔧 Attach ChatLogger so final step responses are logged
        self.chat_client.chat_logger = self.chat_logger

        # Start new session with model info
        self._start_session_with_model_info()

    def _start_session_with_model_info(self):
        """Start a new chat session with model information"""
        model_info = {
            'provider': getattr(self.chat_client, 'api_provider', 'unknown'),
            'model': getattr(self.chat_client, 'model', 'unknown'),
            'api_url': getattr(self.chat_client, 'api_url', 'unknown'),
            'temperature': getattr(self.chat_client, 'ai_settings', {}).get('temperature', None),
            'max_tokens': getattr(self.chat_client, 'ai_settings', {}).get('max_tokens', None)
        }
        self.chat_logger.start_new_session(model_info)
        logger.info(f"Started new session with {model_info['provider']} / {model_info['model']}")

    def start_game_streaming(self) -> Generator[Tuple[bool, List, str], None, None]:
        """Starts the game by setting the scene and giving 4 options"""
        try:
            initial_prompt = "Begin the adventure. Set the scene with vivid description and give me exactly 4 numbered options to choose from (1-4)."
            self.gm_history.append({"role": "user", "content": initial_prompt})

            self.chat_client.is_final_step = False
            streamed_response = ""
            chunk_count = 0

            for chunk in self.chat_client.chat_streaming(self.gm_history):
                streamed_response += chunk
                chunk_count += 1
                temp_conversation = self.conversation + [("GM", streamed_response)]
                yield True, temp_conversation, chunk

            if not streamed_response.strip():
                streamed_response = "The adventure begins in a mysterious location. You must choose your path forward."
                logger.warning("Empty GM response, using fallback")

            self.gm_history.append({"role": "assistant", "content": streamed_response})
            self.conversation.append(("GM", streamed_response))
            self.chat_logger.append_message("GM", streamed_response)

            # Final yield with empty content to signal completion (content already streamed)
            yield True, self.conversation, ""

        except Exception as e:
            logger.error(f"Error in start_game_streaming: {e}")
            self.chat_logger.append_system_message(f"Error starting game: {str(e)}")
            yield False, [], f"{ErrorMessages.GAME_START}: {str(e)}"

    def _is_response_complete(self, response: str) -> bool:
        if not response or len(response.strip()) < 10:
            return False
        stripped = response.rstrip()
        if not stripped.endswith(('.', '!', '?', '"', "'", ')', ']')):
            return False
        incomplete_patterns = ["barely above a", "he says as he", "she whispers as", "you notice that", "in the distance you can", "suddenly you hear"]
        lower_response = response.lower()
        for pattern in incomplete_patterns:
            if lower_response.endswith(pattern):
                return False
        return True

    def take_step_streaming(self, player_choice: Optional[int] = None, max_steps: int = 50) -> Generator[Tuple[bool, List, int, str], None, None]:
        """Streaming player step with robust completion handling"""

        try:
            if player_choice is None:
                player_choice = random.choice([1, 2, 3, 4])

            player_choice_str = str(player_choice)
            self.conversation.append(("Player", player_choice_str))
            self.chat_logger.append_message("Player", player_choice_str)
            yield True, self.conversation, player_choice, ""

            self.step_count += 1
            is_final_step = self.step_count >= max_steps
            self.chat_client.is_final_step = is_final_step

            if is_final_step:
                final_prompt = f"""I choose option {player_choice}.

FINAL STEP - Write exactly 8-9 lines to conclude the story.

Based on choice {player_choice}, provide a complete and satisfying ending that wraps up the adventure. NO numbered options. Keep it to approximately 8-9 lines total."""
            else:
                final_prompt = f"I choose option {player_choice}. Describe the result vividly and give me exactly 4 new numbered options (1, 2, 3, 4)."

            self.gm_history.append({"role": "user", "content": final_prompt})

            streamed_response = ""
            for chunk in self.chat_client.chat_streaming(self.gm_history):
                if chunk:
                    streamed_response += chunk
                    temp_conversation = self.conversation + [("GM", streamed_response)]
                    yield True, temp_conversation, player_choice, chunk

            if not streamed_response.strip():
                error_msg = "No response received from AI model"
                self.chat_logger.append_system_message(f"Error: {error_msg}")
                yield False, self.conversation, player_choice, error_msg
                return

            if not self._is_response_complete(streamed_response) and is_final_step:
                if not streamed_response.rstrip().endswith(('.', '!', '?')):
                    streamed_response += "."
                if len(streamed_response.split()) < 30:
                    fallback = f" With choice {player_choice}, the adventure concludes. Peace settles and the journey ends with resolution."
                    streamed_response += fallback

            self.gm_history.append({"role": "assistant", "content": streamed_response})
            self.conversation.append(("GM", streamed_response))
            self.chat_logger.append_message("GM", streamed_response)

            self.chat_client.is_final_step = False

            if is_final_step:
                self.chat_logger.append_system_message(f"Adventure completed after {self.step_count} steps")

            # Final yield with empty content to signal completion (content already streamed)
            yield True, self.conversation, player_choice, ""

        except Exception as e:
            error_msg = f"Error in take_step_streaming: {str(e)}"
            self.chat_logger.append_system_message(f"Error in step {self.step_count}: {str(e)}")
            self.chat_client.is_final_step = False
            yield False, self.conversation, None, f"{ErrorMessages.GAME_STEP}: {str(e)}"

    def reset(self):
        self.conversation.clear()
        self.step_count = 0
        self.gm_history = self.gm_history[:1]
        self.chat_logger.finalize_session()
        self._start_session_with_model_info()

    def finalize_game(self):
        self.chat_logger.finalize_session()

    def get_game_info(self) -> Dict[str, Any]:
        return {
            "step_count": self.step_count,
            "total_messages": len(self.conversation),
            "gm_history_length": len(self.gm_history),
            "last_message": self.conversation[-1] if self.conversation else None,
            "session_log_file": str(self.chat_logger.session_file) if self.chat_logger.session_file else None,
            "chat_client_info": {
                "api_url": getattr(self.chat_client, 'api_url', 'unknown'),
                "model": getattr(self.chat_client, 'model', 'unknown'),
                "provider": getattr(self.chat_client, 'api_provider', 'unknown'),
                "is_final_step": getattr(self.chat_client, 'is_final_step', False)
            }
        }

    def __del__(self):
        try:
            if hasattr(self, 'chat_logger'):
                self.chat_logger.finalize_session()
        except:
            pass


class ConversationFormatter:
    @staticmethod
    def to_gradio_format(conversation: List[Tuple[str, str]]) -> List[List[str]]:
        # Gradio Chatbot expects list of [user_message, bot_message] pairs
        # Convert GM/Player conversation to this format
        result = []
        i = 0
        while i < len(conversation):
            speaker, content = conversation[i]
            if speaker == "GM":
                # GM message goes in bot slot (index 1)
                result.append([None, content])
            else:
                # Player message goes in user slot (index 0)
                # Check if next message is GM response
                if i + 1 < len(conversation) and conversation[i + 1][0] == "GM":
                    result.append([content, conversation[i + 1][1]])
                    i += 1  # Skip the GM message we just added
                else:
                    result.append([content, None])
            i += 1
        return result

    @staticmethod
    def to_markdown(conversation: List[Tuple[str, str]]) -> str:
        markdown = "# RPG Adventure Log\n\n"
        for speaker, content in conversation:
            prefix = "**Game Master:**" if speaker == "GM" else "**Player:**"
            markdown += f"{prefix}\n{content}\n\n"
        return markdown

    @staticmethod
    def to_plain_text(conversation: List[Tuple[str, str]]) -> str:
        text = "RPG Adventure Log\n" + "=" * 50 + "\n\n"
        for speaker, content in conversation:
            text += f"{speaker}: {content}\n\n"
        return text