import { ArrowLeft, LockKeyhole } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { MarketNav } from '../components/MarketNav';
import { Footer } from '../components/Footer';

type DealerRole = 'dealer' | 'reviewer' | 'admin';

function defaultDestination(role?: string) {
  return role === 'admin' || role === 'reviewer' ? '/review-queue' : '/dealer/workspace';
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
  const adminEntry = location.pathname === '/cl-login';
  const requestedDestination = (location.state as { from?: string } | null)?.from || (adminEntry ? '/admin' : undefined);
  const destination = requestedDestination || '/dealer/workspace';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState('');
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [entryMode, setEntryMode] = useState<'login' | 'apply'>('login');
  const [applicationNotice, setApplicationNotice] = useState('');

  function continueAsGuest() {
    const guestSession = { isCredentialed: false, isGuestDealer: true, startedAt: new Date().toISOString() };
    sessionStorage.setItem('wf_beta_skip', '1');
    sessionStorage.setItem('cl_dealer_session', JSON.stringify(guestSession));
    navigate('/dealer/workspace', { replace: true, state: { guest: true } });
  }

  const accessMessage = destination === '/price-research'
    ? 'Sign in is required to access Price Research.'
    : destination === '/admin' || destination === '/dashboard' || destination === '/multi-listings'
      ? 'CL administrator sign-in is required for the control dashboard.'
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
        sessionStorage.removeItem('cl_dealer_session');
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
      sessionStorage.removeItem('cl_dealer_session');
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

  async function applyForAccess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setError(''); setApplicationNotice('');
    try {
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      const response = await fetch('/api/dealer-registration', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, group_count: Number(values.group_count || 0), contact_consent: values.contact_consent === 'on' }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to submit your application.');
      setApplicationNotice(`Application ${result.application_id} received. Curated Luxury will verify the profile before Workspace credentials are provisioned.`);
      form.reset();
    } catch (applicationError) {
      setError(applicationError instanceof Error ? applicationError.message : 'Unable to submit your application.');
    } finally { setLoading(false); }
  }

  return (
    <main className="min-h-screen bg-[#09090d] text-white">
      <MarketNav />
      <div className="px-5 py-8">
        <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-5xl flex-col">
        <Link to="/" className="flex w-fit items-center gap-2 text-sm text-white/65 transition-colors hover:text-white"><ArrowLeft size={16} /> Curated Luxury</Link>
        <div className="flex flex-1 items-center justify-center py-10">
          <section className={`w-full ${entryMode === 'apply' && !adminEntry ? 'max-w-[720px]' : 'max-w-[420px]'} border border-white/12 bg-[#111118] p-6 sm:p-8`}>
            <div className="mb-6 flex items-center gap-3"><LockKeyhole size={20} className="text-[#c9a96e]" /><h2 className="text-lg font-semibold">{adminEntry ? 'CL Login' : entryMode === 'login' ? 'Workspace Login' : 'Dealer access application'}</h2></div>
            {!adminEntry && <div className="mb-5 grid grid-cols-2 gap-2"><button type="button" onClick={() => { setEntryMode('login'); setError(''); }} className={`h-10 border text-xs font-semibold ${entryMode === 'login' ? 'border-[#c9a96e] bg-[#c9a96e] text-black' : 'border-white/15 text-white/60'}`}>Sign in</button><button type="button" onClick={() => { setEntryMode('apply'); setError(''); }} className={`h-10 border text-xs font-semibold ${entryMode === 'apply' ? 'border-[#c9a96e] bg-[#c9a96e] text-black' : 'border-white/15 text-white/60'}`}>New dealer</button></div>}
            {entryMode === 'login' || adminEntry ? <>
            <div className="mb-5 border-l-2 border-[#c9a96e] bg-[#c9a96e]/10 px-3 py-2 text-xs leading-5 text-[#ead7ae]">
              {accessMessage} Existing secure sessions open automatically.
            </div>
            <form onSubmit={login} className="space-y-4">
              <label className="block text-xs font-medium text-white/65">Email
                <input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} className="mt-2 h-11 w-full border border-white/15 bg-[#09090d] px-3 text-sm text-white outline-none focus:border-[#c9a96e]" />
              </label>
              <label className="block text-xs font-medium text-white/65">Password
                <input type="password" autoComplete="current-password" required minLength={8} value={password} onChange={event => setPassword(event.target.value)} className="mt-2 h-11 w-full border border-white/15 bg-[#09090d] px-3 text-sm text-white outline-none focus:border-[#c9a96e]" />
              </label>
              {error && <div role="alert" className="border-l-2 border-red-500 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</div>}
              {currentRole && (
                <div className="border-l-2 border-white/20 bg-white/5 px-3 py-2 text-xs leading-5 text-white/65">
                  Current role: <strong className="text-white">{currentRole}</strong>. Price Research accepts provisioned users. Review Queue accepts reviewer or admin. The Admin Panel accepts administrators only.
                </div>
              )}
              <button type="submit" disabled={loading || checkingSession} className="h-11 w-full bg-[#c9a96e] text-sm font-semibold text-[#09090d] transition-colors hover:bg-[#d4b87a] disabled:opacity-60">{checkingSession ? 'Checking existing access...' : loading ? 'Signing in...' : 'Sign in securely'}</button>
              {!adminEntry && <button type="button" onClick={continueAsGuest} className="h-11 w-full border border-white/20 bg-transparent text-sm font-semibold text-white/75 transition-colors hover:border-[#c9a96e] hover:text-white">Skip for Now</button>}
              {!adminEntry && <p className="text-center text-[11px] leading-5 text-white/40">Explore the public Workspace now. Posting, profile editing, saved activity, and transaction history remain unavailable until you sign in.</p>}
            </form>
            </> : <form onSubmit={applyForAccess} className="space-y-4">
              <div className="border-l-2 border-[#c9a96e] bg-[#c9a96e]/10 px-3 py-2 text-xs leading-5 text-[#ead7ae]">Apply once with the identity that should be stamped on future posts. Submission does not grant access automatically; Curated Luxury verifies the profile and phone before provisioning credentials.</div>
              <div className="grid gap-4 sm:grid-cols-2">
                <RegistrationInput name="display_name" label="Public display name" required />
                <RegistrationInput name="company_name" label="Company or dealer name" />
                <label className="block text-xs font-medium text-white/65">Account type<select name="account_type" required defaultValue="dealer" className="mt-2 h-11 w-full border border-white/15 bg-[#09090d] px-3 text-sm text-white"><option value="individual">Individual</option><option value="dealer">Dealer</option><option value="company">Company</option><option value="broker">Broker</option></select></label>
                <RegistrationInput name="email" label="Email" type="email" required />
                <RegistrationInput name="phone" label="Phone / WhatsApp" placeholder="+1 305 555 0101" required />
                <RegistrationInput name="city" label="City" required />
                <RegistrationInput name="country_code" label="Country code" placeholder="US" required maxLength={3} />
                <RegistrationInput name="timezone" label="Timezone" defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone} />
                <label className="block text-xs font-medium text-white/65">Preferred language<select name="preferred_language" required defaultValue="en" className="mt-2 h-11 w-full border border-white/15 bg-[#09090d] px-3 text-sm text-white"><option value="en">English</option><option value="es">Español</option><option value="pt">Português</option><option value="zh">简体中文</option></select></label>
                <RegistrationInput name="group_count" label="WhatsApp / Telegram groups" type="number" defaultValue="0" />
                <RegistrationInput name="website_url" label="Website" />
                <RegistrationInput name="telegram_username" label="Telegram username" />
              </div>
              <label className="block text-xs font-medium text-white/65">Dealer profile summary<textarea name="profile_summary" maxLength={1000} rows={4} className="mt-2 w-full border border-white/15 bg-[#09090d] p-3 text-sm text-white" /></label>
              <label className="flex items-start gap-3 text-xs leading-5 text-white/60"><input name="contact_consent" type="checkbox" required className="mt-1" /> I confirm these details may be used to verify, provision, and display my dealer posting profile.</label>
              {error && <div role="alert" className="border-l-2 border-red-500 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</div>}
              {applicationNotice && <div role="status" className="border-l-2 border-emerald-400 bg-emerald-400/10 px-3 py-2 text-xs leading-5 text-emerald-100">{applicationNotice}</div>}
              <button type="submit" disabled={loading} className="h-11 w-full bg-[#c9a96e] text-sm font-semibold text-[#09090d] disabled:opacity-60">{loading ? 'Submitting...' : 'Submit for verification'}</button>
            </form>}
          </section>
        </div>
      </div>
      </div>
      <Footer />
    </main>
  );
}

function RegistrationInput({ name, label, type = 'text', required = false, placeholder, defaultValue, maxLength = 200 }: { name: string; label: string; type?: string; required?: boolean; placeholder?: string; defaultValue?: string; maxLength?: number }) {
  return <label className="block text-xs font-medium text-white/65">{label}<input name={name} type={type} required={required} placeholder={placeholder} defaultValue={defaultValue} maxLength={maxLength} min={type === 'number' ? 0 : undefined} className="mt-2 h-11 w-full border border-white/15 bg-[#09090d] px-3 text-sm text-white outline-none focus:border-[#c9a96e]" /></label>;
}
