/**
 * Final verification test for all scrapers
 * Run with: npx tsx lib/scrapers/test-all-scrapers.ts
 */

import { scrapeSoloSagre, scrapeOpenData, scrapeInLombardia } from './index'

async function verifyAllScrapers() {
  console.log('=== Final Verification: All Scrapers ===\n')

  // Test 1: SoloSagre returns events with Sagra category
  console.log('1. Testing scrapeSoloSagre()...')
  const soloSagreResult = await scrapeSoloSagre({})
  const hasSoloSagreEvents = soloSagreResult.events.length > 0
  const hasSagraCategory = soloSagreResult.events.every(e => e.category === 'Sagra')
  console.log(`   ✓ Returns ${soloSagreResult.events.length} events`)
  console.log(`   ✓ All events have 'Sagra' category: ${hasSagraCategory}`)
  console.log(`   ✓ Sample: ${soloSagreResult.events[0]?.title || 'N/A'}`)

  // Test 2: OpenData returns events with coordinates
  console.log('\n2. Testing scrapeOpenData()...')
  const openDataResult = await scrapeOpenData({})
  const hasOpenDataEvents = openDataResult.events.length > 0
  const eventsWithCoords = openDataResult.events.filter(e => e.latitude !== null && e.longitude !== null)
  console.log(`   ✓ Returns ${openDataResult.events.length} events`)
  console.log(`   ✓ Events with coordinates: ${eventsWithCoords.length}`)
  console.log(`   ✓ Sample: ${openDataResult.events[0]?.title || 'N/A'}`)

  // Test 3: InLombardia returns paginated events
  console.log('\n3. Testing scrapeInLombardia()...')
  const inLombardiaResult = await scrapeInLombardia({})
  const hasInLombardiaEvents = inLombardiaResult.events.length > 0
  console.log(`   ✓ Returns ${inLombardiaResult.events.length} events`)
  console.log(`   ✓ Sample: ${inLombardiaResult.events[0]?.title || 'N/A'}`)

  // Test 4: All events have required fields
  console.log('\n4. Checking required fields...')
  const allEvents = [
    ...soloSagreResult.events,
    ...openDataResult.events,
    ...inLombardiaResult.events
  ]
  const allHaveSource = allEvents.every(e => e.source && e.source.length > 0)
  const allHaveSourceId = allEvents.every(e => e.sourceId && e.sourceId.length > 0)
  const allHaveTitle = allEvents.every(e => e.title && e.title.length > 0)
  const allHaveDateStart = allEvents.every(e => e.dateStart instanceof Date)
  console.log(`   ✓ All have source: ${allHaveSource}`)
  console.log(`   ✓ All have sourceId: ${allHaveSourceId}`)
  console.log(`   ✓ All have title: ${allHaveTitle}`)
  console.log(`   ✓ All have dateStart: ${allHaveDateStart}`)

  // Final verdict
  const allTestsPassed =
    hasSoloSagreEvents &&
    hasSagraCategory &&
    hasOpenDataEvents &&
    eventsWithCoords.length > 0 &&
    hasInLombardiaEvents &&
    allHaveSource &&
    allHaveSourceId &&
    allHaveTitle &&
    allHaveDateStart

  console.log('\n=== Verification Result ===')
  console.log(allTestsPassed ? '✓ ALL SUCCESS CRITERIA MET!' : '✗ Some tests failed')
  console.log(`Total events from all sources: ${allEvents.length}`)
}

verifyAllScrapers().catch(console.error)
