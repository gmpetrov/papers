'use client';

import { type CSSProperties, useEffect, useRef, useState } from 'react';

const titles = [
  'Email Inboxes',
  'Phone Numbers',
  'Payment Cards',
  'Identity API',
  'Papers',
] as const;
const cycleDelay = 5400;
// Deterministic positions keep server rendering and hydration identical.
const particles = Array.from({ length: 42 }, (_, index) => {
  const progress = index / 41;
  return {
    '--particle-x': `${progress * 100}%`,
    '--particle-y': `${18 + ((index * 37) % 67)}%`,
    '--particle-size': `${1.2 + ((index * 13) % 7) * 0.3}px`,
    '--particle-dx': `${6 + ((index * 17) % 24)}px`,
    '--particle-dy': `${-26 + ((index * 23) % 49)}px`,
    '--particle-delay': `${260 + progress * 1050}ms`,
    '--particle-duration': `${650 + ((index * 41) % 450)}ms`,
  } as CSSProperties;
});

export function RotatingHeroTitle() {
  const [cycle, setCycle] = useState(0);
  const titleIndex = cycle % titles.length;
  const previousIndex = (cycle + titles.length - 1) % titles.length;
  const [isVisible, setIsVisible] = useState(true);
  const [isDocumentVisible, setIsDocumentVisible] = useState(true);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const heading = headingRef.current;
    if (!heading) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.2 },
    );

    observer.observe(heading);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const updateDocumentVisibility = () => {
      setIsDocumentVisible(!document.hidden);
    };

    updateDocumentVisibility();
    document.addEventListener('visibilitychange', updateDocumentVisibility);
    return () =>
      document.removeEventListener(
        'visibilitychange',
        updateDocumentVisibility,
      );
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!isVisible || !isDocumentVisible || reducedMotion.matches) return;

    const interval = window.setInterval(() => {
      setCycle((current) => current + 1);
    }, cycleDelay);

    return () => window.clearInterval(interval);
  }, [isDocumentVisible, isVisible]);

  return (
    <h1
      ref={headingRef}
      aria-label="Email inboxes, phone numbers, and payment cards for AI agents"
    >
      <span className="hero-title-rotator" aria-hidden="true">
        {cycle > 0 ? (
          <span
            key={`out-${cycle}`}
            className="hero-title-phrase hero-title-phrase-out"
          >
            {titles[previousIndex]}
          </span>
        ) : null}
        <span
          key={`in-${cycle}`}
          className={`hero-title-phrase${cycle > 0 ? ' hero-title-phrase-in' : ''}`}
          aria-hidden="true"
        >
          <span className="hero-title-ink">{titles[titleIndex]}</span>
          {cycle > 0 && (
            <span className="hero-title-dust">
              {particles.map((style, index) => (
                <span
                  className="hero-title-particle"
                  key={index}
                  style={style}
                />
              ))}
            </span>
          )}
        </span>
      </span>
      <br />
      <em aria-hidden="true">for AI agents</em>
    </h1>
  );
}
