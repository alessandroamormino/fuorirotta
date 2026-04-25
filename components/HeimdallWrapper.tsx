'use client'

import { HeimdallProvider } from 'heimdall-sdk'

export default function HeimdallWrapper({ children }: { children: React.ReactNode }) {
  return (
    <HeimdallProvider collectorUrl="http://localhost:3333" project="fuorirotta">
      {children}
    </HeimdallProvider>
  )
}
