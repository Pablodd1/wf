/**
 * Protected Route — requires authentication to access
 * Redirects unauthenticated users to login page
 * Supports demo skip mode via sessionStorage (tab close = logout)
 */
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  // Check for demo skip mode (session-only, expires on tab close)
  const skipAuth = sessionStorage.getItem('wf_skip_auth') === 'true';

  const { user, loading } = useAuth();

  if (skipAuth) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0F]">
        <div className="w-8 h-8 border-2 border-[#D4AF37] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user && !skipAuth) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
