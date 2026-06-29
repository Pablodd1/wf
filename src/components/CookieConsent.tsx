/**
 * Cookie Consent Banner — EU GDPR compliance
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Cookie } from 'lucide-react';

export function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem('cookie-consent');
    if (!consent) setShow(true);
  }, []);

  const accept = () => {
    localStorage.setItem('cookie-consent', 'accepted');
    setShow(false);
  };

  const decline = () => {
    localStorage.setItem('cookie-consent', 'declined');
    setShow(false);
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 shadow-lg"
        >
          <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center gap-4">
            <Cookie size={20} className="text-[#3B5BFE] shrink-0" />
            <p className="text-sm text-gray-600 flex-1 text-center sm:text-left">
              We use cookies to enhance your experience, analyze site traffic, and for marketing purposes. 
              By continuing to use WatchFacts, you agree to our <a href="#/privacy-policy" className="text-[#3B5BFE] hover:underline">Privacy Policy</a> and <a href="#/terms" className="text-[#3B5BFE] hover:underline">Terms of Service</a>.
            </p>
            <div className="flex items-center gap-3 shrink-0">
              <button onClick={decline} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
                Decline
              </button>
              <button onClick={accept} className="px-4 py-2 bg-[#3B5BFE] hover:bg-[#4A6AFF] text-white text-sm font-medium rounded-lg transition-colors">
                Accept All
              </button>
            </div>
            <button onClick={decline} className="text-gray-400 hover:text-gray-600 shrink-0">
              <X size={16} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
