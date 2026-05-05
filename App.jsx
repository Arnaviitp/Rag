import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  Download,
  FileText,
  Hash,
  KeyRound,
  MessageSquare,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  User,
  Users,
  Zap,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

const STORAGE_KEY = 'aurarag-state-v4';
const MAX_MESSAGES = 800;
const MAX_TEXTAREA_CHARS = 120000;
const DETECTION_SCAN_CHARS = 200000;
const SAMPLE_CONVERSATION = `User 1: Hi! How are you?
User 2: Good, thanks for asking. How about yourself?
User 1: I am doing pretty well. I am excited to be moving to Portland, Oregon soon.
User 2: That is awesome. What are you hoping to do there?
User 1: I want to pursue my culinary dreams and work around food.
User 2: That sounds meaningful. Do you already have a place picked out?
User 1: Not yet, but I have been researching neighborhoods and restaurants.
User 2: You sound really focused and excited about the move.
User 1: I am. I also know it will be a big change, so I am trying to plan carefully.
User 2: Planning ahead should help. I am curious to hear how it goes.`;

async function callGroqAPI(messages, requireJson = false) {
  const response = await fetch('/api/groq', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages,
      response_format: requireJson ? { type: 'json_object' } : undefined,
      temperature: 0.15,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Groq API error ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

function cleanCell(value = '') {
  return value.replace(/^"|"$/g, '').replace(/""/g, '"').trim();
}

function parseConversation(text, limit = Infinity) {
  const messages = [];
  let current = null;
  let line = '';

  const pushLine = (rawLine) => {
    if (messages.length >= limit) return true;
    const cleaned = cleanCell(rawLine);
    if (!cleaned) return false;

    const userMatch =
      cleaned.match(/^(User\s*\d+|Assistant|Human|AI|Bot|Person\s*\d+|[A-Z][\w .-]{0,28}):\s*(.+)$/i) ||
      cleaned.match(/^\[?[\d/-]+[, ]+\d{1,2}:\d{2}(?::\d{2})?\s?(?:AM|PM)?\]?\s*-?\s*([^:]{1,32}):\s*(.+)$/i);

    if (userMatch) {
      current = {
        id: messages.length + 1,
        sender: userMatch[1].trim(),
        text: userMatch[2].trim(),
      };
      messages.push(current);
      return messages.length >= limit;
    }

    if (current) {
      current.text = `${current.text} ${cleaned}`.trim();
    }
    return false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\n') {
      if (pushLine(line)) break;
      line = '';
    } else if (char !== '\r') {
      line += char;
    }
  }

  if (line && messages.length < limit) {
    pushLine(line);
  }

  return messages.map((message, index) => ({
    ...message,
    id: index + 1,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }));
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    try {
      return JSON.parse(match[0]);
    } catch {
      return fallback;
    }
  }
}

function splitChunks(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function topTerms(messages) {
  const stop = new Set([
    'about',
    'after',
    'again',
    'also',
    'because',
    'been',
    'being',
    'could',
    'doing',
    'from',
    'glad',
    'good',
    'great',
    'going',
    'have',
    "i've",
    'know',
    'love',
    'just',
    'like',
    'okay',
    'really',
    'thanks',
    'that',
    "that's",
    'sure',
    'sounds',
    'their',
    'there',
    'they',
    'this',
    'very',
    'well',
    'with',
    'would',
    'what',
    "it's",
    'you',
    'your',
  ]);

  const counts = new Map();
  messages
    .flatMap((message) => message.text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) || [])
    .filter((word) => !stop.has(word))
    .forEach((word) => counts.set(word, (counts.get(word) || 0) + 1));

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([word]) => word);
}

