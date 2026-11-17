"use client";
import { MdChat, MdMarkChatUnread, MdToday, MdSimCard, MdChevronRight, MdEdit } from "react-icons/md";
import { Avatar } from "./ui";
import { formatListTime, formatPhone, timeAgo } from "./utils";

function Card({ icon, label, value, color, delay }) {
  const Icon = icon;
  return (
    <div className="wa-anim-up rounded-xl bg-[var(--wa-header)] p-3.5 flex items-center gap-3" style={{ animationDelay: `${delay}ms` }}>
      <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl text-[#111b21]" style={{ background: color }}>
        <Icon />
      </div>
      <div>
        <p className="text-[22px] font-semibold leading-none text-[var(--wa-text)]">{value}</p>
        <p className="text-[12.5px] text-[var(--wa-muted)] mt-1">{label}</p>
      </div>
    </div>
  );
}

export default function TeamPanel({ employees, totals, onPick, onRename, headerActions }) {
  const busiest = Math.max(1, ...employees.map((e) => e.chats));
  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--wa-panel)] wa-anim-panel">
      <div className="h-[59px] px-4 flex items-center justify-between shrink-0">
        <h1 className="text-[22px] font-bold text-[var(--wa-text)]">Team</h1>
        <div className="flex items-center gap-1">{headerActions}</div>
      </div>

      <div className="flex-1 overflow-y-auto wa-scroll">
        <div className="grid grid-cols-2 gap-2.5 px-3 pb-3">
          <Card icon={MdSimCard} label="Numbers connected" value={employees.length} color="#00a884" delay={0} />
          <Card icon={MdChat} label="Conversations" value={totals.chats} color="#53bdeb" delay={40} />
          <Card icon={MdMarkChatUnread} label="Unanswered" value={totals.unanswered} color="#ffbc38" delay={80} />
          <Card icon={MdToday} label="Active today" value={totals.today} color="#a78bfa" delay={120} />
        </div>

        <p className="px-4 pt-2 pb-2 text-[13px] uppercase tracking-wide text-[var(--wa-accent)]">Employees</p>
        {employees.length === 0 && (
          <p className="px-4 text-[14px] text-[var(--wa-muted)]">No numbers connected yet. Use the link icon to add one.</p>
        )}
        {employees.map((e, i) => (
          <div
            key={e.id}
            className="wa-anim-up group flex items-center hover:bg-[var(--wa-hover)] transition-colors"
            style={{ animationDelay: `${120 + i * 35}ms` }}
          >
            <button type="button" onClick={() => onPick(e.id)} className="min-w-0 flex-1 flex items-center gap-3 pl-3 text-left">
              <Avatar name={e.name} seed={e.id} />
              <div className="min-w-0 flex-1 py-3 border-b border-[var(--wa-border)]">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[16px] text-[var(--wa-text)] truncate">{e.name}</p>
                  <span className="text-[12px] text-[var(--wa-muted)] shrink-0">{formatListTime(e.lastAt)}</span>
                </div>
                <p className="text-[13px] text-[var(--wa-muted)] truncate">{formatPhone(e.display)}</p>
                <div className="mt-2 h-1.5 rounded-full bg-[var(--wa-header)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--wa-accent)] transition-[width] duration-700"
                    style={{ width: `${(e.chats / busiest) * 100}%` }}
                  />
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-[12px] text-[var(--wa-muted)]">
                  <span>{e.chats} chats</span>
                  <span>{e.today} today</span>
                  {e.awaiting > 0 ? (
                    <span className="text-amber-300">
                      {e.awaiting} unanswered{e.oldestWaiting ? ` · oldest ${timeAgo(e.oldestWaiting)}` : ""}
                    </span>
                  ) : (
                    <span className="text-[var(--wa-accent)]">all answered</span>
                  )}
                </div>
              </div>
              <MdChevronRight className="text-xl text-[var(--wa-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
            {e.canRename && (
              <button
                type="button"
                onClick={() => onRename(e)}
                title="Rename"
                aria-label={`Rename ${e.name}`}
                className="self-stretch px-3 text-[18px] text-[var(--wa-muted)] hover:text-[var(--wa-text)] transition-colors"
              >
                <MdEdit />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
