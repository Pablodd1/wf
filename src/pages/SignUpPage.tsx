/**
 * Sign Up Page — Dealer Registration
 * Supports: Email/Password, Google OAuth, Apple OAuth
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { UserPlus, Mail, Lock, User, Chrome, Apple } from 'lucide-react';

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

export default function SignUpPage() {
  const navigate = useNavigate();
  const { signup, loginWithGoogle, loginWithApple, loading, error, clearError } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    if (password !== confirmPassword) {
      clearError();
      // We'll show this inline
      return;
    }

    try {
      await signup(email, password, name);
      setSuccess(true);
    } catch (err: any) {
      if (err.message?.includes('email to confirm')) {
        setSuccess(true);
      }
      // Other errors handled by hook
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-[#F8F9FA]">
        <LightNavbar />
        <div className="pt-[60px] min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-[420px] text-center">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mail size={28} className="text-green-600" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Check your email</h2>
              <p className="text-sm text-gray-500 mb-6">
                We've sent a confirmation link to <strong>{email}</strong>.<br />
                Click the link to verify your account.
              </p>
              <Link
                to="/login"
                className="inline-block px-6 py-2.5 bg-[#3B5BFE] text-white text-sm font-medium rounded-lg hover:bg-[#4A6AFF] transition-colors"
              >
                Go to Login
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA]">
      <LightNavbar />

      <div className="pt-[60px] min-h-screen flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-[420px]">
          {/* Logo */}
          <div className="text-center mb-8">
            <img src="/watchfacts-logo.png" alt="WatchFacts" className="h-8 mx-auto mb-4" />
            <h1 className="text-2xl font-semibold text-gray-900">Create Account</h1>
            <p className="text-sm text-gray-500 mt-1">Join WatchFacts as a dealer</p>
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

            {/* Sign Up Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name</label>
                <div className="relative">
                  <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={name}
                    onChange={e => { setName(e.target.value); clearError(); }}
                    placeholder="John Smith"
                    required
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#3B5BFE] focus:border-transparent"
                  />
                </div>
              </div>

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
                    placeholder="Min. 6 characters"
                    required
                    minLength={6}
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#3B5BFE] focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm Password</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={e => { setConfirmPassword(e.target.value); clearError(); }}
                    placeholder="Repeat your password"
                    required
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#3B5BFE] focus:border-transparent"
                  />
                </div>
                {password && confirmPassword && password !== confirmPassword && (
                  <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                )}
              </div>

              {error && (
                <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || !name || !email || !password || password !== confirmPassword}
                className="w-full flex items-center justify-center gap-2 py-3 bg-[#3B5BFE] hover:bg-[#4A6AFF] text-white font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                <UserPlus size={16} />
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
            </form>
          </div>

          {/* Login link */}
          <p className="text-center text-sm text-gray-500 mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-[#3B5BFE] hover:underline font-medium">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
