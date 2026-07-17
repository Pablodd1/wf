import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Mic, MicOff, RotateCcw, X } from 'lucide-react';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export interface VoiceSearchInterpretation {
  raw: string;
  query: string;
  brand: string;
  reference: string;
}

interface VoiceSearchAssistantProps {
  context: 'trading' | 'price';
  onAccept: (interpretation: VoiceSearchInterpretation) => void;
  tone?: 'dark' | 'light';
  disabled?: boolean;
}

const BRAND_ALIASES: Array<[RegExp, string]> = [
  [/\bpatek(?:\s+philippe)?\b/i, 'Patek Philippe'],
  [/\baudemars(?:\s+piguet)?\b|\bA\.?P\.?\b/i, 'Audemars Piguet'],
  [/\brichard\s+mille\b/i, 'Richard Mille'],
  [/\bvacheron(?:\s+constantin)?\b/i, 'Vacheron Constantin'],
  [/\bf\.?p\.?\s*journe\b/i, 'F.P. Journe'],
  [/\brolex\b/i, 'Rolex'],
  [/\bomega\b/i, 'Omega'],
  [/\bcartier\b/i, 'Cartier'],
  [/\btudor\b/i, 'Tudor'],
  [/\bhublot\b/i, 'Hublot'],
  [/\bpanerai\b/i, 'Panerai'],
  [/\biwc\b/i, 'IWC'],
];

function interpretVoiceSearch(rawTranscript: string): VoiceSearchInterpretation {
  const raw = rawTranscript.trim();
  const query = raw
    .replace(/\b(?:show me|find me|find|search for|look for|looking for|i am looking for|i'm looking for|do you have|what is the price of|price of|market price for)\b/gi, ' ')
    .replace(/\bslash\b/gi, '/')
    .replace(/\bdash\b/gi, '-')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?.!,]+$/g, '');

  let brand = '';
  for (const [pattern, canonicalBrand] of BRAND_ALIASES) {
    if (pattern.test(query)) {
      brand = canonicalBrand;
      break;
    }
  }

  const reference = query
    .split(/\s+/)
    .filter(token => /\d/.test(token) && /^[a-z0-9./-]{4,}$/i.test(token))
    .at(-1)
    ?.toUpperCase() || '';

  return { raw, query, brand, reference };
}

function speechErrorMessage(error: string) {
  if (error === 'not-allowed' || error === 'service-not-allowed') return 'Microphone access was not allowed. Enable it in your browser settings and try again.';
  if (error === 'no-speech') return 'No speech was detected. Try again and speak close to the microphone.';
  if (error === 'audio-capture') return 'No microphone is available on this device.';
  return 'Voice transcription stopped unexpectedly. You can retry or continue typing.';
}

export function VoiceSearchAssistant({ context, onAccept, tone = 'dark', disabled = false }: VoiceSearchAssistantProps) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef('');
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');

  const supported = typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  const interpretation = useMemo(() => interpretVoiceSearch(transcript), [transcript]);
  const dark = tone === 'dark';

  useEffect(() => () => recognitionRef.current?.abort(), []);

  const stop = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };

  const start = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    setOpen(true);
    setError('');
    if (!Recognition) return;

    recognitionRef.current?.abort();
    finalTranscriptRef.current = '';
    setTranscript('');
    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = document.documentElement.lang || navigator.language || 'en-US';
    recognition.onresult = event => {
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result) continue;
        const words = result[0]?.transcript || '';
        if (result.isFinal) finalTranscriptRef.current = `${finalTranscriptRef.current} ${words}`.trim();
        else interim += words;
      }
      setTranscript(`${finalTranscriptRef.current} ${interim}`.trim());
    };
    recognition.onerror = event => {
      setError(speechErrorMessage(event.error));
      setListening(false);
    };
    recognition.onend = () => setListening(false);

    try {
      recognition.start();
      setListening(true);
    } catch {
      setError('The microphone is already active. Stop it before trying again.');
    }
  };

  const accept = () => {
    if (!interpretation.query) return;
    stop();
    onAccept(interpretation);
    setOpen(false);
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => listening ? stop() : start()}
        disabled={disabled}
        aria-label={listening ? 'Stop voice search' : 'Start voice search'}
        aria-pressed={listening}
        title="Search with your voice"
        className={`flex h-10 w-10 items-center justify-center rounded-md border transition disabled:cursor-not-allowed disabled:opacity-50 ${
          listening
            ? 'border-red-400 bg-red-500/15 text-red-400'
            : dark
              ? 'border-[#c9a96e]/35 bg-[#16161f] text-[#d4b87a] hover:border-[#c9a96e]'
              : 'border-[#d7dce2] bg-white text-[#1a2744] hover:border-[#c9a03a]'
        }`}
      >
        {listening ? <MicOff size={18} /> : <Mic size={18} />}
      </button>

      {open && (
        <div className={`absolute right-0 top-12 z-50 w-[min(88vw,370px)] rounded-md border p-4 shadow-2xl ${dark ? 'border-[#c9a96e]/30 bg-[#16161f] text-[#f6f1e8]' : 'border-[#e2e5e9] bg-white text-[#212529]'}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold">Voice search assistant</div>
              <p className={`mt-1 text-xs leading-5 ${dark ? 'text-[#9ca3af]' : 'text-[#6c757d]'}`}>
                {context === 'price'
                  ? 'Say a brand and reference, for example “Patek Philippe 5712 slash 1A”.'
                  : 'Say a brand, reference, dial, or item you want to find.'}
              </p>
            </div>
            <button type="button" onClick={() => { stop(); setOpen(false); }} aria-label="Close voice search" className="shrink-0 opacity-60 hover:opacity-100"><X size={17} /></button>
          </div>

          {!supported ? (
            <p className="mt-4 rounded bg-amber-500/10 p-3 text-xs leading-5 text-amber-600">Live transcription is not supported by this browser. Chrome or Edge is recommended; typed search remains available.</p>
          ) : (
            <>
              <div className={`mt-4 min-h-20 rounded border p-3 text-sm leading-6 ${dark ? 'border-white/10 bg-black/20' : 'border-[#e2e5e9] bg-[#f8f9fa]'}`} aria-live="polite">
                {transcript || (listening ? 'Listening…' : 'Press the microphone to begin.')}
              </div>
              {interpretation.query && (
                <div className={`mt-3 text-xs ${dark ? 'text-[#9ca3af]' : 'text-[#6c757d]'}`}>
                  Interpreted search: <strong className={dark ? 'text-[#f6f1e8]' : 'text-[#212529]'}>{interpretation.query}</strong>
                  {interpretation.brand && <> · Brand: <strong className={dark ? 'text-[#f6f1e8]' : 'text-[#212529]'}>{interpretation.brand}</strong></>}
                  {context === 'price' && interpretation.reference && <> · Reference: <strong className={dark ? 'text-[#f6f1e8]' : 'text-[#212529]'}>{interpretation.reference}</strong></>}
                </div>
              )}
              {error && <p className="mt-3 text-xs leading-5 text-red-500">{error}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={start} className={`flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-semibold ${dark ? 'border-white/15 hover:border-white/35' : 'border-[#d7dce2] hover:border-[#aeb5bd]'}`}>
                  <RotateCcw size={14} /> Try again
                </button>
                <button type="button" onClick={accept} disabled={!interpretation.query} className="flex h-9 items-center gap-2 rounded-md bg-[#c9a03a] px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
                  <Check size={14} /> Use this search
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