const TOPIC_SIGNALS = [
  {
    label: 'Reading And Books',
    summary: 'The speakers focus on reading habits, books, novels, and specific book-related recommendations.',
    pattern: /\b(read|reading|books?|novels?|powell|historical novels?|favorite book)\b/gi,
    weight: 1.8,
  },
  {
    label: 'Movies And Travel',
    summary: 'The discussion moves into movies, travel, favorite places, and leisure experiences.',
    pattern: /\b(movie|movies|watch|childhood|travel|trip|visit|places?|favorite places?)\b/gi,
    weight: 1.7,
  },
  {
    label: 'Music Yoga And Running',
    summary: 'The segment highlights personal routines and hobbies such as music, yoga, running, and spare-time activities.',
    pattern: /\b(music|punk|yoga|run|running|spare time|fan)\b/gi,
    weight: 1.9,
  },
  {
    label: 'Work Schedule And Time Pressure',
    summary: 'The conversation centers on limited time, work schedules, days off, and the pressure of responsibilities.',
    pattern: /\b(work full|work|working|job|day off|busy|time|schedule|tomorrow|today|too busy)\b/gi,
    weight: 1.35,
  },
  {
    label: 'Parenting And Family',
    summary: 'The speakers discuss parenting, kids, family obligations, and single-parent experience.',
    pattern: /\b(single mom|single parent|parent|kids?|child|children|family)\b/gi,
    weight: 1.45,
  },
  {
    label: 'Moving And Portland Plans',
    summary: 'The speakers discuss moving, Portland, neighborhoods, local places, and planning a city transition.',
    pattern: /\b(portland|oregon|moving|move|new city|neighborhood|place picked|apartment|city)\b/gi,
    weight: 1.5,
  },
  {
    label: 'Food And Cooking',
    summary: 'Food, cooking, restaurants, culinary interests, and favorite meals become the main thread.',
    pattern: /\b(food|cook|cooking|culinary|restaurant|meal|dinner|lunch|breakfast|eat|kitchen)\b/gi,
    weight: 1.7,
  },
  {
    label: 'Hobbies And Free Time',
    summary: 'The exchange broadly covers hobbies, fun, free time, and personal interests.',
    pattern: /\b(hobby|hobbies|fun|free time|favorite|interest|interests)\b/gi,
    weight: 0.55,
  },
  {
    label: 'Recommendations And Local Places',
    summary: 'The speakers trade recommendations, places to visit, and concrete local suggestions.',
    pattern: /\b(recommend|recommendation|visit|places?|powell|books|check it out|favorite places|local)\b/gi,
    weight: 1,
  },
  {
    label: 'Support And Encouragement',
    summary: 'The tone is supportive, with reassurance, empathy, encouragement, and friendly affirmation.',
    pattern: /\b(understand|awesome|amazing|sounds|glad|thanks|thank|sorry|help|hope|excited|meaningful)\b/gi,
    weight: 0.25,
  },
];

function countMatches(text, pattern) {
  return (text.match(pattern) || []).length;
}

