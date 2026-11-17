# VetriAI Project

React + Vite frontend and FastAPI backend for VetriAI. The backend uses the `VetriAI_Custom_Arch` model, SQLite conversation history, and SQLite long-term memory.

## Requirements

- Windows with Python 3.12
- Node.js and npm
- A compatible CUDA/PyTorch setup for the model configuration

## Backend setup and startup

From the `VetriAI_Project` directory, create and activate a virtual environment, then install the pinned backend dependencies:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

The backend loads `models\VetriAI_Custom_Arch` when it starts. Chat history and long-term memory are stored in `backend\data\vetriai_memory.db`.

## Frontend setup and startup

In a second PowerShell window, from `VetriAI_Project`:

```powershell
Copy-Item frontend\.env.example frontend\.env.local
cd frontend
npm ci
npm run dev
```

Set `VITE_API_URL` in `frontend\.env.local` if the backend uses a different address. The default is `http://127.0.0.1:8000`. Open the Vite URL printed by the development server.