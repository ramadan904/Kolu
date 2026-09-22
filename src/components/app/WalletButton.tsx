"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWallet, type Wallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { Button } from "@/components/ui/Button";

function short(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

const enc = encodeURIComponent;

/**
 * The wallets Kolu always offers, whether or not they are installed. Each has
 * an install page for desktop and a "browse" deep link that opens Kolu inside
 * the wallet's own in-app browser on a phone — where a mobile web page cannot
 * otherwise reach the wallet at all.
 */
const FEATURED = [
  {
    name: "Phantom",
    color: "#AB9FF2",
    install: "https://phantom.com/download",
    browse: (url: string, ref: string) => `https://phantom.app/ul/browse/${enc(url)}?ref=${enc(ref)}`,
  },
  {
    name: "Solflare",
    color: "#FC7227",
    install: "https://solflare.com/download",
    browse: (url: string, ref: string) => `https://solflare.com/ul/v1/browse/${enc(url)}?ref=${enc(ref)}`,
  },
  {
    name: "Backpack",
    color: "#E33E3F",
    install: "https://backpack.app/downloads",
    browse: (url: string, ref: string) => `https://backpack.app/ul/v1/browse/${enc(url)}?ref=${enc(ref)}`,
  },
] as const;

const MOBILE_WALLET_ADAPTER = "Mobile Wallet Adapter";

type RowAction = "connect" | "web" | "open-in-app" | "install" | "unavailable";

interface Row {
  name: string;
  icon: string | null;
  color: string;
  wallet: Wallet | null;
  action: RowAction;
  status: string;
  hint?: string;
  href?: string;
}

function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
  // iPadOS asks for the desktop site and reports itself as a Mac; touch gives it away.
  return /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}

/**
 * Connect control: a wallet picker that works for someone who has a wallet,
 * someone on a phone, and someone who has never installed one. Built here
 * rather than using the adapter's stock modal, whose styling cannot be
 * reconciled with this design system.
 */