function compactBullets(items, fallback, limit = 4) {
  const seen = new Set();
  const cleaned = items
    .filter(Boolean)
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter((item) => {
      const key = item.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return cleaned.length ? cleaned.slice(0, limit) : [fallback];
}

function topicSignalsFor(chunk) {
  const text = chunk.map((message) => message.text).join(' ');
  const scored = TOPIC_SIGNALS.map((signal) => ({
    ...signal,
    score: countMatches(text, signal.pattern) * signal.weight,
  }))
    .filter((signal) => signal.score > 0)
    .sort((a, b) => b.score - a.score);

  const concrete = scored.filter((signal) => signal.label !== 'Support And Encouragement');
  if (concrete.length) return concrete;
  return scored.length ? scored : [{ label: 'General Conversation', summary: 'The speakers continue the broader conversation without one dominant concrete theme.', score: 1 }];
}

function notableDetails(chunk) {
  const text = chunk.map((message) => message.text).join(' ');
  return compactBullets(
    [
      /\bsingle mom|single parent\b/i.test(text) && 'single-parent experience',
      /\bwork full|working tomorrow|job|busy\b/i.test(text) && 'work and time pressure',
      /\bday off|free time|spare time\b/i.test(text) && 'available time and rest',
      /\bportland|oregon|neighborhood\b/i.test(text) && 'Portland or neighborhood planning',
      /\bpowell|books\b/i.test(text) && "Powell's/books recommendation",
      /\bcook|culinary|restaurant|food\b/i.test(text) && 'food or cooking interests',
      /\bread|novels?|books\b/i.test(text) && 'reading and books',
      /\bmovie|movies|travel\b/i.test(text) && 'movies or travel',
      /\bmusic|punk|yoga|running?\b/i.test(text) && 'music, yoga, or running',
    ],
    'general back-and-forth',
    3,
  );
}

function titleDetail(details, title) {
  const mapping = [
    ['Powell', 'Book Recommendation'],
    ['reading and books', 'Reading'],
    ['movies or travel', 'Movies And Travel'],
    ['music, yoga, or running', 'Personal Routines'],
    ['available time and rest', 'Days Off'],
    ['single-parent experience', 'Parenting Context'],
    ['work and time pressure', 'Time Pressure'],
    ['Portland or neighborhood planning', 'Portland Planning'],
    ['food or cooking interests', 'Food Interests'],
  ];

  const found = mapping.find(([needle, label]) => details.some((detail) => detail.includes(needle)) && !title.includes(label));
  return found?.[1] || null;
}

function summarizeChunk(chunk) {
  const signals = topicSignalsFor(chunk);
  const details = notableDetails(chunk);
  const main = signals[0];
  const secondary = signals.slice(1, 2).map((signal) => signal.label);
  const baseTitle = secondary.length ? `${main.label} + ${secondary.join(' / ')}` : main.label;
  const detail = titleDetail(details, baseTitle);

  return {
    start: chunk[0].id,
    end: chunk[chunk.length - 1].id,
    topicName: detail ? `${baseTitle} - ${detail}` : baseTitle,
    summary: `${main.summary} Key details: ${details.join(', ')}.`,
  };
}

function inferPersona(messages) {
  const grouped = messages.reduce((acc, message) => {
    acc[message.sender] = acc[message.sender] || [];
    acc[message.sender].push(message);
    return acc;
  }, {});

  const stats = Object.fromEntries(
    Object.entries(grouped).map(([name, userMessages]) => {
      const text = userMessages.map((message) => message.text).join(' ');
      const lower = text.toLowerCase();
      return [
        name,
        {
          avgLength: Math.round(text.length / Math.max(userMessages.length, 1)),
          questionRate: userMessages.filter((message) => message.text.includes('?')).length / Math.max(userMessages.length, 1),
          excitement: countMatches(text, /!|\b(excited|awesome|amazing|love|great|dream)\b/gi),
          thanks: countMatches(text, /\b(thanks|thank you|appreciate|glad|sorry|no problem)\b/gi),
          food: countMatches(lower, /\b(cook|food|eat|coffee|dinner|lunch|breakfast|restaurant|culinary|meal)\b/g),
          move: countMatches(lower, /\b(move|moving|city|home|apartment|travel|trip|portland|oregon|neighborhood)\b/g),
          planning: countMatches(lower, /\b(plan|planning|research|trying|carefully|picked|hoping|already)\b/g),
          musicFitness: countMatches(lower, /\b(music|punk|yoga|run|running|spare time|fan)\b/g),
          booksPlaces: countMatches(lower, /\b(powell|books|visit|places|neighborhood|restaurant)\b/g),
        },
      ];
    }),
  );

  const speakerCount = Math.max(Object.keys(stats).length, 1);
  const averageFor = (key) => Object.values(stats).reduce((sum, item) => sum + item[key], 0) / speakerCount;

  return Object.fromEntries(
    Object.entries(grouped).map(([name, userMessages]) => {
      const text = userMessages.map((message) => message.text).join(' ');
      const lower = text.toLowerCase();
      const userStats = stats[name];
      const avgLength = userStats.avgLength;
      const questionPct = Math.round(userStats.questionRate * 100);
      const terms = topTerms(userMessages);

      const habits = [
        userStats.food > averageFor('food') && 'Food and culinary topics stand out more for this speaker.',
        userStats.move > averageFor('move') && 'Frequently returns to place, moving, and Portland-related logistics.',
        userStats.planning > averageFor('planning') && 'Shows a planning/research habit before making decisions.',
        userStats.musicFitness > averageFor('musicFitness') && 'Mentions personal routines around music, running, or yoga.',
        userStats.booksPlaces > averageFor('booksPlaces') && 'Brings up places to visit and local recommendations.',
        userStats.questionRate > averageFor('questionRate') && `Asks questions in about ${questionPct}% of messages.`,
      ];

      const personalFacts = userMessages
        .map((message) => message.text)
        .flatMap((message) => [
          /\bmoving to portland|move to portland|moving to a new city/i.test(message) && 'Plans or discusses a move to Portland.',
          /\bculinary|restaurant|food|cooking|cook\b/i.test(message) && 'Conversation contains culinary or food-related interests.',
          /\boriginally from|moved away|family there|visit my family/i.test(message) && 'Has a personal connection to Portland or family there.',
          /\bpowell|books\b/i.test(message) && "Powell's Books appears as a concrete Portland recommendation.",
          /\bpunk music|yoga|run\b/i.test(message) && 'Shares hobbies around punk music, yoga, or running.',
          /\bresearching neighborhoods|planning carefully|place picked out/i.test(message) && 'Talks about researching neighborhoods or planning the move.',
        ]);

      const personalityTraits = [
        userStats.excitement > averageFor('excitement') && 'More openly enthusiastic than the other speaker.',
        userStats.thanks > averageFor('thanks') && 'More affirming and socially reassuring.',
        userStats.questionRate > averageFor('questionRate') && 'Guides the exchange with curiosity.',
        avgLength > averageFor('avgLength') && 'Gives comparatively richer answers.',
        avgLength < averageFor('avgLength') && 'Keeps replies comparatively concise.',
      ];

      const communicationStyle = [
        `${avgLength} characters per message on average.`,
        userStats.questionRate > 0 ? `${questionPct}% of messages are questions.` : 'Mostly responds with statements.',
        terms.length ? `Most repeated terms: ${terms.join(', ')}.` : 'No dominant repeated terms detected.',
        userStats.excitement ? 'Uses upbeat wording or exclamation for emphasis.' : 'Keeps emotional emphasis restrained.',
      ];

      return [
        name,
        {
          habits: compactBullets(habits, 'No distinctive recurring habit signal detected yet.'),
          personal_facts: compactBullets(personalFacts, 'No concrete personal facts detected yet.'),
          personality_traits: compactBullets(personalityTraits, 'No distinctive trait signal detected yet.'),
          communication_style: compactBullets(communicationStyle, 'No clear style pattern detected yet.'),
        },
      ];
    }),
  );
}

function analyzeLocally(messages) {
  const chunks = splitChunks(messages, 80);
  const checkpoints = chunks.map(summarizeChunk);
  const topics = chunks.map((chunk, index) => {
    const summary = summarizeChunk(chunk);
    return {
      startId: chunk[0].id,
      endId: chunk[chunk.length - 1].id,
      topicName: summary.topicName || `Segment ${index + 1}`,
      summary: summary.summary,
    };
  });

  return {
    checkpoints,
    topics,
    persona: inferPersona(messages),
    mode: 'Local',
  };
}

function buildContext({ persona, topics, checkpoints }) {
  return [
    JSON.stringify(persona, null, 2),
    topics.map((topic) => `[Topic ${topic.startId}-${topic.endId}] ${topic.topicName}: ${topic.summary}`).join('\n'),
    checkpoints.map((checkpoint) => `[Messages ${checkpoint.start}-${checkpoint.end}] ${checkpoint.summary}`).join('\n'),
  ].join('\n\n');
}

function answerLocally(question, analysis) {
  const q = question.toLowerCase();
  const context = buildContext(analysis);
  const lines = context
    .split('\n')
    .filter((line) => q.split(/\s+/).some((word) => word.length > 3 && line.toLowerCase().includes(word)))
    .slice(0, 6);

  if (q.includes('habit')) {
    return Object.entries(analysis.persona)
      .map(([name, data]) => `${name}: ${data.habits.join(' ')}`)
      .join('\n');
  }

  if (q.includes('style') || q.includes('communicat')) {
    return Object.entries(analysis.persona)
      .map(([name, data]) => `${name}: ${data.communication_style.join(' ')}`)
      .join('\n');
  }

  if (q.includes('trait') || q.includes('personality')) {
    return Object.entries(analysis.persona)
      .map(([name, data]) => `${name}: ${data.personality_traits.join(' ')}`)
      .join('\n');
  }

  return lines.length
    ? `Here are the strongest local matches:\n${lines.join('\n')}`
    : 'I could not find a strong local match. Server AI can answer more deeply when the Groq proxy is configured.';
}

const navItems = [
  { id: 'dashboard', icon: Database, label: 'Data' },
  { id: 'analysis', icon: Users, label: 'Profiles' },
  { id: 'chat', icon: MessageSquare, label: 'Chat' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

const sampleQuestions = [
  "What are User 1's habits?",
  'What kind of communication style do they have?',
  'What major life events came up?',
];

function SectionHeader({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="flex items-center gap-3">
          <div className="flex-center h-10 w-10 rounded-lg border border-white/10 bg-white/[0.04] text-cyan-300">
            <Icon size={20} />
          </div>
          <h2 className="text-2xl font-bold text-white">{title}</h2>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent = 'text-indigo-300' }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <div className="mb-3 flex items-center justify-between">
        <Icon className={accent} size={18} />
        <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [topics, setTopics] = useState([]);
  const [checkpoints, setCheckpoints] = useState([]);
  const [persona, setPersona] = useState(null);
  const [analysisMode, setAnalysisMode] = useState('Local');
  const [activeView, setActiveView] = useState('dashboard');
  const [rawInput, setRawInput] = useState('');
  const [aiReady, setAiReady] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ step: 'Ready', detail: 'Waiting for conversation data.', percent: 0 });
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [ragThinking, setRagThinking] = useState(null);

  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const sourceTextRef = useRef('');
  const saveTimerRef = useRef(null);
  const hasAnalysis = messages.length > 0 && Boolean(persona);
  const participants = useMemo(() => new Set(messages.map((message) => message.sender)).size, [messages]);
  const totalWords = useMemo(() => messages.reduce((sum, message) => sum + (message.text.match(/\S+/g)?.length || 0), 0), [messages]);
  const analysis = useMemo(() => ({ persona, topics, checkpoints }), [persona, topics, checkpoints]);
  const detectedInputCount = useMemo(() => {
    if (!rawInput.trim()) return '0';
    if (sourceTextRef.current && sourceTextRef.current !== rawInput) return 'Large file ready';
    const scanText = rawInput.length > DETECTION_SCAN_CHARS ? rawInput.slice(0, DETECTION_SCAN_CHARS) : rawInput;
    const count = parseConversation(scanText, MAX_MESSAGES + 1).length;
    return rawInput.length > DETECTION_SCAN_CHARS || count > MAX_MESSAGES ? `${Math.min(count, MAX_MESSAGES)}+` : count.toString();
  }, [rawInput]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatHistory, ragThinking]);

  useEffect(() => {
    if (!hasAnalysis) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ messages, topics, checkpoints, persona, analysisMode, chatHistory: chatHistory.slice(-20) }),
        );
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }, 250);

    return () => clearTimeout(saveTimerRef.current);
  }, [hasAnalysis, messages, topics, checkpoints, persona, analysisMode, chatHistory]);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const state = JSON.parse(saved);
      setMessages(state.messages || []);
      setTopics(state.topics || []);
      setCheckpoints(state.checkpoints || []);
      setPersona(state.persona || null);
      setAnalysisMode(state.analysisMode || 'Local');
      setChatHistory(state.chatHistory || []);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/status')
      .then((response) => response.json())
      .then((status) => {
        if (active) setAiReady(Boolean(status.groqConfigured));
      })
      .catch(() => {
        if (active) setAiReady(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function processData(text = sourceTextRef.current || rawInput, forceLocal = false) {
    if (isProcessing) return;
    setError(null);
    setNotice(null);

    if (!text.trim()) {
      setError('Paste a conversation, upload a file, or auto-load the sample.');
      return;
    }

    setIsProcessing(true);
    setProgress({ step: 'Parsing', detail: 'Scanning the first usable messages.', percent: 10 });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const parsed = parseConversation(text, MAX_MESSAGES);
    if (!parsed.length) {
      setError('I could not find chat lines. Use lines like "User 1: Hi" or upload a plain conversation export.');
      setIsProcessing(false);
      return;
    }

    const limited = parsed;
    setProgress({ step: 'Parsing', detail: `Found ${limited.length} usable messages.`, percent: 15 });
    setMessages(limited);

    const localResult = analyzeLocally(limited);

    try {
      if (!aiReady || forceLocal) {
        setProgress({ step: 'Local Analysis', detail: 'Building fast on-device summaries and profiles.', percent: 70 });
        setCheckpoints(localResult.checkpoints);
        setTopics(localResult.topics);
        setPersona(localResult.persona);
        setAnalysisMode('Local');
        setProgress({ step: 'Complete', detail: 'Local persona analysis is ready.', percent: 100 });
        setNotice(aiReady ? 'Finished with local analysis.' : 'Finished with local analysis. Secure Groq proxy is not available.');
        setActiveView('analysis');
        return;
      }

      const fullChat = limited.map((message) => `[${message.id}] ${message.sender}: ${message.text}`).join('\n');

      setProgress({ step: 'AI Analysis', detail: 'Generating concrete topics and speaker profiles in one request.', percent: 65 });
      const analysisRes = await callGroqAPI(
        [
          {
            role: 'system',
            content:
              `Analyze the conversation and return JSON only with this shape: {"segments":[{"startId":1,"endId":80,"topicName":"Concrete topic, not filler words","summary":"Specific 1 sentence summary"}],"persona":{"User 1":{"habits":[],"personal_facts":[],"personality_traits":[],"communication_style":[]}}}. Use 6-10 chronological segments covering messages 1 through ${limited.length}. Topic names must be meaningful, for example "Parenting and Workload", "Hobbies and Free Time", "Food and Cooking", "Moving Plans", or "Recommendations". Do not use generic filler words like love, great, what, doing, thanks, or it's as topic names.`,
          },
          { role: 'user', content: fullChat },
        ],
        true,
      );

      const aiData = safeJsonParse(analysisRes, { segments: localResult.topics, persona: localResult.persona });

      setCheckpoints(localResult.checkpoints);
      setTopics(aiData.segments?.length ? aiData.segments : localResult.topics);
      setPersona(aiData.persona || localResult.persona);
      setAnalysisMode('AI');
      setProgress({ step: 'Complete', detail: 'AI persona analysis is ready.', percent: 100 });
      setActiveView('analysis');
    } catch (err) {
      setCheckpoints(localResult.checkpoints);
      setTopics(localResult.topics);
      setPersona(localResult.persona);
      setAnalysisMode('Local');
      setActiveView('analysis');
      setNotice('AI analysis failed, so I kept the app working with local analysis.');
      setError(err.message);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleFileUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      sourceTextRef.current = text;
      if (text.length > MAX_TEXTAREA_CHARS) {
        setRawInput(`${text.slice(0, MAX_TEXTAREA_CHARS)}\n\n[Preview only: ${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The full file is loaded and will be analyzed without rendering all of it here.]`);
      } else {
        setRawInput(text);
      }
      setNotice(`Loaded ${file.name}. Press Analyze to process it. Large files are previewed for speed.`);
      setError(null);
    } catch {
      setError('Could not read that file. Try a plain text or CSV export.');
    } finally {
      event.target.value = '';
    }
  }

  async function loadSample() {
    sourceTextRef.current = SAMPLE_CONVERSATION;
    setRawInput(SAMPLE_CONVERSATION);
    await processData(SAMPLE_CONVERSATION);
  }

  async function handleChat(event) {
    event.preventDefault();
    if (!chatInput.trim() || isTyping) return;
    if (!hasAnalysis) {
      setError('Analyze a conversation before asking questions.');
      setActiveView('dashboard');
      return;
    }

    const question = chatInput.trim();
    setChatInput('');
    setError(null);
    setChatHistory((history) => [
      ...history,
      { role: 'user', text: question, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
    ]);
    setIsTyping(true);
    setRagThinking(aiReady ? 'Searching persona memory with AI...' : 'Searching local persona memory...');

    try {
      const answer = aiReady
        ? await callGroqAPI(
            [
              {
                role: 'system',
                content: `You are Aura, a concise persona-analysis assistant. Answer only from this context. If unsure, say what is missing.\n\n${buildContext(analysis)}`,
              },
              { role: 'user', content: question },
            ]
          )
        : answerLocally(question, analysis);

      setChatHistory((history) => [
        ...history,
        { role: 'assistant', text: answer, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
      ]);
    } catch (err) {
      setChatHistory((history) => [
        ...history,
        { role: 'assistant', text: answerLocally(question, analysis), time: 'Now' },
      ]);
      setError(err.message);
    } finally {
      setIsTyping(false);
      setRagThinking(null);
    }
  }

  function clearWorkspace() {
    localStorage.removeItem(STORAGE_KEY);
    setMessages([]);
    setTopics([]);
    setCheckpoints([]);
    setPersona(null);
    setRawInput('');
    sourceTextRef.current = '';
    setChatHistory([]);
    setAnalysisMode('Local');
    setActiveView('dashboard');
    setNotice('Workspace cleared.');
  }

  function exportAnalysis() {
    const blob = new Blob([JSON.stringify({ messages, topics, checkpoints, persona, analysisMode }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'aurarag-analysis.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-dvh bg-[#06070b] text-white">
      <div className="flex min-h-dvh flex-col lg:flex-row">
        <aside className="glass sticky top-0 z-30 border-b border-white/10 p-3 lg:h-dvh lg:w-72 lg:border-b-0 lg:border-r lg:p-5">
          <div className="flex items-center justify-between gap-3 lg:mb-8">
            <div className="flex items-center gap-3">
              <div className="flex-center h-10 w-10 rounded-lg bg-indigo-600 shadow-lg shadow-indigo-600/20">
                <Cpu size={22} />
              </div>
              <div>
                <h1 className="text-lg font-bold">AuraRAG</h1>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${hasAnalysis ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                    {hasAnalysis ? `${analysisMode} ready` : 'Ready'}
                  </span>
                </div>
              </div>
            </div>
            <div className="hidden rounded-full border border-white/10 px-3 py-1 text-xs text-text-secondary lg:block">
              {messages.length} msgs
            </div>
          </div>

          <nav className="mt-4 grid grid-cols-4 gap-2 lg:mt-0 lg:flex lg:flex-col">
            {navItems.map((item) => {
              const Icon = item.icon;
              const disabled = (item.id === 'analysis' || item.id === 'chat') && !hasAnalysis;
              return (
                <button
                  key={item.id}
                  disabled={disabled}
                  onClick={() => setActiveView(item.id)}
                  className={`flex min-h-12 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition lg:justify-start lg:text-sm ${
                    activeView === item.id
                      ? 'border-indigo-400/30 bg-indigo-500/15 text-indigo-200'
                      : 'border-transparent text-text-secondary hover:border-white/10 hover:bg-white/[0.04] hover:text-white'
                  } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="mt-6 hidden space-y-3 lg:block">
            <StatCard icon={Hash} label="Messages" value={messages.length} accent="text-cyan-300" />
            <StatCard icon={Users} label="Speakers" value={participants} accent="text-fuchsia-300" />
            <StatCard icon={FileText} label="Words" value={totalWords.toLocaleString()} accent="text-emerald-300" />
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
            <AnimatePresence>
              {(error || notice) && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className={`flex items-start gap-3 rounded-lg border p-4 text-sm ${
                    error
                      ? 'border-red-500/30 bg-red-500/10 text-red-200'
                      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                  }`}
                >
                  {error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
                  <span>{error || notice}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {activeView === 'dashboard' && (
              <motion.section
                key="dashboard"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <SectionHeader
                  icon={Database}
                  title="Conversation Workspace"
                  subtitle="Paste a chat, upload a CSV or text export, or load the sample. The app works instantly with local analysis and upgrades to secure server AI when configured."
                  action={
                    <div className="flex flex-wrap gap-2">
                      <button onClick={loadSample} className="soft-button">
                        <Sparkles size={16} /> Sample
                      </button>
                      <button onClick={() => fileInputRef.current?.click()} className="soft-button">
                        <Upload size={16} /> Upload
                      </button>
                    </div>
                  }
                />

                <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
                  <section className="rounded-lg border border-white/10 bg-[#0c0e14]">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                      <div className="flex items-center gap-2 text-sm text-text-secondary">
                        <FileText size={16} />
                        <span>Conversation input</span>
                      </div>
                      <span className="text-xs text-text-muted">{detectedInputCount} detected messages</span>
                    </div>
                    <textarea
                      value={rawInput}
                      onPaste={(event) => {
                        const pasted = event.clipboardData.getData('text');
                        if (pasted.length <= MAX_TEXTAREA_CHARS) return;
                        event.preventDefault();
                        sourceTextRef.current = pasted;
                        setRawInput(`${pasted.slice(0, MAX_TEXTAREA_CHARS)}\n\n[Preview only: pasted text is ${(pasted.length / 1024 / 1024).toFixed(1)} MB. The full paste is loaded and will be analyzed without rendering all of it here.]`);
                        setNotice('Large paste loaded as a fast preview. Press Analyze to process the full text.');
                        setError(null);
                      }}
                      onChange={(event) => {
                        sourceTextRef.current = '';
                        setRawInput(event.target.value);
                        setError(null);
                        setNotice(null);
                      }}
                      className="min-h-[420px] w-full resize-y bg-transparent p-5 font-mono text-sm leading-6 text-slate-200 outline-none placeholder:text-slate-600"
                      placeholder={'User 1: Hi! How are you?\nUser 2: Good, thanks for asking.\nUser 1: I am moving to Portland soon.'}
                    />
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.csv,text/plain,text/csv"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                  </section>

                  <section className="space-y-4">
                    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
                      <div className="mb-4 flex items-center gap-3">
                        <div className="flex-center h-10 w-10 rounded-lg bg-indigo-500/15 text-indigo-200">
                          <Zap size={20} />
                        </div>
                        <div>
                          <h3 className="font-bold">Analyze Fast</h3>
                          <p className="text-xs text-text-muted">Local mode is instant. AI mode uses the secure server proxy.</p>
                        </div>
                      </div>
                      <div className="grid gap-3">
                        <button disabled={isProcessing} onClick={() => processData()} className="btn-glow h-12 disabled:opacity-60">
                          {isProcessing ? <Activity className="animate-spin" size={18} /> : <Sparkles size={18} />}
                          {aiReady ? 'Analyze with AI' : 'Analyze Locally'}
                        </button>
                        {aiReady && (
                          <button disabled={isProcessing} onClick={() => processData(undefined, true)} className="soft-button justify-center">
                            <Cpu size={16} /> Use local mode
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <StatCard icon={Hash} label="Messages" value={messages.length} accent="text-cyan-300" />
                      <StatCard icon={Users} label="Speakers" value={participants} accent="text-fuchsia-300" />
                      <StatCard icon={BarChart3} label="Topics" value={topics.length} accent="text-indigo-300" />
                      <StatCard icon={Clock} label="Mode" value={analysisMode} accent="text-emerald-300" />
                    </div>

                    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
                      <div className="mb-3 flex items-center gap-2 text-sm font-bold">
                        <KeyRound size={16} className="text-amber-300" />
                        API status
                      </div>
                      <p className="text-sm leading-6 text-text-secondary">
                        {aiReady
                          ? 'AI analysis is enabled through a server-side proxy. The browser never receives the key.'
                          : 'Server AI is not available. The site remains fully usable with local analysis and local chat answers.'}
                      </p>
                    </div>
                  </section>
                </div>
              </motion.section>
            )}

            {activeView === 'analysis' && hasAnalysis && (
              <motion.section key="analysis" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
                <SectionHeader
                  icon={Users}
                  title="Persona Profiles"
                  subtitle={`Generated from ${messages.length} messages using ${analysisMode.toLowerCase()} analysis.`}
                  action={
                    <button onClick={exportAnalysis} className="soft-button">
                      <Download size={16} /> Export JSON
                    </button>
                  }
                />

                <div className="grid gap-5 xl:grid-cols-2">
                  {Object.entries(persona || {}).map(([name, data]) => (
                    <article key={name} className="rounded-lg border border-white/10 bg-white/[0.035] p-5 shadow-xl shadow-black/10">
                      <div className="mb-5 flex items-center gap-4">
                        <div className="flex-center h-12 w-12 rounded-lg bg-indigo-500/15 text-indigo-200">
                          <User size={24} />
                        </div>
                        <div>
                          <h3 className="text-xl font-bold">{name}</h3>
                          <p className="text-xs uppercase tracking-widest text-text-muted">Pattern identified</p>
                        </div>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        {[
                          ['Habits', data.habits, Clock, 'text-cyan-300'],
                          ['Facts', data.personal_facts, Hash, 'text-amber-300'],
                          ['Traits', data.personality_traits, Zap, 'text-fuchsia-300'],
                          ['Style', data.communication_style, Sparkles, 'text-emerald-300'],
                        ].map(([label, values, Icon, color]) => (
                          <div key={label} className="rounded-lg border border-white/10 bg-black/15 p-3">
                            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-text-muted">
                              <Icon size={14} className={color} />
                              {label}
                            </div>
                            <div className="mt-3 space-y-2">
                              {(Array.isArray(values) && values.length ? values : ['No signal detected yet.']).slice(0, 4).map((item, index) => (
                              <div key={index} className="insight-card">
                                {item}
                              </div>
                            ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>

                <div className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
                  <div className="mb-5 flex items-center gap-3">
                    <Clock size={20} className="text-emerald-300" />
                    <h3 className="text-xl font-bold">Topic Timeline</h3>
                  </div>
                  <div className="space-y-5">
                    {topics.map((topic, index) => (
                      <div key={`${topic.startId}-${topic.endId}-${index}`} className="timeline-item">
                        <div className="timeline-dot" />
                        <div className="min-w-0 flex-1 border-b border-white/10 pb-5">
                          <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <h4 className="font-bold text-white">{topic.topicName || `Segment ${index + 1}`}</h4>
                            <span className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-text-muted">
                              Msg {topic.startId} - {topic.endId}
                            </span>
                          </div>
                          <p className="text-sm leading-6 text-text-secondary">{topic.summary}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.section>
            )}

            {activeView === 'chat' && hasAnalysis && (
              <motion.section key="chat" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex min-h-[calc(100dvh-150px)] flex-col rounded-lg border border-white/10 bg-[#0c0e14]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-4">
                  <div>
                    <h2 className="text-lg font-bold">Persona Chat</h2>
                    <p className="text-xs text-text-muted">
                      {aiReady ? 'AI answers from your generated context.' : 'Local answers from generated summaries.'}
                    </p>
                  </div>
                  <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-text-secondary">{analysisMode} memory</span>
                </div>

                <div className="custom-scrollbar flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
                  {!chatHistory.length && (
                    <div className="flex min-h-[320px] flex-col items-center justify-center gap-5 text-center">
                      <div className="flex-center h-16 w-16 rounded-lg bg-white/[0.04] text-text-muted">
                        <MessageSquare size={32} />
                      </div>
                      <div>
                        <h3 className="font-bold">Ask anything about the conversation</h3>
                        <p className="mt-1 text-sm text-text-secondary">Start with one of these prompts.</p>
                      </div>
                      <div className="flex flex-wrap justify-center gap-2">
                        {sampleQuestions.map((question) => (
                          <button key={question} onClick={() => setChatInput(question)} className="soft-button">
                            {question}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {chatHistory.map((message, index) => (
                    <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[88%] rounded-lg px-4 py-3 text-sm leading-6 shadow-sm sm:max-w-[75%] ${
                        message.role === 'user'
                          ? 'bg-indigo-600 text-white'
                          : 'border border-white/10 bg-white/[0.045] text-slate-100'
                      }`}>
                        <div className="whitespace-pre-wrap">{message.text}</div>
                        <div className="mt-2 text-[10px] font-bold uppercase tracking-widest opacity-50">{message.time}</div>
                      </div>
                    </div>
                  ))}

                  {ragThinking && (
                    <div className="flex items-center gap-3 text-sm text-indigo-200">
                      <Activity className="animate-spin" size={16} />
                      {ragThinking}
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                <form onSubmit={handleChat} className="border-t border-white/10 p-3 sm:p-4">
                  <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/25 px-3 focus-within:border-indigo-400/50">
                    <Search size={18} className="text-text-muted" />
                    <input
                      value={chatInput}
                      onChange={(event) => setChatInput(event.target.value)}
                      placeholder="Ask about habits, facts, traits, topics..."
                      className="min-w-0 flex-1 bg-transparent py-4 text-sm outline-none"
                    />
                    <button disabled={!chatInput.trim() || isTyping} className="flex-center h-10 w-10 rounded-lg bg-indigo-600 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">
                      <ArrowRight size={20} />
                    </button>
                  </div>
                </form>
              </motion.section>
            )}

            {activeView === 'settings' && (
              <motion.section key="settings" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl space-y-6">
                <SectionHeader
                  icon={Settings}
                  title="Settings"
                  subtitle="Check secure AI status, clear saved work, and export your analysis. The browser never stores the Groq key."
                />

                <div className="rounded-lg border border-white/10 bg-white/[0.035] p-5">
                  <div className="mb-3 flex items-center gap-3">
                    <div className={`flex-center h-10 w-10 rounded-lg ${aiReady ? 'bg-emerald-500/15 text-emerald-200' : 'bg-amber-500/15 text-amber-200'}`}>
                      <KeyRound size={18} />
                    </div>
                    <div>
                      <h3 className="font-bold">Groq proxy status</h3>
                      <p className="text-sm text-text-secondary">{aiReady ? 'Configured securely on the server.' : 'Not reachable. Local analysis is active.'}</p>
                    </div>
                  </div>
                  <p className="text-sm leading-6 text-text-secondary">
                    The API key is read from the server environment and is never exposed as a `VITE_` variable, localStorage value, or browser request header.
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button disabled={!hasAnalysis} onClick={exportAnalysis} className="soft-button disabled:opacity-40">
                    <Download size={16} /> Export analysis
                  </button>
                  <button onClick={clearWorkspace} className="soft-button text-red-200 hover:border-red-400/30 hover:bg-red-500/10">
                    <Trash2 size={16} /> Clear workspace
                  </button>
                </div>
              </motion.section>
            )}
          </div>
        </main>
      </div>

      <AnimatePresence>
        {isProcessing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex-center bg-black/70 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-lg border border-white/10 bg-[#0c0e14] p-6 text-center shadow-2xl">
              <div className="relative mx-auto mb-5 h-20 w-20">
                <div className="absolute inset-0 rounded-full border-4 border-white/10" />
                <motion.div
                  className="absolute inset-0 rounded-full border-4 border-indigo-400 border-t-transparent"
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
                />
                <div className="absolute inset-0 flex-center text-lg font-bold text-indigo-200">{progress.percent}%</div>
              </div>
              <h3 className="text-xl font-bold">{progress.step}</h3>
              <p className="mt-2 text-sm text-text-secondary">{progress.detail}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
