from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor
import re


@lru_cache(maxsize=1)
def get_embeddings():
    """Use HuggingFace sentence-transformers for proper semantic similarity."""
    from langchain_huggingface import HuggingFaceEmbeddings
    return HuggingFaceEmbeddings(
        model_name="all-MiniLM-L6-v2",
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    )

@lru_cache(maxsize=8)
def get_llm(api_key: str):
    from langchain_google_genai import ChatGoogleGenerativeAI
    return ChatGoogleGenerativeAI(model="gemini-2.5-flash", google_api_key=api_key)

def parse_pdf(file_bytes: bytes, filename: str):
    import fitz
    from langchain_core.documents import Document
    docs = []
    with fitz.open(stream=file_bytes, filetype="pdf") as pdf:
        for i, page in enumerate(pdf):
            text = page.get_text().strip()

            # Only OCR if page has zero selectable text (scanned page)
            # Skip image extraction during indexing — that's for the OCR tab only
            if not text:
                text = _ocr_page(pdf, i)

            if text.strip():
                docs.append(Document(
                    page_content=text,
                    metadata={"source": filename, "page": i + 1}
                ))
    return docs


def _page_to_pil(pdf, page_index: int, dpi: int = 200):
    """Render a PDF page to a PIL Image."""
    from PIL import Image
    import io
    pix = pdf[page_index].get_pixmap(dpi=dpi)
    return Image.open(io.BytesIO(pix.tobytes("png")))


def _preprocess_image(image):
    """Enhance image for better OCR accuracy."""
    from PIL import Image, ImageFilter, ImageEnhance
    import numpy as np
    # Convert to grayscale
    gray = image.convert("L")
    # Increase contrast
    gray = ImageEnhance.Contrast(gray).enhance(2.0)
    # Sharpen
    gray = gray.filter(ImageFilter.SHARPEN)
    # Scale up small images
    if gray.width < 800:
        scale = 800 / gray.width
        gray = gray.resize((int(gray.width * scale), int(gray.height * scale)), Image.LANCZOS)
    return gray


def _is_meaningful_text(text: str) -> bool:
    """Filter out garbage OCR results — too short or mostly non-alphabetic."""
    if not text or len(text.strip()) < 10:
        return False
    alpha_ratio = sum(c.isalpha() or c.isspace() for c in text) / max(len(text), 1)
    return alpha_ratio > 0.4


@lru_cache(maxsize=1)
def get_easyocr_reader():
    import easyocr
    return easyocr.Reader(["en"], gpu=False, verbose=False)


def _ocr_with_easyocr(image) -> str:
    """OCR using EasyOCR with preprocessed image."""
    try:
        import numpy as np
        processed = _preprocess_image(image)
        reader = get_easyocr_reader()
        result = reader.readtext(np.array(processed), detail=0, paragraph=True)
        text = "\n".join(result)
        return text if _is_meaningful_text(text) else ""
    except Exception:
        return ""


def _ocr_with_tesseract(image) -> str:
    """OCR using pytesseract with preprocessed image."""
    try:
        import pytesseract
        processed = _preprocess_image(image)
        text = pytesseract.image_to_string(processed, config="--psm 6")
        return text if _is_meaningful_text(text) else ""
    except Exception:
        return ""


def _ocr_page(pdf, page_index: int) -> str:
    """Try EasyOCR first, fall back to Tesseract."""
    try:
        img = _page_to_pil(pdf, page_index)
        text = _ocr_with_easyocr(img)
        if not text.strip():
            text = _ocr_with_tesseract(img)
        return text.strip()
    except Exception:
        return ""


def _extract_images_from_page(pdf, page, page_num: int, filename: str) -> list[str]:
    """Extract embedded images from a page and OCR each one."""
    import io
    from PIL import Image
    texts = []
    try:
        image_list = page.get_images(full=True)
        for img_index, img_info in enumerate(image_list):
            xref = img_info[0]
            base_image = pdf.extract_image(xref)
            img_bytes = base_image["image"]
            img = Image.open(io.BytesIO(img_bytes)).convert("RGB")

            # Skip tiny images (icons, decorations)
            if img.width < 100 or img.height < 100:
                continue

            ocr_text = _ocr_with_easyocr(img)
            if not ocr_text.strip():
                ocr_text = _ocr_with_tesseract(img)

            if ocr_text.strip():
                texts.append(f"[Image {img_index + 1} on page {page_num}]:\n{ocr_text.strip()}")
    except Exception:
        pass
    return texts


