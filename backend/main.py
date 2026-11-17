import os
import re
import secrets
import traceback

from contextlib import asynccontextmanager
from pathlib import Path
from threading import Event, Thread
from typing import Literal

import torch

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from transformers import (
    AutoTokenizer,
    AutoModelForCausalLM,
    BitsAndBytesConfig,
    TextIteratorStreamer,
    StoppingCriteria,
    StoppingCriteriaList,
)

from backend.memory import (
    get_all_memories,
    get_memory,
    save_memory,
    delete_memory,
    save_conversation,
    get_all_conversations,
    get_conversation_messages,
    delete_conversation,
    rename_conversation,
)


# ==========================================
# API KEY CONFIGURATION
# ==========================================

load_dotenv(Path(__file__).resolve().parent / ".env")

VETRIAI_API_KEY = os.getenv("VETRIAI_API_KEY")


def verify_api_key(
    x_vetriai_key: str | None = Header(default=None)
):
    if (
        not VETRIAI_API_KEY
        or not x_vetriai_key
        or not secrets.compare_digest(
            x_vetriai_key,
            VETRIAI_API_KEY
        )
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing API key"
        )


# ==========================================
# MODEL CONFIGURATION
# ==========================================

MODEL_PATH = (
    Path(__file__).resolve().parent.parent
    / "models"
    / "VetriAI_Custom_Arch"
)

tokenizer = None
model = None


# ==========================================
# STOP GENERATION
# ==========================================

class StopOnDisconnect(StoppingCriteria):

    def __init__(self, stop_event: Event):
        self.stop_event = stop_event

    def __call__(self, input_ids, scores, **kwargs):
        return self.stop_event.is_set()


# ==========================================
# REQUEST MODELS
# ==========================================

class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=1500)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    session_id: str = Field(min_length=1, max_length=100)
    model: str = "VetriAI_Custom_Arch"
    history: list[ChatMessage] = Field(
        default_factory=list,
        max_length=8
    )


class RenameChatRequest(BaseModel):
    title: str = Field(min_length=1, max_length=100)


class MemoryRequest(BaseModel):
    key: str = Field(min_length=1, max_length=100)
    value: str = Field(min_length=1, max_length=1000)


# ==========================================
# AUTOMATIC MEMORY COMMAND HANDLER
# ==========================================

def process_memory_command(message: str):

    text = message.strip()

    # Explicit remember command:
    # Remember this: My favourite project is VetriAI

    remember_match = re.match(
        r"^(?:please\s+)?remember(?:\s+this)?\s*:\s*(.+)$",
        text,
        flags=re.IGNORECASE
    )

    if remember_match:

        content = remember_match.group(1).strip()

        # Support "key = value"
        if "=" in content:

            key, value = content.split("=", 1)

        # Support "My favourite project is VetriAI"
        elif re.search(r"\s+is\s+", content, flags=re.IGNORECASE):

            key, value = re.split(
                r"\s+is\s+",
                content,
                maxsplit=1,
                flags=re.IGNORECASE
            )

        else:
            return None

        key = key.strip().lower()
        value = value.strip().rstrip(".!?")

        key = re.sub(r"^(my|the)\s+", "", key)
        key = re.sub(r"[^a-z0-9]+", "_", key)
        key = key.strip("_")

        # Standard memory key aliases
        aliases = {
            "name": "user_name",
            "my_name": "user_name",
            "favourite_project": "favourite_project",
            "favorite_project": "favourite_project",
            "business": "business_name",
        }

        key = aliases.get(key, key)

        if not key or not value:
            return None

        if len(key) > 100 or len(value) > 1000:
            return None

        save_memory(key, value)

        return {
            "action": "saved",
            "key": key,
            "value": value,
        }

    # Explicit forget command:
    # Forget memory: favourite_project

    forget_match = re.match(
        r"^(?:please\s+)?forget\s+(?:this\s+)?memory\s*:\s*(.+)$",
        text,
        flags=re.IGNORECASE
    )

    if forget_match:

        key = forget_match.group(1).strip().lower()

        key = re.sub(r"[^a-z0-9]+", "_", key)
        key = key.strip("_")

        if not key:
            return None

        aliases = {
            "name": "user_name",
            "my_name": "user_name",
            "favorite_project": "favourite_project",
            "business": "business_name",
        }

        key = aliases.get(key, key)

        deleted = delete_memory(key)

        return {
            "action": "deleted" if deleted else "not_found",
            "key": key,
        }

    return None


# ==========================================
# LOAD MODEL
# ==========================================

