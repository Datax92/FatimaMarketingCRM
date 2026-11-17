"use client";

/**
 * The Data Bank — cold lists, one folder per source.
 *
 * Folders are the top level because the sheets are: a Capital Smart City
 * export and an F2F sign-up sheet share no columns, so they cannot share a
 * table. Each card shows what the folder holds and how much of it has already
 * been worked into the pipeline.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MobileDataBankFolders } from "@/components/mobile/MobileDataBank";
import { useProtectedRoute } from "@/hooks/useProtectedRoute";
import { useDataBankFolders, type DataBankFolder } from "@/hooks/useDataBank";
import { useSubAdmins } from "@/hooks/useEmployees";
import { deleteDataBankFolder } from "@/lib/clientActions";
import { Banner, FullPageSpinner } from "@/components/admin/AdminShared";
import { FolderFormModal } from "@/components/dataBank/FolderFormModal";
import { createPortal } from "react-dom";
import { Database, Plus, Pencil, Trash2, ChevronRight, UserCheck } from "lucide-react";

/**
 * Both managing roles land here.
 *
 * A sub admin sees only the folders assigned to them — enforced by the query
 * in `useDataBankFolders` and by the Security Rule behind it, not by anything
 * this page hides.
 *
 * **A manager builds their own lists too.** Create, rename and delete are theirs
 * as well as the admin's; a walk-in sheet or an event sign-up is a manager's
 * own cold list, and refusing it left their Data Bank holding nothing but the
 * mirrors an admin had handed them. What is still the admin's alone is *whose*
 * folder it is: `createDataBankFolder` takes the owner from the caller's token
 * for a manager, and `updateDataBankFolder` ignores the owner field entirely,
 * so nobody can file a folder under, or take one from, somebody else.
 */