def _describe_image_with_vision(img_bytes: bytes, api_key: str) -> str:
    """Use Gemini vision to describe an image when OCR fails."""
    try:
        import google.generativeai as genai
        import io
        from PIL import Image
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.5-flash")
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        response = model.generate_content([
            "Describe this image in detail. If it's a diagram, chart, graph, or figure, "
            "explain what it shows, what the axes/labels mean, and what insights can be drawn. "
            "If it contains text, transcribe it. Be concise but thorough.",
            img
        ])
        return response.text.strip()
    except Exception as e:
        return f"[Vision description unavailable: {e}]"


def extract_ocr_report(file_bytes: bytes, filename: str, api_key: str = "") -> list[dict]:
    """Full OCR report: per-page results with text, image OCR, and AI vision descriptions."""
    import fitz
    import io
    from PIL import Image

    report = []
    with fitz.open(stream=file_bytes, filetype="pdf") as pdf:
        for i, page in enumerate(pdf):
            page_num = i + 1
            native_text = page.get_text().strip()
            ocr_text = ""
            images_found = []

            if not native_text:
                ocr_text = _ocr_page(pdf, i)

            for img_info in page.get_images(full=True):
                xref = img_info[0]
                try:
                    base_image = pdf.extract_image(xref)
                    raw_bytes = base_image["image"]
                    img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
                    if img.width < 100 or img.height < 100:
                        continue

                    img_ocr = _ocr_with_easyocr(img) or _ocr_with_tesseract(img)

                    # If OCR found nothing meaningful, use Gemini vision
                    vision_description = ""
                    if not img_ocr and api_key:
                        vision_description = _describe_image_with_vision(raw_bytes, api_key)

                    images_found.append({
                        "width": img.width,
                        "height": img.height,
                        "ocr_text": img_ocr.strip() if img_ocr else "",
                        "vision_description": vision_description,
                    })
                except Exception:
                    continue

            report.append({
                "page": page_num,
                "has_native_text": bool(native_text),
                "native_text_preview": native_text[:300] if native_text else "",
                "ocr_text": ocr_text[:500] if ocr_text else "",
                "images_found": len(images_found),
                "image_ocr_results": images_found,
            })
    return report

def build_vectorstore(files: list[tuple[bytes, str]]):
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    from langchain_community.vectorstores import Chroma

    with ThreadPoolExecutor() as pool:
        results = list(pool.map(lambda f: parse_pdf(f[0], f[1]), files))

    all_docs = [doc for docs in results for doc in docs]
    chunks = RecursiveCharacterTextSplitter(
        chunk_size=1000, chunk_overlap=150
    ).split_documents(all_docs)

    return Chroma.from_documents(documents=chunks, embedding=get_embeddings())

def _build_chain(vectorstore, api_key: str, history: list[dict], system_prompt: str, question_key: str = "{question}"):
    from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
    from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
    from langchain_core.output_parsers import StrOutputParser
    from langchain_core.runnables import RunnablePassthrough

    llm = get_llm(api_key)
    retriever = vectorstore.as_retriever(search_kwargs={"k": 12})

    history_messages = []
    for msg in history[-12:]:
        if msg["role"] == "user":
            history_messages.append(HumanMessage(content=msg["content"]))
        else:
            history_messages.append(AIMessage(content=msg["content"]))

    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        MessagesPlaceholder(variable_name="chat_history"),
        ("human", question_key),
    ])

    def format_docs(docs):
        return "\n\n".join(d.page_content for d in docs)

    chain = (
        {
            "context": retriever | format_docs,
            "question": RunnablePassthrough(),
            "chat_history": lambda _: history_messages,
        }
        | prompt
        | llm
        | StrOutputParser()
    )
    return chain, retriever

def query_with_sources(vectorstore, question: str, api_key: str, history: list[dict] | None = None) -> tuple[str, list]:
    """Returns (answer, sources) where sources = [{source, page}]"""
    if history is None:
        history = []
    chain, retriever = _build_chain(
        vectorstore, api_key, history,
        system_prompt=(
            "You are a helpful and knowledgeable document assistant. Your primary job is to answer questions "
            "based on the content of the uploaded documents provided in the Document Context below.\n\n"
            "GUIDELINES:\n"
            "- Use the Document Context as your main source of information\n"
            "- If the Document Context contains relevant information, answer thoroughly and clearly from it\n"
            "- If the question is only partially covered, answer what you can from the documents and note any gaps\n"
            "- If the topic is genuinely NOT present anywhere in the context at all, respond with:\n"
            "  'This topic does not appear to be covered in your uploaded documents.'\n"
            "- You may use your knowledge to clarify or explain terms found in the documents, but ground your answer in the document content\n\n"
            "FORMATTING:\n"
            "- Use **bold** for key terms, `code` for technical terms\n"
            "- Use numbered lists for step-by-step answers, bullet points for lists of items\n"
            "- For long answers, end with a brief **Summary** section\n\n"
            "Document Context:\n{context}"
        )
    )
    answer = chain.invoke(question)
    source_docs = retriever.invoke(question)
    sources = []
    seen = set()
    for doc in source_docs:
        key = (doc.metadata.get("source", ""), doc.metadata.get("page", 0))
        if key not in seen:
            seen.add(key)
            sources.append({"source": key[0], "page": key[1], "snippet": doc.page_content[:200]})
    return answer, sources

