# Persona RAG Engine

A high-fidelity RAG (Retrieval-Augmented Generation) application designed to extract deep persona insights, topic transitions, and communication patterns from conversation exports.

## 🚀 Core Features

- **Multi-Modal Analysis**: Supports both local (on-device) heuristic analysis and advanced AI-powered (Groq/LLM) analysis.
- **Dynamic Persona Building**: Automatically constructs detailed profiles including habits, traits, and communication styles.
- **Topic Segmentation**: Automatically detects shifts in conversation themes and provides a navigable timeline.
- **RAG Chat Interface**: Ask questions about the participants and get context-aware answers grounded in the conversation data.

---

## 🔍 How Topic Changes are Detected

The engine identifies topic transitions through a dual-layered approach:

### 1. Local Heuristic Detection
When running in "Local" mode (or if the AI proxy is unavailable), the engine uses a weighted keyword-matching system:
- **Segmentation**: The conversation is divided into chronological chunks (typically 80 messages each).
- **Signal Scoring**: Each chunk is scanned against a dictionary of `TOPIC_SIGNALS`. Signals like "Food and Cooking," "Parenting," or "Moving Plans" are assigned weights based on keyword frequency.
- **Theme Selection**: The highest-scoring signal (adjusted by weight) becomes the primary topic for that segment.
- **Detail Extraction**: A secondary regex-based "Notable Details" scan identifies specific sub-themes (e.g., "single-parent experience") to refine the topic name.

### 2. AI-Powered Segmentation
In "AI" mode, the entire conversation history (or a significant window) is passed to a Large Language Model (LLM) with specific instructions:
- The LLM performs a semantic analysis to identify logical boundaries between 6–10 chronological segments.
- It generates human-readable, meaningful labels (e.g., "Professional Aspirations vs. Personal Routine") instead of generic keyword-based titles.

---

## 📚 How Retrieval Works

The "Chat" interface uses a RAG architecture to ensure accuracy and reduce hallucinations.

### The Retrieval Loop
1. **Context Construction**: The engine aggregates the generated Persona Profiles, Topic Segments, and Message Checkpoints into a structured "Context Map."
2. **Local Keyword Matching**: For local retrieval, the engine performs a fuzzy keyword search across the Context Map. If a user asks about "habits," the engine prioritizes the `habits` field of the Persona data.
3. **AI-Augmented Context**: When the Groq proxy is active, the entire Context Map is injected into the LLM's system prompt. This allows the model to "reason" across the synthesized data rather than searching raw message logs, providing much faster and more accurate responses.
4. **Grounded Answering**: The LLM is strictly instructed to answer *only* using the provided context, ensuring the persona insights remain faithful to the original data.

---

## 👤 How Persona is Built

The Persona Engine builds a multi-dimensional profile for every speaker in the conversation.

### Data Synthesis Pipeline
- **Quantitative Stats**: The engine calculates average message length, question rates, and emotional intensity (detected via exclamation marks and "excitement" keywords).
- **Behavioral Benchmarking**: A speaker's stats are compared against the average of all participants. If a speaker asks significantly more questions or uses more "planning" language than others, these are flagged as distinctive **Personality Traits** or **Habits**.
- **Fact Extraction**: Specific regex patterns look for biographical declarations (e.g., "I'm moving to...", "I work as...", "I love reading...").
- **Communication Style**: The engine synthesizes "Most Repeated Terms" and average message length to describe how a person talks (e.g., "Uses upbeat wording," "Keeps replies concise," or "Guides the exchange with curiosity").

In **AI Mode**, the LLM performs a holistic read of the speaker's contributions to infer nuances like "Communication Style" and "Traits" that simple keyword matching might miss, such as sarcasm, professional tone, or empathy level.

---

## 🛠️ Setup

1. **Environment**: Copy `.env.example` to `.env`.
2. **API Key**: Add your `GROQ_API_KEY` to enable AI-powered analysis.
3. **Run**:
   ```bash
   npm install
   npm run dev
   ```
