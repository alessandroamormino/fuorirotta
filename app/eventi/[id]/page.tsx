'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'
import { Event } from '@/lib/types'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import Navbar from '@/components/Navbar'
import { Calendar, MapPin, ExternalLink, Tag, ArrowLeft } from 'lucide-react'

const EventsMap = dynamic(() => import('@/components/EventsMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50 rounded-2xl">
      <div className="text-gray-500">Caricamento mappa...</div>
    </div>
  ),
})

interface SearchFilters {
  location: string
  dateFrom: Date | null
  dateTo: Date | null
}

export default function EventDetail() {
  const params = useParams()
  const router = useRouter()
  const [event, setEvent] = useState<Event | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (params.id) {
      fetchEvent(params.id as string)
    }
  }, [params.id])

  const fetchEvent = async (id: string) => {
    setLoading(true)
    try {
      const response = await fetch(`/api/events/${id}`)
      if (response.ok) {
        const data = await response.json()
        setEvent(data)
      } else {
        console.error('Event not found')
        router.push('/')
      }
    } catch (error) {
      console.error('Error fetching event:', error)
      router.push('/')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = (filters: SearchFilters) => {
    // Torna alla home con i nuovi filtri
    const params = new URLSearchParams()
    if (filters.location) params.append('location', filters.location)
    if (filters.dateFrom) params.append('dateFrom', filters.dateFrom.toISOString())
    if (filters.dateTo) params.append('dateTo', filters.dateTo.toISOString())

    router.push(`/?${params.toString()}`)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar onSearch={handleSearch} />
        <div className="fixed top-28 left-0 right-0 bottom-0 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-[#83c5be] border-t-[#006d77] rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-600">Caricamento evento...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar onSearch={handleSearch} />
        <div className="fixed top-28 left-0 right-0 bottom-0 flex items-center justify-center">
          <div className="text-center">
            <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Calendar className="w-10 h-10 text-gray-400" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Evento non trovato</h3>
            <p className="text-gray-600 mb-6">L'evento che stai cercando non esiste o è stato rimosso</p>
            <button
              onClick={() => router.push('/')}
              className="px-6 py-3 bg-gradient-to-r from-[#006d77] to-[#83c5be] text-white rounded-full font-semibold hover:shadow-lg transition-shadow"
            >
              Torna agli eventi
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navbar */}
      <Navbar onSearch={handleSearch} />

      {/* Main Content */}
      <main className="fixed top-28 left-0 right-0 bottom-0 overflow-y-auto scrollbar-thin">
        <div className="container mx-auto px-4 max-w-7xl">
          {/* Back Button */}
          <motion.button
            onClick={() => router.back()}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center hover:bg-gray-50 transition-colors border-2 border-[#83c5be]/30 mb-4 mt-4"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <ArrowLeft className="w-5 h-5 text-[#006d77]" />
          </motion.button>
        </div>

        <div className="container mx-auto px-4 max-w-7xl">
          {/* Hero Image */}
          {event.imageUrl ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full h-[400px] md:h-[500px] rounded-3xl overflow-hidden mb-8 shadow-2xl border-2 border-[#83c5be]/30"
            >
              <img
                src={event.imageUrl}
                alt={event.title}
                className="w-full h-full object-cover"
              />
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full h-[400px] md:h-[500px] rounded-3xl overflow-hidden mb-8 shadow-2xl border-2 border-[#83c5be]/30 bg-gradient-to-br from-[#edf6f9] via-[#83c5be]/20 to-[#006d77]/10 flex items-center justify-center"
            >
              <div className="flex flex-col items-center gap-6">
                <div className="w-32 h-32 rounded-full bg-[#006d77]/10 flex items-center justify-center">
                  <Calendar className="w-16 h-16 text-[#006d77]" />
                </div>
                <span className="text-2xl font-semibold text-[#006d77]/60">Evento</span>
              </div>
            </motion.div>
          )}

          {/* Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column - Main Info */}
            <div className="lg:col-span-2 space-y-6">
              {/* Category Badge */}
              {event.category && (
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 }}
                >
                  <span className="inline-flex items-center gap-2 px-4 py-2 bg-[#edf6f9] text-[#006d77] rounded-full text-sm font-semibold border-2 border-[#83c5be]/30">
                    <Tag className="w-4 h-4" />
                    {event.category}
                  </span>
                </motion.div>
              )}

              {/* Title */}
              <motion.h1
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
                className="text-4xl md:text-5xl font-bold text-gray-900 leading-tight"
              >
                {event.title}
              </motion.h1>

              {/* Info Cards */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="grid grid-cols-1 md:grid-cols-2 gap-4"
              >
                {/* Date Card */}
                <div className="bg-white rounded-2xl p-6 shadow-lg border-2 border-[#83c5be]/20 hover:border-[#006d77]/50 transition-all">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-full bg-[#edf6f9] flex items-center justify-center flex-shrink-0">
                      <Calendar className="w-6 h-6 text-[#006d77]" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-1">Data</h3>
                      <p className="text-sm text-gray-600">
                        {format(new Date(event.dateStart), "EEEE dd MMMM yyyy", { locale: it })}
                      </p>
                      {event.dateEnd && (
                        <p className="text-xs text-gray-500 mt-1">
                          Fino al {format(new Date(event.dateEnd), "dd MMMM yyyy", { locale: it })}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Location Card */}
                {event.locationName && (
                  <div className="bg-white rounded-2xl p-6 shadow-lg border-2 border-[#83c5be]/20 hover:border-[#006d77]/50 transition-all">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-full bg-[#edf6f9] flex items-center justify-center flex-shrink-0">
                        <MapPin className="w-6 h-6 text-[#006d77]" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900 mb-1">Luogo</h3>
                        <p className="text-sm text-gray-600">{event.locationName}</p>
                        {event.address && (
                          <p className="text-xs text-gray-500 mt-1">{event.address}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>

              {/* Description */}
              {event.description && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="bg-white rounded-2xl p-6 md:p-8 shadow-lg border-2 border-[#83c5be]/20"
                >
                  <h2 className="text-2xl font-bold text-gray-900 mb-4">Descrizione</h2>
                  <p className="text-gray-700 whitespace-pre-line leading-relaxed">
                    {event.description}
                  </p>
                </motion.div>
              )}
            </div>

            {/* Right Column - Map & Actions */}
            <div className="lg:col-span-1 space-y-6">
              {/* Map */}
              {event.latitude && event.longitude && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 }}
                  className="bg-white rounded-2xl p-4 shadow-lg border-2 border-[#83c5be]/20 sticky top-4"
                >
                  <h3 className="text-lg font-bold text-gray-900 mb-4">Dove si trova</h3>
                  <div className="h-[300px] rounded-xl overflow-hidden border-2 border-[#83c5be]/30">
                    <EventsMap events={[event]} disablePopups={true} />
                  </div>
                </motion.div>
              )}

              {/* External Link */}
              {event.sourceUrl && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 }}
                >
                  <a
                    href={event.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full px-6 py-4 bg-gradient-to-r from-[#006d77] to-[#83c5be] text-white font-semibold rounded-2xl shadow-lg hover:shadow-xl transition-all hover:scale-105"
                  >
                    Visita sito ufficiale
                    <ExternalLink className="w-5 h-5" />
                  </a>
                </motion.div>
              )}

              {/* Source Info */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.7 }}
                className="bg-white rounded-2xl p-4 shadow-lg border-2 border-[#83c5be]/20"
              >
                <p className="text-xs text-gray-500">Fonte: {event.source}</p>
              </motion.div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
