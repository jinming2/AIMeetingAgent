# 🎙️ AI Meeting Agent

A full-stack real-time meeting assistant with live transcription, structured summaries, next-topic prompting, and presentation-outline analysis. 

Powered by **OpenAI GPT**, **Azure Speech**, **FastAPI**, and **React**.

---

## 🧩 Features

| Feature | Description |
|---------|-------------|
| 🔊 **Live transcription** | Real-time speech-to-text via Azure Speech SDK (WebSocket streaming) |
| 📁 **Audio upload** | Upload `.mp3`, `.wav`, `.m4a` … → full transcript **+** structured summary |
| 🧠 **Structured summarization** | Streaming memory → GPT-4 incremental JSON summary |
| 🖼 **PPT outline parsing** | Upload `.pptx` → extract slide text & generate outline |
| 🧭 **Next-topic prompting** | GPT suggests what to say next (Markdown bullets) using transcript + summary + PPT outline |
| 📝 **Markdown rendering** | Bullets / summaries rendered directly in UI; one-click export |
| 💡 **Multi-panel UI** | Transcript | PPT Outline | Summary + Prompt – auto-switches 2- or 3-column |
| 🐳 **Dockerized** | One-command build & launch (`docker compose up --build`) |

---


## ⚙️ Environment Setup

### `.env` Configuration

Create a file named `.env` in the root directory with the following contents:

```env
# Required for GPT-based services
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Required for Azure live transcription
AZURE_SPEECH_KEY=your-azure-speech-key
AZURE_REGION=eastus
```
## 🐳 One-Line Docker Startup
```
docker compose up --build
```
Exposes:

Frontend → http://localhost:5173

Backend → http://localhost:8000

## 🧠 How It Works

### 🎤 Live Mode

1. Press `Start Live`
2. Audio stream → Azure Speech SDK → transcript
3. Every sentence triggers:
   - Memory state update
   - Structured summary via GPT-4o
   - UI summary refresh

---

### 📁 Audio Upload

1. Upload `.mp3` or `.wav`
2. File sent to `/transcribe`
3. Full summary and transcript returned and rendered

---

### 🖼 PPT Upload

1. Upload `.pptx`
2. Extracts title & body text → outline (via `/ppt/auto-summary`)
3. Outline rendered as structured presentation plan

---

### ⏱ Next Topic Prompt

1. Based on:
   - `structured_summary` (from GPT)
   - `recent_transcript` (last 10 lines)
   - *(optional)* `presentation_outline`
2. Calls `/next-topic-prompt`
3. GPT returns Markdown bullet points → rendered


## 📦 API Reference

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/transcribe` | Upload audio file → { utterances[], structured_summary } |
| `WS`   | `/ws/transcribe` | Real-time mic stream → JSON events (`interim`, `final`, `structured_summary`) |
| `POST` | `/ppt/auto-summary` | Upload PPT → { overall_summary } |
| `POST` | `/next-topic-prompt` | → { markdown, section_title, confidence } |
| `POST` | `/generate-speech` *(optional)* | From summary + outline → full speech text |

## 🛠️ Local Development
### Backend deps
```
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```
### Frontend deps

```
cd meeting-assistant-frontend
npm install
npm run dev
```