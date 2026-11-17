"use client";
import { memo } from "react";
import toast from "react-hot-toast";
import {
  MdSearch, MdArrowBack, MdPushPin, MdKeyboardArrowDown, MdDoneAll, MdSort, MdCheck,
  MdContentCopy, MdOpenInNew, MdPersonOutline, MdImage, MdVideocam, MdMic, MdInsertDriveFile,
  MdLocationOn, MdStickyNote2, MdContactPhone, MdGroups, MdEdit, MdVisibilityOff,
} from "react-icons/md";
import { Avatar, Dropdown, Highlight, MenuItem, MenuLabel } from "./ui";
import { displayName, isAwaiting, formatListTime, formatPhone, timeAgo, toDate, typeLabel, waLink } from "./utils";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "unanswered", label: "Unanswered" },
  { id: "today", label: "Today" },
  { id: "pinned", label: "Pinned" },
];

const SORTS = [
  { id: "recent", label: "Most recent" },
  { id: "waiting", label: "Longest waiting first" },
  { id: "unread", label: "Most unanswered messages" },
  { id: "name", label: "Name (A–Z)" },
  { id: "oldest", label: "Oldest activity" },
];

const PREVIEW_ICON = {
  image: MdImage,
  video: MdVideocam,
  audio: MdMic,
  voice: MdMic,
  document: MdInsertDriveFile,
  location: MdLocationOn,
  sticker: MdStickyNote2,
  contacts: MdContactPhone,
  view_once: MdVisibilityOff,
};

// "[image]" previews written by the webhook become an icon + label.
function Preview({ text, query }) {
  const m = /^\[(\w+)\]$/.exec(text || "");
  if (m) {
    const Icon = PREVIEW_ICON[m[1]];
    const label = typeLabel(m[1]);
    return (
      <span className="inline-flex items-center gap-1">
        {Icon && <Icon className="text-[17px] shrink-0" />}
        {label}
      </span>
    );
  }
  return <Highlight text={text} query={query} />;
}

const ChatRow = memo(function ChatRow({ c, selected, pinned, flash, query, handler, showHandler, onSelect, onTogglePin }) {
  const at = toDate(c.lastAt);
  const unread = isAwaiting(c) ? Number(c.unread) : 0;
  const name = displayName(c);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatPhone(c.customer));
      toast.success("Number copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(c.id)}
      onKeyDown={(e) => e.key === "Enter" && onSelect(c.id)}
      className={`wa-row group relative flex items-center gap-3 pl-3 pr-4 cursor-pointer transition-colors duration-100 outline-none ${
        selected ? "bg-[var(--wa-active)]" : "hover:bg-[var(--wa-hover)] focus-visible:bg-[var(--wa-hover)]"
      } ${flash ? "wa-anim-flash" : ""}`}
    >
      <Avatar name={name} seed={c.customer} />
      <div className="min-w-0 flex-1 py-3 border-b border-[var(--wa-border)] group-last:border-transparent">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[17px] text-[var(--wa-text)] truncate">
            <Highlight text={name} query={query} />
          </p>
          <span className={`text-[12px] shrink-0 ${unread ? "text-[var(--wa-badge)]" : "text-[var(--wa-muted)]"}`}>
            {formatListTime(at)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className="text-[14px] text-[var(--wa-muted)] truncate flex items-center gap-1 min-w-0">
            {c.lastDirection === "out" && <MdDoneAll className="text-[18px] text-[#53bdeb] shrink-0" />}
            <span className="truncate">
              <Preview text={c.lastMessage} query={query} />
            </span>
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            {pinned && <MdPushPin className="text-[17px] text-[var(--wa-muted)] rotate-45" />}
            {unread > 0 && (
              <span
                key={unread}
                className="wa-anim-badge min-w-[20px] h-5 px-1.5 rounded-full bg-[var(--wa-badge)] text-[#111b21] text-[12px] font-bold flex items-center justify-center"
              >
                {unread}
              </span>
            )}
            <div onClick={(e) => e.stopPropagation()} className="w-0 overflow-visible group-hover:w-5 transition-[width] duration-150">
              <Dropdown
                width={210}
                trigger={({ toggle }) => (
                  <button
                    type="button"
                    onClick={toggle}
                    aria-label="Chat options"
                    className="text-[var(--wa-muted)] text-2xl opacity-0 group-hover:opacity-100 transition-opacity -mr-1"
                  >
                    <MdKeyboardArrowDown />
                  </button>
                )}
              >
                {(close) => (
                  <>
                    <MenuItem icon={MdPushPin} onClick={() => { onTogglePin(c.id); close(); }}>
                      {pinned ? "Unpin chat" : "Pin chat"}
                    </MenuItem>
                    <MenuItem icon={MdContentCopy} onClick={() => { copy(); close(); }}>Copy number</MenuItem>
                    <MenuItem icon={MdOpenInNew} onClick={() => { window.open(waLink(c.customer), "_blank", "noopener"); close(); }}>
                      Open in WhatsApp
                    </MenuItem>
                  </>
                )}
              </Dropdown>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1 empty:hidden">
          {showHandler && <span className="text-[11.5px] text-[var(--wa-muted)]/90 bg-[var(--wa-chip)] rounded px-1.5 py-px truncate max-w-[60%] inline-flex items-center gap-1">
            <MdPersonOutline className="shrink-0" />
            {handler}
          </span>}
          {unread > 0 && (
            <span className="text-[11.5px] text-amber-300/90 truncate">waiting {timeAgo(at)}</span>
          )}
        </div>
      </div>
    </div>
  );
});

