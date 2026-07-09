/**
 * Auth Hook — Supabase Auth with Google + Apple OAuth
 * Manages login state, user data, and authentication flows
 */
import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { supabase } from '@/lib/supabaseClient';

interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  avatar: string | null;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithApple: () => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true, error: null });

  // Check session on mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          setState({
            user: {
              id: session.user.id,
              email: session.user.email || null,
              name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || null,
              avatar: session.user.user_metadata?.avatar_url || null,
            },
            loading: false,
            error: null,
          });
        } else {
          setState(s => ({ ...s, loading: false }));
        }
      } catch {
        setState({ user: null, loading: false, error: null });
      }
    };

    checkSession();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setState({
          user: {
            id: session.user.id,
            email: session.user.email || null,
            name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || null,
            avatar: session.user.user_metadata?.avatar_url || null,
          },
          loading: false,
          error: null,
        });
      } else {
        setState({ user: null, loading: false, error: null });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setState(s => ({ ...s, loading: true, error: null }));
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setState(s => ({ ...s, loading: false, error: error.message }));
      throw error;
    }
    if (data.user) {
      setState({
        user: {
          id: data.user.id,
          email: data.user.email || null,
          name: data.user.user_metadata?.name || data.user.email?.split('@')[0] || null,
          avatar: data.user.user_metadata?.avatar_url || null,
        },
        loading: false,
        error: null,
      });
    }
  }, []);

  const signup = useCallback(async (email: string, password: string, name: string) => {
    setState(s => ({ ...s, loading: true, error: null }));
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    if (error) {
      setState(s => ({ ...s, loading: false, error: error.message }));
      throw error;
    }
    // Note: For email confirmation flow, user may need to confirm email
    if (data.user && !data.user.identities?.[0]?.identity_data?.email_verified) {
      setState(s => ({
        ...s,
        loading: false,
        error: null,
      }));
      // Return a signal that email confirmation is needed
      throw new Error('Please check your email to confirm your account.');
    }
    if (data.user) {
      setState({
        user: {
          id: data.user.id,
          email: data.user.email || null,
          name: data.user.user_metadata?.name || name || null,
          avatar: null,
        },
        loading: false,
        error: null,
      });
    }
  }, []);

  const loginWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/admin`,
      },
    });
    if (error) {
      setState(s => ({ ...s, error: error.message }));
      throw error;
    }
  }, []);

  const loginWithApple = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: {
        redirectTo: `${window.location.origin}/admin`,
      },
    });
    if (error) {
      setState(s => ({ ...s, error: error.message }));
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setState({ user: null, loading: false, error: null });
  }, []);

  const clearError = useCallback(() => {
    setState(s => ({ ...s, error: null }));
  }, []);

  return (
    <AuthContext.Provider value={{
      ...state,
      login,
      signup,
      loginWithGoogle,
      loginWithApple,
      logout,
      clearError,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/**
 * Safe variant of useAuth that returns null/empty when AuthProvider is not mounted.
 * Use in components that may render outside admin-protected routes (e.g. DealerNavbar).
 */
export function useSafeAuth() {
  const ctx = useContext(AuthContext);
  return ctx || { user: null, loading: false, error: null, login: async () => {}, logout: () => {}, signInWithGoogle: async () => {}, signInWithApple: async () => {} };
}

export { supabase };