export default function DataBankPage() {
  const { role, user, loading: authLoading, getIdToken } = useAuth();
  useProtectedRoute(["admin", "subadmin"]);
  const isAdmin = role === "admin";
  const isManager = role === "admin" || role === "subadmin";
  // Phones get their own screen — see `MobileDataBank`. The listener is gated
  // on the surface actually rendering so the two do not both subscribe.
  const isMobile = useIsMobile();

  /*
    **The Meta campaign folders are not in this grid.** They are listed on Meta
    Ads, which is where their figures and their routing control live; the count
    is read here only to point at them, so an admin whose FASAL TOWN 2 folder
    "disappeared" is told where it went instead of going looking.
  */
  const { folders, metaFolders, mirrors, loading, error } = useDataBankFolders(isManager && !isMobile, {
    role,
    uid: user?.uid,
  });
  // To name who is holding a folder's handed-over rows. The mirrors are no
  // longer cards of their own in the admin's grid — they sat beside the folder
  // they came from, with the same name, and read as duplicates appearing on
  // their own. `Handed on` is the way into them instead.
  const { subAdmins } = useSubAdmins(isAdmin && !isMobile);
  const managerNames = useMemo(
    () => new Map(subAdmins.map((manager) => [manager.uid, manager.name])),
    [subAdmins]
  );

  /*
    Mirrors grouped under the folder they came out of, so a source folder can
    say **who** is holding its handed-over rows rather than only how many.
    Costs nothing: they arrive in the same snapshot the grid is already reading.
  */
  const heldBySource = useMemo(() => {
    const byId = new Map<string, Array<{ id: string; name: string; records: number }>>();
    for (const mirror of mirrors) {
      if (!mirror.sourceFolderId) continue;
      const list = byId.get(mirror.sourceFolderId) ?? [];
      list.push({
        id: mirror.id,
        name: mirror.subAdminUid ? (managerNames.get(mirror.subAdminUid) ?? "a manager") : "a manager",
        records: mirror.recordCount,
      });
      byId.set(mirror.sourceFolderId, list);
    }
    return byId;
  }, [mirrors, managerNames]);

  const [formFor, setFormFor] = useState<{ folder: DataBankFolder | null } | null>(null);
  const [confirming, setConfirming] = useState<DataBankFolder | null>(null);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const totals = useMemo(
    () => ({
      records: folders.reduce((sum, folder) => sum + folder.recordCount, 0),
      promoted: folders.reduce((sum, folder) => sum + folder.promotedCount, 0),
    }),
    [folders]
  );

  const remove = async (folder: DataBankFolder) => {
    setBusy(true);
    try {
      const res = await deleteDataBankFolder(await getIdToken(), folder.id);
      if (res.ok) {
        setBanner({
          tone: "success",
          text: `${folder.name} deleted, along with ${res.data.deleted.toLocaleString()} record${res.data.deleted === 1 ? "" : "s"}.`,
        });
        setConfirming(null);
      } else {
        setBanner({ tone: "error", text: res.error });
      }
    } catch {
      setBanner({ tone: "error", text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  if (isMobile) return <MobileDataBankFolders />;

  if (authLoading || loading) return <FullPageSpinner />;

  return (
    <div className="-m-6 min-h-full bg-[var(--paper)] px-6 py-6 text-[var(--ink)] md:-m-8 md:px-8 md:py-7">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--brand-2)] text-white">
            <Database size={22} />
          </span>
          <div>
            <h1 className="text-[24px] text-[var(--ink)]">Data Bank</h1>
            <p className="mt-0.5 text-[13px] text-[var(--ink-3)]">
              {folders.length} source{folders.length === 1 ? "" : "s"} ·{" "}
              {totals.records.toLocaleString()} cold record
              {totals.records === 1 ? "" : "s"} · {totals.promoted.toLocaleString()} moved into the
              pipeline
            </p>
          </div>
        </div>

        {metaFolders.length > 0 && (
          <Link
            href={`${isAdmin ? "/admin" : "/subadmin"}/meta-ads`}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--rule)] bg-white px-4 py-2 text-[12.5px] text-[var(--ink-2)] transition-colors hover:border-[var(--brand-edge)]"
          >
            <span>
              {metaFolders.length} Facebook campaign{metaFolders.length === 1 ? "" : "s"} in Meta Ads
            </span>
            <ChevronRight size={14} className="text-[var(--brand-edge)]" />
          </Link>
        )}

        {isManager && (
          <button
            onClick={() => setFormFor({ folder: null })}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-5 py-2.5 text-[13.5px] text-white transition-colors hover:bg-[var(--brand)]"
          >
            <Plus size={16} strokeWidth={2.2} />
            <span>New Folder</span>
          </button>
        )}
      </header>

      {(error || banner) && (
        <div className="mb-4 space-y-2.5">
          {error && <Banner tone="error" text={error} />}
          {banner && (
            <Banner tone={banner.tone} text={banner.text} onDismiss={() => setBanner(null)} />
          )}
        </div>
      )}

      {folders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--rule-2)] bg-white/70 px-6 py-16 text-center">
          <Database className="mx-auto mb-3 text-[var(--brand-edge)]" size={30} />
          <p className="text-[14.5px] text-[var(--ink)]">No sources yet.</p>
          <p className="mx-auto mt-1.5 max-w-[440px] text-[13px] text-[var(--ink-3)]">
            A folder is one source — Capital Smart City, F2F, a walk-in list. Create it with the
            columns that source&rsquo;s sheet has, then import the file or add rows by hand.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {folders.map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              /* A manager reading their own list does not need telling whose
                 folder it is; only the admin sees more than one owner. */
              ownerName={
                isAdmin && folder.subAdminUid
                  ? (managerNames.get(folder.subAdminUid) ?? "a manager")
                  : null
              }
              heldBy={heldBySource.get(folder.id)}
              basePath={isAdmin ? "/admin/data-bank" : "/subadmin/data-bank"}
              /* A manager owns every folder their query returns, so both
                 controls are theirs. The Server Action re-checks it. */
              onEdit={() => setFormFor({ folder })}
              onDelete={() => setConfirming(folder)}
            />
          ))}
        </div>
      )}

      {formFor && (
        <FolderFormModal
          folder={formFor.folder}
          /* Mirrors included: they are hidden from the grid, but a new folder
             sharing a mirror's name is exactly the collision worth warning
             about. No extra read — both lists are already on screen. */
          existing={[...folders, ...mirrors]}
          getIdToken={getIdToken}
          onClose={() => setFormFor(null)}
          onSaved={(message) => {
            setFormFor(null);
            setBanner({ tone: "success", text: message });
          }}
        />
      )}

      {confirming && (
        <ConfirmDelete
          folder={confirming}
          busy={busy}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void remove(confirming)}
        />
      )}
    </div>
  );
}

