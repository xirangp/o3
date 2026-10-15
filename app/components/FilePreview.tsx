import { useState, useRef, useEffect, useCallback } from "react";
import { getFileType, formatDuration, getCodeLanguage, type FileType } from "~/lib/file-utils";
import hljs from "highlight.js";
import { marked } from "marked";

interface FilePreviewProps {
  storageId: number;
  fileKey: string;
  fileName: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

export function FilePreview({
  storageId,
  fileKey,
  fileName,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: FilePreviewProps) {
  const fileType = getFileType(fileName);
  const fileUrl = `/api/files/${storageId}/${fileKey}?action=download`;
  const fullUrl = window.location.origin + fileUrl;
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  // 从后端获取预览配置
  const [previewConfig, setPreviewConfig] = useState<{ external?: Record<string, Record<string, string>> }>({});
  useEffect(() => {
    fetch("/api/site-meta")
      .then(res => res.json())
      .then((data: { meta?: Record<string, string> }) => {
        const m = data.meta || {};
        let external: Record<string, Record<string, string>> | undefined;
        try { external = m.preview_external ? JSON.parse(m.preview_external) : undefined; } catch {}
        if (external) setPreviewConfig({ external });
      })
      .catch(() => {});
  }, []);

  // 外部预览链接
  const externalLinks: Record<string, string> = {};
  if (previewConfig?.external) {
    // 先匹配扩展名，再匹配 "*"
    const groups = [previewConfig.external[ext], previewConfig.external["*"]];
    for (const group of groups) {
      if (group) {
        for (const [name, tpl] of Object.entries(group)) {
          const url = tpl
            .replace(/\$e_url/g, encodeURIComponent(fullUrl))
            .replace(/\$url/g, fullUrl)
            .replace(/\$name/g, encodeURIComponent(fileName));
          externalLinks[name] = url;
        }
      }
    }
  }
  const hasExternal = Object.keys(externalLinks).length > 0;
  const [showExternalPrompt, setShowExternalPrompt] = useState(false);
  // 配置加载完成后，如果有外部链接则自动弹窗
  useEffect(() => {
    if (hasExternal) setShowExternalPrompt(true);
  }, [hasExternal]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft" && onPrev && hasPrev) {
        onPrev();
      } else if (e.key === "ArrowRight" && onNext && hasNext) {
        onNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  return (
    <div
      className="fixed inset-0 bg-black/90 flex flex-col z-50"
      onClick={onClose}
    >
      {/* 外部应用弹窗 (AList 风格) */}
      {showExternalPrompt && hasExternal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]" onClick={(e) => { e.stopPropagation(); setShowExternalPrompt(false); }}>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-4">
              <div className="text-3xl mb-2">🔗</div>
              <div className="text-zinc-800 dark:text-zinc-100 font-semibold text-base">外部应用打开</div>
              <div className="text-xs text-zinc-500 mt-1 truncate">{fileName}</div>
            </div>
            <div className="space-y-2 mb-4">
              {Object.entries(externalLinks).map(([name, url]) => (
                <a
                  key={name}
                  href={url}
                  className="flex items-center justify-between w-full px-4 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-300 dark:hover:border-blue-700 transition text-sm text-zinc-700 dark:text-zinc-300"
                  onClick={() => setShowExternalPrompt(false)}
                >
                  <span>{name}</span>
                  <span className="text-xs text-zinc-400">→</span>
                </a>
              ))}
            </div>
            <button
              onClick={() => setShowExternalPrompt(false)}
              className="w-full py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
            >
              取消，留在预览
            </button>
          </div>
        </div>
      )}
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-white font-mono text-sm truncate">{fileName}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* 外部预览链接 */}
          {hasExternal && Object.entries(externalLinks).map(([name, url]) => (
            <a
              key={name}
              href={url}
              className="text-zinc-400 hover:text-emerald-400 text-xs font-mono px-2 py-1 border border-zinc-700 hover:border-emerald-500 rounded transition"
              onClick={(e) => e.stopPropagation()}
            >
              {name}
            </a>
          ))}
          <a
            href={fileUrl}
            download={fileName}
            className="text-zinc-400 hover:text-white text-sm font-mono px-3 py-1 border border-zinc-700 hover:border-zinc-500 rounded transition"
            onClick={(e) => e.stopPropagation()}
          >
            下载
          </a>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white text-2xl px-2"
          >
            ×
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        className="flex-1 flex items-center justify-center overflow-hidden relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Navigation arrows */}
        {hasPrev && (
          <button
            onClick={onPrev}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white text-4xl z-10 p-2"
          >
            ‹
          </button>
        )}
        {hasNext && (
          <button
            onClick={onNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white text-4xl z-10 p-2"
          >
            ›
          </button>
        )}

        {/* Preview content */}
        <div className="w-full h-full flex items-center justify-center p-4">
          {fileType === "video" && <VideoPlayer url={fileUrl} />}
          {fileType === "audio" && <AudioPlayer url={fileUrl} fileName={fileName} />}
          {fileType === "image" && <ImageViewer url={fileUrl} fileName={fileName} />}
          {fileType === "text" && (
            <TextViewer url={fileUrl} fileName={fileName} />
          )}
          {fileType === "code" && (
            <CodeViewer url={fileUrl} fileName={fileName} />
          )}
          {fileType === "markdown" && (
            <MarkdownViewer url={fileUrl} fileName={fileName} />
          )}
          {fileType === "pdf" && <PDFViewer url={fileUrl} />}
          {fileType === "unknown" && (
            <div className="text-zinc-400 font-mono text-center">
              <p className="text-lg mb-2">无法预览此文件类型</p>
              {hasExternal ? (
                <div className="flex flex-col items-center gap-2">
                  <p className="text-sm">选择外部预览：</p>
                  {Object.entries(externalLinks).map(([name, url]) => (
                    <a key={name} href={url} className="text-blue-400 hover:text-blue-300 underline">{name}</a>
                  ))}
                </div>
              ) : (
                <a href={fileUrl} download={fileName} className="text-blue-400 hover:text-blue-300 underline">点击下载</a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Video Player Component
function VideoPlayer({ url }: { url: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const controlsTimeoutRef = useRef<number | null>(null);

  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];

  const togglePlay = useCallback(() => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
    }
  }, [isPlaying]);

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
      // Update buffered
      if (videoRef.current.buffered.length > 0) {
        setBuffered(videoRef.current.buffered.end(videoRef.current.buffered.length - 1));
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      setIsLoading(false);
    }
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (progressRef.current && videoRef.current) {
      const rect = progressRef.current.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      const time = percent * duration;
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    setIsMuted(vol === 0);
    if (videoRef.current) {
      videoRef.current.volume = vol;
      videoRef.current.muted = vol === 0;
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      const newMuted = !isMuted;
      setIsMuted(newMuted);
      videoRef.current.muted = newMuted;
      if (!newMuted && volume === 0) {
        setVolume(0.5);
        videoRef.current.volume = 0.5;
      }
    }
  };

  const changeSpeed = (speed: number) => {
    setPlaybackRate(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
    setShowSpeedMenu(false);
  };

  const toggleFullscreen = () => {
    if (videoRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        videoRef.current.requestFullscreen();
      }
    }
  };

  const skip = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + seconds));
    }
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = window.setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skip(-10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          skip(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (videoRef.current) {
            const newVol = Math.min(1, volume + 0.1);
            setVolume(newVol);
            videoRef.current.volume = newVol;
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (videoRef.current) {
            const newVol = Math.max(0, volume - 0.1);
            setVolume(newVol);
            videoRef.current.volume = newVol;
          }
          break;
        case 'f':
          toggleFullscreen();
          break;
        case 'm':
          toggleMute();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, volume, duration]);

  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, []);

  const progress = duration ? (currentTime / duration) * 100 : 0;
  const bufferedPercent = duration ? (buffered / duration) * 100 : 0;

  return (
    <div
      className="relative w-full max-w-5xl flex items-center justify-center group"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      <video
        ref={videoRef}
        src={url}
        className="w-full max-h-[calc(100vh-160px)] rounded-lg bg-black"
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onCanPlay={() => setIsLoading(false)}
        onClick={togglePlay}
      />

      {/* Loading / Buffering indicator */}
      {(isLoading || isBuffering) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-lg">
          <div className="w-12 h-12 border-3 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* Center play button */}
      {!isPlaying && !isLoading && (
        <button
          onClick={togglePlay}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-white/30 transition-all hover:scale-110"
        >
          <svg className="w-7 h-7 ml-1" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </button>
      )}

      {/* Controls */}
      <div
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent pt-12 pb-3 px-4 rounded-b-lg transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Progress bar */}
        <div
          ref={progressRef}
          className="relative h-1 bg-white/20 rounded-full cursor-pointer mb-3 group/progress"
          onClick={handleProgressClick}
        >
          {/* Buffered */}
          <div
            className="absolute top-0 left-0 h-full bg-white/30 rounded-full"
            style={{ width: `${bufferedPercent}%` }}
          />
          {/* Progress */}
          <div
            className="absolute top-0 left-0 h-full bg-blue-500 rounded-full"
            style={{ width: `${progress}%` }}
          />
          {/* Thumb */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-blue-500 rounded-full opacity-0 group-hover/progress:opacity-100 transition-opacity shadow-lg"
            style={{ left: `calc(${progress}% - 6px)` }}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Play/Pause */}
            <button onClick={togglePlay} className="text-white p-1.5 hover:bg-white/10 rounded transition">
              {isPlaying ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              )}
            </button>

            {/* Skip buttons */}
            <button onClick={() => skip(-10)} className="text-white/70 hover:text-white p-1 text-xs font-mono">
              -10s
            </button>
            <button onClick={() => skip(10)} className="text-white/70 hover:text-white p-1 text-xs font-mono">
              +10s
            </button>

            {/* Time */}
            <span className="text-white/80 text-xs font-mono ml-1">
              {formatDuration(currentTime)} / {formatDuration(duration)}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {/* Speed */}
            <div className="relative">
              <button
                onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                className="text-white/70 hover:text-white px-2 py-1 text-xs font-mono hover:bg-white/10 rounded transition"
              >
                {playbackRate}x
              </button>
              {showSpeedMenu && (
                <div className="absolute bottom-full right-0 mb-1 bg-zinc-800 rounded-lg shadow-xl border border-zinc-700 py-1 min-w-[60px]">
                  {speeds.map((speed) => (
                    <button
                      key={speed}
                      onClick={() => changeSpeed(speed)}
                      className={`block w-full px-3 py-1 text-xs font-mono text-left hover:bg-white/10 transition ${
                        playbackRate === speed ? 'text-blue-400' : 'text-white/80'
                      }`}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Volume */}
            <div className="flex items-center gap-1 group/vol">
              <button onClick={toggleMute} className="text-white/70 hover:text-white p-1.5 hover:bg-white/10 rounded transition">
                {isMuted || volume === 0 ? (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                  </svg>
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-0 group-hover/vol:w-16 transition-all h-1 bg-white/20 rounded-full appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5
                  [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
              />
            </div>

            {/* Fullscreen */}
            <button onClick={toggleFullscreen} className="text-white/70 hover:text-white p-1.5 hover:bg-white/10 rounded transition">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Audio Player Component
function AudioPlayer({ url, fileName }: { url: string; fileName: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    if (audioRef.current) {
      audioRef.current.volume = vol;
    }
  };

  return (
    <div className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-lg p-6">
      <audio
        ref={audioRef}
        src={url}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />

      {/* Album art placeholder */}
      <div className="w-32 h-32 mx-auto mb-6 bg-zinc-800 rounded-lg flex items-center justify-center">
        <span className="text-5xl">🎵</span>
      </div>

      {/* File name */}
      <div className="text-center mb-6">
        <p className="text-white font-mono text-sm truncate">{fileName}</p>
      </div>

      {/* Progress bar */}
      <div className="mb-4">
        <input
          type="range"
          min="0"
          max={duration || 100}
          value={currentTime}
          onChange={handleSeek}
          className="w-full h-1 bg-zinc-700 rounded-full appearance-none cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
            [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
        />
        <div className="flex justify-between text-xs text-zinc-400 mt-1 font-mono">
          <span>{formatDuration(currentTime)}</span>
          <span>{formatDuration(duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-6">
        {/* Play/Pause */}
        <button
          onClick={togglePlay}
          className="w-14 h-14 bg-blue-600 hover:bg-blue-500 rounded-full flex items-center justify-center text-white text-2xl transition"
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
      </div>

      {/* Volume */}
      <div className="flex items-center justify-center gap-2 mt-6">
        <span className="text-zinc-400 text-sm">{volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={volume}
          onChange={handleVolumeChange}
          className="w-24 h-1 bg-zinc-700 rounded-full appearance-none cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2
            [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:rounded-full"
        />
      </div>
    </div>
  );
}

// Image Viewer Component
function ImageViewer({ url, fileName }: { url: string; fileName: string }) {
  const [scale, setScale] = useState(1);
  const [loading, setLoading] = useState(true);

  const zoomIn = () => setScale((s) => Math.min(s + 0.25, 3));
  const zoomOut = () => setScale((s) => Math.max(s - 0.25, 0.5));
  const resetZoom = () => setScale(1);

  return (
    <div className="flex flex-col items-center max-h-full">
      {/* Zoom controls */}
      <div className="flex items-center gap-2 mb-4 bg-black/50 rounded-lg px-3 py-2">
        <button onClick={zoomOut} className="text-white px-2 hover:text-blue-400">−</button>
        <span className="text-white text-sm font-mono w-16 text-center">{Math.round(scale * 100)}%</span>
        <button onClick={zoomIn} className="text-white px-2 hover:text-blue-400">+</button>
        <button onClick={resetZoom} className="text-zinc-400 text-xs ml-2 hover:text-white">重置</button>
      </div>

      {/* Image */}
      <div className="overflow-auto max-w-full max-h-[calc(100vh-200px)]">
        {loading && (
          <div className="flex items-center justify-center w-64 h-64">
            <span className="text-zinc-400 font-mono">加载中...</span>
          </div>
        )}
        <img
          src={url}
          alt={fileName}
          className="transition-transform"
          style={{ transform: `scale(${scale})`, display: loading ? 'none' : 'block' }}
          onLoad={() => setLoading(false)}
        />
      </div>
    </div>
  );
}

// Text Viewer Component (plain text without syntax highlighting)
function TextViewer({ url, fileName }: { url: string; fileName: string }) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const fetchContent = async () => {
      try {
        setLoading(true);
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch file");
        const text = await res.text();
        setContent(text);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load file");
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, [url]);

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-64">
        <span className="text-zinc-400 font-mono">加载中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center w-full h-64">
        <span className="text-red-400 font-mono">{error}</span>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl max-h-[calc(100vh-150px)] bg-zinc-900 border border-zinc-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-800 border-b border-zinc-700">
        <span className="text-zinc-400 text-xs font-mono">plaintext</span>
        <span className="text-zinc-500 text-xs font-mono">{content.split('\n').length} 行</span>
      </div>

      {/* Content */}
      <div className="overflow-auto max-h-[calc(100vh-200px)]">
        <pre className="p-4 text-sm font-mono text-zinc-300 whitespace-pre-wrap break-words">
          {content}
        </pre>
      </div>
    </div>
  );
}

// Code Viewer Component (with syntax highlighting)
function CodeViewer({ url, fileName }: { url: string; fileName: string }) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [highlightedCode, setHighlightedCode] = useState<string>("");
  const language = getCodeLanguage(fileName);

  useEffect(() => {
    const fetchContent = async () => {
      try {
        setLoading(true);
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch file");
        const text = await res.text();
        setContent(text);

        // Apply syntax highlighting
        try {
          const result = hljs.highlight(text, { language, ignoreIllegals: true });
          setHighlightedCode(result.value);
        } catch {
          // Fallback to auto-detection if language is not supported
          const result = hljs.highlightAuto(text);
          setHighlightedCode(result.value);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load file");
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, [url, language]);

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-64">
        <span className="text-zinc-400 font-mono">加载中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center w-full h-64">
        <span className="text-red-400 font-mono">{error}</span>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl max-h-[calc(100vh-150px)] bg-zinc-900 border border-zinc-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-800 border-b border-zinc-700">
        <span className="text-zinc-400 text-xs font-mono">{language}</span>
        <span className="text-zinc-500 text-xs font-mono">{content.split('\n').length} 行</span>
      </div>

      {/* Content with syntax highlighting */}
      <div className="overflow-auto max-h-[calc(100vh-200px)]">
        <pre className="p-4 text-sm font-mono leading-relaxed">
          <code
            className={`hljs language-${language}`}
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
          />
        </pre>
      </div>

      {/* Highlight.js dark theme styles */}
      <style>{`
        .hljs {
          color: #c9d1d9;
          background: transparent;
        }
        .hljs-comment,
        .hljs-quote {
          color: #8b949e;
          font-style: italic;
        }
        .hljs-keyword,
        .hljs-selector-tag,
        .hljs-type {
          color: #ff7b72;
        }
        .hljs-literal,
        .hljs-number,
        .hljs-tag .hljs-attr,
        .hljs-template-variable,
        .hljs-variable {
          color: #79c0ff;
        }
        .hljs-string,
        .hljs-doctag,
        .hljs-regexp {
          color: #a5d6ff;
        }
        .hljs-title,
        .hljs-title.class_,
        .hljs-title.function_ {
          color: #d2a8ff;
        }
        .hljs-params {
          color: #c9d1d9;
        }
        .hljs-built_in {
          color: #ffa657;
        }
        .hljs-symbol,
        .hljs-bullet,
        .hljs-link {
          color: #7ee787;
        }
        .hljs-meta,
        .hljs-meta .hljs-keyword {
          color: #79c0ff;
        }
        .hljs-meta .hljs-string {
          color: #a5d6ff;
        }
        .hljs-attr {
          color: #79c0ff;
        }
        .hljs-attribute {
          color: #7ee787;
        }
        .hljs-name {
          color: #7ee787;
        }
        .hljs-section {
          color: #d2a8ff;
          font-weight: bold;
        }
        .hljs-selector-class,
        .hljs-selector-id {
          color: #7ee787;
        }
        .hljs-addition {
          color: #aff5b4;
          background-color: #033a16;
        }
        .hljs-deletion {
          color: #ffdcd7;
          background-color: #67060c;
        }
      `}</style>
    </div>
  );
}

// Markdown Viewer Component
function MarkdownViewer({ url, fileName }: { url: string; fileName: string }) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [renderedHtml, setRenderedHtml] = useState<string>("");

  useEffect(() => {
    const fetchContent = async () => {
      try {
        setLoading(true);
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch file");
        const text = await res.text();
        setContent(text);

        // Configure marked for code highlighting
        marked.setOptions({
          gfm: true,
          breaks: true,
        });

        // Custom renderer for code blocks with syntax highlighting
        const renderer = new marked.Renderer();
        renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
          if (lang && hljs.getLanguage(lang)) {
            try {
              const highlighted = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
              return `<pre class="hljs-code-block"><code class="hljs language-${lang}">${highlighted}</code></pre>`;
            } catch {
              // fallback
            }
          }
          // Auto-detect or plain
          const highlighted = hljs.highlightAuto(text).value;
          return `<pre class="hljs-code-block"><code class="hljs">${highlighted}</code></pre>`;
        };

        const html = await marked(text, { renderer });
        setRenderedHtml(html);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load file");
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, [url]);

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-64">
        <span className="text-zinc-400 font-mono">加载中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center w-full h-64">
        <span className="text-red-400 font-mono">{error}</span>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl max-h-[calc(100vh-150px)] bg-zinc-900 border border-zinc-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-800 border-b border-zinc-700">
        <span className="text-zinc-400 text-xs font-mono">Markdown</span>
        <span className="text-zinc-500 text-xs font-mono">{fileName}</span>
      </div>

      {/* Rendered Markdown Content */}
      <div className="overflow-auto max-h-[calc(100vh-200px)] p-6">
        <div
          className="markdown-body"
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      </div>

      {/* Markdown styles */}
      <style>{`
        .markdown-body {
          color: #c9d1d9;
          font-size: 14px;
          line-height: 1.7;
        }
        .markdown-body h1,
        .markdown-body h2,
        .markdown-body h3,
        .markdown-body h4,
        .markdown-body h5,
        .markdown-body h6 {
          color: #fff;
          font-weight: 600;
          margin-top: 24px;
          margin-bottom: 16px;
          line-height: 1.25;
        }
        .markdown-body h1 {
          font-size: 2em;
          padding-bottom: 0.3em;
          border-bottom: 1px solid #3f3f46;
        }
        .markdown-body h2 {
          font-size: 1.5em;
          padding-bottom: 0.3em;
          border-bottom: 1px solid #3f3f46;
        }
        .markdown-body h3 { font-size: 1.25em; }
        .markdown-body h4 { font-size: 1em; }
        .markdown-body h5 { font-size: 0.875em; }
        .markdown-body h6 { font-size: 0.85em; color: #8b949e; }
        .markdown-body p {
          margin-top: 0;
          margin-bottom: 16px;
        }
        .markdown-body a {
          color: #58a6ff;
          text-decoration: none;
        }
        .markdown-body a:hover {
          text-decoration: underline;
        }
        .markdown-body strong {
          color: #fff;
          font-weight: 600;
        }
        .markdown-body em {
          font-style: italic;
        }
        .markdown-body code {
          background-color: rgba(110, 118, 129, 0.4);
          padding: 0.2em 0.4em;
          border-radius: 6px;
          font-size: 85%;
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
        }
        .markdown-body pre {
          margin-top: 0;
          margin-bottom: 16px;
        }
        .markdown-body .hljs-code-block {
          background-color: #161b22;
          border-radius: 6px;
          padding: 16px;
          overflow-x: auto;
        }
        .markdown-body .hljs-code-block code {
          background: transparent;
          padding: 0;
          font-size: 13px;
          line-height: 1.5;
        }
        .markdown-body ul,
        .markdown-body ol {
          margin-top: 0;
          margin-bottom: 16px;
          padding-left: 2em;
        }
        .markdown-body li {
          margin-top: 0.25em;
        }
        .markdown-body li + li {
          margin-top: 0.25em;
        }
        .markdown-body blockquote {
          margin: 0 0 16px 0;
          padding: 0 1em;
          color: #8b949e;
          border-left: 0.25em solid #3f3f46;
        }
        .markdown-body hr {
          height: 0.25em;
          padding: 0;
          margin: 24px 0;
          background-color: #3f3f46;
          border: 0;
        }
        .markdown-body table {
          border-collapse: collapse;
          margin-bottom: 16px;
          width: 100%;
        }
        .markdown-body table th,
        .markdown-body table td {
          padding: 6px 13px;
          border: 1px solid #3f3f46;
        }
        .markdown-body table th {
          font-weight: 600;
          background-color: #21262d;
        }
        .markdown-body table tr:nth-child(2n) {
          background-color: #161b22;
        }
        .markdown-body img {
          max-width: 100%;
          border-radius: 6px;
        }
        /* Syntax highlighting */
        .hljs {
          color: #c9d1d9;
          background: transparent;
        }
        .hljs-comment,
        .hljs-quote {
          color: #8b949e;
          font-style: italic;
        }
        .hljs-keyword,
        .hljs-selector-tag,
        .hljs-type {
          color: #ff7b72;
        }
        .hljs-literal,
        .hljs-number,
        .hljs-tag .hljs-attr,
        .hljs-template-variable,
        .hljs-variable {
          color: #79c0ff;
        }
        .hljs-string,
        .hljs-doctag,
        .hljs-regexp {
          color: #a5d6ff;
        }
        .hljs-title,
        .hljs-title.class_,
        .hljs-title.function_ {
          color: #d2a8ff;
        }
        .hljs-params {
          color: #c9d1d9;
        }
        .hljs-built_in {
          color: #ffa657;
        }
        .hljs-symbol,
        .hljs-bullet,
        .hljs-link {
          color: #7ee787;
        }
        .hljs-meta,
        .hljs-meta .hljs-keyword {
          color: #79c0ff;
        }
        .hljs-attr {
          color: #79c0ff;
        }
        .hljs-attribute {
          color: #7ee787;
        }
        .hljs-name {
          color: #7ee787;
        }
      `}</style>
    </div>
  );
}

// PDF Viewer Component
function PDFViewer({ url }: { url: string }) {
  return (
    <div className="w-full h-full max-w-5xl max-h-[calc(100vh-100px)]">
      <iframe
        src={url}
        className="w-full h-full bg-white rounded-lg"
        title="PDF Viewer"
      />
    </div>
  );
}
