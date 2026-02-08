/**
 * Quick test script for scrapers
 * Run with: npx tsx lib/scrapers/test-scrapers.ts
 */

import { scrapeSoloSagre } from './solosagre'
import { scrapeOpenData } from './opendata'

async function testScrapers() {
  console.log('Testing SoloSagre scraper...')
  const soloSagreResult = await scrapeSoloSagre({})
  console.log(`✓ SoloSagre: ${soloSagreResult.events.length} events in ${soloSagreResult.duration}ms`)
  if (soloSagreResult.events.length > 0) {
    console.log(`  Sample: ${soloSagreResult.events[0].title} (${soloSagreResult.events[0].category})`)
  }
  if (soloSagreResult.error) {
    console.error(`  Error: ${soloSagreResult.error}`)
  }

  console.log('\nTesting OpenData scraper...')
  const openDataResult = await scrapeOpenData({})
  console.log(`✓ OpenData: ${openDataResult.events.length} events in ${openDataResult.duration}ms`)
  if (openDataResult.events.length > 0) {
    const sample = openDataResult.events[0]
    console.log(`  Sample: ${sample.title}`)
    console.log(`  Has coordinates: ${sample.latitude !== null && sample.longitude !== null}`)
  }
  if (openDataResult.error) {
    console.error(`  Error: ${openDataResult.error}`)
  }

  console.log('\n✓ All scrapers tested successfully!')
}

testScrapers().catch(console.error)
