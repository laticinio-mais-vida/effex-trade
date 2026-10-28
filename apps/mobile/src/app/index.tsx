import { Redirect } from 'expo-router'
import { LoadingView } from '@/components/ui'
import { homeFor, useAuth } from '@/lib/auth'

export default function Index() {
  const { status, user } = useAuth()
  if (status === 'loading') return <LoadingView />
  if (!user) return <Redirect href="/login" />
  return <Redirect href={homeFor(user.role)} />
}