function EmployeeChip({ name, seed, sub, badge, active, onClick, icon }) {
  const Icon = icon;
  return (
    <button
      type="button"
      onClick={onClick}
      title={name}
      className={`relative shrink-0 w-[76px] pt-2 pb-1.5 rounded-xl flex flex-col items-center gap-1 transition-colors duration-150 ${
        active ? "bg-[#0a332c]" : "hover:bg-[var(--wa-hover)]"
      }`}
    >
      <div className={`rounded-full p-[2px] transition-colors ${active ? "bg-[var(--wa-accent)]" : "bg-transparent"}`}>
        {Icon ? (
          <div className="w-11 h-11 rounded-full bg-[var(--wa-active)] text-[var(--wa-text)] text-2xl flex items-center justify-center">
            <Icon />
          </div>
        ) : (
          <Avatar name={name} seed={seed} size={44} />
        )}
      </div>
      <span className={`w-full px-1 text-[12.5px] leading-tight truncate text-center ${active ? "text-[#d9fdd3] font-semibold" : "text-[var(--wa-text)]"}`}>
        {name}
      </span>
      <span className="text-[10.5px] leading-none text-[var(--wa-muted)]">{sub}</span>
      {badge > 0 && (
        <span className="wa-anim-badge absolute top-1 right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--wa-badge)] text-[#111b21] text-[11px] font-bold flex items-center justify-center">
          {badge}
        </span>
      )}
    </button>
  );
}

