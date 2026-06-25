def extract_resume_text(file_bytes: bytes) -> str:
    """Extract all text from a resume PDF."""
    import fitz
    text_parts = []
    with fitz.open(stream=file_bytes, filetype="pdf") as pdf:
        for page in pdf:
            text = page.get_text().strip()
            if text:
                text_parts.append(text)
    return "\n\n".join(text_parts)


def analyze_resume(resume_text: str, job_description: str, api_key: str) -> dict:
    """Run full resume analysis: ATS score, suggestions, interview questions."""
    import json
    from langchain_google_genai import ChatGoogleGenerativeAI
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_core.output_parsers import StrOutputParser

    llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", google_api_key=api_key)

    jd_section = f"\n\nJob Description:\n{job_description}" if job_description.strip() else ""

    prompt = ChatPromptTemplate.from_messages([
        ("system",
         "You are an expert ATS (Applicant Tracking System) analyst and career coach with 15+ years of experience "
         "in recruitment and resume optimization.\n\n"
         "Analyze the resume below and return a detailed JSON response with EXACTLY this structure:\n\n"
         '{{\n'
         '  "ats_score": <number 0-100>,\n'
         '  "score_breakdown": {{\n'
         '    "keywords": <0-25>,\n'
         '    "formatting": <0-20>,\n'
         '    "experience": <0-25>,\n'
         '    "skills": <0-20>,\n'
         '    "education": <0-10>\n'
         '  }},\n'
         '  "strengths": ["strength1", "strength2", ...],\n'
         '  "improvements": [\n'
         '    {{"issue": "...", "suggestion": "...", "priority": "high|medium|low"}},\n'
         '    ...\n'
         '  ],\n'
         '  "missing_keywords": ["keyword1", "keyword2", ...],\n'
         '  "interview_questions": [\n'
         '    {{"question": "...", "category": "technical|behavioral|situational", "tip": "..."}},\n'
         '    ...\n'
         '  ],\n'
         '  "overall_summary": "...",\n'
         '  "recommended_roles": ["role1", "role2", ...]\n'
         '}}\n\n'
         "SCORING RULES:\n"
         "- keywords (0-25): match with job description or industry terms\n"
         "- formatting (0-20): clear sections, bullet points, dates, contact info\n"
         "- experience (0-25): relevance, quantified achievements, progression\n"
         "- skills (0-20): technical and soft skills listed\n"
         "- education (0-10): degree, certifications, relevant coursework\n\n"
         "Generate 8-10 interview questions covering technical, behavioral, and situational categories.\n"
         "Return ONLY valid JSON, no markdown code blocks."
         ),
        ("human", "Resume:\n{resume_text}{jd_section}\n\nAnalyze this resume."),
    ])

    chain = prompt | llm | StrOutputParser()
    raw = chain.invoke({"resume_text": resume_text, "jd_section": jd_section})

    # Clean and parse JSON
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip().rstrip("```").strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Fallback: return raw as summary
        return {
            "ats_score": 0,
            "score_breakdown": {},
            "strengths": [],
            "improvements": [],
            "missing_keywords": [],
            "interview_questions": [],
            "overall_summary": raw,
            "recommended_roles": [],
        }
