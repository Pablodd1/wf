import { type ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

interface DealerGateProps {
  children: ReactNode;
  allowedRoles?: Array<'dealer' | 'reviewer' | 'admin'>;
}

export function DealerGate({ children, allowedRoles }: DealerGateProps) {
  const location = useLocation();
  const [state, setState] = useState<'loading' | 'authorized' | 'denied'>('loading');

  useEffect(() => {
    if (state === 'authorized') return;
    const controller = new AbortController();
    fetch('/api/dealer-auth', { credentials: 'include', signal: controller.signal })
      .then(async response => {
        const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
        const roleAllowed = !allowedRoles?.length || allowedRoles.includes(result?.user?.role);
        setState(response.ok && result?.authenticated === true && roleAllowed ? 'authorized' : 'denied');
      })
      .catch(error => {
        if (error?.name !== 'AbortError') setState('denied');
      });
    return () => controller.abort();
  }, [allowedRoles, state]);

  if (state === 'loading') {
    return <div className="flex min-h-screen items-center justify-center bg-bg-primary text-sm text-text-secondary">Checking dealer session...</div>;
  }
  if (state === 'denied') {
    const loginPath = allowedRoles?.length && !allowedRoles.includes('dealer') ? '/cl-login' : '/dealer';
    return <Navigate to={loginPath} replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return children;
}
