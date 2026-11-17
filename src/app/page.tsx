"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { IS_DEMO, DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/demo/store";
import { ShieldCheck, User, Users, Lock, Mail, AlertCircle, Info, Eye, EyeOff } from "lucide-react";
import { BrandLockup } from "@/components/shell/Brand";
import { PRODUCT } from "@/lib/brand";
import CursorGrid from "@/components/effects/CursorGrid";

function describeSignInError(code: string | undefined): string {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That email and password combination is not recognised.";
    case "auth/invalid-email":
      return "That email address is not valid.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact your administrator.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a few minutes and try again.";
    case "auth/network-request-failed":
      return "Cannot reach the server. Check your connection.";
    case "auth/configuration-not-found":
    case "auth/operation-not-allowed":
      return "Email and password sign-in is not enabled on this Firebase project.";
    case "auth/role-mismatch":
      return "Your account does not have the selected role.";
    default:
      return "Could not sign you in. Please try again.";
  }
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedRole, setSelectedRole] = useState<"admin" | "subadmin" | "employee">("admin");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const router = useRouter();
  const { user, role, loading, roleError, signIn } = useAuth();

  useEffect(() => {
    if (loading || !user || !role) return;
    router.replace("/home");
  }, [user, role, loading, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setErrorCode("");
    setIsSubmitting(true);
    try {
      await signIn(email, password, selectedRole);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? "unknown";
      console.error("[auth] Sign-in failed:", code, err);
      setError(describeSignInError(code));
      setErrorCode(code);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="property-login-viewport" role="status">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--brand-edge)] border-t-[var(--brand)]" />
      </div>
    );
  }

  const roles = [
    { key: "admin", label: "Admin", Icon: ShieldCheck },
    { key: "subadmin", label: "Manager", Icon: Users },
    { key: "employee", label: "Employee", Icon: User },
  ] as const;

  return (
    <div className="property-login-viewport">
      <CursorGrid color="#1F2456" cellSize={65} radius={180} gridOpacity={0.045} fillOpacity={0.03} maxOpacity={0.7} clickPulse />
      <div className="property-drift-blob blob-1" aria-hidden="true" />
      <div className="property-drift-blob blob-2" aria-hidden="true" />

      <div className="property-login-card">
        <div className="property-brand-header">
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
            <BrandLockup size={46} />
          </div>
          <div className="property-role-badge">
            {selectedRole === "admin" ? <ShieldCheck size={14} className="badge-icon" /> : selectedRole === "subadmin" ? <Users size={14} className="badge-icon" /> : <User size={14} className="badge-icon" />}
            <span>{selectedRole === "admin" ? "ADMIN SIGN-IN" : selectedRole === "subadmin" ? "MANAGER SIGN-IN" : "EMPLOYEE SIGN-IN"}</span>
          </div>
          <h1 className="property-portal-title">{PRODUCT}</h1>
          <div className="property-portal-subtitles">
            <p className="sub-en">Choose your role, then sign in</p>
            <p className="sub-ur" dir="rtl">اپنا کردار منتخب کریں، پھر سائن ان کریں</p>
          </div>
        </div>

        {roleError && (
          <div className="property-auth-alert error" role="alert">
            <AlertCircle size={15} /> {roleError}
          </div>
        )}
        {error && (
          <div className="property-auth-alert error" role="alert">
            {error}
            {process.env.NODE_ENV !== "production" && errorCode && <small style={{ display: "block", opacity: 0.6 }}>{errorCode}</small>}
          </div>
        )}

        <form onSubmit={handleLogin} className="property-login-form" noValidate>
          <div className="property-role-tabs" role="group" aria-label="Role">
            {roles.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                className={`role-tab-pill ${selectedRole === key ? "active" : ""}`}
                aria-pressed={selectedRole === key}
                onClick={() => setSelectedRole(key)}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>

          <div className="property-input-field">
            <label className="property-field-label" htmlFor="email">
              <span>{IS_DEMO ? "Email or username" : "Email"}</span>
              <span className="ur-hint" dir="rtl">(ای میل)</span>
            </label>
            <div className="property-input-wrap">
              <Mail className="input-left-icon" size={17} />
              <input
                id="email"
                // The demo admin signs in as `demo`, which an email box refuses.
                type={IS_DEMO ? "text" : "email"}
                autoCapitalize="none"
                autoComplete="username"
                autoFocus
                required
                className="property-text-input"
                placeholder={IS_DEMO ? "demo" : "you@fatimamarketing.com"}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="property-input-field">
            <label className="property-field-label" htmlFor="password">
              <span>Password</span>
              <span className="ur-hint" dir="rtl">(پاس ورڈ)</span>
            </label>
            <div className="property-input-wrap">
              <Lock className="input-left-icon" size={17} />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                className="property-text-input with-toggle"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="input-eye-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          <button type="submit" className="property-submit-btn" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="property-card-footer">
          <span className="property-footer-note">Accounts are created by your administrator.</span>
        </div>

        {IS_DEMO && (
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--rule)", display: "grid", gap: 8 }}>
            <button
              type="button"
              className="btn"
              style={{ height: "auto", padding: "10px 12px", justifyContent: "flex-start", flexDirection: "column", alignItems: "flex-start", background: "var(--brand-wash)" }}
              onClick={() => {
                setEmail("demo");
                setPassword(DEMO_PASSWORD);
                setSelectedRole("admin");
              }}
            >
              <span className="kicker" style={{ color: "var(--brand)" }}>Demo admin</span>
              <span style={{ fontSize: 13 }}>
                Username <b>demo</b> · Password <b>{DEMO_PASSWORD}</b>
              </span>
            </button>
            <p className="kicker" style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center", color: "var(--warn)" }}>
              <Info size={12} /> Or another role · password {DEMO_PASSWORD}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.uid}
                  type="button"
                  className="btn sm"
                  style={{ height: "auto", padding: "6px 8px", flexDirection: "column", alignItems: "flex-start", fontSize: 11 }}
                  onClick={() => {
                    setEmail(account.email);
                    setPassword(DEMO_PASSWORD);
                    setSelectedRole(account.role);
                  }}
                >
                  <b style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>{account.email}</b>
                  <span style={{ textTransform: "capitalize", color: "var(--ink-3)" }}>{account.role}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
