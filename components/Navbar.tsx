'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { it } from 'date-fns/locale'
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isToday, startOfWeek, endOfWeek } from 'date-fns'
import Link from 'next/link'

interface NavbarProps {
  onSearch: (filters: SearchFilters) => void
}

interface SearchFilters {
  location: string
  dateFrom: Date | null
  dateTo: Date | null
  radius?: number
}

type ActiveField = 'where' | 'when'

const SUGGESTED_DESTINATIONS = [
  { name: 'Nelle vicinanze', subtitle: 'Destinazioni vicine a te', icon: 'nearby', isNearby: true },
  { name: 'Milano', subtitle: 'Capitale lombarda', icon: 'city' },
  { name: 'Bergamo', subtitle: 'Città alta', icon: 'castle' },
  { name: 'Brescia', subtitle: 'Leonessa d\'Italia', icon: 'monument' },
  { name: 'Como', subtitle: 'Città dei laghi', icon: 'lake' },
  { name: 'Cremona', subtitle: 'Città dei violini', icon: 'music' },
  { name: 'Lecco', subtitle: 'Tra lago e montagne', icon: 'mountain' },
  { name: 'Lodi', subtitle: 'Città storica', icon: 'castle' },
  { name: 'Mantova', subtitle: 'Città d\'arte', icon: 'monument' },
  { name: 'Monza', subtitle: 'Città della corona', icon: 'city' },
  { name: 'Pavia', subtitle: 'Università storica', icon: 'monument' },
  { name: 'Sondrio', subtitle: 'Porta della Valtellina', icon: 'mountain' },
  { name: 'Varese', subtitle: 'Città giardino', icon: 'lake' },
]

const RADIUS_OPTIONS = [
  { value: 10, label: '10 km', subtitle: 'Vicinissimo' },
  { value: 20, label: '20 km', subtitle: 'Nelle vicinanze' },
  { value: 50, label: '50 km', subtitle: 'Zona estesa' },
]

