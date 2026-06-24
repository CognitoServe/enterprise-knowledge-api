# Enterprise Knowledge RAG Engine & Dashboard

A production-ready RAG (Retrieval-Augmented Generation) REST API and premium Web UI that converts any PDF into a queryable knowledge base. Upload a PDF → chunks are embedded and stored in ChromaDB → ask questions and get grounded LLM answers with source citations and an interactive context drawer.

## Architecture

```
PDF Upload → Text Extraction → Chunking (200 words, 20 overlap)
                                    ↓
                              ChromaDB Storage
                              (embeddings auto-generated)
                                    ↓
Question → Embed Query → Top-3 Retrieval → Grounded Prompt → LLM → Answer + Sources
```

## Tech Stack

| Layer       | Tool                          |
|-------------|-------------------------------|
| Frontend UI | HTML5, CSS3 (Custom Variables), Vanilla JS |
| Framework   | FastAPI                       |
| Vector DB   | ChromaDB (persistent on disk) |
| LLM         | OpenRouter (GPT-4o-mini)      |
| PDF Parser  | PyPDF2                        |
| Embeddings  | ChromaDB default (all-MiniLM-L6-v2) |

## Setup

```bash
# 1 — Clone and enter the project
cd knowledge-api

# 2 — Create a virtual environment
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS / Linux

# 3 — Install dependencies
pip install -r requirements.txt

# 4 — Configure your API key
copy .env.example .env
# Edit .env and add your OpenRouter API key

# 5 — Run the server
uvicorn main:app --reload
```

- **Web UI & REST API** live at `http://127.0.0.1:8000/`
- **Interactive docs (Swagger)** at `http://127.0.0.1:8000/docs`

## Web UI Dashboard Features

A premium glassmorphic dark-theme Web UI is served directly from the root endpoint:
- **Interactive Document Upload**: Drag-and-drop zone with animated upload progress states.
- **Source Inspector Drawer**: Click on any source badge in the chat history to slide out a drawer showing the exact text chunk extracted from the PDF that the LLM used for grounding.
- **Live Status Monitor**: Pulsing connection light showing FastAPI backend status.
- **Chat Management**: One-click option to clear chat history and restart sessions.

## Endpoints

### `GET /health`
Liveness check.

```bash
curl http://127.0.0.1:8000/health
```
```json
{"status": "ok"}
```

---

### `POST /upload`
Upload a PDF file. The API extracts text, chunks it, embeds the chunks, and stores them in ChromaDB.

```bash
curl -X POST http://127.0.0.1:8000/upload \
  -F "file=@report.pdf"
```
```json
{"message": "PDF processed successfully", "chunks_stored": 42}
```

---

### `POST /query`
Ask a question against the stored knowledge base. Returns a grounded LLM answer and the chunk objects (ID and text content) used as sources.

```bash
curl -X POST http://127.0.0.1:8000/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What is the refund policy?"}'
```
```json
{
  "answer": "The refund policy states...",
  "sources": [
    {
      "id": "chunk_a1b2c3d4_3",
      "text": "..."
    }
  ]
}
```

## Project Structure

```
knowledge-api/
├── main.py            # FastAPI app — all endpoints and RAG logic
├── requirements.txt   # Python dependencies
├── .env.example       # Environment variable template
├── .env               # Your actual API key (git-ignored)
├── .gitignore         # Git ignore rules
├── static/            # Frontend Web UI Assets
│   ├── index.html     # Dashboard layout
│   ├── styles.css     # Premium custom CSS variables & layout
│   └── app.js         # Upload, query, health monitor & Markdown logic
└── chroma_db/         # ChromaDB persistent storage (auto-created)
```

## How It Works

1. **Upload** — PyPDF2 reads every page of the PDF. The raw text is split into 200-word chunks with a 20-word overlap so context isn't lost at chunk boundaries.

2. **Store** — ChromaDB's default embedding function (all-MiniLM-L6-v2 via ONNX) vectorizes each chunk and stores it on disk under `./chroma_db/`.

3. **Query** — The user's question is embedded with the same model. ChromaDB returns the top 3 nearest chunks by cosine similarity.

4. **Answer** — A grounded prompt is built containing only the retrieved chunks. The LLM (GPT-4o-mini via OpenRouter) is instructed to answer strictly from the provided context — no hallucination, no outside knowledge.