@asynccontextmanager
async def lifespan(app: FastAPI):

    global tokenizer, model

    print("Loading VetriAI tokenizer...")

    tokenizer = AutoTokenizer.from_pretrained(
        str(MODEL_PATH),
        trust_remote_code=True,
    )

    print("Loading VetriAI 4-bit model...")

    quant_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_use_double_quant=True,
    )

    model = AutoModelForCausalLM.from_pretrained(
        str(MODEL_PATH),
        trust_remote_code=True,
        quantization_config=quant_config,
        device_map="auto",
        dtype=torch.float16,
        low_cpu_mem_usage=True,
    )

    model.eval()

    print("VetriAI model loaded successfully!")
    print("Long-term memory is ready!")

    try:
        yield

    finally:

        model = None
        tokenizer = None

        if torch.cuda.is_available():
            torch.cuda.empty_cache()


# ==========================================
# FASTAPI APPLICATION
# ==========================================

app = FastAPI(
    title="VetriAI API",
    description="VetriAI AI Backend with Streaming and Long-Term Memory",
    version="1.3.0",
    lifespan=lifespan,
)


# ==========================================
# CORS
# ==========================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://vetriai.pages.dev",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==========================================
# HOME
# ==========================================

@app.get("/")
def home():

    return {
        "message": "Welcome to VetriAI API",
        "status": "running",
    }


# ==========================================
# HEALTH
# ==========================================

@app.get("/health")
def health():

    return {
        "status": "healthy",
        "application": "VetriAI",
        "model_loaded": model is not None,
        "streaming": True,
        "conversation_memory": True,
        "long_term_memory": True,
    }


# ==========================================
# CHAT HISTORY APIs
# ==========================================

@app.get("/chats", dependencies=[Depends(verify_api_key)])
def list_chats():

    return get_all_conversations()


@app.get("/chats/{session_id}", dependencies=[Depends(verify_api_key)])
def get_chat(session_id: str):

    messages = get_conversation_messages(session_id)

    if not messages:

        raise HTTPException(
            status_code=404,
            detail="Conversation not found"
        )

    return {
        "session_id": session_id,
        "messages": messages,
    }


@app.put("/chats/{session_id}/rename", dependencies=[Depends(verify_api_key)])
def rename_chat(
    session_id: str,
    request: RenameChatRequest
):

    title = request.title.strip()

    if not title:

        raise HTTPException(
            status_code=400,
            detail="Chat title cannot be empty"
        )

    success = rename_conversation(
        session_id,
        title
    )

    if not success:

        raise HTTPException(
            status_code=404,
            detail="Conversation not found"
        )

    return {
        "status": "success",
        "session_id": session_id,
        "title": title,
    }


@app.delete("/chats/{session_id}", dependencies=[Depends(verify_api_key)])
def remove_chat(session_id: str):

    delete_conversation(session_id)

    return {
        "status": "success",
        "message": "Conversation deleted",
    }


# ==========================================
# LONG-TERM MEMORY APIs
# ==========================================

@app.get("/memories", dependencies=[Depends(verify_api_key)])
def list_memories():

    return get_all_memories()


@app.get("/memories/{key}", dependencies=[Depends(verify_api_key)])
def read_memory(key: str):

    memory = get_memory(key)

    if memory is None:

        raise HTTPException(
            status_code=404,
            detail="Memory not found"
        )

    return memory


@app.post("/memories", dependencies=[Depends(verify_api_key)])
def create_or_update_memory(request: MemoryRequest):

    key = request.key.strip()
    value = request.value.strip()

    if not key or not value:

        raise HTTPException(
            status_code=400,
            detail="Memory key and value cannot be empty"
        )

    save_memory(key, value)

    return {
        "status": "success",
        "message": "Memory saved successfully",
        "key": key,
        "value": value,
    }


@app.delete("/memories/{key}", dependencies=[Depends(verify_api_key)])
def remove_memory(key: str):

    success = delete_memory(key)

    if not success:

        raise HTTPException(
            status_code=404,
            detail="Memory not found"
        )

    return {
        "status": "success",
        "message": "Memory deleted successfully",
        "key": key,
    }


# ==========================================
# MAIN CHAT API
# ==========================================

