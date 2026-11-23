import { useEffect, useId, useRef, useState, type ClipboardEvent, type FormEvent } from 'react';
import { AlertCircle, Check, RotateCw, X } from 'lucide-react';
import { Mascot } from './components/Mascot';
import { DownloadButton } from './components/DownloadButton';
import { ChainLinkIcon, PasteStackIcon } from './components/Icons';
import { VideoResultCard } from './components/VideoResultCard';
import type { VideoShowcaseData } from './components/VideoShowcase';
import { useLenis } from './hooks/useLenis';
import type { ResolvedVideo } from './types';

const TIKTOK_URL_PATTERN = 'https?://([a-zA-Z0-9-]+\\.)*tiktok\\.com/.*';

function extractTikTokUrl(raw: string): string | null {
  const match = raw.match(/https?:\/\/(?:[a-zA-Z0-9-]+\.)*tiktok\.com\/[^\s<>"')]+/i);
  if (match) {
    return match[0].replace(/[.,!?;:]+$/, '');
  }
  return null;
}

function looksLikeTikTokUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'tiktok.com' || host.endsWith('.tiktok.com');
  } catch {
    return false;
  }
}

interface ActiveViewVideo extends VideoShowcaseData {
  sourceUrl: string;
}

export default function App() {
  useLenis();

  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pasteState, setPasteState] = useState<'idle' | 'pasted'>('idle');
  const [feedback, setFeedback] = useState<{
    type: 'error' | 'info';
    message: string;
    canRetry?: boolean;
  } | null>(null);
  const [activeVideo, setActiveVideo] = useState<ActiveViewVideo | null>(null);
  const [isRefreshingStream, setIsRefreshingStream] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const currentViewRef = useRef<HTMLDivElement>(null);
  const pasteTimerRef = useRef<number | null>(null);
  const feedbackId = useId();

  useEffect(() => {
    return () => {
      if (pasteTimerRef.current !== null) {
        window.clearTimeout(pasteTimerRef.current);
      }
    };
  }, []);

  // Press '/' anywhere outside inputs to focus the link input cleanly
  useEffect(() => {
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, []);

  async function resolveAndDisplay(targetUrl: string) {
    setIsLoading(true);
    setFeedback(null);
    setStreamError(null);
    setActiveVideo(null);

    try {
      const response = await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
      });

      const data = (await response.json()) as ResolvedVideo & { error?: string };

      if (!response.ok) {
        setFeedback({
          type: 'error',
          message: data.error || 'Could not fetch this video. Check that it is public.',
          canRetry: response.status >= 500,
        });
        return;
      }

      setActiveVideo({ ...data, sourceUrl: data.sourceUrl || targetUrl });
      requestAnimationFrame(() => {
        currentViewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } catch {
      setFeedback({
        type: 'error',
        message: 'Network error while fetching the video. Please try again.',
        canRetry: true,
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshActiveStream(target: ActiveViewVideo) {
    if (!target.sourceUrl) return;
    setIsRefreshingStream(true);
    setStreamError(null);
    try {
      const response = await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target.sourceUrl }),
      });
      if (!response.ok) {
        setStreamError('Could not reload this video right now.');
        return;
      }
      const data = (await response.json()) as ResolvedVideo;
      const refreshed: ActiveViewVideo = {
        ...data,
        sourceUrl: data.sourceUrl || target.sourceUrl,
      };
      setActiveVideo((current) => (current?.id === target.id ? refreshed : current));
    } catch {
      setStreamError('Network error while loading the video.');
    } finally {
      setIsRefreshingStream(false);
    }
  }

  async function handlePasteClick() {
    setFeedback(null);
    if (pasteTimerRef.current !== null) {
      window.clearTimeout(pasteTimerRef.current);
    }

    try {
      if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
        throw new Error('Clipboard API unavailable');
      }
      const rawText = (await navigator.clipboard.readText()).trim();
      if (!rawText) {
        setFeedback({
          type: 'info',
          message: 'Your clipboard is empty. Copy a TikTok link and try again.',
        });
        inputRef.current?.focus();
        return;
      }

      const cleanUrl = extractTikTokUrl(rawText) ?? rawText;
      setUrl(cleanUrl);
      setPasteState('pasted');
      pasteTimerRef.current = window.setTimeout(() => setPasteState('idle'), 1500);

      if (looksLikeTikTokUrl(cleanUrl)) {
        void resolveAndDisplay(cleanUrl);
      } else {
        inputRef.current?.focus();
      }
    } catch {
      inputRef.current?.focus();
      setFeedback({
        type: 'info',
        message: 'Press Ctrl+V or Cmd+V inside the link box to paste.',
      });
    }
  }

  function handleInputPaste(event: ClipboardEvent<HTMLInputElement>) {
    const raw = event.clipboardData?.getData('text') ?? '';
    const extracted = extractTikTokUrl(raw);
    if (extracted && extracted !== raw.trim()) {
      event.preventDefault();
      setUrl(extracted);
      setFeedback(null);
    }
  }

  function handleClear() {
    setUrl('');
    setFeedback(null);
    inputRef.current?.focus();
  }

  function handleInputBlur() {
    const candidate = extractTikTokUrl(url) ?? url.trim();
    if (candidate.length > 0 && !looksLikeTikTokUrl(candidate)) {
      setFeedback({
        type: 'error',
        message: 'Enter a valid TikTok link (tiktok.com, vm.tiktok.com, or vt.tiktok.com).',
      });
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const rawTrimmed = url.trim();

    if (!rawTrimmed) {
      setFeedback({
        type: 'error',
        message: 'Paste a TikTok video link first.',
      });
      inputRef.current?.focus();
      return;
    }

    const normalizedUrl = extractTikTokUrl(rawTrimmed) ?? rawTrimmed;
    if (normalizedUrl !== rawTrimmed) {
      setUrl(normalizedUrl);
    }

    if (!looksLikeTikTokUrl(normalizedUrl)) {
      setFeedback({
        type: 'error',
        message: 'Enter a valid TikTok link (tiktok.com, vm.tiktok.com, or vt.tiktok.com).',
      });
      inputRef.current?.focus();
      return;
    }

    await resolveAndDisplay(normalizedUrl);
  }

  const hasError = feedback?.type === 'error';

  return (
    <main className="safe-main flex min-h-dvh w-full flex-col items-center justify-center bg-black">
      <div className="w-full max-w-[430px]">
        <Mascot />

        <div className="mt-5 px-[10px]">
          <h1 className="hero-title font-bold leading-[1.06] tracking-[-0.03em] text-white">
            Download
            <br />
            TikTok Videos
          </h1>
          <p className="mt-[14px] text-[17px] font-medium leading-[1.38] tracking-[-0.01em] text-[#A1A1A6]">
            Fast. Free. No Watermark.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="mt-8">
          <div className="url-shell w-full overflow-hidden rounded-[31px] bg-[#171717]">
            <div className="flex min-h-[78px] w-full items-center gap-3.5 pl-[22px] pr-[9px] pt-[10px] pb-[18px]">
              <ChainLinkIcon className="h-[22px] w-[22px] shrink-0 text-white" />
              <input
                ref={inputRef}
                type="url"
                inputMode="url"
                required
                pattern={TIKTOK_URL_PATTERN}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-label="Paste TikTok link"
                aria-invalid={hasError ? 'true' : undefined}
                aria-describedby={hasError ? feedbackId : undefined}
                placeholder="Paste TikTok link here..."
                value={url}
                onPaste={handleInputPaste}
                onBlur={handleInputBlur}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (feedback) setFeedback(null);
                }}
                className="min-w-0 flex-1 bg-transparent pr-1 text-[15.5px] font-normal text-white placeholder:text-[#7F7F81] focus:outline-none"
              />

              {url.length > 0 ? (
                <button
                  type="button"
                  onClick={handleClear}
                  aria-label="Clear link"
                  className="flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-full text-[#8E8E93] hover:bg-[#262628] hover:text-white cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}

              <button
                type="button"
                onClick={handlePasteClick}
                aria-label={
                  pasteState === 'pasted' ? 'Link pasted' : 'Paste link from clipboard'
                }
                title="Paste link from clipboard"
                className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full bg-[#313131] text-white hover:bg-[#3F3F42] active:bg-[#4A4A4E] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              >
                {pasteState === 'pasted' ? (
                  <Check className="h-[19px] w-[19px] text-white" strokeWidth={2.4} aria-hidden="true" />
                ) : (
                  <PasteStackIcon className="h-[20px] w-[20px]" />
                )}
              </button>
            </div>

            <DownloadButton isLoading={isLoading} />
          </div>
        </form>

        {feedback ? (
          <div
            id={feedbackId}
            role={hasError ? 'alert' : 'status'}
            className={`mt-4 flex flex-wrap items-center justify-between gap-2 px-2.5 text-[14px] font-medium leading-[1.45] ${
              hasError ? 'text-[#FF3B30]' : 'text-[#A1A1A6]'
            }`}
          >
            <p className="flex items-start gap-2">
              {hasError ? (
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0 text-[#FF3B30]"
                  aria-hidden="true"
                />
              ) : null}
              <span>{feedback.message}</span>
            </p>
            {feedback.canRetry && looksLikeTikTokUrl(url.trim()) ? (
              <button
                type="button"
                onClick={() => void resolveAndDisplay(url.trim())}
                className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[12.5px] font-semibold text-white hover:bg-white/18 cursor-pointer"
              >
                <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Try again</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {activeVideo ? (
        <div ref={currentViewRef} className="video-hub w-full max-w-[920px] scroll-mt-6">
          <VideoResultCard
            video={activeVideo}
            isLoadingStream={isRefreshingStream}
            streamError={streamError}
            onStreamError={() => {
              if (!isRefreshingStream) {
                void refreshActiveStream(activeVideo);
              }
            }}
            onDismiss={() => {
              setActiveVideo(null);
              setStreamError(null);
            }}
          />
        </div>
      ) : null}
    </main>
  );
}
