document.addEventListener("DOMContentLoaded", () => {
    // UI Elements
    const uploadZone = document.getElementById("upload-zone");
    const fileInput = document.getElementById("file-input");
    
    const statusPanel = document.getElementById("status-panel");
    const uploadSpinner = document.getElementById("upload-spinner");
    const uploadStatusText = document.getElementById("upload-status-text");
    const successStats = document.getElementById("success-stats");
    const chunksValue = document.getElementById("chunks-value");
    const loadedDocName = document.getElementById("loaded-doc-name");
    
    const healthLight = document.getElementById("health-light");
    const healthText = document.getElementById("health-text");

    const chatForm = document.getElementById("chat-form");
    const chatInput = document.getElementById("chat-input");
    const sendBtn = document.getElementById("send-btn");
    const chatHistory = document.getElementById("chat-history");
    const clearChatBtn = document.getElementById("clear-chat-btn");

    const sourceInspector = document.getElementById("source-inspector");
    const closeInspectorBtn = document.getElementById("close-inspector-btn");
    const inspectorContent = document.getElementById("inspector-content");

    // Global state
    let lastUploadedFile = "";
    let activeSources = {}; // maps source id to text content

    // Slide out inspector on page load
    sourceInspector.classList.add("hidden");

    // Check Server Status on Load & Periodically
    async function checkHealth() {
        healthLight.className = "indicator-light pending";
        healthText.innerText = "Checking backend...";
        try {
            const res = await fetch("/health");
            const data = await res.json();
            if (res.ok && data.status === "ok") {
                healthLight.className = "indicator-light active";
                healthText.innerText = "Connected to FastAPI";
                return true;
            } else {
                throw new Error("Invalid response");
            }
        } catch (err) {
            healthLight.className = "indicator-light error";
            healthText.innerText = "Backend Offline";
            return false;
        }
    }

    checkHealth();
    setInterval(checkHealth, 10000);

    // Close Inspector
    closeInspectorBtn.addEventListener("click", () => {
        sourceInspector.classList.add("hidden");
    });

    // Drag & Drop Handlers
    uploadZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        uploadZone.classList.add("dragover");
    });

    uploadZone.addEventListener("dragleave", () => {
        uploadZone.classList.remove("dragover");
    });

    uploadZone.addEventListener("drop", (e) => {
        e.preventDefault();
        uploadZone.classList.remove("dragover");
        if (e.dataTransfer.files.length) {
            handleFileUpload(e.dataTransfer.files[0]);
        }
    });

    uploadZone.addEventListener("click", () => fileInput.click());
    
    fileInput.addEventListener("change", (e) => {
        if (e.target.files.length) {
            handleFileUpload(e.target.files[0]);
        }
    });

    // Clear Chat
    clearChatBtn.addEventListener("click", () => {
        chatHistory.innerHTML = `
            <div class="message system-msg">
                <div class="msg-bubble">
                    <p>Chat history cleared.</p>
                </div>
            </div>
        `;
        sourceInspector.classList.add("hidden");
        inspectorContent.innerHTML = `
            <div class="empty-state">
                <svg class="empty-svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="9" y1="15" x2="15" y2="15"></line><line x1="9" y1="19" x2="15" y2="19"></line><line x1="9" y1="11" x2="10" y2="11"></line></svg>
                <p>Click on any source badge in the chat history to view the exact text chunk extracted from the PDF.</p>
            </div>
        `;
    });

    // Upload Logic
    async function handleFileUpload(file) {
        if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
            alert("Please upload a PDF file.");
            return;
        }

        // Update UI state
        uploadZone.style.display = "none";
        statusPanel.style.display = "block";
        uploadSpinner.style.display = "block";
        successStats.style.display = "none";
        uploadStatusText.innerText = "Extracting & Chunking PDF...";

        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetch("/upload", {
                method: "POST",
                body: formData
            });

            const data = await res.json();

            if (!res.ok) throw new Error(data.detail || "Upload failed");

            // Success
            uploadSpinner.style.display = "none";
            uploadStatusText.innerText = "Document Processed!";
            successStats.style.display = "flex";
            chunksValue.innerText = data.chunks_stored;
            loadedDocName.innerText = file.name;
            lastUploadedFile = file.name;

            // Enable Chat
            chatInput.disabled = false;
            sendBtn.disabled = false;
            chatInput.focus();

            appendMessage("system", `Loaded document: <strong>${escapeHtml(file.name)}</strong>.<br>Generated and indexed <strong>${data.chunks_stored}</strong> vector chunks in ChromaDB.`);

        } catch (err) {
            uploadSpinner.style.display = "none";
            uploadStatusText.innerText = "Upload Failed";
            uploadStatusText.style.color = "var(--error)";
            alert(err.message);
            // Revert UI after delay
            setTimeout(() => {
                uploadZone.style.display = "flex";
                statusPanel.style.display = "none";
                uploadStatusText.style.color = "";
            }, 3000);
        }
    }

    // Chat Logic
    chatForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (!text) return;

        // Add user message
        appendMessage("user", text);
        chatInput.value = "";
        
        // Add loading placeholder
        const loadingId = "loading-" + Date.now();
        appendMessage("ai", '<div class="spinner" style="width: 16px; height: 16px; margin: 0; border-width: 2px;"></div> Analyzing document contexts...', null, loadingId);
        
        chatInput.disabled = true;
        sendBtn.disabled = true;

        try {
            const res = await fetch("/query", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: text })
            });

            const data = await res.json();
            
            // Remove loading
            const loadingElement = document.getElementById(loadingId);
            if (loadingElement) loadingElement.remove();

            if (!res.ok) throw new Error(data.detail || "Query failed");

            // Store sources in active state for retrieval on click
            if (data.sources) {
                data.sources.forEach(src => {
                    activeSources[src.id] = src.text;
                });
            }

            const sourceIds = data.sources ? data.sources.map(src => src.id) : [];
            appendMessage("ai", data.answer, sourceIds);

        } catch (err) {
            const loadingElement = document.getElementById(loadingId);
            if (loadingElement) loadingElement.remove();
            appendMessage("system", "Error: " + err.message);
        } finally {
            chatInput.disabled = false;
            sendBtn.disabled = false;
            chatInput.focus();
        }
    });

    // Helper: Escape HTML
    function escapeHtml(unsafe) {
        if (!unsafe) return "";
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    // Simple Markdown-to-HTML parser for responses
    function parseMarkdown(text) {
        if (!text) return "";
        let html = escapeHtml(text);

        // Bold (**text**)
        html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

        // Code block (```lang ... ```)
        html = html.replace(/```(.*?)\r?\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>");
        html = html.replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>");

        // Inline code (`code`)
        html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

        // Bullet points (starting with "- " or "* " on new line)
        html = html.replace(/(?:^|\n)[-*]\s+(.+)/g, "<li>$1</li>");
        // Wrap adjacent list items in <ul>
        html = html.replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>");
        // Convert double newlines to paragraphs
        html = html.split(/\n{2,}/g).map(p => {
            if (p.startsWith("<ul>") || p.startsWith("<pre>")) return p;
            return `<p>${p.replace(/\n/g, "<br>")}</p>`;
        }).join("");

        return html;
    }

    // Append Message to History
    function appendMessage(role, content, sources = null, id = null) {
        const msgDiv = document.createElement("div");
        msgDiv.className = `message ${role}-msg`;
        if (id) msgDiv.id = id;

        let contentHtml = "";
        
        // System message doesn't need markdown parsing as we might insert custom HTML tags
        if (role === "system") {
            contentHtml = `<div class="msg-bubble">${content}</div>`;
        } else {
            contentHtml = `<div class="msg-bubble">${parseMarkdown(content)}</div>`;
        }
        
        if (sources && sources.length > 0) {
            const sourcesHtml = sources.map(sid => `<span class="source-badge" data-source-id="${sid}">${sid}</span>`).join("");
            contentHtml += `<div class="sources-container">${sourcesHtml}</div>`;
        }

        msgDiv.innerHTML = contentHtml;
        chatHistory.appendChild(msgDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;

        // Attach event listeners to badges in this message
        if (sources && sources.length > 0) {
            msgDiv.querySelectorAll(".source-badge").forEach(badge => {
                badge.addEventListener("click", () => {
                    const sid = badge.getAttribute("data-source-id");
                    inspectSource(sid);
                });
            });
        }
    }

    // Inspect Source Content
    function inspectSource(sid) {
        const sourceText = activeSources[sid] || "No source content found.";
        
        sourceInspector.classList.remove("hidden");
        
        inspectorContent.innerHTML = `
            <div class="inspected-chunk">
                <div class="chunk-card-header">
                    <span class="chunk-card-title">${escapeHtml(sid)}</span>
                    <span class="chunk-card-score">Retrieved Context</span>
                </div>
                <div class="chunk-card-text">${escapeHtml(sourceText)}</div>
            </div>
        `;
    }
});