# Keep backward compat
def query_vectorstore(vectorstore, question: str, api_key: str, history: list[dict] | None = None) -> str:
    answer, _ = query_with_sources(vectorstore, question, api_key, history)
    return answer

def generate_quiz(vectorstore, api_key: str, num_questions: int = 5) -> str:
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_core.output_parsers import StrOutputParser

    llm = get_llm(api_key)
    retriever = vectorstore.as_retriever(search_kwargs={"k": 12})

    prompt = ChatPromptTemplate.from_messages([
        ("system",
         "You are an expert quiz creator. Generate exactly {num_questions} high-quality multiple-choice questions "
         "from the document context below.\n\n"
         "FORMAT EACH QUESTION EXACTLY LIKE THIS:\n\n"
         "---\n"
         "**Q[number]. [Clear, specific question]**\n\n"
         "- A) [Option]\n"
         "- B) [Option]\n"
         "- C) [Option]\n"
         "- D) [Option]\n\n"
         "✅ **Answer: [Letter]) [Correct option]**\n\n"
         "💡 **Explanation:** [1-2 sentence explanation of why this is correct]\n\n"
         "RULES:\n"
         "- Questions must test real understanding, not just memorization\n"
         "- All 4 options must be plausible\n"
         "- Cover different topics from the document\n"
         "- Vary difficulty: easy, medium, hard\n\n"
         "Document Context:\n{context}"),
        ("human", "Generate {num_questions} quiz questions."),
    ])

    def format_docs(docs):
        return "\n\n".join(d.page_content for d in docs)

    docs = retriever.invoke("key concepts topics facts definitions")
    context = format_docs(docs)
    chain = prompt | llm | StrOutputParser()
    return chain.invoke({"context": context, "num_questions": num_questions})

def generate_notes(vectorstore, api_key: str) -> str:
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_core.output_parsers import StrOutputParser

    llm = get_llm(api_key)
    retriever = vectorstore.as_retriever(search_kwargs={"k": 15})

    prompt = ChatPromptTemplate.from_messages([
        ("system",
         "You are an expert study notes creator. Generate comprehensive, well-structured study notes "
         "from the document context below.\n\n"
         "FORMAT THE NOTES EXACTLY LIKE THIS:\n\n"
         "# 📚 [Document Title / Topic]\n\n"
         "> [One-line overview of what this document covers]\n\n"
         "---\n\n"
         "## 🎯 Key Objectives\n"
         "[3-5 bullet points of what you'll learn]\n\n"
         "---\n\n"
         "## 📖 [Topic 1 Name]\n"
         "### Core Concept\n"
         "[Clear explanation]\n\n"
         "**Key Points:**\n"
         "- [Point 1]\n"
         "- [Point 2]\n\n"
         "> 💡 **Important:** [Any critical insight]\n\n"
         "[Repeat ## sections for each major topic]\n\n"
         "---\n\n"
         "## 🔑 Key Terms & Definitions\n"
         "| Term | Definition |\n"
         "|------|------------|\n"
         "| [term] | [definition] |\n\n"
         "---\n\n"
         "## ✅ Summary\n"
         "[3-5 sentence summary of the entire document]\n\n"
         "## 🚀 Quick Review Questions\n"
         "1. [Question 1]\n"
         "2. [Question 2]\n"
         "3. [Question 3]\n\n"
         "RULES:\n"
         "- Be thorough and detailed\n"
         "- Use examples where helpful\n"
         "- Highlight the most important concepts\n\n"
         "Document Context:\n{context}"),
        ("human", "Generate comprehensive study notes."),
    ])

    docs = retriever.invoke("main topics key concepts definitions summary introduction")
    context = "\n\n".join(d.page_content for d in docs)
    chain = prompt | llm | StrOutputParser()
    return chain.invoke({"context": context})