export function WalletButton({
  size = "sm",
  full = false,
  label = "Connect wallet",
}: {
  size?: "sm" | "lg";
  full?: boolean;
  label?: string;
  /** Kept for callers; the picker is now a centred dialog. */
  dropUp?: boolean;
} = {}) {
  const { wallets, select, connect, disconnect, connecting, connected, publicKey, wallet } = useWallet();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  // The adapter needs a tick between select() and connect().
  useEffect(() => {
    if (!pending || !wallet || wallet.adapter.name !== pending || connected || connecting) return;
    void connect().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "Connection failed";
      // A user closing the wallet popup is not an error worth showing.
      if (!/user rejected|closed|cancel/i.test(message)) setError(`${pending}: ${message}`);
      setPending(null);
    });
  }, [pending, wallet, connected, connecting, connect]);

  useEffect(() => {
    if (connected) {
      setPickerOpen(false);
      setPending(null);
      setError(null);
    }
  }, [connected]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const rows = useMemo<Row[]>(() => {
    const mobile = isMobileDevice();
    const byName = new Map(wallets.map((w) => [w.adapter.name as string, w]));
    const here = typeof window === "undefined" ? "" : window.location.href;
    const origin = typeof window === "undefined" ? "" : window.location.origin;

    const featured: Row[] = FEATURED.map((f) => {
      const w = byName.get(f.name) ?? null;
      const state = w?.readyState;
      if (state === WalletReadyState.Installed) {
        return { name: f.name, icon: w!.adapter.icon, color: f.color, wallet: w, action: "connect", status: "Detected" };
      }
      // Solflare's adapter can connect through its web wallet with no extension.
      if (f.name === "Solflare" && w && state === WalletReadyState.Loadable) {
        return {
          name: f.name,
          icon: w.adapter.icon,
          color: f.color,
          wallet: w,
          action: "web",
          status: "Web wallet",
          hint: "No extension needed — connects in a Solflare window",
        };
      }
      if (mobile) {
        return {
          name: f.name,
          icon: w?.adapter.icon ?? null,
          color: f.color,
          wallet: null,
          action: "open-in-app",
          status: "Open in app",
          hint: `Opens Kolu inside the ${f.name} app`,
          href: f.browse(here, origin),
        };
      }
      return {
        name: f.name,
        icon: w?.adapter.icon ?? null,
        color: f.color,
        wallet: null,
        action: "install",
        status: "Install",
        hint: "Reload Kolu after installing",
        href: f.install,
      };
    });

    // Anything else the browser exposes through Wallet Standard — Glow, OKX,
    // a hardware wallet bridge — and, on Android, the Mobile Wallet Adapter.
    const others: Row[] = wallets
      .filter((w) => !FEATURED.some((f) => f.name === w.adapter.name))
      .filter(
        (w) =>
          w.readyState === WalletReadyState.Installed ||
          (w.adapter.name === MOBILE_WALLET_ADAPTER && w.readyState !== WalletReadyState.Unsupported),
      )
      .map((w) => ({
        name: w.adapter.name === MOBILE_WALLET_ADAPTER ? "Wallet app on this phone" : w.adapter.name,
        icon: w.adapter.icon,
        color: "#5c5c66",
        wallet: w,
        action: "connect" as const,
        status: w.adapter.name === MOBILE_WALLET_ADAPTER ? "Mobile" : "Detected",
      }));

    return [...featured, ...others];
  }, [wallets]);

  const choose = useCallback(
    (row: Row) => {
      setError(null);
      if (row.action === "install" && row.href) {
        window.open(row.href, "_blank", "noopener,noreferrer");
        return;
      }
      if (row.action === "open-in-app" && row.href) {
        window.location.href = row.href;
        return;
      }
      if (row.wallet) {
        setPending(row.wallet.adapter.name);
        select(row.wallet.adapter.name as WalletName);
      }
    },
    [select],
  );

  if (connected && publicKey) {
    const address = publicKey.toBase58();
    return (
      <div className="relative" ref={menuRef}>
        <Button variant="secondary" size="sm" onClick={() => setMenuOpen((v) => !v)}>
          {wallet?.adapter.icon && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={wallet.adapter.icon} alt="" className="h-4 w-4 rounded-[4px]" />
          )}
          <span className="num">{short(address)}</span>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="text-[var(--text-3)]">
            <path d="M2 3.5L5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
        </Button>
        {menuOpen && (
          <div className="panel absolute right-0 z-50 mt-2 w-60 overflow-hidden p-1">
            <div className="px-3 pt-2 pb-2.5">
              <div className="text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]">
                {wallet?.adapter.name ?? "Wallet"}
              </div>
              <div className="num mt-0.5 text-[13px] text-white">{short(address)}</div>
            </div>
            <MenuItem
              onClick={() => {
                void navigator.clipboard?.writeText(address);
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              }}
            >
              {copied ? "Copied" : "Copy address"}
            </MenuItem>
            <MenuItem onClick={() => window.open(`https://solscan.io/account/${address}`, "_blank", "noopener,noreferrer")}>
              View on Solscan ↗
            </MenuItem>
            <MenuItem
              danger
              onClick={() => {
                void disconnect();
                setMenuOpen(false);
              }}
            >
              Log out
            </MenuItem>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className={full ? "w-full" : ""}>
        <Button size={size} full={full} loading={connecting} onClick={() => setPickerOpen(true)}>
          {connecting ? "Connecting" : label}
        </Button>
      </div>
      {mounted && pickerOpen &&
        createPortal(
          <WalletPicker
            rows={rows}
            pending={connecting ? pending : null}
            error={error}
            onChoose={choose}
            onClose={() => {
              setPickerOpen(false);
              setPending(null);
            }}
          />,
          document.body,
        )}
    </>
  );
}

function MenuItem({
  onClick,
  children,
  danger,
}: {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-[var(--radius-sm)] px-3 py-2 text-left text-[13px] transition-colors ${
        danger
          ? "text-[var(--up)] hover:bg-[var(--up-soft)]"
          : "text-[var(--text-2)] hover:bg-[var(--raised)] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function WalletPicker({
  rows,
  pending,
  error,
  onChoose,
  onClose,
}: {
  rows: Row[];
  pending: string | null;
  error: string | null;
  onChoose: (row: Row) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const detected = rows.filter((r) => r.action === "connect");
  const rest = rows.filter((r) => r.action !== "connect");

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Connect a wallet">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative max-h-[92vh] w-full max-w-[440px] overflow-y-auto rounded-t-[16px] border border-white/10 p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] sm:rounded-[16px]"
        style={{
          outline: "none",
          background: "radial-gradient(420px 200px at 50% -40px, rgba(59,130,255,0.18), transparent 70%), #0a0b10",
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.02em]">Connect a wallet</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-2)]">
              Kolu reads your xStock balances and asks your wallet to sign trades. It never holds
              keys and cannot move funds on its own.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded-[var(--radius-sm)] p-1.5 text-[var(--text-3)] hover:bg-[var(--raised)] hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M4.5 4.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {detected.length > 0 && (
          <>
            <div className="mt-5 mb-1.5 text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]">
              On this device
            </div>
            <ul className="space-y-1">
              {detected.map((r) => (
                <WalletRow key={r.name} row={r} pending={pending === r.wallet?.adapter.name} onChoose={onChoose} />
              ))}
            </ul>
          </>
        )}

        {rest.length > 0 && (
          <>
            <div className="mt-5 mb-1.5 text-[11px] uppercase tracking-[0.07em] text-[var(--text-3)]">
              {detected.length > 0 ? "More wallets" : "Choose a wallet"}
            </div>
            <ul className="space-y-1">
              {rest.map((r) => (
                <WalletRow key={r.name} row={r} pending={pending === r.wallet?.adapter.name} onChoose={onChoose} />
              ))}
            </ul>
          </>
        )}

        {error && (
          <p className="mt-3 rounded-[var(--radius-sm)] bg-[var(--up-soft)] px-3 py-2 text-[12px] leading-relaxed text-[var(--up)]" role="alert">
            {error}
          </p>
        )}

        {!isMobileDevice() && <PhoneHandoff />}

        <p className="mt-4 border-t border-[var(--border)] pt-3 text-[12px] leading-relaxed text-[var(--text-3)]">
          No wallet yet? Phantom and Solflare take about a minute to set up. Or explore first —
          everything but signing works without one.
        </p>
      </div>
    </div>
  );
}

function WalletRow({
  row,
  pending,
  onChoose,
}: {
  row: Row;
  pending: boolean;
  onChoose: (row: Row) => void;
}) {
  const statusTone =
    row.status === "Detected" || row.status === "Mobile"
      ? "text-[var(--down)]"
      : row.action === "web"
        ? "text-[var(--accent)]"
        : "text-[var(--text-3)]";
  return (
    <li>
      <button
        type="button"
        onClick={() => onChoose(row)}
        disabled={pending}
        className="group flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--raised)] disabled:opacity-70"
      >
        {row.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.icon} alt="" className="h-8 w-8 shrink-0 rounded-[8px]" />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-[14px] font-semibold text-black"
            style={{ background: row.color }}
          >
            {row.name[0]}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium text-white">{row.name}</span>
          {row.hint && <span className="block truncate text-[12px] text-[var(--text-3)]">{row.hint}</span>}
        </span>
        <span className={`shrink-0 text-[12px] ${statusTone}`}>
          {pending ? "Approve in wallet…" : row.status}
          {(row.action === "install" || row.action === "open-in-app") && " ↗"}
        </span>
      </button>
    </li>
  );
}

/**
 * Desktop to phone: a QR code that opens this exact page inside the chosen
 * wallet's app on a phone — Phantom, Solflare or Backpack — where the wallet
 * is already present and connects in one tap. Scanned with the phone's camera;
 * no extension, no pairing, nothing leaves this page but its own URL.
 */
function PhoneHandoff() {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(0);
  const [svg, setSvg] = useState<string | null>(null);
  const f = FEATURED[pick];
  const here = typeof window === "undefined" ? "" : window.location.href;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = f.browse(here, origin);
  const local = /localhost|127.0.0.1/.test(origin);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void import("qrcode").then((QR) =>
      QR.toString(link, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#05060a", light: "#ffffff" } }).then(
        (s) => !cancelled && setSvg(s),
      ),
    );
    return () => {
      cancelled = true;
    };
  }, [open, link]);

  return (
    <div className="mt-5 rounded-[12px] border border-white/[0.08] bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left"
      >
        <span className="flex items-center gap-2.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-[var(--accent-2)]">
            <rect x="6" y="2" width="12" height="20" rx="3" stroke="currentColor" strokeWidth="1.8" />
            <path d="M11 18h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span>
            <span className="block text-[13px] font-medium text-white">Use the wallet on your phone</span>
            <span className="block text-[12px] text-[var(--text-3)]">Scan a code, Kolu opens inside the wallet app</span>
          </span>
        </span>
        <span className={`text-[var(--text-3)] transition-transform ${open ? "rotate-90" : ""}`}>›</span>
      </button>
      {open && (
        <div className="border-t border-white/[0.07] px-3.5 pt-3 pb-4">
          <div className="flex gap-1 rounded-[8px] bg-black/30 p-0.5" role="tablist" aria-label="Phone wallet">
            {FEATURED.map((w, i) => (
              <button
                key={w.name}
                type="button"
                role="tab"
                aria-selected={i === pick}
                onClick={() => setPick(i)}
                className={`flex-1 rounded-[6px] py-1.5 text-[12px] font-medium transition-colors ${
                  i === pick ? "bg-white/[0.09] text-white" : "text-[var(--text-3)] hover:text-[var(--text-2)]"
                }`}
              >
                {w.name}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-4">
            <div
              className="flex h-[132px] w-[132px] shrink-0 items-center justify-center rounded-[10px] bg-white p-2.5"
              aria-label={`QR code: open Kolu in ${f.name}`}
              role="img"
            >
              {svg ? (
                <span className="block h-full w-full [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
              ) : (
                <span className="skeleton h-full w-full" />
              )}
            </div>
            <ol className="space-y-1.5 text-[12px] leading-snug text-[var(--text-2)]">
              <li>1. Open your phone&rsquo;s camera and point it at the code.</li>
              <li>2. Tap the link: {f.name} opens with Kolu inside it.</li>
              <li>3. Tap Connect wallet there — {f.name} is already signed in.</li>
            </ol>
          </div>
          {local && (
            <p className="mt-3 text-[11px] text-[var(--warn)]">
              This page is running on your computer, so a phone cannot reach it. Use the live site to hand off.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
