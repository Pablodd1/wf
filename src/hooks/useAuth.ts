import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { supabase } from '@/lib/supabaseClient';

interface User {
  id: string;
  email: string;
  name?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithApple: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  error: null,
  login: async () => {},
  signup: async () => {},
  logout: async () => {},
  loginWithGoogle: async () => {},
  loginWithApple: async () => {},
  clearError: () => {},
});

/**
 * Auth Provider -- wraps the app with authentication state.
 * Integrates with Supabase Auth for session management.
 * Supports: Email/Password, Google OAuth, Apple OAuth.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check for existing session on mount
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        setUser({
          id: data.session.user.id,
          email: data.session.user.email || '',
          name: data.session.user.user_metadata?.name || '',
        });
      }
      setLoading(false);
    });

    // Listen for auth state changes (login, logout, token refresh)
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email || '',
          name: session.user.user_metadata?.name || '',
        });
      } else {
        setUser(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const clearError = () => setError(null);

  const login = async (email: string, password: string) => {
    clearError();
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setError(err.message);
      throw err;
    }
  };

  const signup = async (email: string, password: string, name?: string) => {
    clearError();
    const { error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name: name || '' } },
    });
    if (err) {
      setError(err.message);
      throw err;
    }
  };

  const logout = async () => {
    clearError();
    await supabase.auth.signOut();
    setUser(null);
  };

  const loginWithGoogle = async () => {
    clearError();
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/#/admin` },
    });
    if (err) {
      setError(err.message);
      throw err;
    }
  };

  const loginWithApple = async () => {
    clearError();
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: `${window.location.origin}/#/admin` },
    });
    if (err) {
      setError(err.message);
      throw err;
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, error, login, signup, logout, loginWithGoogle, loginWithApple, clearError }}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to access auth context. Must be used inside AuthProvider.
 */
export function useAuth() {
  return useContext(AuthContext);
}
