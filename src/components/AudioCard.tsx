import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import {
  Check,
  Download,
  Loader2,
  Music,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { DownloadProgress, MusicAsset } from '../types/media';

interface AudioCardProps {
  music: MusicAsset | null;
  downloadUrl: string;
  fallbackCoverUrl: string | null;
  fallbackAuthor: string;
  fallbackDuration: number;
  pauseSignal: number;
  isDownloadingAny: boolean;
  activeAudioDownload: { label: string; progress: DownloadProgress } | null;
  isCompleted: boolean;
  onAudioPlay: () => void;
  onDownloadAudio: () => void;
  onCancelDownload: () => void;
}

const AUDIO_SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function AudioCard({
  music,
  downloadUrl,
  fallbackCoverUrl,
  fallbackAuthor,
  fallbackDuration,
  pauseSignal,
  isDownloadingAny,
  activeAudioDownload,
  isCompleted,
  onAudioPlay,
  onDownloadAudio,
  onCancelDownload,
}: AudioCardProps) {
  const audioSrc = music?.src ?? `${downloadUrl}${downloadUrl.includes('?') ? '&' : '?'}inline=1`;
  const coverSrc = music?.cover?.src ?? fallbackCoverUrl;
  const title = music?.title?.trim() || 'Original sound';
  const author = music?.author?.trim() || fallbackAuthor || 'TikTok';
  const initialDuration = music?.duration || fallbackDuration || 0;

  const [coverFailed, setCoverFailed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDuration);
  const [showRemaining, setShowRemaining] = useState(false);
  const [audioError, setAudioError] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);

  // Reset state when switching posts/tracks
  useEffect(() => {
    setCoverFailed(false);
    setIsPlaying(false);
    setIsBuffering(false);
    setCurrentTime(0);
    setDuration(initialDuration);
    setAudioError(false);
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
  }, [audioSrc, initialDuration]);

  // Pause audio if the main video starts playing
  useEffect(() => {
    if (pauseSignal === 0) return;
    const el = audioRef.current;
    if (el && !el.paused) {
      el.pause();
      setIsPlaying(false);
      setIsBuffering(false);
    }
  }, [pauseSignal]);

  // Smooth real-time timeline updates while audio plays
  useEffect(() => {
    if (!isPlaying) return;
    let rafId = 0;

    const tick = () => {
      const el = audioRef.current;
      if (el && !el.paused) {
        const t = el.currentTime;
        setCurrentTime((prev) => (Math.floor(prev * 20) !== Math.floor(t * 20) ? t : prev));
        rafId = window.requestAnimationFrame(tick);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [isPlaying]);

  // Sync playbackRate, loop, and mute state to the audio element
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = playbackRate;
    el.loop = isLooping;
    el.muted = isMuted;
  }, [playbackRate, isLooping, isMuted, audioSrc]);

  const totalDuration = duration > 0 ? duration : initialDuration;
  const sliderMax = totalDuration > 0 ? totalDuration : 100;
  const sliderValue = totalDuration > 0 ? Math.min(currentTime, totalDuration) : 0;
  const remainingTime = Math.max(0, totalDuration - sliderValue);

  function togglePlay() {
    const el = audioRef.current;
    if (!el || audioError) return;
    if (el.paused) {
      onAudioPlay();
      el.muted = isMuted;
      el.playbackRate = playbackRate;
      void el.play().then(
        () => setIsPlaying(true),
        () => {
          setIsPlaying(false);
          setIsBuffering(false);
        },
      );
    } else {
      el.pause();
      setIsPlaying(false);
      setIsBuffering(false);
    }
  }

  function handleSeek(nextTime: number) {
    const el = audioRef.current;
    if (!el || !Number.isFinite(nextTime)) return;
    const clamped = Math.max(0, Math.min(totalDuration || nextTime, nextTime));
    el.currentTime = clamped;
    setCurrentTime(clamped);
  }

  function seekBy(deltaSeconds: number) {
    const el = audioRef.current;
    if (!el || audioError) return;
    const maxTime = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : totalDuration;
    const next = Math.max(0, Math.min(maxTime || 0, el.currentTime + deltaSeconds));
    el.currentTime = next;
    setCurrentTime(next);
  }

  function toggleMute() {
    const next = !isMuted;
    setIsMuted(next);
    if (audioRef.current) {
      audioRef.current.muted = next;
    }
  }

  function cycleSpeed() {
    const idx = AUDIO_SPEEDS.indexOf(playbackRate as (typeof AUDIO_SPEEDS)[number]);
    const next = AUDIO_SPEEDS[(idx + 1) % AUDIO_SPEEDS.length] ?? 1;
    setPlaybackRate(next);
  }

  function handleCardKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement | null;
    if (target && target.tagName === 'INPUT') return;

    if (e.key === ' ' || e.key.toLowerCase() === 'k') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'j') {
      e.preventDefault();
      seekBy(-5);
    } else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'l') {
      e.preventDefault();
      seekBy(5);
    } else if (e.key.toLowerCase() === 'm') {
      e.preventDefault();
      toggleMute();
    }
  }

  const scrubberStyle = {
    '--attr-min': 0,
    '--attr-max': sliderMax,
    '--control-value': sliderValue,
  } as CSSProperties;

  return (
    <div
      onKeyDown={handleCardKeyDown}
      className="rounded-[26px] border border-white/10 bg-[#141414] p-5"
    >
      <audio
        ref={audioRef}
        src={audioSrc}
        preload="metadata"
        muted={isMuted}
        loop={isLooping}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onWaiting={() => setIsBuffering(true)}
        onCanPlay={() => setIsBuffering(false)}
        onPlaying={() => {
          setIsPlaying(true);
          setIsBuffering(false);
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => {
          setIsPlaying(false);
          setIsBuffering(false);
        }}
        onEnded={() => {
          setIsPlaying(false);
          setIsBuffering(false);
          if (!isLooping) setCurrentTime(0);
        }}
        onError={() => {
          setIsPlaying(false);
          setIsBuffering(false);
          setAudioError(true);
        }}
      />

      {/* Top row: Interactive cover artwork + Track title + Author · Duration */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={togglePlay}
          disabled={audioError}
          aria-label={isPlaying ? `Pause ${title}` : `Play ${title}`}
          className="group relative h-[64px] w-[64px] shrink-0 overflow-hidden rounded-[16px] border border-white/12 bg-[#0B0B0C] cursor-pointer disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          {coverSrc && !coverFailed ? (
            <img
              src={coverSrc}
              alt={`${title} cover`}
              referrerPolicy="no-referrer"
              onError={() => setCoverFailed(true)}
              className="h-full w-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.04]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[#8E8E93]">
              <Music className="h-6 w-6" aria-hidden="true" />
            </div>
          )}

          {!audioError ? (
            <span
              aria-hidden="true"
              className={`absolute inset-0 flex items-center justify-center bg-black/45 text-white transition-opacity duration-150 ${
                isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              {isBuffering ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : isPlaying ? (
                <Pause className="h-5 w-5 fill-white" />
              ) : (
                <Play className="ml-0.5 h-5 w-5 fill-white" />
              )}
            </span>
          ) : null}
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-bold leading-[1.3] tracking-[-0.015em] text-white">
            {title}
          </p>
          <p className="mt-1 truncate text-[14px] font-medium tabular-nums text-[#8E8E93]">
            <span>{author}</span>
            {totalDuration > 0 ? (
              <>
                <span className="mx-1.5" aria-hidden="true">
                  ·
                </span>
                <span>{formatTime(totalDuration)}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      {/* Middle section: Dedicated two-row OLED audio deck with full-width timeline + crisp controls */}
      <div className="mt-4 rounded-[20px] border border-white/[0.06] bg-[#1C1C1F] px-4 pt-3 pb-3.5">
        {/* Full-width precision scrubber */}
        <input
          type="range"
          min={0}
          max={sliderMax}
          step={0.1}
          value={sliderValue}
          disabled={audioError || totalDuration <= 0}
          style={scrubberStyle}
          aria-label="Seek audio timeline"
          aria-valuetext={`${formatTime(sliderValue)} of ${formatTime(totalDuration)}`}
          onChange={(e) => handleSeek(Number(e.target.value))}
          className="video-scrubber audio-scrubber block w-full"
        />

        {/* Elapsed / Total (tap right timestamp to toggle remaining time) */}
        <div className="-mt-1 flex items-center justify-between text-[12px] font-medium tabular-nums text-[#8E8E93]">
          <span>{formatTime(sliderValue)}</span>
          <button
            type="button"
            onClick={() => setShowRemaining((prev) => !prev)}
            aria-label={
              showRemaining
                ? `${formatTime(remainingTime)} remaining, click to show total duration`
                : `Total duration ${formatTime(totalDuration)}, click to show remaining time`
            }
            className="min-h-0 min-w-0 rounded px-1 py-0.5 text-[#8E8E93] hover:text-white cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            {showRemaining ? `-${formatTime(remainingTime)}` : formatTime(totalDuration)}
          </button>
        </div>

        {/* Transport controls row */}
        <div className="mt-2.5 flex items-center justify-between gap-2">
          {/* Left: -5s, Play/Pause, +5s */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => seekBy(-5)}
              disabled={audioError}
              aria-label="Rewind 5 seconds"
              title="Rewind 5s"
              className="flex h-[40px] w-[40px] items-center justify-center rounded-full text-[#A1A1A6] hover:bg-white/10 hover:text-white disabled:opacity-35 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <RotateCcw className="h-[17px] w-[17px]" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={togglePlay}
              disabled={audioError}
              aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
              className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-white text-[#0A0A0A] hover:bg-[#EAEAEF] active:scale-[0.96] transition-transform duration-150 disabled:opacity-40 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              {isBuffering ? (
                <Loader2 className="h-[19px] w-[19px] animate-spin" aria-hidden="true" />
              ) : isPlaying ? (
                <Pause className="h-[19px] w-[19px] fill-current" aria-hidden="true" />
              ) : (
                <Play className="ml-0.5 h-[19px] w-[19px] fill-current" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              onClick={() => seekBy(5)}
              disabled={audioError}
              aria-label="Forward 5 seconds"
              title="Forward 5s"
              className="flex h-[40px] w-[40px] items-center justify-center rounded-full text-[#A1A1A6] hover:bg-white/10 hover:text-white disabled:opacity-35 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <RotateCw className="h-[17px] w-[17px]" aria-hidden="true" />
            </button>
          </div>

          {/* Right: Speed, Loop, Mute */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={cycleSpeed}
              disabled={audioError}
              aria-label={`Playback speed ${playbackRate}x`}
              title="Change playback speed"
              className={`flex h-[40px] min-w-[44px] items-center justify-center rounded-full px-2.5 text-[12.5px] font-semibold tabular-nums transition-colors cursor-pointer disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 whitespace-nowrap ${
                playbackRate !== 1
                  ? 'bg-white/16 text-white'
                  : 'text-[#A1A1A6] hover:bg-white/10 hover:text-white'
              }`}
            >
              {playbackRate}×
            </button>

            <button
              type="button"
              onClick={() => setIsLooping((loop) => !loop)}
              disabled={audioError}
              aria-label={isLooping ? 'Disable loop' : 'Enable loop'}
              aria-pressed={isLooping}
              title={isLooping ? 'Loop on' : 'Loop off'}
              className={`flex h-[40px] w-[40px] items-center justify-center rounded-full transition-colors cursor-pointer disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                isLooping
                  ? 'bg-white/16 text-white'
                  : 'text-[#A1A1A6] hover:bg-white/10 hover:text-white'
              }`}
            >
              <Repeat className="h-[17px] w-[17px]" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={toggleMute}
              disabled={audioError}
              aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
              aria-pressed={isMuted}
              title={isMuted ? 'Unmute' : 'Mute'}
              className={`flex h-[40px] w-[40px] items-center justify-center rounded-full transition-colors cursor-pointer disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
                isMuted
                  ? 'bg-white/16 text-white'
                  : 'text-[#A1A1A6] hover:bg-white/10 hover:text-white'
              }`}
            >
              {isMuted ? (
                <VolumeX className="h-[18px] w-[18px]" aria-hidden="true" />
              ) : (
                <Volume2 className="h-[18px] w-[18px]" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {audioError ? (
          <p className="mt-2 text-[12.5px] font-medium text-[#8E8E93]">
            Audio preview unavailable — you can still download the MP3 below.
          </p>
        ) : null}
      </div>

      {/* Real-time progress bar while downloading music */}
      {activeAudioDownload ? (
        <div
          role="status"
          aria-live="polite"
          className="mt-3.5 rounded-2xl border border-white/10 bg-[#1B1B1D] px-4 py-3"
        >
          <div className="flex items-center justify-between gap-2 text-[13px]">
            <span className="truncate font-medium text-white">
              {activeAudioDownload.label}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-semibold tabular-nums text-[#D1D1D6]">
                {activeAudioDownload.progress.percent !== null
                  ? `${activeAudioDownload.progress.percent}%`
                  : '...'}
              </span>
              <button
                type="button"
                onClick={onCancelDownload}
                aria-label="Cancel audio download"
                className="flex h-7 w-7 items-center justify-center rounded-full text-[#8E8E93] hover:bg-white/10 hover:text-white cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div
            role="progressbar"
            aria-label={activeAudioDownload.label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={activeAudioDownload.progress.percent ?? undefined}
            className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/15"
          >
            {activeAudioDownload.progress.percent !== null ? (
              <div
                className="h-full w-full origin-left rounded-full bg-white transition-transform duration-150 ease-out"
                style={{
                  transform: `scaleX(${Math.max(0.02, activeAudioDownload.progress.percent / 100)})`,
                }}
              />
            ) : (
              <div className="download-progress-indeterminate h-full w-2/5 rounded-full bg-white" />
            )}
          </div>
        </div>
      ) : null}

      {/* Bottom row: Full-width clean bordered Download music button */}
      <button
        type="button"
        disabled={isDownloadingAny}
        onClick={onDownloadAudio}
        className="mt-3.5 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[14px] border border-white/12 bg-[#1B1B1E] px-5 py-3 text-[15.5px] font-semibold tracking-[-0.01em] text-white hover:border-white/24 hover:bg-[#242429] active:bg-[#2C2C32] disabled:opacity-60 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 whitespace-nowrap"
      >
        {isCompleted ? (
          <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
        ) : (
          <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        <span>
          {activeAudioDownload
            ? 'Downloading music...'
            : isCompleted
              ? 'Music saved'
              : 'Download music'}
        </span>
      </button>
    </div>
  );
}