function FolderCard({
  folder,
  ownerName,
  heldBy,
  basePath,
  onEdit,
  onDelete,
}: {
  folder: DataBankFolder;
  /** Set when this folder is a manager's mirror — see `ensureManagerFolder`. */
  ownerName?: string | null;
  /**
   * The managers holding rows from this folder, and how many each has.
   *
   * They used to be cards of their own in the grid — same name as this folder,
   * ordered next to it, which read as a duplicate that had appeared on its own.
   * The count below names them instead, so "where did my 9 rows go" is answered
   * on the folder they left rather than by a second folder that looks like a
   * copy of it.
   */
  heldBy?: Array<{ id: string; name: string; records: number }>;
  /**
   * Where this role's Data Bank lives. Hardcoding `/admin/data-bank` sent a
   * manager into the admin's URL space — it happened to render, because the
   * route allows both roles, but every link and Back button afterwards then
   * read as the admin's.
   */
  basePath: string;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-[var(--rule)] bg-white transition-colors hover:border-[var(--brand-edge)]">
      <Link href={`${basePath}/${folder.id}`} className="block px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {folder.code && (
                <span className="rounded-md bg-[var(--brand-wash)] px-2 py-0.5 text-[11px] tracking-[0.6px] text-[var(--brand)]">
                  {folder.code}
                </span>
              )}
              <span className="truncate text-[16px] text-[var(--ink)]">{folder.name}</span>
            </div>
            {ownerName && (
              <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-wash)] px-2.5 py-0.5 text-[11px] text-[var(--brand-2)]">
                <UserCheck size={11} />
                Handed to {ownerName}
              </span>
            )}
            {folder.description && (
              <p className="mt-1 truncate text-[12.5px] text-[var(--ink-3)]">{folder.description}</p>
            )}
          </div>
          <ChevronRight size={18} className="mt-1 shrink-0 text-[var(--brand-edge)]" />
        </div>

        <div className="mt-4 flex items-end gap-6">
          <div>
            <div className="text-[24px] tabular-nums text-[var(--ink)]">
              {folder.recordCount.toLocaleString()}
            </div>
            <div className="text-[11px] tracking-[0.9px] text-[var(--ink-3)] uppercase">Records</div>
          </div>
          <div>
            <div className="text-[24px] tabular-nums text-[var(--brand)]">
              {folder.promotedCount.toLocaleString()}
            </div>
            <div className="text-[11px] tracking-[0.9px] text-[var(--ink-3)] uppercase">Promoted</div>
          </div>
          {/* Only when some have left. A permanent "0 handed over" column on
              every folder is noise on the majority that never will. */}
          {(folder.handedOffCount ?? 0) > 0 && (
            <div>
              <div className="text-[24px] tabular-nums text-[var(--brand-2)]">
                {(folder.handedOffCount ?? 0).toLocaleString()}
              </div>
              <div className="text-[11px] tracking-[0.9px] text-[var(--ink-3)] uppercase">Handed on</div>
            </div>
          )}
        </div>

        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {folder.fields.slice(0, 4).map((field) => (
            <span
              key={field.key}
              className="rounded-md bg-[var(--brand-wash)] px-2 py-0.5 text-[11.5px] text-[var(--ink-2)]"
            >
              {field.label}
            </span>
          ))}
          {folder.fields.length > 4 && (
            <span className="px-1 py-0.5 text-[11.5px] text-[var(--ink-3)]">
              +{folder.fields.length - 4}
            </span>
          )}
        </div>
      </Link>

      {/* Outside the <Link>, because each of these is its own destination — a
          link inside a link is not a nested target, it is an invalid one. */}
      {heldBy && heldBy.length > 0 && (
        <div className="border-t border-[var(--paper-2)] px-5 py-3">
          <div className="text-[11px] tracking-[0.9px] text-[var(--ink-3)] uppercase">Held by</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {heldBy.map((mirror) => (
              <Link
                key={mirror.id}
                href={`${basePath}/${mirror.id}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-wash)] px-2.5 py-1 text-[11.5px] text-[var(--brand-2)] transition-colors hover:bg-[var(--brand-edge)]"
              >
                <UserCheck size={11} />
                {mirror.name} — {mirror.records.toLocaleString()}
                <ChevronRight size={11} />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Kept out of the <Link> so they are separate targets, not nested ones.
          Absent only when a caller passes neither, so the row collapses rather
          than showing buttons that would be refused. */}
      {(onEdit || onDelete) && (
      <div className="flex items-center gap-1 border-t border-[var(--paper-2)] px-3 py-2">
        {onEdit && (
        <button
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-[var(--ink-2)] transition-colors hover:bg-[var(--brand-wash)]"
        >
          <Pencil size={13} />
          <span>Edit fields</span>
        </button>
        )}
        {onDelete && (
        <button
          onClick={onDelete}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-[var(--bad)] transition-colors hover:bg-[var(--bad-wash)]"
        >
          <Trash2 size={13} />
          <span>Delete</span>
        </button>
        )}
      </div>
      )}
    </div>
  );
}

/**
 * Deleting a folder takes every record with it, so the count is stated in the
 * prompt and the confirm button names it. A folder of 12,000 numbers is not
 * something to lose to a stray click.
 */
function ConfirmDelete({
  folder,
  busy,
  onCancel,
  onConfirm,
}: {
  folder: DataBankFolder;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Portalled for the same reason every other overlay in this app is: the page
  // wrapper carries `will-change: transform`, which makes it the containing
  // block for `position: fixed` children — an un-portalled dialog is pinned to
  // the page box, not the viewport, and lands cropped in half a window.
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center px-4">
      <div className="animate-modal-fade fixed inset-0 bg-[var(--ink)]/45" onClick={onCancel} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Delete ${folder.name}`}
        className="animate-modal-pop relative z-10 w-full max-w-[440px] overflow-hidden rounded-2xl bg-white p-6 shadow-[0_26px_70px_rgba(18,54,52,0.32)]"
      >
        <div className="text-[17px] text-[var(--ink)]">Delete {folder.name}?</div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-2)]">
          This removes the folder and all{" "}
          <strong className="text-[var(--bad)]">{folder.recordCount.toLocaleString()}</strong> record
          {folder.recordCount === 1 ? "" : "s"} in it. Leads already promoted into the pipeline are
          not affected. This cannot be undone.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-full border border-[var(--rule-2)] bg-white px-6 py-2.5 text-[13.5px] text-[var(--ink-2)] transition-colors hover:bg-[var(--brand-wash)] disabled:opacity-50"
          >
            Keep it
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="rounded-full bg-[var(--bad)] px-6 py-2.5 text-[13.5px] text-white transition-colors hover:bg-[var(--bad)] disabled:opacity-50"
          >
            {busy ? "Deleting…" : `Delete ${folder.recordCount.toLocaleString()} records`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
