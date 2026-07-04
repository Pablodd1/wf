/**
 * LuxuryHero — Full-screen hero with video or 3D background.
 * Supports video background with fallback images, staggered text reveal, and CTA.
 */

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { ShimmerText } from './ShimmerText';
import { Hero3D } from '@/pages/Hero3D';

interface LuxuryHeroProps {
  /** Use 3D watch scene instead of video/gradient */
  use3D?: boolean;
  /** Video URL (relative path or full URL) */
  videoSrc?: string;
  /** Poster image while video loads */
  posterSrc?: string;
  /** Hero title */
  title: string;
  /** Hero subtitle */
  subtitle?: string;
  /** CTA text */
  ctaText?: string;
  /** CTA onClick handler */
  onCtaClick?: () => void;
  /** Scroll to content indicator */
  showScrollIndicator?: boolean;
  /** Overlay opacity (0-100) */
  overlayOpacity?: number;
  /** Children rendered below title */
  children?: React.ReactNode;
}

export function LuxuryHero({
  use3D = false,
  videoSrc,
  posterSrc = '/hero-poster.jpg',
  title,
  subtitle,
  ctaText,
  onCtaClick,
  showScrollIndicator = true,
  overlayOpacity = 70,
  children,
}: LuxuryHeroProps) {
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    const v = videoRef.current;
    if (v.readyState >= 3) {
      setVideoLoaded(true);
    } else {
      const onCanPlay = () => setVideoLoaded(true);
      const onError = () => setVideoError(true);
      v.addEventListener('canplay', onCanPlay, { once: true });
      v.addEventListener('error', onError, { once: true });
      return () => {
        v.removeEventListener('canplay', onCanPlay);
        v.removeEventListener('error', onError);
      };
    }
  }, []);

  const showVideo = videoSrc && !videoError;
  const show3D = use3D && !showVideo;

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* ─── Background ──────────────────────── */}
      {show3D && <Hero3D />}

      {showVideo && (
        <>
          <video
            ref={videoRef}
            autoPlay
            muted
            loop
            playsInline
            poster={posterSrc}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${
              videoLoaded ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <source src={videoSrc} type="video/mp4" />
          </video>
          {/* Poster fallback */}
          {!videoLoaded && posterSrc && (
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${posterSrc})` }}
            />
          )}
        </>
      )}

      {/* Gradient fallback when no video and no 3D */}
      {!showVideo && !show3D && (
        <div className="absolute inset-0 bg-dark-gradient" />
      )}

      {/* Gold radial glow behind text */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse at 50% 30%, rgba(212,175,55,0.15) 0%, transparent 50%),
            radial-gradient(ellipse at 50% 80%, rgba(212,175,55,0.06) 0%, transparent 40%)
          `,
        }}
      />

      {/* ─── Dark Overlay ────────────────────── */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(to bottom, rgba(10,10,15,0.2), rgba(10,10,15,${overlayOpacity / 100}))`,
        }}
      />

      {/* ─── Content ─────────────────────────── */}
      <div className="relative z-10 text-center px-6 max-w-4xl mx-auto">
        {/* Title — staggered word reveal */}
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.08 } },
          }}
        >
          {title.split(' ').map((word, i) => (
            <motion.span
              key={i}
              variants={{
                hidden: { opacity: 0, y: 40, filter: 'blur(8px)' },
                visible: { opacity: 1, y: 0, filter: 'blur(0px)' },
              }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="inline-block mr-[0.3em]"
            >
              {i === 0 || i === title.split(' ').length - 1 ? (
                <ShimmerText as="span" size="2xl">
                  {word}
                </ShimmerText>
              ) : (
                <span className="text-4xl md:text-5xl lg:text-6xl font-bold text-white/90">
                  {word}
                </span>
              )}
            </motion.span>
          ))}
        </motion.div>

        {/* Subtitle */}
        {subtitle && (
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.6 }}
            className="mt-6 text-lg md:text-xl text-wf-text-secondary max-w-2xl mx-auto"
          >
            {subtitle}
          </motion.p>
        )}

        {/* CTA */}
        {ctaText && (
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.1, duration: 0.5 }}
            onClick={onCtaClick}
            className="mt-10 px-8 py-4 bg-gold-gradient text-wf-black font-semibold text-lg rounded-full
                       shadow-gold hover:shadow-gold-lg transform hover:scale-105
                       transition-all duration-300 ease-out"
          >
            {ctaText}
          </motion.button>
        )}

        {/* Extra content */}
        {children && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.4, duration: 0.5 }}
            className="mt-8"
          >
            {children}
          </motion.div>
        )}
      </div>

      {/* ─── Scroll Indicator ────────────────── */}
      {showScrollIndicator && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
        >
          <span className="text-xs text-wf-text-muted uppercase tracking-widest">Scroll</span>
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 4v10M5 10l5 5 5-5" stroke="rgba(212,175,55,0.6)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </motion.div>
        </motion.div>
      )}
    </section>
  );
}
