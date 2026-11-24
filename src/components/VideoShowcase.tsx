import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Film,
  Heart,
  Image as ImageIcon,
  Maximize,
  Minimize,
  Music,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { DownloadTrayIcon } from './Icons';
import { parseCaptionAndHashtags, truncateAtWord } from '../utils/caption';
import type { PhotoSlideItem, ResolvedVideo, VideoQualityOption } from '../types';

export interface VideoShowcaseData {
  id: string;
  type?: 'photo' | 'video';
  title: string;
  authorName: string;
  authorHandle: string;
  duration: number;
  likeCount?: number | null;
  viewCount?: number | null;
  coverUrl: string | null;
  previewUrl?: string | null;
  qualities?: VideoQualityOption[];
  images?: PhotoSlideItem[];
  downloads: ResolvedVideo['downloads'];
}

interface VideoShowcaseProps {
  video: VideoShowcaseData;
  lazy?: boolean;
  isLoadingStream?: boolean;
  streamError?: string | null;
  onStreamError?: () => void;
}

const CAPTION_COLLAPSE_LIMIT = 140;
const DOUBLE_CLICK_GUARD_MS = 220;
const PLAYBACK_SPEEDS = [1, 1.25, 1.5, 2] as const;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return value.toLocaleString();
}

export function VideoShowcase({
  video,
  lazy = false,
  isLoadingStream = false,
  streamError = null,
  onStreamError,
}: VideoShowcaseProps) {
  const [coverFailed, setCoverFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );
  const [isPaused, setIsPaused] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );
  const [showControls, setShowControls] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(video.duration || 0);
  const [isCaptionExpanded, setIsCaptionExpanded] = useState(false);
  const [downloadFeedback, setDownloadFeedback] = useState<'video' | 'audio' | 'photo' | 'live' | null>(null);
  const [selectedQualityIndex, setSelectedQualityIndex] = useState(0);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [shouldLoadPlayer, setShouldLoadPlayer] = useState(() => {
    if (!lazy) return true;
    return typeof HTMLMediaElement !== 'undefined'
      ? Object.hasOwn(HTMLMediaElement.prototype, 'loading')
      : true;
  });

  const playerFrameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isMutedRef = useRef(isMuted);
  const playbackSpeedRef = useRef(playbackSpeed);
  const hideControlsTimerRef = useRef<number | null>(null);
  const pendingClickTimerRef = useRef<number | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  isMutedRef.current = isMuted;
  playbackSpeedRef.current = playbackSpeed;

  function clearHideControlsTimer() {
    if (hideControlsTimerRef.current !== null) {
      window.clearTimeout(hideControlsTimerRef.current);
      hideControlsTimerRef.current = null;
    }
  }

  function clearPendingClickTimer() {
    if (pendingClickTimerRef.current !== null) {
      window.clearTimeout(pendingClickTimerRef.current);
      pendingClickTimerRef.current = null;
    }
  }

  function scheduleHideControls() {
    clearHideControlsTimer();
    hideControlsTimerRef.current = window.setTimeout(() => {
      setShowControls(false);
      hideControlsTimerRef.current = null;
    }, 2800);
  }

  useEffect(() => {
    return () => {
      clearHideControlsTimer();
      clearPendingClickTimer();
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  // Reset per-video state when switching videos
  useEffect(() => {
    clearHideControlsTimer();
    clearPendingClickTimer();
    setCoverFailed(false);
    setVideoFailed(false);
    setCurrentTime(0);
    setMediaDuration(video.duration || 0);
    setIsCaptionExpanded(false);
    setDownloadFeedback(null);
    setSelectedQualityIndex(0);
    setActiveSlideIndex(0);
    setIsPaused(prefersReducedMotion);
    setShowControls(prefersReducedMotion);
  }, [video.id, video.previewUrl, video.duration, prefersReducedMotion]);

  const qualities = video.qualities ?? [];
  const selectedQuality = qualities[selectedQualityIndex] ?? qualities[0] ?? null;
  const activePreviewUrl = selectedQuality?.src ?? video.previewUrl ?? null;
  const primaryDownloadUrl =
    selectedQuality?.dl ?? video.downloads.hd?.url ?? video.downloads.sd?.url ?? null;

  const images = video.images ?? [];
  const isPhotoPost = video.type === 'photo' && images.length > 0;
  const activeSlide = isPhotoPost ? images[Math.min(activeSlideIndex, images.length - 1)] : null;

  // Keep playbackRate synced to the active video element
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed, activePreviewUrl, shouldLoadPlayer]);

  // Listen to reduced-motion preference changes
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
      if (event.matches && videoRef.current) {
        videoRef.current.pause();
        setShowControls(true);
      }
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // IntersectionObserver fallback for lazy-loaded video when native HTMLMediaElement.loading is unsupported
  useEffect(() => {
    if (!lazy || shouldLoadPlayer) return;
    const node = playerFrameRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setShouldLoadPlayer(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShouldLoadPlayer(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: '200px 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [lazy, shouldLoadPlayer]);

  // Keep fullscreen indicator synced
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === playerFrameRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Autoplay with sound on when stream is ready and reduced-motion is not requested
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !shouldLoadPlayer || !activePreviewUrl || isPhotoPost) return;
    el.muted = isMutedRef.current;
    el.playbackRate = playbackSpeedRef.current;
    if (prefersReducedMotion) {
      el.pause();
      setIsPaused(true);
      setShowControls(true);
      return;
    }
    clearHideControlsTimer();
    setIsPaused(false);
    setShowControls(false);
    void el.play().catch(() => {
      // Browser blocked unmuted autoplay before user interaction; keep sound enabled and show play UI
      setIsPaused(true);
      setShowControls(true);
    });
  }, [activePreviewUrl, isPhotoPost, shouldLoadPlayer, prefersReducedMotion]);

  // Real-time clock overlay updates via requestAnimationFrame while playing
  useEffect(() => {
    if (isPaused || !shouldLoadPlayer || !activePreviewUrl || isPhotoPost) return;
    let rafId = 0;

    const syncClock = () => {
      const el = videoRef.current;
      if (el && !el.paused) {
        const t = el.currentTime;
        setCurrentTime((prev) => (Math.floor(prev * 10) !== Math.floor(t * 10) ? t : prev));
        rafId = window.requestAnimationFrame(syncClock);
      }
    };

    rafId = window.requestAnimationFrame(syncClock);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [isPaused, shouldLoadPlayer, activePreviewUrl, isPhotoPost]);

  function togglePlayPause() {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      clearHideControlsTimer();
      setIsPaused(false);
      setShowControls(false);
      el.muted = isMuted;
      void el.play().catch(() => {
        setIsPaused(true);
        setShowControls(true);
      });
    } else {
      clearHideControlsTimer();
      el.pause();
      setIsPaused(true);
      setShowControls(true);
    }
  }

  function handleVideoSingleClick() {
    const el = videoRef.current;
    if (!el) return;
    clearPendingClickTimer();
    pendingClickTimerRef.current = window.setTimeout(() => {
      pendingClickTimerRef.current = null;
      // Single press toggles player controls without pausing playback
      setShowControls((prev) => {
        const next = !prev;
        if (next && !el.paused) {
          scheduleHideControls();
        } else {
          clearHideControlsTimer();
        }
        return next;
      });
    }, DOUBLE_CLICK_GUARD_MS);
  }

  function handleCenterButtonClick() {
    clearPendingClickTimer();
    pendingClickTimerRef.current = window.setTimeout(() => {
      pendingClickTimerRef.current = null;
      togglePlayPause();
    }, DOUBLE_CLICK_GUARD_MS);
  }

  function handleVideoDoubleClick() {
    clearPendingClickTimer();
    clearHideControlsTimer();
    const el = videoRef.current;
    if (!el) return;

    if (!el.paused) {
      // 1st double-click while playing: pause and show player UI
      el.pause();
      setIsPaused(true);
      setShowControls(true);
      return;
    }

    if (showControls) {
      // 2nd double-click while paused with UI: return to normal mode without player UI and stay stopped
      setShowControls(false);
      return;
    }

    // Double-click from paused normal mode (no UI): resume playing without UI
    setIsPaused(false);
    setShowControls(false);
    el.muted = isMuted;
    void el.play().catch(() => {
      setIsPaused(true);
      setShowControls(true);
    });
  }

  function toggleMute() {
    const el = videoRef.current;
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (el) {
      el.muted = nextMuted;
    }
    if (!isPaused) {
      scheduleHideControls();
    }
  }

  function cyclePlaybackSpeed() {
    const currentIndex = PLAYBACK_SPEEDS.indexOf(
      playbackSpeed as (typeof PLAYBACK_SPEEDS)[number],
    );
    const nextSpeed = PLAYBACK_SPEEDS[(currentIndex + 1) % PLAYBACK_SPEEDS.length] ?? 1;
    setPlaybackSpeed(nextSpeed);
    if (videoRef.current) {
      videoRef.current.playbackRate = nextSpeed;
    }
    if (!isPaused) {
      scheduleHideControls();
    }
  }

  function seekBy(deltaSeconds: number) {
    const el = videoRef.current;
    if (!el) return;
    const maxTime = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : totalDuration;
    const clamped = Math.max(0, Math.min(maxTime || 0, el.currentTime + deltaSeconds));
    el.currentTime = clamped;
    setCurrentTime(clamped);
  }

  function handleSeek(nextTime: number) {
    const el = videoRef.current;
    if (!el || !Number.isFinite(nextTime)) return;
    el.currentTime = nextTime;
    setCurrentTime(nextTime);
    if (!isPaused) {
      scheduleHideControls();
    }
  }

  async function toggleFullscreen() {
    const frame = playerFrameRef.current;
    const el = videoRef.current as (HTMLVideoElement & {
      webkitEnterFullscreen?: () => void;
    }) | null;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (frame && typeof frame.requestFullscreen === 'function') {
        await frame.requestFullscreen();
      } else if (el && typeof el.webkitEnterFullscreen === 'function') {
        el.webkitEnterFullscreen();
      }
    } catch {
      // Ignore fullscreen rejection in restricted iframes
    }
  }

  function triggerDownloadNotice(kind: 'video' | 'audio' | 'photo' | 'live') {
    setDownloadFeedback(kind);
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = window.setTimeout(() => {
      setDownloadFeedback(null);
      feedbackTimerRef.current = null;
    }, 2000);
  }

  const { caption, hashtags } = useMemo(
    () => parseCaptionAndHashtags(video.title),
    [video.title],
  );

  const isLongCaption = caption.length > CAPTION_COLLAPSE_LIMIT || caption.split('\n').length > 3;
  const displayedCaption =
    isLongCaption && !isCaptionExpanded
      ? `${truncateAtWord(caption, CAPTION_COLLAPSE_LIMIT)}...`
      : caption;

  const totalDuration = mediaDuration > 0 ? mediaDuration : video.duration || 0;
  const sliderMax = totalDuration > 0 ? totalDuration : 100;
  const sliderValue = totalDuration > 0 ? Math.min(currentTime, totalDuration) : 0;

  const scrubberStyle = {
    '--attr-min': 0,
    '--attr-max': sliderMax,
    '--control-value': sliderValue,
  } as CSSProperties;

  const hasLikes = typeof video.likeCount === 'number' && video.likeCount >= 0;
  const hasViews = typeof video.viewCount === 'number' && video.viewCount >= 0;

  return (
    <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-[minmax(0,380px)_minmax(0,1fr)] md:items-start">
      {/* 1. Standalone Video Player */}
      <div className="w-full">
        <div
          ref={playerFrameRef}
          className="relative w-full overflow-hidden rounded-[28px] border border-white/15 bg-[#0B0B0C] aspect-[9/16] max-h-[660px]"
        >
          {isPhotoPost && activeSlide ? (
            <>
              <img
                key={activeSlide.src}
                src={activeSlide.src}
                alt={`${video.title} — photo ${activeSlideIndex + 1} of ${images.length}`}
                referrerPolicy="no-referrer"
                className="h-full w-full bg-black object-contain"
              />
              <div className="pointer-events-none absolute top-3.5 left-3.5 rounded-full border border-white/12 bg-black/55 px-3 py-1 text-[12.5px] font-semibold tabular-nums text-white backdrop-blur-md select-none">
                {activeSlideIndex + 1} / {images.length}
              </div>
              {images.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveSlideIndex((idx) => (idx - 1 + images.length) % images.length)
                    }
                    aria-label="Previous photo"
                    className="absolute left-3 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveSlideIndex((idx) => (idx + 1) % images.length)}
                    aria-label="Next photo"
                    className="absolute right-3 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <ChevronRight className="h-5 w-5" aria-hidden="true" />
                  </button>
                </>
              ) : null}
            </>
          ) : activePreviewUrl && !videoFailed ? (
            <>
              <video
                ref={videoRef}
                key={activePreviewUrl}
                src={shouldLoadPlayer ? activePreviewUrl : undefined}
                poster={shouldLoadPlayer ? (video.coverUrl ?? undefined) : undefined}
                width={540}
                height={960}
                preload={shouldLoadPlayer ? 'metadata' : 'none'}
                autoPlay={shouldLoadPlayer && !prefersReducedMotion}
                muted={isMuted}
                loop
                playsInline
                tabIndex={0}
                aria-label={
                  isPaused
                    ? 'Paused video, double click to toggle controls or play'
                    : 'Playing video, double click to pause'
                }
                {...(lazy ? ({ loading: 'lazy' } as Record<string, string>) : {})}
                onClick={handleVideoSingleClick}
                onDoubleClick={handleVideoDoubleClick}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter' || e.key.toLowerCase() === 'k') {
                    e.preventDefault();
                    togglePlayPause();
                  } else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'j') {
                    e.preventDefault();
                    seekBy(-5);
                  } else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'l') {
                    e.preventDefault();
                    seekBy(5);
                  } else if (e.key.toLowerCase() === 'm') {
                    e.preventDefault();
                    toggleMute();
                  } else if (e.key.toLowerCase() === 'f') {
                    e.preventDefault();
                    void toggleFullscreen();
                  } else if (e.key === 'Escape') {
                    setShowControls(false);
                  }
                }}
                onPlay={() => setIsPaused(false)}
                onPlaying={() => setIsPaused(false)}
                onPause={() => {
                  clearHideControlsTimer();
                  setIsPaused(true);
                }}
                onLoadedMetadata={(e) => {
                  const dur = e.currentTarget.duration;
                  if (Number.isFinite(dur) && dur > 0) {
                    setMediaDuration(dur);
                  }
                }}
                onTimeUpdate={(e) => {
                  setCurrentTime(e.currentTarget.currentTime);
                }}
                onSeeked={(e) => {
                  setCurrentTime(e.currentTarget.currentTime);
                }}
                onError={() => {
                  setVideoFailed(true);
                  onStreamError?.();
                }}
                className="h-full w-full cursor-pointer bg-black object-cover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              />

              {/* Persistent real-time current time / total duration text overlay */}
              <div
                aria-live="off"
                className="pointer-events-none absolute top-3.5 left-3.5 rounded-full border border-white/12 bg-black/55 px-3 py-1 text-[12.5px] font-semibold tabular-nums tracking-[-0.01em] text-white backdrop-blur-md select-none"
              >
                <span>{formatTime(sliderValue)}</span>
                <span className="mx-1 text-white/45">/</span>
                <span className="text-white/75">{formatTime(totalDuration)}</span>
              </div>

              {/* Player UI is shown only when showControls is active; hides cleanly on second double-click while staying paused */}
              {showControls ? (
                <>
                  <button
                    type="button"
                    onClick={handleCenterButtonClick}
                    onDoubleClick={handleVideoDoubleClick}
                    aria-label={isPaused ? 'Play video' : 'Pause video'}
                    className="absolute inset-0 m-auto flex h-[68px] w-[68px] items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/75 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    {isPaused ? (
                      <Play className="ml-1 h-7 w-7 fill-white text-white" aria-hidden="true" />
                    ) : (
                      <Pause className="h-7 w-7 fill-white text-white" aria-hidden="true" />
                    )}
                  </button>

                  <div
                    className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pt-12 pb-3.5"
                    onPointerDown={() => {
                      if (!isPaused) scheduleHideControls();
                    }}
                  >
                    <input
                      type="range"
                      min={0}
                      max={sliderMax}
                      step={0.1}
                      value={sliderValue}
                      style={scrubberStyle}
                      aria-label="Seek video timeline"
                      aria-valuetext={`${formatTime(sliderValue)} of ${formatTime(totalDuration)}`}
                      onChange={(e) => handleSeek(Number(e.target.value))}
                      className="video-scrubber block w-full"
                    />

                    <div className="-mt-1 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={togglePlayPause}
                          aria-label={isPaused ? 'Play video' : 'Pause video'}
                          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-white/14 text-white backdrop-blur-sm hover:bg-white/24 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                        >
                          {isPaused ? (
                            <Play className="ml-0.5 h-[18px] w-[18px] fill-current" aria-hidden="true" />
                          ) : (
                            <Pause className="h-[18px] w-[18px] fill-current" aria-hidden="true" />
                          )}
                        </button>

                        <span className="text-[13px] font-medium tabular-nums text-white/90">
                          {formatTime(sliderValue)}
                          <span className="mx-1 text-white/45">/</span>
                          <span className="text-white/65">{formatTime(totalDuration)}</span>
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={cyclePlaybackSpeed}
                          aria-label={`Playback speed ${playbackSpeed}x`}
                          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-white/14 px-2.5 text-[12.5px] font-semibold tabular-nums text-white backdrop-blur-sm hover:bg-white/24 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                        >
                          {playbackSpeed}×
                        </button>

                        <button
                          type="button"
                          onClick={toggleMute}
                          aria-label={isMuted ? 'Unmute video' : 'Mute video'}
                          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-white/14 text-white backdrop-blur-sm hover:bg-white/24 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                        >
                          {isMuted ? (
                            <VolumeX className="h-[18px] w-[18px]" aria-hidden="true" />
                          ) : (
                            <Volume2 className="h-[18px] w-[18px]" aria-hidden="true" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => void toggleFullscreen()}
                          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-white/14 text-white backdrop-blur-sm hover:bg-white/24 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                        >
                          {isFullscreen ? (
                            <Minimize className="h-[18px] w-[18px]" aria-hidden="true" />
                          ) : (
                            <Maximize className="h-[18px] w-[18px]" aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
            </>
          ) : video.coverUrl && !coverFailed ? (
            <img
              src={video.coverUrl}
              alt={video.title}
              width={540}
              height={960}
              referrerPolicy="no-referrer"
              onError={() => setCoverFailed(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-[14px] text-[#8E8E93]">
              <Film className="h-8 w-8" aria-hidden="true" />
              <span>{isLoadingStream ? 'Loading video...' : 'Video preview unavailable'}</span>
            </div>
          )}
        </div>

        {streamError ? (
          <p role="alert" className="mt-2.5 px-2 text-[13.5px] font-medium text-[#FF3B30]">
            {streamError}
          </p>
        ) : null}
      </div>

      {/* Right Column: Separate Description Card + Download Card */}
      <div className="flex min-w-0 flex-col gap-4">
        {/* 2. Description Card: Likes | Views -> Caption (Read more / Read less) -> Separator -> Hashtags # */}
        <div className="rounded-[26px] border border-white/10 bg-[#141414] p-6 sm:p-7">
          {/* Row 1: Number of likes | views side-by-side */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-white/[0.08] pb-4">
            <div className="flex items-center gap-1.5">
              <Heart className="h-4 w-4 text-[#8E8E93]" aria-hidden="true" />
              <span className="text-[16px] font-bold tabular-nums tracking-[-0.015em] text-white">
                {hasLikes ? formatCompactNumber(video.likeCount!) : '—'}
              </span>
              <span className="text-[13.5px] font-medium text-[#8E8E93]">likes</span>
            </div>

            <span aria-hidden="true" className="text-[#48484A] select-none">
              |
            </span>

            <div className="flex items-center gap-1.5">
              <Eye className="h-4 w-4 text-[#8E8E93]" aria-hidden="true" />
              <span className="text-[16px] font-bold tabular-nums tracking-[-0.015em] text-white">
                {hasViews ? formatCompactNumber(video.viewCount!) : '—'}
              </span>
              <span className="text-[13.5px] font-medium text-[#8E8E93]">views</span>
            </div>
          </div>

          {/* Row 2: Caption with ... + Read more / Read less when long */}
          {caption ? (
            <p className="mt-4 text-[15.5px] font-normal leading-[1.68] text-[#F2F2F7] whitespace-pre-line">
              {displayedCaption}
              {isLongCaption ? (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={() => setIsCaptionExpanded((expanded) => !expanded)}
                    className="inline min-h-0 min-w-0 font-semibold text-white underline-offset-4 hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 rounded"
                  >
                    {isCaptionExpanded ? 'Read less' : 'Read more'}
                  </button>
                </>
              ) : null}
            </p>
          ) : null}

          {/* Row 3: Separator + Hashtags # */}
          {hashtags.length > 0 ? (
            <div
              className={`${
                caption ? 'mt-4 border-t border-white/[0.08] pt-4' : 'mt-4'
              } flex flex-wrap gap-x-3 gap-y-1.5`}
            >
              {hashtags.map((tag) => (
                <span key={tag} className="text-[13.5px] font-medium text-[#8E8E93]">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {/* 3. Separate Download Card */}
        <div className="flex flex-col gap-2.5 rounded-[26px] border border-white/10 bg-[#141414] p-5">
          {!isPhotoPost && qualities.length > 1 ? (
            <div className="mb-1 flex flex-wrap gap-2" role="group" aria-label="Video quality">
              {qualities.map((q, idx) => {
                const resLabel = `${Math.min(q.width || 0, q.height || 0) || 'HD'}p`;
                const codecLabel = q.hevc ? ' HEVC' : '';
                const isSelected = idx === selectedQualityIndex;
                return (
                  <button
                    key={`${q.dl}-${idx}`}
                    type="button"
                    onClick={() => {
                      setSelectedQualityIndex(idx);
                      setVideoFailed(false);
                    }}
                    aria-pressed={isSelected}
                    className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold tabular-nums transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
                      isSelected
                        ? 'bg-white text-[#0A0A0A]'
                        : 'bg-[#242426] text-[#D1D1D6] hover:bg-[#313134] hover:text-white'
                    }`}
                  >
                    {resLabel}
                    {codecLabel}
                  </button>
                );
              })}
            </div>
          ) : null}

          {isPhotoPost && activeSlide ? (
            <>
              <a
                href={activeSlide.dl}
                download
                onClick={() => triggerDownloadNotice('photo')}
                className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-[15.5px] font-semibold tracking-[-0.01em] text-[#0A0A0A] hover:bg-[#EFEFF2] active:bg-[#DCDCE0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <ImageIcon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                <span>
                  {downloadFeedback === 'photo'
                    ? 'Starting download...'
                    : images.length > 1
                      ? `Download Photo ${activeSlideIndex + 1}`
                      : 'Download Photo'}
                </span>
              </a>

              {activeSlide.live ? (
                <a
                  href={activeSlide.live.dl}
                  download
                  onClick={() => triggerDownloadNotice('live')}
                  className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-full bg-[#242426] px-5 py-2.5 text-[14.5px] font-medium text-white hover:bg-[#313134] active:bg-[#3A3A3E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  <Film className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    {downloadFeedback === 'live' ? 'Starting Live Photo...' : 'Live Photo (MP4)'}
                  </span>
                </a>
              ) : null}
            </>
          ) : primaryDownloadUrl ? (
            <a
              href={primaryDownloadUrl}
              download
              onClick={() => triggerDownloadNotice('video')}
              className="flex min-h-[54px] w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-[15.5px] font-semibold tracking-[-0.01em] text-[#0A0A0A] hover:bg-[#EFEFF2] active:bg-[#DCDCE0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <DownloadTrayIcon className="h-[18px] w-[18px] shrink-0" />
              <span>{downloadFeedback === 'video' ? 'Starting download...' : 'Download'}</span>
            </a>
          ) : null}

          {video.downloads.audio ? (
            <a
              href={video.downloads.audio.url}
              download
              onClick={() => triggerDownloadNotice('audio')}
              className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-full bg-[#242426] px-5 py-2.5 text-[14.5px] font-medium text-white hover:bg-[#313134] active:bg-[#3A3A3E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <Music className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{downloadFeedback === 'audio' ? 'Starting MP3...' : 'MP3'}</span>
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