function Skeleton() {
  return (
    <div className="px-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-3">
          <div className="wa-skeleton w-[49px] h-[49px] rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="wa-skeleton h-3.5 rounded w-2/5" />
            <div className="wa-skeleton h-3 rounded w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ChatList({
  title = "Chats",
  conversations,
  loading,
  error,
  selectedId,
  onSelect,
  search,
  onSearch,
  filter,
  onFilter,
  counts,
  employees,
  employeeFilter,
  onEmployeeFilter,
  sort,
  onSort,
  pins,
  onTogglePin,
  flashIds,
  handlerOf,
  headerActions,
  onRename,
  canLoadMore,
  loadingMore,
  onLoadMore,
}) {
  const query = search.trim();
  const activeEmployee = employees.find((e) => e.id === employeeFilter);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--wa-panel)]">
      {/* Header: the selected employee comes first */}
      <div className="h-[59px] px-4 flex items-center justify-between gap-2 shrink-0">
        {activeEmployee ? (
          <div key={activeEmployee.id} className="wa-anim-fade flex items-center gap-3 min-w-0">
            <Avatar name={activeEmployee.name} seed={activeEmployee.id} size={36} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <h1 className="text-[18px] font-bold text-[var(--wa-text)] truncate leading-tight">{activeEmployee.name}</h1>
                {activeEmployee.canRename && (
                  <button
                    type="button"
                    onClick={() => onRename(activeEmployee)}
                    title="Rename"
                    aria-label={`Rename ${activeEmployee.name}`}
                    className="shrink-0 text-[16px] text-[var(--wa-muted)] hover:text-[var(--wa-text)] transition-colors"
                  >
                    <MdEdit />
                  </button>
                )}
              </div>
              <p className="text-[12.5px] text-[var(--wa-muted)] truncate">
                {formatPhone(activeEmployee.display)} · {activeEmployee.chats} chats
              </p>
            </div>
          </div>
        ) : (
          <h1 className="text-[22px] font-bold text-[var(--wa-text)]">{title}</h1>
        )}
        <div className="flex items-center gap-1 shrink-0">
          {headerActions}
          <Dropdown
            width={250}
            trigger={({ open, toggle }) => (
              <button
                type="button"
                onClick={toggle}
                title="Sort chats"
                aria-label="Sort chats"
                className={`w-10 h-10 rounded-full flex items-center justify-center text-[22px] transition-colors ${
                  open || sort !== "recent" ? "bg-[var(--wa-active)] text-[var(--wa-text)]" : "text-[var(--wa-muted)] hover:bg-white/5"
                }`}
              >
                <MdSort />
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuLabel>Sort by</MenuLabel>
                {SORTS.map((s) => (
                  <MenuItem key={s.id} icon={sort === s.id ? MdCheck : undefined} onClick={() => { onSort(s.id); close(); }}>
                    <span className={sort === s.id ? "pl-0" : "pl-[30px]"}>{s.label}</span>
                  </MenuItem>
                ))}
              </>
            )}
          </Dropdown>
        </div>
      </div>

      {/* Employee switcher */}
      <div className="flex gap-1 px-2 pb-2 overflow-x-auto wa-scroll shrink-0">
        <EmployeeChip
          name="All"
          seed="all"
          icon={MdGroups}
          sub={`${employees.reduce((n, e) => n + e.chats, 0)} chats`}
          active={!activeEmployee}
          onClick={() => onEmployeeFilter("all")}
        />
        {employees.map((e) => (
          <EmployeeChip
            key={e.id}
            name={e.name}
            seed={e.id}
            sub={`${e.chats} chats`}
            badge={e.awaiting}
            active={employeeFilter === e.id}
            onClick={() => onEmployeeFilter(e.id)}
          />
        ))}
      </div>

      {/* Search */}
      <div className="px-3 pb-2 shrink-0">
        <div className="h-[35px] rounded-lg bg-[var(--wa-input)] flex items-center gap-3 px-3 focus-within:ring-1 focus-within:ring-[var(--wa-accent)]/60 transition-shadow">
          {query ? (
            <button type="button" onClick={() => onSearch("")} className="text-[var(--wa-accent)] text-xl" aria-label="Clear search">
              <MdArrowBack className="wa-anim-pop" />
            </button>
          ) : (
            <MdSearch className="text-[var(--wa-muted)] text-xl shrink-0" />
          )}
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={activeEmployee ? `Search ${activeEmployee.name}'s chats` : "Search name, number or message"}
            className="bg-transparent outline-none text-[15px] text-[var(--wa-text)] w-full placeholder:text-[var(--wa-muted)]"
          />
        </div>
      </div>

      {/* Filter pills */}
      <div className="px-3 pb-2 flex items-center gap-2 overflow-x-auto wa-scroll shrink-0">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onFilter(f.id)}
            className={`shrink-0 h-8 px-3 rounded-full text-[14px] transition-colors duration-150 flex items-center gap-1.5 ${
              filter === f.id
                ? "bg-[#0a332c] text-[#d9fdd3]"
                : "bg-[var(--wa-input)] text-[var(--wa-muted)] hover:bg-[var(--wa-active)]"
            }`}
          >
            {f.label}
            {counts[f.id] > 0 && f.id !== "all" && (
              <span className={`text-[12px] ${filter === f.id ? "text-[#d9fdd3]/80" : "text-[var(--wa-muted)]/80"}`}>{counts[f.id]}</span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto wa-scroll">
        {loading && <Skeleton />}
        {error && <p className="m-4 p-3 rounded-lg text-[14px] text-rose-300 bg-rose-500/10">{error}</p>}
        {!loading && !error && conversations.length === 0 && (
          <div className="wa-anim-fade text-center px-8 py-12 text-[var(--wa-muted)] text-[14px]">
            {query ? `No chats, contacts or messages found for "${query}"` : "No chats here yet."}
          </div>
        )}
        {conversations.map((c) => (
          <ChatRow
            key={c.id}
            c={c}
            selected={selectedId === c.id}
            pinned={Boolean(pins[c.id])}
            flash={flashIds.has(c.id)}
            query={query}
            handler={handlerOf(c)}
            showHandler={!activeEmployee}
            onSelect={onSelect}
            onTogglePin={onTogglePin}
          />
        ))}
        {!loading && canLoadMore && (
          <div className="flex justify-center pt-4">
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="h-8 px-4 rounded-full text-[13.5px] bg-[var(--wa-input)] text-[var(--wa-text)] hover:bg-[var(--wa-active)] disabled:opacity-60 transition-colors"
            >
              {loadingMore ? "Loading…" : "Load older chats"}
            </button>
          </div>
        )}
        {!loading && conversations.length > 0 && (
          <p className="text-center text-[12px] text-[var(--wa-muted)]/70 py-5">
            {conversations.length} chat{conversations.length === 1 ? "" : "s"} · read-only monitor
          </p>
        )}
      </div>
    </div>
  );
}
