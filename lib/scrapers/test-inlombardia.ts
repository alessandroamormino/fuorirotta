/**
 * Test script for InLombardia scraper
 * Run with: npx tsx lib/scrapers/test-inlombardia.ts
 */

import { scrapeInLombardia } from './inlombardia'

async function testInLombardia() {
  console.log('Testing InLombardia scraper with AJAX pagination...')
  const result = await scrapeInLombardia({})

  console.log(`✓ InLombardia: ${result.events.length} events in ${result.duration}ms`)

  if (result.error) {
    console.error(`  Error: ${result.error}`)
  }

  if (result.events.length > 0) {
    const sample = result.events[0]
    console.log(`\nSample event:`)
    console.log(`  Title: ${sample.title}`)
    console.log(`  Location: ${sample.locationName}`)
    console.log(`  Category: ${sample.category}`)
    console.log(`  Date: ${sample.dateStart.toISOString().split('T')[0]}`)
    console.log(`  Source: ${sample.source}`)
  }

  console.log('\n✓ InLombardia scraper tested successfully!')
}

testInLombardia().catch(console.error)
