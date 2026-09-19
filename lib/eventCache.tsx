"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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
  const [cache, setCache] = useState<Map<string, EventCacheData>>(new Map());

  // Load cache from sessionStorage on mount
  useEffect(() => {
    const savedCache = sessionStorage.getItem('eventCache');
    if (savedCache) {
      try {
        const parsed = JSON.parse(savedCache);
        setCache(new Map(Object.entries(parsed)));
      } catch (e) {
        console.error('Failed to load cache:', e);
      }
    }
  }, []);

  // Save cache to sessionStorage whenever it changes.
  //
  // Il try/catch non e' difensivo per abitudine: senza, un
  // QuotaExceededError su setItem esce da questo effect e React porta giu'
  // l'intera pagina con "Application error: a client-side exception has
  // occurred" — schermata bianca, niente lista, niente mappa. Il ramo di
  // lettura sopra si proteggeva gia'; la scrittura no.
  // Riprodotto in Chrome il 2026-09-20 sul catalogo locale post-Alto Adige
  // (~19.000 eventi futuri): la quota di sessionStorage e' ~5MB per origine
  // e un paio di risposte con i mapEvents al completo la saturano. Con i
  // ~1.700 eventi di produzione capitava di rado; dopo il rilascio della
  // Fase 19 diventerebbe ordinario.
  // La cache e' solo un'ottimizzazione: se non ci sta, si butta via e si
  // rifa' un fetch. Sempre meglio di una pagina bianca.
  useEffect(() => {
    if (cache.size === 0) return;
    try {
      sessionStorage.setItem('eventCache', JSON.stringify(Object.fromEntries(cache.entries())));
    } catch (e) {
      console.warn('[EventCache] cache non salvata, si prosegue senza:', e);
      try { sessionStorage.removeItem('eventCache'); } catch { /* niente da fare */ }
    }
  }, [cache]);

  const getCachedEvents = (queryKey: string): EventCacheData | null => {
    const cached = cache.get(queryKey);
    if (!cached) return null;

    const now = Date.now();
    if (now - cached.timestamp > CACHE_DURATION) {
      // Cache expired
      setCache(prev => {
        const newCache = new Map(prev);
        newCache.delete(queryKey);
        return newCache;
      });
      return null;
    }

    return cached;
  };

  const setCachedEvents = (queryKey: string, data: Omit<EventCacheData, 'timestamp'>) => {
    setCache(prev => new Map(prev).set(queryKey, {
      ...data,
      timestamp: Date.now()
    }));
  };

  const clearCache = () => {
    setCache(new Map());
    sessionStorage.removeItem('eventCache');
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
