import React, { useState, useEffect, useRef } from 'react';
import { 
  Database, User, MessageSquare, Play, 
  ChevronRight, Search, Activity, FileText, CheckCircle2, AlertCircle 
} from 'lucide-react';

// --- API Configuration ---
const apiKey = "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"; // Groq API Key

// Exponential backoff for Groq API calls
async function callGroqAPI(messages, requireJson = false, retries = 5) {
  const delays = [1000, 2000, 4000, 8000, 16000];
  const url = `https://api.groq.com/openai/v1/chat/completions`;

  const payload = {
    model: "llama-3.3-70b-versatile",
    messages: messages,
  };

  // Groq supports JSON mode to guarantee valid JSON output
  if (requireJson) {
    payload.response_format = { type: "json_object" };
  }

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errText}`);
      }
      
      const data = await response.json();
      return data.choices?.[0]?.message?.content || "";
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delays[i]));
    }
  }
}

// Helper to ask Groq for JSON responses
async function askGroqJson(promptSystem, promptUser) {
  // Groq requires the word "JSON" in the prompt for json_object mode
  const messages = [
    { role: "system", "content": promptSystem + " Ensure you output valid JSON." },
    { role: "user", "content": promptUser }
  ];
  
  const text = await callGroqAPI(messages, true);
  try {
    // Strip markdown backticks in case the model returns formatted JSON
    const cleanText = text.replace(/```(json)?\n?/gi, '').replace(/```/g, '').trim();
    return JSON.parse(cleanText);
  } catch (e) {
    console.error("Failed to parse JSON from Groq:", text);
    return null;
  }
}

// Helper to ask Groq for standard text responses
async function askGroqText(promptSystem, promptUser) {
  const messages = [
    { role: "system", "content": promptSystem },
    { role: "user", "content": promptUser }
  ];
  return await callGroqAPI(messages, false);
}


// --- Main Application Component ---
export default function App() {
  // Application State
  const [rawText, setRawText] = useState("");
  const [messages, setMessages] = useState([]);
  const [topics, setTopics] = useState([]);
  const [centurySummaries, setCenturySummaries] = useState([]);
  const [personaData, setPersonaData] = useState(null);
  
  // UI State
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressStatus, setProgressStatus] = useState("");
  const [activeTab, setActiveTab] = useState('data'); // 'data', 'checkpoints', 'persona'
  const [errorMsg, setErrorMsg] = useState("");
  const fileInputRef = useRef(null);
  
  // Chat State
  const [chatHistory, setChatHistory] = useState([
    { role: 'assistant', text: "Hello! Once you process the conversation data, you can ask me questions like 'What are User 1's habits?' or 'What did they discuss about Portland?'" }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  const chatEndRef = useRef(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  // --- 1. Data Generation & Parsing ---
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => setRawText(evt.target.result);
      reader.readAsText(file);
    }
  };

  const generateSampleData = () => {
    let sample = "";
    let msgId = 1;
    const addMsgs = (topicMsgs) => {
      topicMsgs.forEach(m => {
        sample += `User ${m.u}: ${m.t}\n`;
        msgId++;
      });
    };

    // Topic 1: Portland & Moving (1-20)
    for(let i=0; i<10; i++) {
      addMsgs([
        {u:1, t: i===0 ? "I'm excited to be moving to a new city soon!" : "I'm looking forward to the food scene there."},
        {u:2, t: i===0 ? "Oh that's awesome! What city?" : "Portland is great for food. Have you heard of Powell's Books?"}
      ]);
    }
    // Topic 2: Music & Hobbies (21-50)
    for(let i=0; i<15; i++) {
      addMsgs([
        {u:1, t: i===0 ? "I also play in a rock band that my parents don't know about." : "Playing the guitar helps me destress."},
        {u:2, t: i===0 ? "That's awesome! Rock music is great." : "I usually listen to it when I'm feeling angry or stressed."}
      ]);
    }
    // Topic 3: Fishing & Outdoors (51-80)
    for(let i=0; i<15; i++) {
      addMsgs([
        {u:1, t: i===0 ? "I took my kids to see the fall colors in the mountains." : "I've never been fishing before."},
        {u:2, t: i===0 ? "I love the mountains. I'm an avid fisherman." : "It's definitely a great way to relax."}
      ]);
    }
    // Topic 4: Daily Habits & Personality (81-110)
    for(let i=0; i<15; i++) {
      addMsgs([
        {u:1, t: i===0 ? "I'm a bit of a night owl, usually sleep around 2 AM." : "I tend to use a lot of emojis when I text 😂"},
        {u:2, t: i===0 ? "I'm the opposite, early bird! Up at 6 AM everyday." : "I keep my messages pretty short and direct."}
      ]);
    }

    setRawText(sample);
  };

  const parseMessages = (text) => {
    const lines = text.split(/[\r\n]+/);
    const parsed = [];
    let currentId = 1;
    
    lines.forEach(line => {
      // Look for "User X:" and extract the text after it, ignoring leading junk
      const match = line.match(/(User\s*\d+):\s*(.*)/i);
      if (match) {
        // Clean up trailing CSV quotes, commas, and whitespace
        let msgText = match[2].replace(/["',]+$/, '').trim();
        if (msgText) {
          parsed.push({ id: currentId++, sender: match[1], text: msgText });
        }
      }
    });
    return parsed;
  };

  // --- 2. Processing Pipeline ---
  const processPipeline = async () => {
    if (!rawText.trim()) return;
    setIsProcessing(true);
    setErrorMsg("");
    setTopics([]);
    setCenturySummaries([]);
    setPersonaData(null);
    setActiveTab('checkpoints');

    try {
      const parsedMsgs = parseMessages(rawText);
      // Limit to 500 messages to prevent payload too large errors
      const limitedMsgs = parsedMsgs.slice(0, 500);
      setMessages(limitedMsgs);

      if (limitedMsgs.length === 0) {
        throw new Error("No valid messages found. Make sure lines look like 'User 1: text'.");
      }

      // Format messages for LLM
      const formattedChat = limitedMsgs.map(m => `[ID:${m.id}] ${m.sender}: ${m.text}`).join('\n');

      // --- A. Topic Checkpoints ---
      setProgressStatus("Analyzing chronological topic changes...");
      const topicPromptSys = "You are an AI that segments conversations into chronological topics. Return a JSON object with a 'topics' array. Each object should have: startMsgId (number), endMsgId (number), topicName (string), summary (string). Ensure contiguous coverage of all messages without gaps.";
      const topicRes = await askGroqJson(topicPromptSys, `Analyze these messages:\n${formattedChat}`);
      
      if (topicRes && topicRes.topics) {
        setTopics(topicRes.topics);
      }

      // --- B. 100 Message Checkpoints ---
      setProgressStatus("Creating 100-message interval checkpoints...");
      const centuries = [];
      for (let i = 0; i < parsedMsgs.length; i += 100) {
        const chunk = parsedMsgs.slice(i, i + 100);
        const chunkText = chunk.map(m => `[ID:${m.id}] ${m.sender}: ${m.text}`).join('\n');
        
        const summary = await askGroqText(
          "You are a summarization AI.",
          `Provide a concise 2-sentence summary of what happens in this conversation segment (Messages ${chunk[0].id} to ${chunk[chunk.length-1].id}):\n\n${chunkText}`
        );
        centuries.push({
          startMsgId: chunk[0].id,
          endMsgId: chunk[chunk.length-1].id,
          summary: summary.trim()
        });
      }
      setCenturySummaries(centuries);

      // --- C. Persona Extraction ---
      setProgressStatus("Extracting User Personas from behavioral signals...");
      setActiveTab('persona');
      const personaSys = "Extract persona details for each user based ONLY on conversational signals. Return a JSON object where keys are user names (e.g., 'User 1'), and values are objects containing arrays of strings for: 'habits', 'personal_facts', 'personality_traits', and 'communication_style'.";
      const personaRes = await askGroqJson(personaSys, `Extract personas from this conversation:\n${formattedChat}`);
      
      if (personaRes) {
        setPersonaData(personaRes);
      }

      setProgressStatus("Ready!");
    } catch (err) {
      console.error(err);
      setProgressStatus("An error occurred.");
      setErrorMsg(err.message || "Failed to process data. The conversation might be too long or invalid.");
      setActiveTab('data'); // Send back to data tab to see error
    } finally {
      setIsProcessing(false);
    }
  };

  // --- 3. Retrieval Augmented Generation (RAG) System ---
  
  // Basic keyword extraction & TF-IDF style scoring for browser
  const extractKeywords = (text) => {
    const stopWords = new Set(["what", "is", "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "about", "how", "are", "their", "they", "this", "user"]);
    return text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
  };

  const scoreText = (text, keywords) => {
    let score = 0;
    const lowerText = text.toLowerCase();
    keywords.forEach(kw => {
      const regex = new RegExp(`\\b${kw}\\b`, 'g');
      const matches = lowerText.match(regex);
      if (matches) score += matches.length;
    });
    return score;
  };

  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !personaData) return;

    const userQuery = chatInput;
    setChatInput("");
    setChatHistory(prev => [...prev, { role: 'user', text: userQuery }]);
    setIsChatting(true);

    try {
      const keywords = extractKeywords(userQuery);

      // 1. Retrieve relevant Topic Summaries
      const scoredTopics = topics.map(t => ({
        ...t,
        score: scoreText(t.topicName + " " + t.summary, keywords)
      })).sort((a, b) => b.score - a.score);
      const topTopics = scoredTopics.slice(0, 3); // Get top 3 topics

      // 2. Retrieve relevant Message Chunks
      const scoredMsgs = messages.map(m => ({
        ...m,
        score: scoreText(m.text, keywords)
      })).sort((a, b) => b.score - a.score);
      const topMsgs = scoredMsgs.slice(0, 10); // Get top 10 individual messages

      // 3. Combine into Prompt for Generation
      const ragPrompt = `
      You are an intelligent chatbot answering questions based on an analyzed conversation.
      
      --- PERSONA DATA ---
      ${JSON.stringify(personaData, null, 2)}
      
      --- RELEVANT TOPIC SUMMARIES ---
      ${topTopics.map(t => `Messages ${t.startMsgId}-${t.endMsgId} (${t.topicName}): ${t.summary}`).join('\n')}
      
      --- RELEVANT RAW MESSAGES ---
      ${topMsgs.map(m => `[ID:${m.id}] ${m.sender}: ${m.text}`).join('\n')}
      
      --- INSTRUCTIONS ---
      Answer the user's query using the provided context. If the query asks about a specific person's habits, traits, or style, rely heavily on the Persona Data. If it asks about events or what was said, rely on the Summaries and Raw Messages.
      Be conversational and direct.
      `;

      const answer = await askGroqText(ragPrompt, `User Query: ${userQuery}`);
      
      setChatHistory(prev => [...prev, { role: 'assistant', text: answer }]);
    } catch (err) {
      setChatHistory(prev => [...prev, { role: 'assistant', text: "Sorry, I encountered an error retrieving that information." }]);
    } finally {
      setIsChatting(false);
    }
  };

  // --- UI Components ---
  return (
    <div className="flex h-screen bg-gray-900 text-gray-100 font-sans">
      
      {/* Left Panel: Ingestion & Internals (Parts 1 & 2) */}
      <div className="w-1/2 flex flex-col border-r border-gray-700 bg-gray-800 shadow-xl z-10">
        <div className="p-4 border-b border-gray-700 bg-gray-900 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Activity className="text-blue-400" size={24} />
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">RAG Processing Engine</h1>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setActiveTab('data')} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'data' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>Data</button>
            <button onClick={() => setActiveTab('checkpoints')} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'checkpoints' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>Checkpoints</button>
            <button onClick={() => setActiveTab('persona')} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'persona' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>Persona</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {/* TAB: DATA INGESTION */}
          {activeTab === 'data' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2"><Database size={16}/> Raw Conversation Data</h2>
                <div className="flex gap-3 items-center">
                  <input type="file" accept=".txt,.csv" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
                  <button onClick={() => fileInputRef.current?.click()} className="text-xs text-indigo-400 hover:text-indigo-300 underline">Upload CSV/TXT</button>
                  <button onClick={generateSampleData} className="text-xs text-blue-400 hover:text-blue-300 underline">Load {'>'}100 Msg Sample</button>
                </div>
              </div>
              <textarea 
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="Paste conversation here (e.g. User 1: Hello!)..."
                className="w-full h-96 bg-gray-950 border border-gray-700 rounded-lg p-3 text-sm text-gray-300 focus:outline-none focus:border-blue-500 font-mono resize-none"
              />
              <button 
                onClick={processPipeline}
                disabled={isProcessing || !rawText}
                className={`w-full py-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-all ${isProcessing || !rawText ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg'}`}
              >
                {isProcessing ? <Activity className="animate-spin" size={20} /> : <Play size={20} />}
                {isProcessing ? progressStatus : "Process RAG & Extract Persona"}
              </button>
              {errorMsg && (
                <div className="text-red-400 text-sm mt-2 p-3 bg-red-900/20 rounded-lg border border-red-900/50 flex items-start gap-2">
                  <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}
            </div>
          )}

          {/* TAB: CHECKPOINTS (Part 1) */}
          {activeTab === 'checkpoints' && (
            <div className="space-y-6">
              {!topics.length && !isProcessing && (
                <div className="text-center text-gray-500 mt-10">Process data to view checkpoints.</div>
              )}
              {isProcessing && <div className="text-center text-blue-400 animate-pulse">{progressStatus}</div>}
              
              {topics.length > 0 && (
                <>
                  <div>
                    <h2 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                      <FileText size={16}/> 1. Topic Checkpoints
                    </h2>
                    <div className="space-y-3">
                      {topics.map((t, idx) => (
                        <div key={idx} className="bg-gray-800 border border-gray-700 p-3 rounded-lg shadow-sm border-l-4 border-l-emerald-500">
                          <div className="flex justify-between items-start mb-1">
                            <span className="font-bold text-gray-200">{t.topicName}</span>
                            <span className="text-xs bg-gray-700 px-2 py-1 rounded text-gray-400">Msgs {t.startMsgId} - {t.endMsgId}</span>
                          </div>
                          <p className="text-sm text-gray-400">{t.summary}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h2 className="text-sm font-semibold text-purple-400 uppercase tracking-wider mb-3 flex items-center gap-2 mt-8">
                      <CheckCircle2 size={16}/> 2. 100-Message Checkpoints
                    </h2>
                    <div className="space-y-3">
                      {centurySummaries.map((c, idx) => (
                        <div key={idx} className="bg-gray-800 border border-gray-700 p-3 rounded-lg shadow-sm border-l-4 border-l-purple-500">
                          <div className="flex justify-between items-start mb-1">
                            <span className="font-bold text-gray-200">Segment {idx + 1}</span>
                            <span className="text-xs bg-gray-700 px-2 py-1 rounded text-gray-400">Msgs {c.startMsgId} - {c.endMsgId}</span>
                          </div>
                          <p className="text-sm text-gray-400">{c.summary}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB: PERSONA (Part 2) */}
          {activeTab === 'persona' && (
            <div className="space-y-6">
               {!personaData && !isProcessing && (
                <div className="text-center text-gray-500 mt-10">Process data to view extracted personas.</div>
              )}
              {isProcessing && <div className="text-center text-blue-400 animate-pulse">{progressStatus}</div>}

              {personaData && Object.entries(personaData).map(([userName, data], idx) => (
                <div key={idx} className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
                  <div className="bg-gray-750 px-4 py-3 border-b border-gray-700 flex items-center gap-2 bg-gray-900">
                    <User className="text-blue-400" size={18} />
                    <h3 className="font-bold text-lg">{userName}</h3>
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-4">
                    <div className="bg-gray-900/50 p-3 rounded-lg">
                      <h4 className="text-xs font-bold text-indigo-400 uppercase mb-2">Habits</h4>
                      <ul className="text-sm text-gray-300 list-disc pl-4 space-y-1">
                        {data.habits?.map((item, i) => <li key={i}>{item}</li>) || <li>None detected</li>}
                      </ul>
                    </div>
                    <div className="bg-gray-900/50 p-3 rounded-lg">
                      <h4 className="text-xs font-bold text-pink-400 uppercase mb-2">Personal Facts</h4>
                      <ul className="text-sm text-gray-300 list-disc pl-4 space-y-1">
                        {data.personal_facts?.map((item, i) => <li key={i}>{item}</li>) || <li>None detected</li>}
                      </ul>
                    </div>
                    <div className="bg-gray-900/50 p-3 rounded-lg">
                      <h4 className="text-xs font-bold text-amber-400 uppercase mb-2">Traits</h4>
                      <ul className="text-sm text-gray-300 list-disc pl-4 space-y-1">
                        {data.personality_traits?.map((item, i) => <li key={i}>{item}</li>) || <li>None detected</li>}
                      </ul>
                    </div>
                    <div className="bg-gray-900/50 p-3 rounded-lg">
                      <h4 className="text-xs font-bold text-emerald-400 uppercase mb-2">Comms Style</h4>
                      <ul className="text-sm text-gray-300 list-disc pl-4 space-y-1">
                        {data.communication_style?.map((item, i) => <li key={i}>{item}</li>) || <li>None detected</li>}
                      </ul>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel: Chatbot (Part 3) */}
      <div className="w-1/2 flex flex-col bg-gray-950">
        <div className="p-4 border-b border-gray-800 bg-gray-900 flex items-center gap-2">
          <MessageSquare className="text-indigo-400" size={24} />
          <h2 className="text-lg font-bold text-gray-100">Persona & History Query Bot</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {chatHistory.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] p-3 rounded-2xl ${
                msg.role === 'user' 
                  ? 'bg-blue-600 text-white rounded-tr-none' 
                  : 'bg-gray-800 text-gray-200 border border-gray-700 rounded-tl-none shadow-md'
              }`}>
                {msg.text}
              </div>
            </div>
          ))}
          {isChatting && (
             <div className="flex justify-start">
               <div className="bg-gray-800 border border-gray-700 p-3 rounded-2xl rounded-tl-none flex gap-1 items-center">
                 <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></div>
                 <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                 <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
               </div>
             </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Chat Input */}
        <div className="p-4 bg-gray-900 border-t border-gray-800">
          {!personaData && (
             <div className="mb-2 text-xs text-amber-500 flex items-center gap-1">
               <AlertCircle size={14} /> Process data first to enable querying.
             </div>
          )}
          <form onSubmit={handleChatSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500" size={18} />
              <input 
                type="text" 
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={!personaData || isChatting}
                placeholder="E.g., What are their habits? How do they talk?"
                className="w-full bg-gray-800 border border-gray-700 rounded-full py-3 pl-10 pr-4 text-sm text-gray-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
              />
            </div>
            <button 
              type="submit" 
              disabled={!personaData || isChatting || !chatInput.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-full p-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              <ChevronRight size={20} />
            </button>
          </form>
        </div>
      </div>
      
      {/* Inline styles for custom scrollbar */}
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #6b7280; }
      `}} />
    </div>
  );
}
