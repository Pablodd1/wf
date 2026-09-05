import { Linkedin, MessageCircle, Send } from 'lucide-react';

const shareUrl = () => encodeURIComponent(window.location.href);
const shareText = () => encodeURIComponent('Explore Curated Luxury market intelligence.');

export function SocialShareRail() {
  const openShare = (url: string) => window.open(url, '_blank', 'noopener,noreferrer,width=640,height=520');

  return (
    <aside className="fixed right-0 top-1/2 z-40 hidden -translate-y-1/2 border border-r-0 border-white/15 bg-black/80 sm:flex sm:flex-col" aria-label="Share Curated Luxury">
      <button onClick={() => openShare(`https://api.whatsapp.com/send?text=${shareText()}%20${shareUrl()}`)} className="grid h-10 w-10 place-items-center border-b border-white/10 text-white/65 transition-colors hover:bg-[#25D366] hover:text-black" title="Share on WhatsApp"><MessageCircle size={17} /></button>
      <button onClick={() => openShare(`https://t.me/share/url?url=${shareUrl()}&text=${shareText()}`)} className="grid h-10 w-10 place-items-center border-b border-white/10 text-white/65 transition-colors hover:bg-[#229ED9] hover:text-black" title="Share on Telegram"><Send size={16} /></button>
      <button onClick={() => openShare(`https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl()}`)} className="grid h-10 w-10 place-items-center text-white/65 transition-colors hover:bg-[#0A66C2] hover:text-white" title="Share on LinkedIn"><Linkedin size={16} /></button>
    </aside>
  );
}
