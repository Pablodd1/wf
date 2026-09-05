import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Bot, MessageCircle, Send, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

type ChatMessage = { role: 'assistant' | 'user'; text: string };

const initialMessage: ChatMessage = {
  role: 'assistant',
  text: 'Welcome to Curated Luxury. I can direct you to listings, reference research, or dealer operations.',
};

function fallbackResponse(message: string) {
  const normalized = message.toLowerCase();
  if (/(price|reference|model|value|market)/.test(normalized)) {
    return { reply: 'Open Price Research to compare dated observations for a reference.', route: '/price-research' };
  }
  if (/(list|buy|sell|trade|inventory|wts|wtb)/.test(normalized)) {
    return { reply: 'The Trading Floor is the fastest way to browse dated dealer listings.', route: '/trading' };
  }
  if (/(dealer|review|account|operation|admin)/.test(normalized)) {
    return { reply: 'Dealer access opens Price Search, the Trading Floor, and the rated-dealer network.', route: '/dealer' };
  }
  return { reply: 'I can help with listings, price research, or dealer access. Which one do you need?', route: null };
}

export function FrontDeskWidget() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage]);

  useEffect(() => {
    const openFrontDesk = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setOpen(true);
      if (detail?.message) setDraft(detail.message.slice(0, 600));
    };
    window.addEventListener('curated-luxury:front-desk', openFrontDesk);
    return () => window.removeEventListener('curated-luxury:front-desk', openFrontDesk);
  }, []);

  const sendMessage = async (event?: FormEvent<HTMLFormElement>, shortcut?: string) => {
    event?.preventDefault();
    const text = (shortcut || draft).trim();
    if (!text || loading) return;

    setMessages((current) => [...current, { role: 'user', text }]);
    setDraft('');
    setLoading(true);

    try {
      const response = await fetch('/api/front-desk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const result = await response.json();
      if (!response.ok || !result.reply) throw new Error('Front desk unavailable');
      setMessages((current) => [...current, { role: 'assistant', text: result.reply }]);
      if (result.route) window.setTimeout(() => navigate(result.route), 650);
    } catch {
      const fallback = fallbackResponse(text);
      setMessages((current) => [...current, { role: 'assistant', text: fallback.reply }]);
      if (fallback.route) window.setTimeout(() => navigate(fallback.route!), 650);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-3 z-50 flex flex-col items-end gap-3 sm:bottom-5 sm:right-5">
      {open && (
        <section className="w-[min(360px,calc(100vw-2.5rem))] border border-white/15 bg-[#111111] shadow-2xl" aria-label="Curated Luxury AI front desk">
          <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2"><Bot size={17} className="text-[#d8bd80]" /><span className="text-sm font-semibold">Curated Luxury AI</span></div>
            <button onClick={() => setOpen(false)} className="p-1 text-white/60 transition-colors hover:text-white" title="Close front desk"><X size={17} /></button>
          </header>
          <div className="max-h-72 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`max-w-[88%] px-3 py-2 text-sm leading-5 ${message.role === 'assistant' ? 'border-l-2 border-[#d8bd80] bg-white/5 text-white/80' : 'ml-auto bg-white text-black'}`}>
                {message.text}
              </div>
            ))}
            {loading && <div className="text-xs text-white/55">Thinking...</div>}
          </div>
          <div className="flex gap-2 overflow-x-auto border-t border-white/10 px-4 py-3">
            {['Find a listing', 'Research a reference', 'Dealer access'].map((shortcut) => (
              <button key={shortcut} onClick={() => void sendMessage(undefined, shortcut)} className="shrink-0 border border-white/15 px-2.5 py-1.5 text-[11px] text-white/75 transition-colors hover:border-[#d8bd80] hover:text-white">
                {shortcut}
              </button>
            ))}
          </div>
          <form onSubmit={sendMessage} className="flex border-t border-white/10">
            <label className="sr-only" htmlFor="front-desk-message">Message Curated Luxury AI</label>
            <input id="front-desk-message" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={600} placeholder="Ask Curated Luxury..." className="h-12 min-w-0 flex-1 bg-transparent px-4 text-sm text-white outline-none placeholder:text-white/40" />
            <button type="submit" disabled={!draft.trim() || loading} className="grid w-12 place-items-center border-l border-white/10 text-[#d8bd80] transition-colors hover:bg-white/5 disabled:text-white/20" title="Send message"><Send size={17} /></button>
          </form>
        </section>
      )}
      <button onClick={() => setOpen((value) => !value)} className="flex h-11 w-11 items-center justify-center bg-[#d8bd80] text-sm font-semibold text-black shadow-lg transition-transform hover:-translate-y-0.5 sm:h-12 sm:w-auto sm:gap-2 sm:px-4" title="Open Curated Luxury AI front desk" aria-label={open ? 'Close Curated Luxury AI front desk' : 'Open Curated Luxury AI front desk'} aria-expanded={open}>
        <MessageCircle size={18} /> <span className="hidden sm:inline">{open ? 'Close' : 'Ask Curated Luxury'}</span>
      </button>
    </div>
  );
}
