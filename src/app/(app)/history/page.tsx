import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gap history · Kolu",
  description: "How far each xStock has traded from its real share over the last week, from real trades — and whether the gap closed at the open.",
};

/** Rendered by the shared board in the layout; this route only picks the view. */
export default function HistoryPage() {
  return null;
}
