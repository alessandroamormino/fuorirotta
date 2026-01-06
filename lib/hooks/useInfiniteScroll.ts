import { useEffect, useRef, useCallback } from 'react'

/**
 * Custom hook per implementare infinite scroll con Intersection Observer
 * @param onLoadMore Callback da chiamare quando l'utente raggiunge il bottom
 * @param hasMore Flag che indica se ci sono altri dati da caricare
 * @param isLoading Flag che indica se il caricamento è in corso
 * @returns Ref da assegnare all'elemento trigger (div in fondo alla lista)
 */
export function useInfiniteScroll(
  onLoadMore: () => void,
  hasMore: boolean,
  isLoading: boolean
) {
  const observerTarget = useRef<HTMLDivElement>(null)

  const handleObserver = useCallback((entries: IntersectionObserverEntry[]) => {
    const [target] = entries

    // Trigger caricamento quando:
    // 1. L'elemento è visibile (isIntersecting)
    // 2. Ci sono ancora dati da caricare (hasMore)
    // 3. Non c'è già un caricamento in corso (isLoading)
    if (target.isIntersecting && hasMore && !isLoading) {
      onLoadMore()
    }
  }, [hasMore, isLoading, onLoadMore])

  useEffect(() => {
    const element = observerTarget.current
    if (!element) return

    const observer = new IntersectionObserver(handleObserver, {
      root: null, // Viewport come root
      rootMargin: '300px', // Inizia a caricare 300px prima di raggiungere il bottom
      threshold: 0.1 // Trigger quando almeno il 10% è visibile
    })

    observer.observe(element)

    return () => {
      if (element) observer.unobserve(element)
    }
  }, [handleObserver])

  return observerTarget
}
