"use client";
import { useEffect, useRef, useState } from "react";
import {
  MdPlayArrow, MdPause, MdMic, MdDownload, MdInsertDriveFile, MdPictureAsPdf, MdImage,
  MdErrorOutline, MdRefresh, MdClose, MdChevronLeft, MdChevronRight, MdOpenInNew, MdVideocam,
} from "react-icons/md";
import { downloadMedia, formatBytes, useMedia } from "./mediaLoader";
import { formatClock, shownText, toDate } from "./utils";

function Spinner({ className = "" }) {
  return (
    <span className={`inline-block w-6 h-6 rounded-full border-[3px] border-white/25 border-t-[var(--wa-accent)] animate-spin ${className}`} />
  );
}

function Failed({ error, onRetry, compact }) {
  return (
    <div className={`flex items-center gap-2 text-[12.5px] text-white/70 ${compact ? "" : "px-3 py-3"}`}>
      <MdErrorOutline className="text-lg text-rose-300 shrink-0" />
      <span className="flex-1">{error}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="text-[var(--wa-accent)] text-lg shrink-0" aria-label="Retry">
          <MdRefresh />
        </button>
      )}
    </div>
  );
}

// Shows the photo's small preview (the full photo opens in the viewer). When
// its shape is known (stored with the message, or sent with the link), the
// space is reserved before it loads, so the chat doesn't jump.
function ImageMedia({ m, onOpen }) {
  const media = useMedia(m, { auto: true });
  const [broken, setBroken] = useState(false);
  const size = m.archive?.thumb || (media.width && media.height ? media : null);
  const shape = size ? { aspectRatio: `${size.width} / ${size.height}` } : undefined;
  return (
    <div ref={media.ref} className="-mx-1 -mt-0.5 mb-1 rounded-md overflow-hidden bg-black/25 min-w-[240px]">
      {media.status === "ready" && broken ? (
        <Failed error={`Couldn't display this photo (${media.type || "unknown type"}).`} />
      ) : media.status === "ready" ? (
        <button type="button" onClick={onOpen} className="block w-full cursor-zoom-in">
          <img
            src={media.thumbUrl || media.url}
            alt={m.text || "Photo"}
            decoding="async"
            onError={() => setBroken(true)}
            style={shape}
            className="wa-anim-fade block w-full max-h-[330px] object-cover"
          />
        </button>
      ) : media.status === "error" ? (
        <Failed error={media.error} onRetry={media.load} />
      ) : (
        <div style={shape} className={`${shape ? "max-h-[330px]" : "h-[200px]"} w-full flex items-center justify-center wa-skeleton`}>
          <MdImage className="text-4xl text-white/30" />
        </div>
      )}
    </div>
  );
}

function StickerMedia({ m }) {
  const media = useMedia(m, { auto: true });
  return (
    <div ref={media.ref} className="w-[150px] h-[150px] flex items-center justify-center">
      {media.status === "ready" ? (
        <img src={media.url} alt="Sticker" className="wa-anim-pop max-w-full max-h-full" />
      ) : media.status === "error" ? (
        <Failed error={media.error} onRetry={media.load} compact />
      ) : (
        <Spinner />
      )}
    </div>
  );
}