export default function Navbar({ onSearch }: NavbarProps) {
  const [activeField, setActiveField] = useState<ActiveField | null>(null)
  const [filters, setFilters] = useState<SearchFilters>({
    location: '',
    dateFrom: null,
    dateTo: null,
  })
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [hoveredDate, setHoveredDate] = useState<Date | null>(null)
  const searchBarRef = useRef<HTMLDivElement>(null)
  const [searchInput, setSearchInput] = useState('')
  const [showRadiusSelector, setShowRadiusSelector] = useState(false)
  const [selectedRadius, setSelectedRadius] = useState<number | null>(null)
  const [customRadius, setCustomRadius] = useState(30)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchBarRef.current && !searchBarRef.current.contains(event.target as Node)) {
        setActiveField(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSearch = () => {
    onSearch({
      ...filters,
      radius: selectedRadius || undefined
    })
    setActiveField(null)
  }

  const handleClearSearch = () => {
    setFilters({ location: '', dateFrom: null, dateTo: null, radius: undefined })
    setSearchInput('')
    setSelectedRadius(null)
    setActiveField(null)
    onSearch({ location: '', dateFrom: null, dateTo: null, radius: undefined })
  }

  const handleDateSelect = (date: Date) => {
    if (!filters.dateFrom || (filters.dateFrom && filters.dateTo)) {
      setFilters({ ...filters, dateFrom: date, dateTo: null })
    } else {
      if (date < filters.dateFrom) {
        setFilters({ ...filters, dateFrom: date, dateTo: filters.dateFrom })
      } else {
        setFilters({ ...filters, dateTo: date })
      }
    }
  }

  const isDateInRange = (date: Date) => {
    if (!filters.dateFrom) return false
    if (!filters.dateTo && !hoveredDate) return isSameDay(date, filters.dateFrom)
    const endDate = filters.dateTo || hoveredDate
    if (!endDate) return isSameDay(date, filters.dateFrom)
    return date >= filters.dateFrom && date <= endDate
  }

  const isDateRangeStart = (date: Date) => filters.dateFrom && isSameDay(date, filters.dateFrom)
  const isDateRangeEnd = (date: Date) => filters.dateTo && isSameDay(date, filters.dateTo)

  const getDaysInMonth = () => {
    const start = startOfWeek(startOfMonth(currentMonth), { locale: it })
    const end = endOfWeek(endOfMonth(currentMonth), { locale: it })
    return eachDayOfInterval({ start, end })
  }

  const getIconForDestination = (iconType: string) => {
    switch (iconType) {
      case 'nearby': return '📍'
      case 'city': return '🏙️'
      case 'castle': return '🏰'
      case 'lake': return '🏞️'
      case 'monument': return '🏛️'
      case 'music': return '🎵'
      case 'mountain': return '⛰️'
      default: return '📍'
    }
  }

  const hasActiveFilters = filters.location || filters.dateFrom || filters.dateTo

  return (
    <nav className="fixed top-5 left-0 right-0 z-50 px-4 py-4">
      <div className="container mx-auto">
        <div className="flex items-center justify-center gap-8">
          {/* Logo - Outside the glass box */}
          <div className="absolute left-15">
            <Link href="/">
              <motion.div
                className="flex items-center space-x-2 cursor-pointer"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {/* <div className="w-10 h-10 bg-gradient-to-br from-[#006d77] to-[#83c5be] rounded-xl flex items-center justify-center shadow-lg">
                  <span className="text-white font-bold text-xl">F</span>
                </div> */}
                <span className="text-2xl font-bold text-[#006d77]">
                  Fuorirotta
                </span>
              </motion.div>
            </Link>
          </div>

          {/* Search Bar - Glass box - Centered */}
          <div ref={searchBarRef} className="w-full max-w-3xl relative">
            {/* Glass Search Bar */}
            <div className="w-full flex items-center bg-white/90 backdrop-blur-md border border-white/40 rounded-full shadow-lg hover:shadow-xl transition-all px-2 relative">
                  {/* Where Field */}
                  <div className="flex-1 relative">
                    <div
                      onClick={() => setActiveField('where')}
                      className="px-4 sm:px-6 py-2 sm:py-3 rounded-full cursor-pointer transition-all hover:bg-white/50"
                    >
                      <label className="text-[10px] sm:text-xs font-semibold text-gray-900 block mb-0.5">Dove</label>
                      <input
                        type="text"
                        placeholder="Cerca destinazioni"
                        value={searchInput}
                        onChange={(e) => {
                          setSearchInput(e.target.value)
                          setFilters({ ...filters, location: e.target.value })
                        }}
                        className="w-full text-xs sm:text-sm outline-none bg-transparent text-gray-700 placeholder-gray-400"
                        onFocus={() => setActiveField('where')}
                      />
                    </div>
                    {activeField === 'where' && (
                      <motion.div
                        layoutId="activeRing"
                        className="absolute inset-x-0 top-2 bottom-2 rounded-full ring-2 ring-[#006d77] pointer-events-none"
                        transition={{
                          type: 'spring',
                          stiffness: 500,
                          damping: 40,
                        }}
                      />
                    )}
                  </div>

                  <div className="w-px h-8 bg-white/30" />

                  {/* When Field */}
                  <div className="flex-1 relative">
                    <div
                      onClick={() => setActiveField('when')}
                      className="px-4 sm:px-6 py-2 sm:py-3 rounded-full cursor-pointer transition-all hover:bg-white/50"
                    >
                      <label className="text-[10px] sm:text-xs font-semibold text-gray-900 block mb-0.5">Date</label>
                      <div className="text-xs sm:text-sm text-gray-400 truncate">
                        {filters.dateFrom && filters.dateTo
                          ? `${format(filters.dateFrom, 'd MMM', { locale: it })} - ${format(filters.dateTo, 'd MMM', { locale: it })}`
                          : 'Aggiungi date'}
                      </div>
                    </div>
                    {activeField === 'when' && (
                      <motion.div
                        layoutId="activeRing"
                        className="absolute inset-x-0 top-2 bottom-2 rounded-full ring-2 ring-[#006d77] pointer-events-none"
                        transition={{
                          type: 'spring',
                          stiffness: 500,
                          damping: 40,
                        }}
                      />
                    )}
                  </div>

                  {/* Clear & Search Buttons */}
                  <div className="flex items-center gap-2 pr-2 pl-3">
                    {hasActiveFilters && (
                      <motion.button
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={handleClearSearch}
                        className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors"
                      >
                        Cancella
                      </motion.button>
                    )}
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={handleSearch}
                      className="w-12 h-12 bg-[#006d77] hover:bg-[#00565e] rounded-full flex items-center justify-center transition-colors"
                    >
                      <Search className="w-5 h-5 text-white" />
                    </motion.button>
                  </div>
                </div>

            {/* Dropdown Content - Airbnb style sliding */}
            {activeField !== null && (
              <motion.div
                layout
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{
                  layout: { type: 'spring', damping: 30, stiffness: 400 },
                  opacity: { duration: 0.2 }
                }}
                className={`absolute top-full mt-4 bg-white/95 backdrop-blur-md rounded-3xl shadow-2xl border border-white/30 overflow-hidden
                  ${activeField === 'where' ? 'left-0 right-0 sm:left-0 sm:right-auto sm:w-[500px]' : 'left-0 right-0 sm:left-auto sm:right-0 sm:w-[700px]'}
                `}
              >
                <AnimatePresence mode="wait">
                  {/* Where Dropdown */}
                  {activeField === 'where' && !showRadiusSelector && (
                    <motion.div
                      key="where"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.2 }}
                      className="p-4 sm:p-8"
                    >
                      <h3 className="text-xs sm:text-sm font-semibold text-gray-900 mb-4 sm:mb-6">Destinazioni suggerite</h3>
                      <div className="grid grid-cols-1 gap-4 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin">
                        {SUGGESTED_DESTINATIONS.map((dest) => (
                          <motion.button
                            key={dest.name}
                            whileHover={{ backgroundColor: '#f7f7f7' }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => {
                              if (dest.isNearby) {
                                setShowRadiusSelector(true)
                              } else {
                                setSearchInput(dest.name)
                                setFilters({ ...filters, location: dest.name })
                                setActiveField('when')
                              }
                            }}
                            className="flex items-center gap-3 sm:gap-4 p-2 sm:p-3 rounded-xl hover:bg-gray-50 transition-all text-left"
                          >
                            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gray-100 rounded-lg flex items-center justify-center text-xl sm:text-2xl flex-shrink-0">
                              {getIconForDestination(dest.icon)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-gray-900 text-sm sm:text-base truncate">{dest.name}</div>
                              <div className="text-xs sm:text-sm text-gray-500 truncate">{dest.subtitle}</div>
                            </div>
                          </motion.button>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {/* Radius Selector */}
                  {activeField === 'where' && showRadiusSelector && (
                    <motion.div
                      key="radius"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.2 }}
                      className="p-4 sm:p-8"
                    >
                      <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
                        <motion.button
                          onClick={() => setShowRadiusSelector(false)}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          className="w-7 h-7 sm:w-8 sm:h-8 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors"
                        >
                          <svg className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                          </svg>
                        </motion.button>
                        <h3 className="text-xs sm:text-sm font-semibold text-gray-900">Seleziona il raggio</h3>
                      </div>
                      <div className="grid grid-cols-1 gap-4">
                        {RADIUS_OPTIONS.map((radius) => (
                          <motion.button
                            key={radius.value}
                            whileHover={{ backgroundColor: '#f7f7f7' }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => {
                              setSelectedRadius(radius.value)
                              setSearchInput(`Nelle vicinanze (${radius.label})`)
                              setFilters({ ...filters, location: `Nelle vicinanze (${radius.label})` })
                              setShowRadiusSelector(false)
                              setActiveField('when')
                            }}
                            className="flex items-center gap-3 sm:gap-4 p-2 sm:p-3 rounded-xl hover:bg-gray-50 transition-all text-left"
                          >
                            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gray-100 rounded-lg flex items-center justify-center text-xl sm:text-2xl flex-shrink-0">
                              📍
                            </div>
                            <div className="flex-1">
                              <div className="font-medium text-gray-900 text-sm sm:text-base">{radius.label}</div>
                              <div className="text-xs sm:text-sm text-gray-500">{radius.subtitle}</div>
                            </div>
                          </motion.button>
                        ))}

                        {/* Custom Radius Option */}
                        <div className="border-t pt-3 sm:pt-4 mt-2">
                          <div className="p-3 sm:p-4 rounded-xl bg-gray-50">
                            <div className="flex items-center justify-between mb-3 sm:mb-4">
                              <div className="font-medium text-gray-900 text-sm sm:text-base">Distanza personalizzata</div>
                              <div className="text-xl sm:text-2xl font-bold text-[#006d77]">{customRadius} km</div>
                            </div>

                            {/* Slider */}
                            <div className="mb-4">
                              <input
                                type="range"
                                min="5"
                                max="200"
                                step="5"
                                value={customRadius}
                                onChange={(e) => setCustomRadius(Number(e.target.value))}
                                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                                style={{
                                  background: `linear-gradient(to right, #006d77 0%, #006d77 ${((customRadius - 5) / 195) * 100}%, #e5e7eb ${((customRadius - 5) / 195) * 100}%, #e5e7eb 100%)`
                                }}
                              />
                              <div className="flex justify-between text-xs text-gray-500 mt-1">
                                <span>5 km</span>
                                <span>200 km</span>
                              </div>
                            </div>

                            <motion.button
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => {
                                setSelectedRadius(customRadius)
                                setSearchInput(`Nelle vicinanze (${customRadius} km)`)
                                setFilters({ ...filters, location: `Nelle vicinanze (${customRadius} km)` })
                                setShowRadiusSelector(false)
                                setActiveField('when')
                              }}
                              className="w-full px-4 py-2 bg-gradient-to-r from-[#006d77] to-[#83c5be] text-white font-semibold rounded-lg hover:shadow-lg transition-all"
                            >
                              Applica
                            </motion.button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* When Dropdown - Custom Calendar */}
                  {activeField === 'when' && (
                    <motion.div
                      key="when"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      transition={{ duration: 0.2 }}
                      className="p-4 sm:p-8"
                    >
                      <div className="flex flex-col sm:flex-row gap-4 sm:gap-8">
                        {/* Calendar Month 1 */}
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-4">
                            <button
                              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                            >
                              <ChevronLeft className="w-5 h-5" />
                            </button>
                            <h3 className="font-bold text-gray-900 text-sm sm:text-base">
                              {format(currentMonth, 'MMMM yyyy', { locale: it })}
                            </h3>
                            <button
                              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                              className="p-2 hover:bg-gray-100 rounded-full transition-colors sm:hidden"
                            >
                              <ChevronRight className="w-5 h-5" />
                            </button>
                            <div className="w-9 hidden sm:block" />
                          </div>

                          {/* Calendar Grid */}
                          <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
                            {['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((day, i) => (
                              <div key={i} className="text-center text-[10px] sm:text-xs font-semibold text-gray-500 py-1 sm:py-2">
                                {day}
                              </div>
                            ))}
                            {getDaysInMonth().map((date, i) => {
                              const inRange = isDateInRange(date)
                              const isStart = isDateRangeStart(date)
                              const isEnd = isDateRangeEnd(date)
                              const isCurrentMonth = isSameMonth(date, currentMonth)
                              const isPast = date < new Date() && !isToday(date)

                              return (
                                <motion.button
                                  key={i}
                                  whileHover={isCurrentMonth && !isPast ? { scale: 1.1 } : {}}
                                  onClick={() => isCurrentMonth && !isPast && handleDateSelect(date)}
                                  onMouseEnter={() => isCurrentMonth && !isPast && setHoveredDate(date)}
                                  onMouseLeave={() => setHoveredDate(null)}
                                  disabled={!isCurrentMonth || isPast}
                                  className={`
                                    aspect-square flex items-center justify-center text-xs sm:text-sm rounded-full transition-all relative
                                    ${!isCurrentMonth ? 'text-gray-300' : ''}
                                    ${isPast ? 'text-gray-300 cursor-not-allowed' : ''}
                                    ${isStart || isEnd ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold' : ''}
                                    ${inRange && !isStart && !isEnd ? 'bg-blue-100' : ''}
                                    ${!inRange && !isPast && isCurrentMonth ? 'hover:bg-gray-100' : ''}
                                    ${isToday(date) && !isStart && !isEnd ? 'border-2 border-blue-600' : ''}
                                  `}
                                >
                                  {format(date, 'd')}
                                </motion.button>
                              )
                            })}
                          </div>
                        </div>

                        {/* Calendar Month 2 */}
                        <div className="flex-1 hidden sm:block">
                          <div className="flex items-center justify-between mb-4">
                            <div className="w-9" />
                            <h3 className="font-bold text-gray-900">
                              {format(addMonths(currentMonth, 1), 'MMMM yyyy', { locale: it })}
                            </h3>
                            <button
                              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                            >
                              <ChevronRight className="w-5 h-5" />
                            </button>
                          </div>

                          <div className="grid grid-cols-7 gap-1">
                            {['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((day, i) => (
                              <div key={i} className="text-center text-xs font-semibold text-gray-500 py-2">
                                {day}
                              </div>
                            ))}
                            {eachDayOfInterval({
                              start: startOfWeek(startOfMonth(addMonths(currentMonth, 1)), { locale: it }),
                              end: endOfWeek(endOfMonth(addMonths(currentMonth, 1)), { locale: it }),
                            }).map((date, i) => {
                              const inRange = isDateInRange(date)
                              const isStart = isDateRangeStart(date)
                              const isEnd = isDateRangeEnd(date)
                              const isCurrentMonth = isSameMonth(date, addMonths(currentMonth, 1))
                              const isPast = date < new Date() && !isToday(date)

                              return (
                                <motion.button
                                  key={i}
                                  whileHover={isCurrentMonth && !isPast ? { scale: 1.1 } : {}}
                                  onClick={() => isCurrentMonth && !isPast && handleDateSelect(date)}
                                  onMouseEnter={() => isCurrentMonth && !isPast && setHoveredDate(date)}
                                  onMouseLeave={() => setHoveredDate(null)}
                                  disabled={!isCurrentMonth || isPast}
                                  className={`
                                    aspect-square flex items-center justify-center text-sm rounded-full transition-all
                                    ${!isCurrentMonth ? 'text-gray-300' : ''}
                                    ${isPast ? 'text-gray-300 cursor-not-allowed' : ''}
                                    ${isStart || isEnd ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold' : ''}
                                    ${inRange && !isStart && !isEnd ? 'bg-blue-100' : ''}
                                    ${!inRange && !isPast && isCurrentMonth ? 'hover:bg-gray-100' : ''}
                                    ${isToday(date) && !isStart && !isEnd ? 'border-2 border-blue-600' : ''}
                                  `}
                                >
                                  {format(date, 'd')}
                                </motion.button>
                              )
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Clear Dates Button */}
                      {(filters.dateFrom || filters.dateTo) && (
                        <div className="mt-6 flex justify-end">
                          <button
                            onClick={() => setFilters({ ...filters, dateFrom: null, dateTo: null })}
                            className="text-sm font-semibold text-gray-600 hover:text-gray-900 underline"
                          >
                            Cancella date
                          </button>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
