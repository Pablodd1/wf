import { ArrowLeft, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

export default function DealerLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const destination = (location.state as { from?: string } | null)?.from || '/dealer';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const betaSkipEnabled = import.meta.env.VITE_ENABLE_DEALER_SKIP !== 'false';

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
      navigate(destination, { replace: true });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Unable to sign in.');
    } finally { setLoading(false); }
  }

  function skipForBeta() {
    sessionStorage.setItem('wf_beta_skip', '1');
    navigate(destination, { replace: true });
  }

  return (
    <main className="min-h-screen bg-[#09090d] px-5 py-8 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl flex-col">
        <Link to="/" className="flex w-fit items-center gap-2 text-sm text-white/65 transition-colors hover:text-white"><ArrowLeft size={16} /> Curated Luxury</Link>
        <div className="grid flex-1 items-center gap-12 py-10 lg:grid-cols-[1fr_420px]">
          <section>
            <div className="mb-5 flex h-11 w-11 items-center justify-center border border-[#c9a96e]/45 text-[#c9a96e]"><ShieldCheck size={22} /></div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#c9a96e]">Controlled dealer access</p>
            <h1 className="max-w-xl font-serif text-4xl leading-tight sm:text-5xl">Your market operations workspace.</h1>
            <p className="mt-5 max-w-lg text-sm leading-7 text-white/60">Access Price Search, the Trading Floor, and the WatchFacts rated-dealer network. Accounts are provisioned by WatchFacts; public registration is disabled.</p>
          </section>

          <section className="border border-white/12 bg-[#111118] p-6 sm:p-8">
            <div className="mb-6 flex items-center gap-3"><LockKeyhole size={20} className="text-[#c9a96e]" /><h2 className="text-lg font-semibold">Dealer login</h2></div>
            <form onSubmit={login} className="space-y-4">
              <label className="block text-xs font-medium text-white/65">Email
                <input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} className="mt-2 h-11 w-full border border-white/15 bg-[#09090d] px-3 text-sm text-white outline-none focus:border-[#c9a96e]" />
              </label>
              <label className="block text-xs font-medium text-white/65">Password
                <input type="password" autoComplete="current-password" required minLength={8} value={password} onChange={event => setPassword(event.target.value)} className="mt-2 h-11 w-full border border-white/15 bg-[#09090d] px-3 text-sm text-white outline-none focus:border-[#c9a96e]" />
              </label>
              {error && <div role="alert" className="border-l-2 border-red-500 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</div>}
              <button type="submit" disabled={loading} className="h-11 w-full bg-[#c9a96e] text-sm font-semibold text-[#09090d] transition-colors hover:bg-[#d4b87a] disabled:opacity-60">{loading ? 'Signing in...' : 'Sign in securely'}</button>
            </form>
            {betaSkipEnabled && (
              <div className="mt-5 border-t border-white/10 pt-5">
                <button type="button" onClick={skipForBeta} className="h-10 w-full border border-white/20 text-xs font-semibold text-white/75 transition-colors hover:border-white/45 hover:text-white">Skip and enter beta</button>
                <p className="mt-2 text-center text-[11px] leading-5 text-amber-200/65">Temporary access for this browser tab only. Secure dealer actions still require an authenticated account.</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
