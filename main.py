import os
import io
import uuid
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from PyPDF2 import PdfReader
import chromadb
from openai import OpenAI

load_dotenv(override=True)

# ── App ───────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Enterprise Knowledge API",
    description="RAG-powered PDF knowledge base — chunk, embed, store, query with grounded LLM answers.",
    version="1.0.0",
)

# ── ChromaDB (persistent on disk) ────────────────────────────────────────
chroma_client = chromadb.PersistentClient(path="./chroma_db")
collection = chroma_client.get_or_create_collection(name="knowledge_base")

# ── LLM via OpenRouter (OpenAI-compatible SDK) ───────────────────────────
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
llm = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=OPENROUTER_API_KEY,
)
MODEL = "openai/gpt-4o-mini"


# ── Helpers ───────────────────────────────────────────────────────────────

def chunk_text(text: str, chunk_size: int = 200, overlap: int = 20) -> list[str]:
    """
    Split text into overlapping word-level chunks.
    chunk_size  — max words per chunk
    overlap     — words shared between consecutive chunks
    """
    words = text.split()
    if not words:
        return []

    chunks: list[str] = []
    start = 0
    while start < len(words):
        end = start + chunk_size
        chunk = " ".join(words[start:end])
        if chunk.strip():
            chunks.append(chunk)
        start += chunk_size - overlap
    return chunks


def extract_pdf_text(file_bytes: bytes) -> str:
    """Read every page of a PDF and return the concatenated plain text."""
    reader = PdfReader(io.BytesIO(file_bytes))
    pages: list[str] = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            pages.append(text)
    return "\n".join(pages)


# ── Request / response models ────────────────────────────────────────────

class QueryRequest(BaseModel):
    question: str


# ── Endpoints ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    """Liveness probe."""
    return {"status": "ok"}


STATIC_DIR = Path(__file__).parent / "static"

@app.get("/", include_in_schema=False)
async def root():
    return FileResponse(STATIC_DIR / "index.html")

@app.get("/static/{filepath:path}", include_in_schema=False)
async def serve_static(filepath: str):
    file = (STATIC_DIR / filepath).resolve()
    # Prevent directory traversal attacks
    if not str(file).startswith(str(STATIC_DIR.resolve())):
        raise HTTPException(status_code=403, detail="Forbidden")
    if file.is_file():
        return FileResponse(file)
    raise HTTPException(status_code=404, detail="File not found")



@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    """
    Accept a PDF, extract text, chunk it, embed + store in ChromaDB.
    Returns the number of chunks stored.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    raw = await file.read()

    # 1 — extract text
    text = extract_pdf_text(raw)
    if not text.strip():
        raise HTTPException(status_code=400, detail="Could not extract any text from the PDF.")

    # 2 — chunk
    chunks = chunk_text(text, chunk_size=200, overlap=20)
    if not chunks:
        raise HTTPException(status_code=400, detail="PDF produced zero text chunks.")

    # 3 — unique IDs per chunk (batch prefix keeps uploads distinguishable)
    batch_id = uuid.uuid4().hex[:8]
    ids = [f"chunk_{batch_id}_{i}" for i in range(len(chunks))]

    # 4 — store in ChromaDB (default embedding function handles vectorization)
    collection.add(documents=chunks, ids=ids)

    return {"message": "PDF processed successfully", "chunks_stored": len(chunks)}


@app.post("/query")
async def query(body: QueryRequest):
    """
    Embed the question, retrieve top-3 chunks from ChromaDB,
    build a grounded prompt, call the LLM, return answer + sources.
    """
    num_chunks = collection.count()
    if num_chunks == 0:
        raise HTTPException(status_code=400, detail="Knowledge base is empty. Upload a PDF first.")

    # 1 — retrieve top 3 relevant chunks
    n_results = min(3, num_chunks)
    results = collection.query(query_texts=[body.question], n_results=n_results)

    retrieved_chunks: list[str] = results["documents"][0]
    chunk_ids: list[str] = results["ids"][0]

    # 2 — build grounded prompt
    context_block = "\n\n".join(
        f"[{cid}]: {text}" for cid, text in zip(chunk_ids, retrieved_chunks)
    )

    grounded_prompt = (
        "You are a precise research assistant. Answer the user's question using ONLY "
        "the retrieved context chunks below. Do NOT use outside knowledge.\n"
        "If the chunks do not contain enough information to answer, say so explicitly.\n\n"
        f"--- CONTEXT ---\n{context_block}\n--- END CONTEXT ---\n\n"
        f"Question: {body.question}\n\n"
        "Provide a clear, concise answer."
    )

    # 3 — call LLM via OpenRouter
    response = llm.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": grounded_prompt}],
        temperature=0.2,
    )

    answer = response.choices[0].message.content

    sources = [{"id": cid, "text": text} for cid, text in zip(chunk_ids, retrieved_chunks)]
    return {"answer": answer, "sources": sources}

