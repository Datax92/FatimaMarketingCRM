"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { doc, updateDoc } from "@/lib/db/client";
import { MdClose } from "react-icons/md";
import { db } from "@/lib/firebase/client";
import { Avatar } from "./ui";
import { formatPhone } from "./utils";

// Renames a connected number in the monitor. The name is the number's label in
// wa_numbers (the only field the Firestore rules let admins change); the
// WhatsApp Business profile name on the phone is left alone, and an empty name
// goes back to it.
export default function RenameEmployee({ employee, onClose }) {
  const [name, setName] = useState(employee.label || employee.verifiedName || "");
  const [saving, setSaving] = useState(false);

  const save = async (value) => {
    const label = value.trim();
    setSaving(true);
    try {
      await updateDoc(doc(db, "wa_numbers", employee.id), { label: label || null });
      toast.success(label ? `Renamed to ${label}` : "Back to the WhatsApp name");
      onClose();
    } catch (err) {
      toast.error(err.code === "permission-denied" ? "Only full admins can rename numbers." : err.message);
      setSaving(false);
    }
  };

  return (
    <div className="wa-anim-fade fixed inset-0 z-[70] bg-[#0b141a]/80 flex items-center justify-center p-4" onClick={() => !saving && onClose()}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          save(name);
        }}
        className="wa-anim-pop w-full max-w-sm bg-[#233138] rounded-xl shadow-[0_17px_50px_rgba(0,0,0,0.6)] text-[#e9edef]"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h2 className="text-lg font-bold text-white">Rename employee</h2>
          <button type="button" onClick={onClose} disabled={saving} className="text-[#8696a0] hover:text-white disabled:opacity-40" aria-label="Close">
            <MdClose size={22} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Avatar name={name || employee.name} seed={employee.id} size={44} />
            <div className="min-w-0 text-[13px] text-[#8696a0]">
              <p className="truncate">{formatPhone(employee.display)}</p>
              <p className="truncate">WhatsApp name: {employee.verifiedName || "not set"}</p>
            </div>
          </div>
          <div>
            <label htmlFor="wa-rename" className="block text-xs text-[#8696a0] font-medium mb-1">
              Name shown in the monitor
            </label>
            <input
              id="wa-rename"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && !saving && onClose()}
              disabled={saving}
              maxLength={60}
              placeholder={employee.verifiedName || "e.g. Ali (Ticketing)"}
              className="w-full bg-[#2a3942] border border-transparent rounded-lg px-3 py-2.5 text-sm text-[#e9edef] outline-none focus:border-[#00a884] placeholder:text-[#8696a0] transition-colors"
            />
            <p className="mt-1.5 text-[12px] text-[#8696a0]">Only changes the name here, not on the employee&apos;s phone.</p>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-white/5 flex items-center gap-2">
          {employee.label && employee.verifiedName && (
            <button
              type="button"
              onClick={() => save("")}
              disabled={saving}
              className="mr-auto text-[13px] text-[#00a884] hover:text-[#06cf9c] disabled:opacity-40"
            >
              Use WhatsApp name
            </button>
          )}
          <button type="button" onClick={onClose} disabled={saving} className="ml-auto px-4 py-2 rounded-xl text-sm font-semibold text-[#aebac1] hover:text-white disabled:opacity-40">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 rounded-full text-sm font-semibold bg-[#00a884] hover:bg-[#06cf9c] text-[#111b21] disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
