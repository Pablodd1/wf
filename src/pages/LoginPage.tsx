/**
 * Login Page — Dealer Login
 * Supports: Email/Password, Google OAuth, Apple OAuth, Demo Skip
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { LogIn, Mail, Lock, Chrome, Apple, Shield, BarChart3 } from 'lucide-react';

function LightNavbar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-[60px] bg-white border-b border-gray-100 flex items-center justify-between px-6 md:px-10">
      <Link to="/" className="flex items-center">
        <img src="/watchfacts-logo.png" alt="WatchFacts" className="h-[28px] w-auto" />
      </Link>
      <nav className="flex items-center gap-6">
        <Link to="/reports" className="text-[11px] font-medium text-gray-600 hover:text-gray-900 uppercase tracking-[0.08em] transition-colors">Reports</Link>
        <a href="https://watchfacts.com/partners" target="_blank" rel="noopener noreferrer" className="text-[11px] font-medium text-gray-600 hover:text-gray-900 uppercase tracking-[0.08em] transition-colors">Partners</a>
        <a href="https://watchfacts.com/lux-fi" target="_blank" rel="noopener noreferrer" className="text-[11px] font-medium text-gray-600 hover:text-gray-900 uppercase tracking-[0.08em] transition-colors">Hire Fi</a>
      </nav>
    </header>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, loginWithGoogle, loginWithApple, loading, error, clearError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await login(email, password);
      navigate('/admin');
    } catch {
      // Error handled by auth hook
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA]">
      <LightNavbar />

      <div className="pt-[60px] min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-[420px]">
          {/* Logo */}
          <div className="text-center mb-8">
            <img src="/watchfacts-logo.png" alt="WatchFacts" className="h-8 mx-auto mb-4" />
            <h1 className="text-2xl font-semibold text-gray-900">Dealer Login</h1>
            <p className="text-sm text-gray-500 mt-1">Sign in to access your dashboard</p>
          </div>

          {/* Auth Card */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8">
            {/* OAuth Buttons */}
            <div className="space-y-3 mb-6">
              <button
                onClick={() => loginWithGoogle()}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <Chrome size={18} className="text-[#4285F4]" />
                Continue with Google
              </button>
              <button
                onClick={() => loginWithApple()}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-black text-white rounded-lg text-sm font-medium hover:bg-gray-900 transition-colors disabled:opacity-50"
              >
                <Apple size={18} />
                Continue with Apple
              </button>
            </div>

            {/* Divider */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white px-3 text-gray-400 uppercase tracking-wider">or</span>
              </div>
            </div>

            {/* Email/Password Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => { setEmail(e.target.value); clearError(); }}
                    placeholder="dealer@watchfacts.com"
                    required
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#3B5BFE] focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="password"
                    value={password}
                    onChange={e => { setPassword(e.target.value); clearError(); }}
                    placeholder="Enter your password"
                    required
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#3B5BFE] focus:border-transparent"
                  />
                </div>
              </div>

              {error && (
                <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3 bg-[#3B5BFE] hover:bg-[#4A6AFF] text-white font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                <LogIn size={16} />
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          </div>

          {/* Sign up link */}
          <p className="text-center text-sm text-gray-500 mt-6">
            Don't have an account?{' '}
            <Link to="/signup" className="text-[#3B5BFE] hover:underline font-medium">Sign up</Link>
          </p>

          {/* Skip Login for Demo/Internal Use */}
          <div className="mt-6 pt-6 border-t border-gray-100">
            <button
              onClick={() => {
                sessionStorage.setItem('wf_skip_auth', 'true');
                navigate('/admin');
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-sm font-medium transition-colors"
            >
              <Shield size={16} />
              Skip Login — Enter Dashboard
            </button>
            <p className="text-center text-[11px] text-gray-400 mt-2">
              Demo mode: read-only access. Sign in for full features.
            </p>
          </div>

          {/* Catalog Match Confidence Protocol */}
          <div className="mt-8 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <BarChart3 size={16} className="text-[#3B5BFE]" />
              Catalog Match Confidence Protocol
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] text-gray-500 uppercase tracking-wider border-b border-gray-100">
                    <th className="pb-2 pr-4">Catalog Match</th>
                    <th className="pb-2 pr-4">AI Intervention Needed</th>
                    <th className="pb-2 pr-4">Confidence Score</th>
                    <th className="pb-2">Action</th>
                  </tr>
                </thead>
                <tbody className="text-gray-600">
                  <tr className="border-b border-gray-50">
                    <td className="py-2.5 pr-4 font-medium text-green-600">Everything found in catalog</td>
                    <td className="py-2.5 pr-4 text-gray-500">None</td>
                    <td className="py-2.5 pr-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-mono font-semibold">100%</span>
                    </td>
                    <td className="py-2.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-medium">Auto-approve</span>
                    </td>
                  </tr>
                  <tr className="border-b border-gray-50">
                    <td className="py-2.5 pr-4 font-medium text-blue-600">1 thing missing (e.g., dial color)</td>
                    <td className="py-2.5 pr-4 text-gray-500">AI fills 1 gap</td>
                    <td className="py-2.5 pr-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-mono font-semibold">90%</span>
                    </td>
                    <td className="py-2.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">Review suggested</span>
                    </td>
                  </tr>
                  <tr className="border-b border-gray-50">
                    <td className="py-2.5 pr-4 font-medium text-amber-600">2 things missing (e.g., ref + dial)</td>
                    <td className="py-2.5 pr-4 text-gray-500">AI fills 2 gaps</td>
                    <td className="py-2.5 pr-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-mono font-semibold">80%</span>
                    </td>
                    <td className="py-2.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">Must review</span>
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-4 font-medium text-red-600">3+ things missing or garbage</td>
                    <td className="py-2.5 pr-4 text-gray-500">AI can&apos;t resolve</td>
                    <td className="py-2.5 pr-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-mono font-semibold">&lt;80%</span>
                    </td>
                    <td className="py-2.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">Manual intervention</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
