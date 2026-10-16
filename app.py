"""Flask-based RPG Chatbot Application"""
import json
import time
import requests as http_requests
from flask import Flask, render_template, request, jsonify, Response, stream_with_context
from config import Config
from game_logic import GameState, ConversationFormatter
from chatbot import ChatClient
from prompts import PromptManager

app = Flask(__name__)

# Store game states per session (in production, use proper session management)
game_sessions = {}


def get_provider_config(provider_name: str) -> dict:
    """Get configuration for a specific provider"""
    provider_configs = {
        "OpenAI (GPT)": {
            "api_url": "https://api.openai.com/v1/chat/completions",
            "default_model": "gpt-4o-mini",
            "models": ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"],
            "requires_key": True,
            "provider": "openai",
            "timeout": (10, 60),
        },
        "Anthropic (Claude)": {
            "api_url": "https://api.anthropic.com/v1/messages",
            "default_model": "claude-haiku-5-5",
            "models": [
                "claude-haiku-5-5",
                "claude-sonnet-5-5",
                "claude-opus-5-5",
            ],
            "requires_key": True,
            "provider": "anthropic",
            "timeout": (10, 60),
        },
        "Google (Gemini)": {
            "api_url": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
            "default_model": "gemini-2.5-flash",
            "models": [
                "gemini-2.5-flash",
                "gemini-2.5-flash-lite",
                "gemini-2.5-pro",
            ],
            "requires_key": True,
            "provider": "gemini",
            "timeout": (10, 60),
        },
        "DeepSeek": {
            "api_url": "https://api.deepseek.com/chat/completions",
            "default_model": "deepseek-chat",
            "models": ["deepseek-chat", "deepseek-reasoner"],
            "requires_key": True,
            "provider": "deepseek",
            "timeout": (10, 120),
        },
        "Ollama (Local)": {
            "api_url": "http://localhost:11434/v1/chat/completions",
            "default_model": "llama3.1",
            "models": [
                "llama3.1",
                "llama3.2",
                "llama3.3",
                "mistral",
                "gemma3",
                "qwen3",
                "deepseek-r1",
                "phi4",
                "codellama",
                "gpt-oss"
            ],
            "requires_key": False,
            "provider": "ollama",
            "timeout": (10, 300),  # local models can be slow on first load
        },
        "Groq": {
    "api_url": "https://api.groq.com/openai/v1/chat/completions",
    "default_model": "llama-3.1-8b-instant",
    "models": [
        "llama-3.1-8b-instant",
        "llama-3.3-70b-versatile",
        "openai/gpt-oss-20b",
        "openai/gpt-oss-120b",
    ],
    "requires_key": True,
    "provider": "groq",
    "timeout": (10, 60),
},
        "LM Studio": {
            "api_url": "http://localhost:1234/v1/chat/completions",
            "default_model": "local-model",
            "models": ["local-model"],
            "requires_key": False,
            "provider": "lmstudio",
            "timeout": (10, 300),
        },
        "Custom Provider": {
            "api_url": "",
            "default_model": "custom-model",
            "models": ["custom-model"],
            "requires_key": True,
            "provider": "custom",
            "timeout": (10, 120),
        },
    }
    return provider_configs.get(provider_name, provider_configs["Custom Provider"])


def create_client(provider_name, model_name, api_url="", api_key=""):
    """Create a ChatClient for the selected provider"""
    provider_config = get_provider_config(provider_name)
    url = api_url.strip() if api_url.strip() else provider_config["api_url"]

    client = ChatClient(model=model_name)
    client.api_url = url
    client.api_key = api_key.strip() if api_key else ""
    client.api_provider = provider_config["provider"]
    client.timeout = provider_config["timeout"]
    return client


@app.route('/api/ollama/models')
def get_ollama_models():
    """Return installed Ollama models, with .env override support"""
    if Config.OLLAMA_MODELS:
        models = [m.strip() for m in Config.OLLAMA_MODELS.split(',') if m.strip()]
        return jsonify({'models': models, 'default_model': models[0] if models else ''})
    try:
        resp = http_requests.get('http://localhost:11434/api/tags', timeout=3)
        resp.raise_for_status()
        data = resp.json()
        models = [m['name'] for m in data.get('models', [])]
        return jsonify({'models': models, 'default_model': models[0] if models else ''})
    except Exception as e:
        return jsonify({'models': [], 'default_model': '', 'error': str(e)})


@app.route('/')
def index():
    """Serve the main page"""
    providers = [
        "OpenAI (GPT)",
        "Anthropic (Claude)",
        "Google (Gemini)",
        "DeepSeek",
        "Ollama (Local)",
        "Groq",
        "LM Studio",
        "Custom Provider",
    ]
    return render_template('index.html', providers=providers)


@app.route('/api/provider/<provider_name>')
def get_provider(provider_name):
    """Get provider configuration"""
    config = get_provider_config(provider_name)
    return jsonify(config)


