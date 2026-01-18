"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Event } from './types';

interface EventCacheData {
  events: Event[];
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

  // Save cache to sessionStorage whenever it changes
  useEffect(() => {
    if (cache.size > 0) {
      const cacheObj = Object.fromEntries(cache.entries());
      sessionStorage.setItem('eventCache', JSON.stringify(cacheObj));
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