@app.post("/chat", dependencies=[Depends(verify_api_key)])
def chat(request: ChatRequest):

    if model is None or tokenizer is None:

        raise HTTPException(
            status_code=503,
            detail="VetriAI model is not ready",
        )

    stop_event = Event()

    def generate_stream():

        streamer = TextIteratorStreamer(
            tokenizer,
            skip_prompt=True,
            skip_special_tokens=True,
            timeout=None,
        )

        assistant_response = ""

        try:

            # Save user message
            save_conversation(
                request.session_id,
                "user",
                request.message,
            )

            # Process explicit memory commands
            memory_result = process_memory_command(
                request.message
            )

            # Load saved memories
            user_memories = get_all_memories()

            memory_context = "\n".join(
                f"- {key}: {value}"
                for key, value in user_memories.items()
            )

            # ==================================
            # SYSTEM PROMPT
            # ==================================

            system_prompt = (
                "You are VetriAI, an AI assistant developed for the VetriAI project. "
                "Always identify yourself as VetriAI when asked who you are. "
                "Never call yourself Qwen or another model name in normal conversations. "
                "Be helpful, clear, and honest. "
                "Never claim that the current model architecture or weights were "
                "created entirely from scratch. Be transparent about technical origins "
                "if explicitly asked. "
                "Your public identity is VetriAI. "
                "Do not volunteer internal implementation details or base model names. "
                "Never confuse your identity with the user's identity. "
                "Always answer questions about the user in second person. "
                "Use 'Your' instead of 'My' when describing the user's saved preferences. "
                "Never speak as if you are the user. "
                "Example: If favourite_programming_language is Python, "
                "answer: 'Your favourite programming language is Python.' "  
                "\n\nUser profile and saved memories:\n"
                + (
                    memory_context
                    if memory_context
                    else "No saved memories yet."
                )
                + "\nUse these saved facts when relevant. "
                "Do not invent personal facts about the user."
            )

            # ==================================
            # BUILD MESSAGES
            # ==================================

            messages = [
                {
                    "role": "system",
                    "content": system_prompt,
                }
            ]

            for item in request.history[-8:]:

                messages.append(
                    {
                        "role": item.role,
                        "content": item.content,
                    }
                )

            messages.append(
                {
                    "role": "user",
                    "content": request.message,
                }
            )

            # ==================================
            # MEMORY COMMAND RESPONSE
            # ==================================

            if memory_result:

                if memory_result["action"] == "saved":

                    assistant_response = (
                        f"I'll remember that. "
                        f"Saved {memory_result['key']} as "
                        f"{memory_result['value']}."
                    )

                elif memory_result["action"] == "deleted":

                    assistant_response = (
                        f"I've removed the memory "
                        f"{memory_result['key']}."
                    )

                else:

                    assistant_response = (
                        f"I couldn't find a saved memory named "
                        f"{memory_result['key']}."
                    )

                yield assistant_response

            else:

                # ==================================
                # TOKENIZER CHAT TEMPLATE
                # ==================================

                if tokenizer.chat_template:

                    prompt = tokenizer.apply_chat_template(
                        messages,
                        tokenize=False,
                        add_generation_prompt=True,
                    )

                else:

                    prompt = "\n".join(
                        f"{item['role']}: {item['content']}"
                        for item in messages
                    )

                    prompt += "\nassistant:"

                # ==================================
                # TOKENIZE INPUT
                # ==================================

                inputs = tokenizer(
                    prompt,
                    return_tensors="pt",
                    truncation=True,
                    max_length=4096,
                )

                input_device = (
                    model.get_input_embeddings().weight.device
                )

                inputs = {
                    key: value.to(input_device)
                    for key, value in inputs.items()
                }

                # ==================================
                # GENERATION SETTINGS
                # ==================================

                generation_kwargs = {
                    **inputs,
                    "streamer": streamer,
                    "max_new_tokens": 128,
                    "do_sample": False,
                    "pad_token_id": tokenizer.eos_token_id,
                    "stopping_criteria": StoppingCriteriaList(
                        [
                            StopOnDisconnect(stop_event)
                        ]
                    ),
                }

                # ==================================
                # MODEL GENERATION
                # ==================================

                def run_generation():

                    try:

                        with torch.inference_mode():

                            model.generate(
                                **generation_kwargs
                            )

                    except Exception:

                        print("Generation error:")

                        traceback.print_exc()

                        stop_event.set()
                        streamer.end()

                worker = Thread(
                    target=run_generation,
                    daemon=True,
                )

                worker.start()

                try:

                    for text_chunk in streamer:

                        if stop_event.is_set():
                            break

                        if text_chunk:

                            assistant_response += text_chunk

                            yield text_chunk

                finally:

                    worker.join(timeout=2)

            # ==================================
            # SAVE ASSISTANT RESPONSE
            # ==================================

            if assistant_response.strip():

                save_conversation(
                    request.session_id,
                    "assistant",
                    assistant_response,
                )

        except Exception:

            print("Streaming or conversation-memory error:")

            traceback.print_exc()

            yield "\n[VetriAI generation error]"

        finally:

            stop_event.set()

    # ======================================
    # STREAMING RESPONSE
    # ======================================

    return StreamingResponse(
        generate_stream(),
        media_type="text/plain; charset=utf-8",
        headers={
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "X-Accel-Buffering": "no",
        },
    )
