import React from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import './src/nativewind-env'
import RootApp from './src/navigation/AppNavigator'

export default function App() {
  return (
    <SafeAreaProvider>
      <RootApp />
    </SafeAreaProvider>
  )
}