const fmt = (s) => {
  if (!Number.isFinite(s)) return "0:00";
  const mins = Math.floor(s / 60);
  return `${mins}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

const SPEEDS = [1, 1.5, 2];

function VoicePlayer({ m, out }) {
  const media = useMedia(m);
  const audio = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);

  const toggle = async () => {
    if (media.status !== "ready") {
      try {
        await media.load();
      } catch {
        return;
      }
      // The <audio> element mounts on the next render; play once it exists
      requestAnimationFrame(() => audio.current?.play().catch(() => {}));
      return;
    }
    if (audio.current.paused) audio.current.play().catch(() => {});
    else audio.current.pause();
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audio.current) audio.current.playbackRate = next;
  };

  const pct = duration ? (time / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-3 w-[280px] max-w-full py-1 pr-1">
      <div className="relative shrink-0">
        <div className={`w-11 h-11 rounded-full flex items-center justify-center text-2xl ${out ? "bg-[#0b8f72] text-white" : "bg-[#53bdeb] text-[#111b21]"}`}>
          <MdMic />
        </div>
      </div>
      <button
        type="button"
        onClick={toggle}
        className="w-8 h-8 shrink-0 flex items-center justify-center text-[32px] text-white/80 hover:text-white"
        aria-label={playing ? "Pause" : "Play"}
      >
        {media.status === "loading" ? <Spinner className="!w-5 !h-5" /> : playing ? <MdPause /> : <MdPlayArrow />}
      </button>
      <div className="flex-1 min-w-0">
        {media.status === "error" ? (
          <Failed error={media.error} onRetry={media.load} compact />
        ) : (
          <>
            <div className="relative h-4 flex items-center">
              <div className="absolute inset-x-0 h-[3px] rounded-full bg-white/25" />
              <div className="absolute left-0 h-[3px] rounded-full bg-[#53bdeb] transition-[width] duration-150" style={{ width: `${pct}%` }} />
              <div
                className="absolute w-3 h-3 rounded-full bg-[#53bdeb] -translate-x-1/2 transition-[left] duration-150"
                style={{ left: `${pct}%` }}
              />
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={time}
                disabled={media.status !== "ready"}
                onChange={(e) => {
                  if (audio.current) audio.current.currentTime = Number(e.target.value);
                  setTime(Number(e.target.value));
                }}
                className="absolute inset-0 w-full opacity-0 cursor-pointer disabled:cursor-default"
                aria-label="Seek"
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-white/60 mt-0.5">
              <span>{media.status === "ready" ? fmt(playing || time ? time : duration) : "Voice message"}</span>
              {media.status === "ready" && (
                <button type="button" onClick={cycleSpeed} className="px-1.5 rounded-full bg-white/15 text-white/80 text-[10.5px] font-semibold">
                  {speed}×
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {media.status === "ready" && (
        <audio
          ref={audio}
          src={media.url}
          preload="metadata"
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration);
            e.currentTarget.playbackRate = speed;
          }}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setTime(0);
          }}
          className="hidden"
        />
      )}
    </div>
  );
}

function VideoMedia({ m }) {
  const media = useMedia(m);
  return (
    <div className="-mx-1 -mt-0.5 mb-1 rounded-md overflow-hidden bg-black/40 w-[300px] max-w-full">
      {media.status === "ready" ? (
        <video src={media.url} controls autoPlay className="wa-anim-fade block w-full max-h-[360px] bg-black" />
      ) : media.status === "error" ? (
        <Failed error={media.error} onRetry={media.load} />
      ) : (
        <button
          type="button"
          onClick={() => media.load().catch(() => {})}
          className="group w-full h-[180px] flex flex-col items-center justify-center gap-2 text-white/80"
        >
          <span className="w-14 h-14 rounded-full bg-black/50 flex items-center justify-center text-4xl group-hover:scale-110 transition-transform">
            {media.status === "loading" ? <Spinner /> : <MdPlayArrow />}
          </span>
          <span className="text-[12px] flex items-center gap-1"><MdVideocam /> Tap to load video</span>
        </button>
      )}
    </div>
  );
}

function DocumentMedia({ m }) {
  const media = useMedia(m);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const name = m.media?.filename || "Document";
  const ext = (name.includes(".") ? name.split(".").pop() : (m.media?.mimeType || "").split("/").pop() || "file").toUpperCase();
  const isPdf = ext === "PDF" || m.media?.mimeType === "application/pdf";
  const Icon = isPdf ? MdPictureAsPdf : MdInsertDriveFile;

  const download = async () => {
    setSaving(true);
    setSaveError("");
    try {
      await downloadMedia(m, name);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Open the tab synchronously so the popup isn't blocked, then point it at the file
  const open = async () => {
    const tab = window.open("", "_blank");
    try {
      const file = await media.load();
      if (tab) tab.location.href = file.url;
    } catch {
      tab?.close();
    }
  };

  return (
    <div className="-mx-1 -mt-0.5 mb-1 rounded-md bg-black/20 min-w-[250px]">
      <div className="flex items-center gap-3 px-3 py-3">
        <div className={`w-10 h-12 rounded-md flex items-center justify-center text-2xl shrink-0 ${isPdf ? "bg-rose-500/80 text-white" : "bg-white/15 text-white/80"}`}>
          <Icon />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] truncate">{name}</p>
          <p className="text-[11.5px] text-white/55">
            {ext}
            {media.size ? ` · ${formatBytes(media.size)}` : ""}
          </p>
        </div>
        {media.status === "loading" || saving ? (
          <Spinner />
        ) : (
          <div className="flex items-center gap-1 shrink-0">
            {isPdf && (
              <button type="button" onClick={open} title="Open" className="w-9 h-9 rounded-full border border-white/20 flex items-center justify-center text-lg hover:bg-white/10">
                <MdOpenInNew />
              </button>
            )}
            <button type="button" onClick={download} title="Download" className="w-9 h-9 rounded-full border border-white/20 flex items-center justify-center text-xl hover:bg-white/10">
              <MdDownload />
            </button>
          </div>
        )}
      </div>
      {(media.status === "error" || saveError) && (
        <div className="border-t border-white/10">
          <Failed error={saveError || media.error} onRetry={saveError ? download : media.load} />
        </div>
      )}
    </div>
  );
}

// Picks the right viewer for a message that carries a media id.
export function MessageMedia({ m, out, onOpenImage }) {
  if (m.type === "image") return <ImageMedia m={m} onOpen={onOpenImage} />;
  if (m.type === "sticker") return <StickerMedia m={m} />;
  if (m.type === "audio" || m.type === "voice") return <VoicePlayer m={m} out={out} />;
  if (m.type === "video") return <VideoMedia m={m} />;
  return <DocumentMedia m={m} />;
}

function LightboxImage({ m }) {
  const media = useMedia(m, { auto: true });
  return (
    <div ref={media.ref} className="flex items-center justify-center w-full h-full">
      {media.status === "ready" ? (
        <img
          key={m.id}
          src={media.url}
          alt={m.text || "Photo"}
          className="wa-anim-pop max-w-full max-h-full object-contain rounded shadow-2xl select-none"
        />
      ) : media.status === "error" ? (
        <Failed error={media.error} onRetry={media.load} />
      ) : (
        <Spinner className="!w-10 !h-10" />
      )}
    </div>
  );
}

// Full-screen photo viewer with arrows, keyboard navigation and download.
export function Lightbox({ items, index, onIndex, onClose, title }) {
  const m = items[index];

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      else if (e.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
      else return;
      // Keep the page's own Escape handling from also closing the chat
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [index, items.length, onClose, onIndex]);

  if (!m) return null;
  const at = toDate(m.timestamp);

  const download = () =>
    downloadMedia(m, (type) => `whatsapp-photo-${m.id.slice(-8)}.${((type || "").split("/")[1] || "jpg").replace("jpeg", "jpg")}`).catch(
      // The viewer still shows the photo; nothing else to report
      (err) => console.error("WhatsApp photo download", err)
    );

  return (
    <div className="wa-anim-fade fixed inset-0 z-[80] bg-[#0b141a]/95 flex flex-col" onClick={onClose}>
      <div className="h-[60px] px-4 flex items-center gap-3 shrink-0 bg-[#111b21]/80" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] text-[var(--wa-text)] truncate">{m.direction === "out" ? title.employee : title.customer}</p>
          <p className="text-[12.5px] text-[var(--wa-muted)]">
            {at ? `${at.toLocaleDateString()} at ${formatClock(at)}` : ""} · {index + 1} of {items.length}
          </p>
        </div>
        <button type="button" onClick={download} className="w-10 h-10 rounded-full text-2xl text-[var(--wa-muted)] hover:text-white hover:bg-white/10 flex items-center justify-center" aria-label="Download">
          <MdDownload />
        </button>
        <button type="button" onClick={onClose} className="w-10 h-10 rounded-full text-2xl text-[var(--wa-muted)] hover:text-white hover:bg-white/10 flex items-center justify-center" aria-label="Close">
          <MdClose />
        </button>
      </div>

      <div className="relative flex-1 min-h-0 flex items-center justify-center px-16 py-6">
        <div className="w-full h-full" onClick={(e) => e.stopPropagation()}>
          <LightboxImage key={m.id} m={m} />
        </div>
        {index > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onIndex(index - 1); }}
            className="absolute left-3 w-11 h-11 rounded-full bg-black/40 hover:bg-black/60 text-white text-3xl flex items-center justify-center transition-colors"
            aria-label="Previous photo"
          >
            <MdChevronLeft />
          </button>
        )}
        {index < items.length - 1 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onIndex(index + 1); }}
            className="absolute right-3 w-11 h-11 rounded-full bg-black/40 hover:bg-black/60 text-white text-3xl flex items-center justify-center transition-colors"
            aria-label="Next photo"
          >
            <MdChevronRight />
          </button>
        )}
      </div>

      {shownText(m) && (
        <p className="shrink-0 pb-6 px-6 text-center text-[14.5px] text-[var(--wa-text)]" onClick={(e) => e.stopPropagation()}>
          {shownText(m)}
        </p>
      )}
    </div>
  );
}
