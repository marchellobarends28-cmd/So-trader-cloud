"use client";

import React, { useState } from "react";
import { Lock, LogOut, ShieldAlert, Loader2, X } from "lucide-react";

interface LoginModalProps {
  open: boolean;
  authenticated: boolean;
  usingDefaultPassword: boolean;
  onClose: () => void;
  onLogin: (password: string) => Promise<{ ok: boolean; error?: string }>;
  onLogout: () => Promise<void>;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  open,
  authenticated,
  usingDefaultPassword,
  onClose,
  onLogin,
  onLogout,
}) => {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await onLogin(password);
    setBusy(false);
    if (!res.ok) setError(res.error ?? "Login failed");
    else {
      setPassword("");
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-4 shadow-2xl">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{authenticated ? "Session active" : "Sign in to trade"}</h3>
              <p className="text-[10px] text-slate-400">Trading controls require authentication</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {authenticated ? (
          <div className="mt-4 space-y-3">
            <p className="text-[11px] text-emerald-300 bg-emerald-950/30 border border-emerald-800/40 rounded-lg p-2">
              You are authenticated. Destructive actions (emergency stop, live approval, order changes) will be accepted.
            </p>
            <button
              onClick={async () => {
                await onLogout();
                onClose();
              }}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 py-2 text-xs font-bold text-slate-200"
            >
              <LogOut className="w-3.5 h-3.5" /> Sign out
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-3">
            {usingDefaultPassword && (
              <div className="text-[10px] text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded-lg p-2 flex items-start gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>Set a strong <code className="font-mono">DASHBOARD_PASSWORD</code> in your hosting environment before signing in. No default password is enabled.</span>
              </div>
            )}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Dashboard password"
              autoComplete="current-password"
              className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
            {error && <div className="text-[11px] text-rose-400">{error}</div>}
            <button
              type="submit"
              disabled={busy || password.length === 0}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 py-2 text-xs font-bold text-white"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
              Sign in
            </button>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Account, trading and market data are hidden until you sign in. Every private endpoint rejects requests without a valid session
              cookie or the MT5 bridge API key.
            </p>
          </form>
        )}
      </div>
    </div>
  );
};
