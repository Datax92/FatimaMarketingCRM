"use client";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { collection, getCountFromServer, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import {
  MdClose, MdContentCopy, MdOpenInNew, MdPersonOutline, MdSchedule, MdForum, MdCallReceived,
  MdCallMade, MdTimer, MdEvent, MdPhotoLibrary, MdMarkChatUnread,
} from "react-icons/md";
import { db } from "@/lib/firebase/client";
import { Avatar } from "./ui";
import { displayName, isAwaiting, formatDuration, formatPhone, sortKeyRange, timeAgo, toDate, waLink } from "./utils";

const MEDIA_TYPES = new Set(["image", "video", "audio", "voice", "document", "sticker"]);

function Stat({ icon, label, value }) {
  const Icon = icon;
  return (
    <div className="flex items-center gap-4 px-6 py-3">
      <Icon className="text-xl text-[var(--wa-muted)] shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] text-[var(--wa-text)] truncate">{value}</p>
        <p className="text-[13px] text-[var(--wa-muted)]">{label}</p>
      </div>
    </div>
  );
}

export default function ContactInfo({ conversation, messages, hasOlder, handler, employeeNumber, onClose }) {
  const name = displayName(conversation);

  // Only the latest messages are loaded in a long chat; its full size and
  // first message come from a count and a one-document query
  const [whole, setWhole] = useState(null);
  useEffect(() => {
    if (!hasOlder) {
      setWhole(null);
      return;
    }
    let cancelled = false;
    const all = collection(db, "wa_messages");
    const [from, to] = sortKeyRange(conversation.id);
    Promise.all([
      getCountFromServer(query(all, where("conversationId", "==", conversation.id))),
      getDocs(query(all, where("sortKey", ">=", from), where("sortKey", "<=", to), orderBy("sortKey"), limit(1))),
    ]).then(
      ([count, oldest]) => !cancelled && setWhole({ total: count.data().count, first: toDate(oldest.docs[0]?.get("timestamp")) }),
      (err) => console.error("wa contact stats", err)
    );
    return () => {
      cancelled = true;
    };
  }, [conversation.id, hasOlder]);

  const stats = useMemo(() => {
    let incoming = 0;
    let outgoing = 0;
    let media = 0;
    let waitingSince = null;
    const replyTimes = [];
    for (const m of messages) {
      if (m.type === "reaction") continue;
      if (MEDIA_TYPES.has(m.type)) media += 1;
      const at = toDate(m.timestamp);
      if (m.direction === "in") {
        incoming += 1;
        waitingSince ||= at;
      } else {
        outgoing += 1;
        if (waitingSince && at) replyTimes.push(at - waitingSince);
        waitingSince = null;
      }
    }
    const avg = replyTimes.length ? replyTimes.reduce((a, b) => a + b, 0) / replyTimes.length : null;
    return {
      incoming,
      outgoing,
      media,
      avg,
      first: toDate(messages[0]?.timestamp),
      replies: replyTimes.length,
    };
  }, [messages]);

  const last = toDate(conversation.lastAt);
  const unanswered = isAwaiting(conversation);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatPhone(conversation.customer));
      toast.success("Number copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <div className="wa-anim-drawer flex flex-col h-full min-h-0 bg-[var(--wa-panel)] border-l border-[var(--wa-border)]">
      <div className="h-[59px] px-4 bg-[var(--wa-header)] flex items-center gap-6 shrink-0">
        <button type="button" onClick={onClose} className="text-[var(--wa-muted)] text-2xl hover:text-[var(--wa-text)]" aria-label="Close">
          <MdClose />
        </button>
        <p className="text-[16px] text-[var(--wa-text)]">Contact info</p>
      </div>

      <div className="flex-1 overflow-y-auto wa-scroll">
        <div className="flex flex-col items-center px-6 pt-7 pb-5 bg-[var(--wa-panel)]">
          <div className="wa-anim-pop">
            <Avatar name={name} seed={conversation.customer} size={160} />
          </div>
          <p className="mt-4 text-[22px] text-[var(--wa-text)] text-center break-words">{name}</p>
          <p className="text-[16px] text-[var(--wa-muted)]">{formatPhone(conversation.customer)}</p>
          <div className="flex gap-3 mt-5">
            <button
              type="button"
              onClick={copy}
              className="w-[92px] py-3 rounded-lg border border-[var(--wa-border)] hover:bg-[var(--wa-hover)] transition-colors flex flex-col items-center gap-1 text-[var(--wa-accent)]"
            >
              <MdContentCopy className="text-xl" />
              <span className="text-[13px] text-[var(--wa-text)]">Copy</span>
            </button>
            <a
              href={waLink(conversation.customer)}
              target="_blank"
              rel="noopener noreferrer"
              className="w-[92px] py-3 rounded-lg border border-[var(--wa-border)] hover:bg-[var(--wa-hover)] transition-colors flex flex-col items-center gap-1 text-[var(--wa-accent)]"
            >
              <MdOpenInNew className="text-xl" />
              <span className="text-[13px] text-[var(--wa-text)]">WhatsApp</span>
            </a>
          </div>
        </div>

        <div className="h-2.5 bg-[#0c1317]" />

        <p className="px-6 pt-4 pb-1 text-[14px] text-[var(--wa-muted)]">Handled by</p>
        <div className="flex items-center gap-4 px-6 py-3">
          <Avatar name={handler} seed={conversation.phoneNumberId} size={40} />
          <div className="min-w-0">
            <p className="text-[16px] text-[var(--wa-text)] truncate">{handler}</p>
            <p className="text-[13px] text-[var(--wa-muted)] truncate">{formatPhone(employeeNumber || conversation.businessNumber)}</p>
          </div>
        </div>

        <div className="h-2.5 bg-[#0c1317]" />

        <p className="px-6 pt-4 pb-1 text-[14px] text-[var(--wa-muted)]">Conversation</p>
        {unanswered && (
          <div className="mx-6 my-2 px-3 py-2 rounded-lg bg-amber-500/10 text-amber-300 text-[13.5px] flex items-center gap-2 wa-anim-fade">
            <MdMarkChatUnread className="text-lg shrink-0" />
            Customer waiting for a reply · {timeAgo(last)}
          </div>
        )}
        <Stat icon={MdForum} label="Messages stored" value={whole ? whole.total : stats.incoming + stats.outgoing} />
        {hasOlder && (
          <p className="px-6 pb-1 text-[12.5px] text-[var(--wa-muted)]">
            Counts and reply time below cover the latest {messages.length} messages loaded.
          </p>
        )}
        <Stat icon={MdCallReceived} label="From customer" value={stats.incoming} />
        <Stat icon={MdCallMade} label={`From ${handler}`} value={stats.outgoing} />
        <Stat
          icon={MdTimer}
          label={`Average reply time${stats.replies ? ` (${stats.replies} replies)` : ""}`}
          value={formatDuration(stats.avg)}
        />
        <Stat icon={MdPhotoLibrary} label="Photos, voice notes & files" value={stats.media} />
        <Stat
          icon={MdEvent}
          label="First message"
          value={(hasOlder ? whole?.first : stats.first)?.toLocaleString() || "—"}
        />
        <Stat icon={MdSchedule} label="Last activity" value={last ? last.toLocaleString() : "—"} />
        <Stat icon={MdPersonOutline} label="WhatsApp profile name" value={conversation.customerName || "Not shared"} />
        <div className="h-6" />
      </div>
    </div>
  );
}
