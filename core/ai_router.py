"""LLM client for the triage layer.

Supports Gemini, Groq and Mistral, using whichever API key is configured — set
GEMINI_API_KEY, GROQ_API_KEY or MISTRAL_API_KEY. Error tracking needs no LLM;
the ingest pipeline is pure systems work. This sits strictly off the hot path
and powers one optional feature: explaining a stack trace.
"""

import logging
import os
from dataclasses import dataclass
from enum import Enum
from typing import List, Optional

import requests

logger = logging.getLogger(__name__)

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
REQUEST_TIMEOUT = 60


class ModelProvider(Enum):
    GEMINI_PRO = "gemini-2.5-pro"
    GEMINI_FLASH = "gemini-2.5-flash"
    MISTRAL_SMALL = "mistral-small-latest"
    MISTRAL_LARGE = "mistral-large-latest"
    GROQ_GPT_OSS_120B = "openai/gpt-oss-120b"
    GROQ_GPT_OSS_20B = "openai/gpt-oss-20b"


# env var holding the key, request family, and endpoint. Mistral and Groq are
# both OpenAI-compatible, so they share a payload shape and differ only in URL.
PROVIDER_ENV = {
    ModelProvider.GEMINI_PRO: ("GEMINI_API_KEY", "gemini", GEMINI_BASE),
    ModelProvider.GEMINI_FLASH: ("GEMINI_API_KEY", "gemini", GEMINI_BASE),
    ModelProvider.MISTRAL_SMALL: ("MISTRAL_API_KEY", "openai", MISTRAL_URL),
    ModelProvider.MISTRAL_LARGE: ("MISTRAL_API_KEY", "openai", MISTRAL_URL),
    ModelProvider.GROQ_GPT_OSS_120B: ("GROQ_API_KEY", "openai", GROQ_URL),
    ModelProvider.GROQ_GPT_OSS_20B: ("GROQ_API_KEY", "openai", GROQ_URL),
}

# Human label per env var, for error messages.
PROVIDER_LABEL = {
    "GEMINI_API_KEY": "Gemini",
    "MISTRAL_API_KEY": "Mistral",
    "GROQ_API_KEY": "Groq",
}

# Tried in this order; the first with a key set wins.
PREFERENCE = (
    ModelProvider.GEMINI_PRO,
    ModelProvider.GROQ_GPT_OSS_120B,
    ModelProvider.MISTRAL_SMALL,
)


@dataclass
class ChatMessage:
    """One turn in a model conversation."""

    role: str
    content: str


class AIModelUnavailable(RuntimeError):
    """Raised when no API key is configured or the provider rejects the call."""


class AIModelRouter:
    SYSTEM_PROMPT = (
        "You are a senior engineer triaging a production error. Be concise and "
        "concrete. Never invent code that is not shown to you."
    )

    def __init__(self) -> None:
        self.providers = {
            provider: {
                "api_key": os.getenv(env),
                "api_key_env": env,
                "family": family,
                "endpoint": endpoint,
            }
            for provider, (env, family, endpoint) in PROVIDER_ENV.items()
        }

    @property
    def available(self) -> bool:
        return self.default_model() is not None

    def default_model(self) -> Optional[ModelProvider]:
        """First provider in PREFERENCE whose API key is set."""
        for provider in PREFERENCE:
            env, _, _ = PROVIDER_ENV[provider]
            if os.getenv(env):
                return provider
        return None

    # ---- payload builders (Gemini and OpenAI-compatible APIs differ) ----

    def _gemini_payload(self, prompt: str, history, **kwargs) -> dict:
        contents = []
        for msg in (history or [])[-8:]:
            # Gemini says "model" where OpenAI-style APIs say "assistant".
            role = "model" if msg.role == "assistant" else "user"
            contents.append({"role": role, "parts": [{"text": msg.content}]})
        contents.append({"role": "user", "parts": [{"text": prompt}]})

        return {
            "contents": contents,
            "systemInstruction": {"parts": [{"text": self.SYSTEM_PROMPT}]},
            "generationConfig": {
                "temperature": kwargs.get("temperature", 0.3),
                "maxOutputTokens": kwargs.get("max_tokens", 1200),
            },
        }

    def _openai_payload(self, prompt: str, history, model: ModelProvider, **kwargs) -> dict:
        messages = [{"role": "system", "content": self.SYSTEM_PROMPT}]
        for msg in (history or [])[-8:]:
            messages.append({"role": msg.role, "content": msg.content})
        messages.append({"role": "user", "content": prompt})

        return {
            "model": model.value,
            "messages": messages,
            "temperature": kwargs.get("temperature", 0.3),
            # Reasoning models (gpt-oss) spend tokens thinking before emitting
            # content, so this budget must cover both or the reply comes back empty.
            "max_tokens": kwargs.get("max_tokens", 1500),
        }

    def _key_for(self, model: ModelProvider) -> str:
        env, _, _ = PROVIDER_ENV[model]
        key = os.getenv(env)
        if not key:
            raise AIModelUnavailable(f"{env} is not set")
        return key

    def complete(
        self,
        prompt: str,
        history: Optional[List[ChatMessage]] = None,
        model: Optional[ModelProvider] = None,
        **kwargs,
    ) -> str:
        """One-shot completion against whichever provider is configured.

        Raises AIModelUnavailable rather than returning an error string, so
        callers can map the failure to a real HTTP status.
        """
        model = model or self.default_model()
        if model is None:
            raise AIModelUnavailable(
                "No AI key set — set GEMINI_API_KEY, GROQ_API_KEY or MISTRAL_API_KEY"
            )

        api_key = self._key_for(model)
        env, family, endpoint = PROVIDER_ENV[model]
        label = PROVIDER_LABEL[env]

        if family == "gemini":
            url = f"{endpoint}/{model.value}:generateContent"
            headers = {"Content-Type": "application/json", "x-goog-api-key": api_key}
            payload = self._gemini_payload(prompt, history, **kwargs)
        else:
            url = endpoint
            headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
            payload = self._openai_payload(prompt, history, model, **kwargs)

        try:
            response = requests.post(url, headers=headers, json=payload, timeout=REQUEST_TIMEOUT)
        except requests.RequestException as e:
            raise AIModelUnavailable(f"could not reach {label}: {e}") from e

        if response.status_code == 429:
            # Distinguished because it means the key is valid but throttled —
            # a very different fix from a bad key.
            raise AIModelUnavailable(f"{label} rate limit reached; the key is valid but throttled")
        if response.status_code in (401, 403):
            raise AIModelUnavailable(f"{label} rejected the API key ({response.status_code})")
        if response.status_code != 200:
            raise AIModelUnavailable(f"{label} returned {response.status_code}")

        data = response.json()
        if family == "gemini":
            text = "".join(
                part.get("text", "")
                for candidate in data.get("candidates", [])
                for part in candidate.get("content", {}).get("parts", [])
            ).strip()
        else:
            choices = data.get("choices", [])
            text = (choices[0]["message"].get("content") or "" if choices else "").strip()

        if not text:
            raise AIModelUnavailable(f"{label} returned an empty response")
        return text
