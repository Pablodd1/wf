import { ArrowLeft, LockKeyhole } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

type DealerRole = 'dealer' | 'reviewer' | 'admin';

function defaultDestination(role?: string) {
  return role === 'admin' || role === 'reviewer' ? '/review-queue' : '/dealer';
}

function requiredRolesFor(path?: string): DealerRole[] | null {
  const route = String(path || '').split('?')[0];
  if (route === '/dashboard' || route === '/admin' || route === '/multi-listings') return ['admin'];
  if (route === '/review' || route === '/review-queue' || route === '/reprocess') return ['reviewer', 'admin'];
  if (route === '/demo' || route === '/demo-mode') return ['admin'];
  if (route.startsWith('/dealer') || route === '/analytics' || route === '/clean' || route === '/dealers') {
    return ['dealer', 'reviewer', 'admin'];
  }
  return null;
}

function canOpenRequestedDestination(role?: string, path?: string) {
  const required = requiredRolesFor(path);
  if (!required) return true;
  return required.includes(role as DealerRole);
}

export default function DealerLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const adminEntry = location.pathname === '/admin-login';
  const requestedDestination = (location.state as { from?: string } | null)?.from || (adminEntry ? '/admin' : undefined);
  const destination = requestedDestination || '/dealer';
  const betaSkipLabel = destination === '/dealer'
    ? 'Continue to dealer preview'
    : 'Continue without login to Trading Floor';
  const betaDestinations = new Set(['/dealer', '/trading']);
  const protectedDestination = !betaDestinations.has(destination);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState('');
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  // Demo access is deliberately limited by DealerGate to browse-only routes.
  // Keep the entry point visible regardless of stale deployment variables.
  const betaSkipEnabled = !protectedDestination;

  const accessMessage = destination === '/price-research'
    ? 'Sign in is required to access Price Research.'
    : destination === '/admin' || destination === '/dashboard' || destination === '/multi-listings'
      ? 'Administrator sign-in is required for the Admin Panel.'
      : 'Secure sign-in is required to continue.';

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    fetch('/api/dealer-auth', { credentials: 'include', signal: controller.signal })
      .then(async response => {
        const result = response.headers.get('content-type')?.includes('application/json')
          ? await response.json()
          : null;
        if (!response.ok || result?.authenticated !== true) return;
        sessionStorage.removeItem('wf_beta_skip');
        const role = result?.user?.role as DealerRole | undefined;
        setCurrentRole(role || null);
        if (requestedDestination && !canOpenRequestedDestination(role, requestedDestination)) {
          setError(`Signed in as ${role || 'unprovisioned user'}; ${requestedDestination} requires ${requiredRolesFor(requestedDestination)?.join(' or ')} access.`);
          return;
        }
        navigate(requestedDestination || defaultDestination(role), { replace: true });
      })
      .catch(sessionError => {
        if (active && sessionError?.name !== 'AbortError') setError('Unable to verify the existing session. You can still sign in below.');
      })
      .finally(() => {
        if (active) setCheckingSession(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [navigate, requestedDestination]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/dealer-auth', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to sign in.');
      sessionStorage.removeItem('wf_beta_skip');
      const role = result?.user?.role as DealerRole | undefined;
      setCurrentRole(role || null);
      if (requestedDestination && !canOpenRequestedDestination(role, requestedDestination)) {
        setError(`Signed in as ${role || 'unprovisioned user'}; ${requestedDestination} requires ${requiredRolesFor(requestedDestination)?.join(' or ')} access.`);
        return;
      }
      navigate(requestedDestination || defaultDestination(role), { replace: true });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Unable to sign in.');
    } finally { setLoading(false); }
  }

  function skipForBeta() {
    sessionStorage.setItem('wf_beta_skip', '1');
    navigate(requestedDestination && betaDestinations.has(requestedDestination) ? requestedDestination : '/trading', { replace: true });
  }

  return (
    <main className="min-h-screen bg-[#09090d] px-5 py-8 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl flex-col">
        <Link to="/" className="flex w-fit items-center gap-2 text-sm text-white/65 transition-colors hover:text-white"><ArrowLeft size={16} /> Curated Luxury</Link>
        <div className="flex flex-1 items-center justify-center py-10">
          <section className="w-full max-w-[420px] border border-white/12 bg-[#111118] p-6 sm:p-8">
            <div className="mb-6 flex items-center gap-3"><LockKeyhole size={20} className="text-[#c9a96e]" /><h2 className="text-lg font-semibold">{adminEntry ? 'Admin login' : 'Login'}</h2></div>
            {protectedDestination && (
              <div className="mb-5 border-l-2 border-[#c9a96e] bg-[#c9a96e]/10 px-3 py-2 text-xs leading-5 text-[#ead7ae]">
                {accessMessage} Existing secure sessions open automatically.
              </div>
            )}
            <form onSubmit={login} className="space-y-4">
              <label className="block text-xs font-medium text-white/65">Email
                <input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} className="mt-2 h-11 w-full border border-white/15 bg-[#09090d] px-3 text-sm text-white outline-none focus:border-[#c9a96e]" />
              </label>
              <label className="block text-xs font-medium text-white/65">Password
                <input type="password" autoComplete="current-password" required minLength={8} value={password} onChange={event => setPassword(event.target.value)} className="mt-2 h-11 w-full border border-white/15 bg-[#09090d] px-3 text-sm text-white outline-none focus:border-[#c9a96e]" />
              </label>
              {error && <div role="alert" className="border-l-2 border-red-500 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</div>}
              {currentRole && protectedDestination && (
                <div className="border-l-2 border-white/20 bg-white/5 px-3 py-2 text-xs leading-5 text-white/65">
                  Current role: <strong className="text-white">{currentRole}</strong>. Price Research accepts provisioned users. Review Queue accepts reviewer or admin. The Admin Panel accepts administrators only.
                </div>
              )}
              <button type="submit" disabled={loading || checkingSession} className="h-11 w-full bg-[#c9a96e] text-sm font-semibold text-[#09090d] transition-colors hover:bg-[#d4b87a] disabled:opacity-60">{checkingSession ? 'Checking existing access...' : loading ? 'Signing in...' : 'Sign in securely'}</button>
            </form>
            {betaSkipEnabled && (
              <div className="mt-5 border-t border-white/10 pt-5">
                <button type="button" onClick={skipForBeta} disabled={checkingSession} className="h-10 w-full border border-white/20 text-xs font-semibold text-white/75 transition-colors hover:border-white/45 hover:text-white disabled:opacity-50">{betaSkipLabel}</button>
                <p className="mt-2 text-center text-[11px] leading-5 text-amber-200/65">Marketplace browsing needs no password. Human Review and approvals require a secure reviewer or administrator session.</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