@app.route('/api/start', methods=['POST'])
def start_game():
    """Start a new game and stream the initial response"""
    data = request.json
    provider = data.get('provider', 'Groq')
    model = data.get('model', 'llama-3.1-8b-instant')
    api_key = data.get('api_key', '')
    api_url = data.get('api_url', '')
    session_id = data.get('session_id', 'default')

    def generate():
        try:
            client = create_client(provider, model, api_url, api_key)
            gm_prompt, player_prompt = PromptManager.load_all_prompts()
            game = GameState(gm_prompt, player_prompt, chat_client=client)
            game_sessions[session_id] = game

            for success, conversation, response in game.start_game_streaming():
                if success:
                    yield f"data: {json.dumps({'type': 'chunk', 'content': response, 'conversation': ConversationFormatter.to_gradio_format(conversation)})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'error', 'message': response})}\n\n"
                    return

            yield f"data: {json.dumps({'type': 'done', 'step': game.step_count})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return Response(stream_with_context(generate()), mimetype='text/event-stream')


@app.route('/api/step', methods=['POST'])
def next_step():
    """Take the next step in the game"""
    data = request.json
    session_id = data.get('session_id', 'default')
    max_steps = data.get('max_steps', 10)
    provider = data.get('provider', 'Groq')
    model = data.get('model', 'llama-3.1-8b-instant')
    api_key = data.get('api_key', '')
    api_url = data.get('api_url', '')

    game = game_sessions.get(session_id)
    if not game:
        return jsonify({'error': 'No active game. Start a new game first.'}), 400

    def generate():
        try:
            # Update client for this step
            client = create_client(provider, model, api_url, api_key)
            game.chat_client = client

            for success, conversation, choice, response in game.take_step_streaming(max_steps=max_steps):
                if success:
                    yield f"data: {json.dumps({'type': 'chunk', 'content': response, 'choice': choice, 'conversation': ConversationFormatter.to_gradio_format(conversation)})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'error', 'message': response})}\n\n"
                    return

            is_complete = game.step_count >= max_steps
            yield f"data: {json.dumps({'type': 'done', 'step': game.step_count, 'complete': is_complete})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return Response(stream_with_context(generate()), mimetype='text/event-stream')


@app.route('/api/autoplay', methods=['POST'])
def autoplay():
    """Auto-play the game"""
    data = request.json
    max_steps = data.get('max_steps', 5)
    delay = data.get('delay', 1)
    provider = data.get('provider', 'Groq')
    model = data.get('model', 'llama-3.1-8b-instant')
    api_key = data.get('api_key', '')
    api_url = data.get('api_url', '')
    session_id = data.get('session_id', 'default')

    def generate():
        try:
            client = create_client(provider, model, api_url, api_key)
            gm_prompt, player_prompt = PromptManager.load_all_prompts()
            game = GameState(gm_prompt, player_prompt, chat_client=client)
            game_sessions[session_id] = game

            # Start game
            yield f"data: {json.dumps({'type': 'status', 'message': 'Starting adventure...'})}\n\n"

            for success, conversation, response in game.start_game_streaming():
                if not success:
                    yield f"data: {json.dumps({'type': 'error', 'message': response})}\n\n"
                    return
                yield f"data: {json.dumps({'type': 'chunk', 'content': response, 'conversation': ConversationFormatter.to_gradio_format(conversation)})}\n\n"

            yield f"data: {json.dumps({'type': 'step_done', 'step': 0})}\n\n"

            if delay > 0:
                time.sleep(delay)

            # Auto-play steps
            while game.step_count < max_steps:
                yield f"data: {json.dumps({'type': 'status', 'message': f'Step {game.step_count + 1}/{max_steps}...'})}\n\n"

                for success, conversation, choice, response in game.take_step_streaming(max_steps=max_steps):
                    if not success:
                        yield f"data: {json.dumps({'type': 'error', 'message': response})}\n\n"
                        return
                    yield f"data: {json.dumps({'type': 'chunk', 'content': response, 'choice': choice, 'conversation': ConversationFormatter.to_gradio_format(conversation)})}\n\n"

                yield f"data: {json.dumps({'type': 'step_done', 'step': game.step_count})}\n\n"

                if game.step_count >= max_steps:
                    break

                if delay > 0:
                    time.sleep(delay)

            yield f"data: {json.dumps({'type': 'complete', 'step': game.step_count})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return Response(stream_with_context(generate()), mimetype='text/event-stream')


@app.route('/api/reset', methods=['POST'])
def reset_game():
    """Reset the game"""
    data = request.json
    session_id = data.get('session_id', 'default')

    if session_id in game_sessions:
        del game_sessions[session_id]

    return jsonify({'status': 'reset'})


if __name__ == '__main__':
    print("Starting Flask RPG Chatbot...")
    print(f"Server running at http://{Config.SERVER_HOST}:{Config.SERVER_PORT}")
    app.run(
        host=Config.SERVER_HOST,
        port=Config.SERVER_PORT,
        debug=True,
        threaded=True
    )