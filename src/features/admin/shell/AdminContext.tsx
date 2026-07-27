'use client';

import { createContext, useContext } from 'react';
import type { Profile } from '@/lib/db-types';

export interface AdminContextValue {
  profile: Profile;
  projectId: string | null;
  projectName: string;
  currency: 'USD' | 'BOB';
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({
  value,
  children,
}: {
  value: AdminContextValue;
  children: React.ReactNode;
}) {
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin debe usarse dentro de AdminProvider');
  return ctx;
}
