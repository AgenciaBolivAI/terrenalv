'use client';

// Cloudflare Turnstile widget. Renders NOTHING unless NEXT_PUBLIC_TURNSTILE_SITE_KEY
// is configured — the API skips verification when captcha is disabled, so the
// form works end-to-end without it.

import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
    };
    __terrenalvTurnstileOnLoad?: () => void;
  }
}

const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__terrenalvTurnstileOnLoad&render=explicit';

export interface TurnstileHandle {
  /** Issue a fresh token: Turnstile tokens are single-use, so every retry needs one. */
  reset: () => void;
}

export function TurnstileWidget({
  onToken,
  handleRef,
}: {
  onToken: (token: string | null) => void;
  handleRef?: React.RefObject<TurnstileHandle | null>;
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const containerRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      reset: () => {
        if (!window.turnstile || widgetIdRef.current === null) return;
        onToken(null);
        window.turnstile.reset(widgetIdRef.current);
      },
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, onToken]);

  useEffect(() => {
    if (!siteKey || renderedRef.current) return;
    const renderWidget = () => {
      if (renderedRef.current || !containerRef.current || !window.turnstile) return;
      renderedRef.current = true;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token) => onToken(token),
        'expired-callback': () => onToken(null),
        'error-callback': () => onToken(null),
      });
    };
    if (window.turnstile) {
      renderWidget();
      return;
    }
    window.__terrenalvTurnstileOnLoad = renderWidget;
    if (!document.querySelector(`script[src^="https://challenges.cloudflare.com/turnstile"]`)) {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  }, [siteKey, onToken]);

  if (!siteKey) return null;
  return <div ref={containerRef} className="my-2" />;
}
