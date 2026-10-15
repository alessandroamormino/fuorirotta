"use client";

import { createContext, useContext, useRef, ReactNode } from 'react';
import { Event } from './types';

interface EventCacheData {
  events: Event[];
  mapEvents?: Event[];
  total: number;
  timestamp: number;
  query: string;
}

interface EventCacheContextType {
  getCachedEvents: (queryKey: string) => EventCacheData | null;
  setCachedEvents: (queryKey: string, data: Omit<EventCacheData, 'timestamp'>) => void;
  clearCache: () => void;
}

const EventCacheContext = createContext<EventCacheContextType | undefined>(undefined);

const CACHE_DURATION = 5 * 60 * 1000; // 5 minuti

export function EventCacheProvider({ children }: { children: ReactNode }) {
  // Un ref e non uno stato: la cache non si disegna, si consulta. Da stato,
  // ogni scrittura ridisegnava tutti i consumer del context; e il caricamento
  // da sessionStorage stava in un effect del provider, che React esegue DOPO
  // quelli dei figli — al primo mount HomeClient la trovava sempre vuota.
  // Ora si carica alla prima lettura, sempre lato client (handler ed effect).
  const cacheRef = useRef<Map<string, EventCacheData> | null>(null);

  const cache = (): Map<string, EventCacheData> => {
    if (cacheRef.current === null) {
      cacheRef.current = new Map();
      try {
        const savedCache = sessionStorage.getItem('eventCache');
        if (savedCache) cacheRef.current = new Map(Object.entries(JSON.parse(savedCache)));
      } catch (e) {
        console.error('Failed to load cache:', e);
      }
    }
    return cacheRef.current;
  };

  // Il try/catch non e' difensivo per abitudine: senza, un
  // QuotaExceededError su setItem esce dal chiamante e React porta giu'
  // l'intera pagina con "Application error: a client-side exception has
  // occurred" — schermata bianca, niente lista, niente mappa.
  // Riprodotto in Chrome il 2026-09-20 sul catalogo locale post-Alto Adige
  // (~19.000 eventi futuri): la quota di sessionStorage e' ~5MB per origine
  // e un paio di risposte con i mapEvents al completo la saturano.
  // La cache e' solo un'ottimizzazione: se non ci sta, si butta via e si
  // rifa' un fetch. Sempre meglio di una pagina bianca.
  const persist = () => {
    try {
      sessionStorage.setItem('eventCache', JSON.stringify(Object.fromEntries(cache().entries())));
    } catch (e) {
      console.warn('[EventCache] cache non salvata, si prosegue senza:', e);
      try { sessionStorage.removeItem('eventCache'); } catch { /* niente da fare */ }
    }
  };

  const getCachedEvents = (queryKey: string): EventCacheData | null => {
    const cached = cache().get(queryKey);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > CACHE_DURATION) {
      cache().delete(queryKey);
      persist();
      return null;
    }

    return cached;
  };

  const setCachedEvents = (queryKey: string, data: Omit<EventCacheData, 'timestamp'>) => {
    cache().set(queryKey, { ...data, timestamp: Date.now() });
    persist();
  };

  const clearCache = () => {
    cacheRef.current = new Map();
    try { sessionStorage.removeItem('eventCache'); } catch { /* niente da fare */ }
  };

  return (
    <EventCacheContext.Provider value={{ getCachedEvents, setCachedEvents, clearCache }}>
      {children}
    </EventCacheContext.Provider>
  );
}

export function useEventCache() {
  const context = useContext(EventCacheContext);
  if (!context) {
    throw new Error('useEventCache must be used within EventCacheProvider');
  }
  return context;
}
